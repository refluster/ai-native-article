// workforce/lambdas/shared/artefact-writer.ts
//
// Epic-010 Story 3 (#92): per-execution artefact writer for the new
// project-prefixed S3 layout, with a redaction guard at the write seam
// so credential bodies never leave the runner.
//
// Write path (canonical, post-Epic-010):
//
//   s3://wf-bucket-{stage}/projects/{project_id}/{yyyy}/{mm}/{exec_ulid}/{filename}
//
// What this module owns (vs. shared/deliverable.ts):
//
//   - shared/deliverable.ts is the LEGACY writer — `articles/`, `plans/`,
//     `runs/`, `pr-briefs/`, `memory/`, etc. Existing data stays where it
//     is; no back-fill in this PR (per #92 scope-out).
//   - shared/artefact-writer.ts is the Story-3 writer for NEW execution
//     artefacts under `projects/{project_id}/...`. The runner uses this
//     for every new EXEC row's `artifact_ref`. The IAM policy on the
//     runner role grants `s3:PutObject` for both arms; cross-project
//     denial relies on the runner constructing the prefix from the
//     resolved `projectId` and never accepting a caller-supplied key.
//
// Redaction (#92 AC 2 + 3):
//
//   `assertNoSecrets()` scans the body for known credential shapes
//   (GitHub PAT, Anthropic key, Discord bot token, Secrets Manager ARN)
//   and throws `RedactionViolation` on hit. The runner catches the
//   throw and writes an EXEC row with `status="failed_artefact_redaction"`
//   so the failure is visible in the ledger — never silently dropped.
//
// Write order (#92 AC 5):
//
//   The wrapper does PutObject FIRST and returns the `ArtifactRef`.
//   The runner then writes the EXEC row carrying that ref. An EXEC row
//   never points at a non-existent S3 object. The runner's structural
//   tests in agent-runner/dual-write-tests.ts assert this order.

import { createHash } from "node:crypto";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import type { ArtifactRef, ProjectId } from "./project.js";

// One client per cold start. `process.env.BUCKET_NAME` is required at
// Lambda init by deliverable.ts already; we read it lazily here so test
// modules that mock the S3 client don't trip the env-var guard.
const s3 = new S3Client({});

function bucketName(): string {
  const name = process.env.BUCKET_NAME;
  if (!name) throw new Error("BUCKET_NAME env var is required");
  return name;
}

// --- Redaction patterns --------------------------------------------------

/**
 * Patterns the writer refuses to publish. Each entry is `{ name, regex }`
 * so a hit can be reported with a meaningful label without echoing the
 * matched value (which is, by construction, a secret).
 *
 * Coverage (Epic-010 §8, issue #92 AC 2):
 *
 *   - GitHub personal access token   `ghp_…` (and `gho_`, `ghu_`, `ghs_`,
 *                                              `ghr_` companion prefixes)
 *   - Anthropic API key              `sk-ant-…`
 *   - Discord bot token              three base64url segments separated
 *                                    by `.` with the canonical length
 *                                    distribution
 *   - Secrets Manager ARN substring  `arn:aws:secretsmanager:`
 *
 * Patterns are intentionally conservative — false negatives on a novel
 * credential shape are caught by the second line of defence (the IAM
 * runtime trust boundary plus the operator's manual review of
 * `failed_artefact_redaction` events). False positives are surfaced to
 * the operator the same way and are correctable by tightening the
 * skill prompt; the alternative (silent leak) is C-1/W-4 unacceptable.
 */
export const REDACTION_PATTERNS: ReadonlyArray<{ name: string; regex: RegExp }> = [
  {
    name: "github_pat",
    // The five GitHub token prefixes per
    // https://github.blog/2021-04-05-behind-githubs-new-authentication-token-formats/.
    // Suffix is base62 ≥ 30 chars; bound to ≤ 255 to keep the regex linear.
    regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,255}\b/,
  },
  {
    name: "anthropic_api_key",
    // `sk-ant-` prefix with a long base62/url-safe tail. Bound the tail
    // so a malformed input doesn't backtrack catastrophically.
    regex: /\bsk-ant-[A-Za-z0-9_-]{20,200}\b/,
  },
  {
    name: "discord_bot_token",
    // user_id . timestamp . hmac (base64url-ish), per the format
    // discord.py + the discord docs document. Lengths are bounded so
    // the regex is linear; the lower bounds match real tokens.
    regex: /\b[A-Za-z0-9_-]{24,28}\.[A-Za-z0-9_-]{6,7}\.[A-Za-z0-9_-]{27,}\b/,
  },
  {
    name: "secrets_manager_arn",
    // Substring match — any leaked ARN to Secrets Manager is a leak,
    // regardless of which secret it points at.
    regex: /arn:aws:secretsmanager:/,
  },
];

/**
 * Thrown when `assertNoSecrets()` finds a pattern match in the artefact
 * body. The runner catches this, marks the EXEC row
 * `status="failed_artefact_redaction"`, and re-raises (per #92 AC 3).
 *
 * `pattern` carries the friendly pattern name (NOT the matched text) so
 * the error message is safe to log + safe to surface in CloudWatch.
 */
export class RedactionViolation extends Error {
  readonly pattern: string;
  constructor(pattern: string) {
    super(`failed_artefact_redaction: ${pattern} pattern matched`);
    this.name = "RedactionViolation";
    this.pattern = pattern;
  }
}

/**
 * Throw `RedactionViolation` if the body contains any known secret
 * shape. Returns silently on a clean body. The scan is O(body × patterns)
 * with bounded regexes — safe to run on every PutObject.
 */
export function assertNoSecrets(body: string): void {
  for (const { name, regex } of REDACTION_PATTERNS) {
    if (regex.test(body)) {
      throw new RedactionViolation(name);
    }
  }
}

// --- ArtifactRef validation ---------------------------------------------

const SUMMARY_MAX_LEN = 512;

/**
 * Enforce the schema invariants on an `ArtifactRef` (per #92 AC 4):
 *
 *   - `summary` is ≤ 512 chars. Longer values throw — callers MUST
 *     truncate explicitly (so the truncation point is intentional, not
 *     accidental).
 *
 * Other invariants (uri prefix, content_hash shape, size_bytes ≥ 0) are
 * enforced at construction time by `writeProjectArtefact()` below; this
 * helper exists as a defence-in-depth surface for callers that construct
 * an `ArtifactRef` outside the writer (e.g. tests, future migration
 * tooling).
 */
export function assertValidArtifactRef(ref: ArtifactRef): void {
  if (ref.summary.length > SUMMARY_MAX_LEN) {
    throw new Error(
      `ArtifactRef.summary exceeds ${SUMMARY_MAX_LEN} chars (got ${ref.summary.length})`,
    );
  }
  if (ref.size_bytes < 0) {
    throw new Error(`ArtifactRef.size_bytes must be ≥ 0 (got ${ref.size_bytes})`);
  }
  if (!/^[0-9a-f]{64}$/.test(ref.content_hash)) {
    throw new Error(
      `ArtifactRef.content_hash must be 64-char lowercase hex sha256 (got "${ref.content_hash.slice(0, 12)}…")`,
    );
  }
}

// --- Project-prefixed writer --------------------------------------------

export interface WriteProjectArtefactOptions {
  /** Project that owns this artefact. Forms the S3 prefix. */
  projectId: ProjectId;
  /** ULID identifying the execution this artefact belongs to. */
  execUlid: string;
  /** Final filename inside the per-execution folder (e.g. "result.json"). */
  filename: string;
  /** Artefact body. UTF-8 text; binary artefacts are out of scope for v1. */
  body: string;
  /** MIME type to set on the S3 object. */
  contentType: string;
  /**
   * ≤512-char inline preview the EXEC row carries for cheap listing.
   * Caller MUST truncate explicitly — `writeProjectArtefact` throws if
   * `summary.length > 512` rather than silently slicing (per #92 AC 4).
   */
  summary: string;
  /**
   * Override the current date when computing the `{yyyy}/{mm}` prefix.
   * Tests use this to make S3 keys deterministic; production calls omit
   * and the writer uses `new Date()`.
   */
  now?: Date;
}

/**
 * Write one execution's artefact to S3 under the project-prefixed key
 * and return the `ArtifactRef` the caller will embed in the EXEC row.
 *
 * Order of operations (deliberate — see file header, #92 AC 5):
 *
 *   1. `assertNoSecrets(body)`         throws `RedactionViolation` if hit
 *   2. compute sha256 + size_bytes
 *   3. validate the resulting `ArtifactRef`
 *   4. `PutObject` to S3
 *   5. return the ref
 *
 * The runner does the EXEC-row insert AFTER step 5. If step 4 fails the
 * runner never writes an EXEC row pointing at a missing object.
 */
export async function writeProjectArtefact(
  opts: WriteProjectArtefactOptions,
): Promise<ArtifactRef> {
  assertNoSecrets(opts.body);

  if (opts.summary.length > SUMMARY_MAX_LEN) {
    throw new Error(
      `writeProjectArtefact: summary exceeds ${SUMMARY_MAX_LEN} chars (got ${opts.summary.length}); caller must truncate explicitly`,
    );
  }

  const now = opts.now ?? new Date();
  const yyyy = String(now.getUTCFullYear()).padStart(4, "0");
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const key = `projects/${opts.projectId}/${yyyy}/${mm}/${opts.execUlid}/${opts.filename}`;
  const bucket = bucketName();

  const bodyBytes = Buffer.from(opts.body, "utf8");
  const contentHash = createHash("sha256").update(bodyBytes).digest("hex");

  const ref: ArtifactRef = {
    uri: `s3://${bucket}/${key}`,
    content_hash: contentHash,
    content_type: opts.contentType,
    size_bytes: bodyBytes.byteLength,
    summary: opts.summary,
  };
  assertValidArtifactRef(ref);

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: bodyBytes,
      ContentType: opts.contentType,
    }),
  );

  return ref;
}

/**
 * Empty receipt for fire-and-forget skills (per #92 scope: "one artefact
 * per execution OR an empty receipt"). The receipt is a zero-byte
 * `receipt.txt` written at the canonical key — the EXEC row still
 * carries an `artifact_ref`, satisfying the invariant that no EXEC row
 * is written without one.
 */
export async function writeEmptyReceipt(
  projectId: ProjectId,
  execUlid: string,
  now?: Date,
): Promise<ArtifactRef> {
  return await writeProjectArtefact({
    projectId,
    execUlid,
    filename: "receipt.txt",
    body: "",
    contentType: "text/plain; charset=utf-8",
    summary: "",
    now,
  });
}
