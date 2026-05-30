// Handler for the feed-health skill — Epic-011 Story 4 (#131).
// See ./SKILL.md for the contract.
//
// Implements the four W-1 check classes over the AGENT#{slug}/POST#{ulid}
// corpus (PR #149 / Epic-011 Story 1). Designed for two callers:
//
//   1. The agent-runner (`dispatchFeedHealth(ctx)` → DeterministicResult,
//      matching `workforce/lambdas/shared/skill-types.ts`).
//   2. The CI workflow (`workforce/scripts/feed-health.mjs` shells out
//      to `runFeedHealth(deps)` and translates the result into an
//      exit code).
//
// Both surfaces share the same `runFeedHealth()` core so the four checks
// are defined in exactly one place — adding a fifth check is a one-line
// addition to the `CHECKS` table below.
//
// Failure semantics:
//   - The sweep runs to completion, accumulating violations.
//   - After the sweep, if any violation was found, throws
//     `FeedHealthViolationsError` carrying the list. Throwing is
//     load-bearing: the runner records a `status=throw` RUN row and the
//     CI exit code is non-zero. Per-violation CloudWatch metrics are
//     emitted regardless (the alarm fires on the metric, not on the
//     throw).
//   - The sweep-envelope cap (`SWEEP_HARD_CAP = 1000`) throws
//     `SweepEnvelopeExceededError` before the violation list is
//     processed. This is exit code 2 from the CLI per SKILL.md.
//
// SDK imports live in workforce/lambdas/shared/* (matching the
// feed-post handler convention from PR #149) so the skill folder
// doesn't reach into AWS SDK transitive deps directly. The S3
// HeadObject + GetObjectHead wrappers live on `shared/post.ts`.

import {
  fetchPostBodyHead,
  iterateAllPosts,
  postBodyExists,
} from "../../lambdas/shared/post.js";
import type { FeedPostRow } from "../../lambdas/shared/post.js";
import { putCountMetric } from "../../lambdas/shared/cw-metric.js";
import type {
  DeterministicResult,
  RunnerContext,
} from "../../lambdas/shared/skill-types.js";

// ── Public types ─────────────────────────────────────────────────────────

/** Discriminator for the four W-1 check classes. */
export type FeedHealthCheck =
  | "orphaned_body_ref"
  | "llm_artefact_in_head"
  | "finish_reason_length"
  | "zero_tokens_out";

/** One violation surfaced by the sweep. */
export interface FeedHealthViolation {
  check: FeedHealthCheck;
  agent_slug: string;
  post_id: string;
  /** Short human-readable detail (e.g. the body_ref that 404'd, or the
   *  first 50 chars of the artefact-tripping body). ≤256 chars. */
  detail: string;
}

export interface FeedHealthResult {
  rowsScanned: number;
  violations: FeedHealthViolation[];
}

export interface FeedHealthDeps {
  /** Async iterator over all POST rows. Default: `iterateAllPosts()`. */
  iteratePosts: () => AsyncIterable<FeedPostRow>;
  /** Probe whether the S3 body for a POST row exists. Default: HeadObject. */
  bodyExists: (bodyRef: string) => Promise<boolean>;
  /** Fetch the body's first N chars. Default: GetObject + read N bytes. */
  fetchBodyHead: (bodyRef: string, maxChars: number) => Promise<string>;
  /** Emit a count metric. Default: `putCountMetric` (best-effort). */
  putCountMetric: typeof putCountMetric;
}

// ── Constants ────────────────────────────────────────────────────────────

/** Sweep cap. The handler throws `sweep_envelope_exceeded` past this. */
export const SWEEP_HARD_CAP = 1000;

/** CloudWatch namespace — mirrors PR #149's `Workforce/Feed`. */
export const METRIC_NAMESPACE = "Workforce/Feed";
export const METRIC_VIOLATION = "WfFeedHealthViolation";
export const METRIC_SWEPT = "WfFeedHealthSwept";
export const METRIC_VIOLATIONS_TOTAL = "WfFeedHealthViolationsTotal";

/**
 * Same regex set as `workforce/skills/feed-post/handler.ts:LLM_ARTEFACT_PATTERNS`.
 * Duplicated here intentionally (not imported) so the SWEEP catches
 * regex drift between write-time and sweep-time. If the feed-post
 * regex tightens, the sweep regex should tighten in lock-step; if it
 * doesn't, this sweep will start catching things the write-time guard
 * stopped catching — which is exactly the signal the sweep exists to
 * surface (per Story #131 §Scope-Part-B check 2 doc).
 */
export const LLM_ARTEFACT_PATTERNS: readonly RegExp[] = [
  /^as an ai/i,
  /^here is the/i,
  /^here's the/i,
  /^i apologi[sz]e/i,
  /^certainly[!,]/i,
  /^sure[!,]/i,
  /^of course[!,]/i,
  /^i'?m sorry/i,
  /^i cannot/i,
  /^i can'?t/i,
];

/** Head length the artefact regex inspects — matches feed-post handler. */
export const ARTEFACT_HEAD_CHARS = 50;

// ── Errors ───────────────────────────────────────────────────────────────

export class FeedHealthViolationsError extends Error {
  constructor(public readonly violations: FeedHealthViolation[]) {
    super(
      `feed-health: ${violations.length} violation(s) — ` +
        violations.map((v) => `${v.check}:${v.agent_slug}/${v.post_id}`).join(", "),
    );
    this.name = "FeedHealthViolationsError";
  }
}

export class SweepEnvelopeExceededError extends Error {
  constructor(public readonly rowsScanned: number) {
    super(
      `feed-health: sweep envelope exceeded — scanned ${rowsScanned} rows ` +
        `(cap ${SWEEP_HARD_CAP}). Tighten the cap or paginate before next run.`,
    );
    this.name = "SweepEnvelopeExceededError";
  }
}

// ── Defaults ─────────────────────────────────────────────────────────────

const STAGE = process.env.STAGE ?? "dev";

function defaultDeps(): FeedHealthDeps {
  return {
    iteratePosts: () => iterateAllPosts(100),
    bodyExists: postBodyExists,
    fetchBodyHead: fetchPostBodyHead,
    putCountMetric,
  };
}

// ── Sweep core ───────────────────────────────────────────────────────────

/**
 * Run the four-check sweep over the POST corpus.
 *
 * Returns the rows-scanned count + the violation list. Does NOT throw
 * on violations — the caller chooses how to surface them (the runner
 * adapter throws; the CI adapter exits 1). Throws only on operational
 * failures (sweep envelope, SDK errors) so the two outcomes are
 * distinguishable by the caller.
 *
 * The `Stage` dimension is always added by `putCountMetric()` — no
 * extra dimension needed here.
 */
export async function runFeedHealth(
  depsOverride?: Partial<FeedHealthDeps>,
): Promise<FeedHealthResult> {
  const deps: FeedHealthDeps = { ...defaultDeps(), ...depsOverride };
  const violations: FeedHealthViolation[] = [];
  let rowsScanned = 0;

  for await (const row of deps.iteratePosts()) {
    rowsScanned++;
    if (rowsScanned > SWEEP_HARD_CAP) {
      throw new SweepEnvelopeExceededError(rowsScanned);
    }
    const postId = row.sk.replace(/^POST#/, "");
    const slug = row.agent_slug;

    // Check 3: finish_reason==='length'. Cheap (attribute compare), do
    // first so the metric for it lands even if a later check fails.
    if (row.finish_reason === "length") {
      const v: FeedHealthViolation = {
        check: "finish_reason_length",
        agent_slug: slug,
        post_id: postId,
        detail: `finish_reason='length' on POST row (write-time R-9 throw bypassed)`,
      };
      violations.push(v);
      await emitViolation(deps, v);
    }

    // Check 4: zero tokens_out. Same shape — cheap attribute check.
    if (row.tokens_out === 0) {
      const v: FeedHealthViolation = {
        check: "zero_tokens_out",
        agent_slug: slug,
        post_id: postId,
        detail: `tokens_out=0 (empty body / metering pipeline gap)`,
      };
      violations.push(v);
      await emitViolation(deps, v);
    }

    // Check 1: orphaned body_ref. One HeadObject per row — bounded by
    // SWEEP_HARD_CAP. Skip if body_ref is missing/empty (a separate
    // failure mode; the row itself is malformed but that's not one of
    // the four W-1 classes Story #131 names — log + continue).
    if (!row.body_ref) {
      console.warn(
        JSON.stringify({
          event: "feed_health_row_missing_body_ref",
          agent_slug: slug,
          post_id: postId,
        }),
      );
    } else {
      const exists = await deps.bodyExists(row.body_ref);
      if (!exists) {
        const v: FeedHealthViolation = {
          check: "orphaned_body_ref",
          agent_slug: slug,
          post_id: postId,
          detail: `body_ref="${row.body_ref}" did not resolve (HeadObject 404)`,
        };
        violations.push(v);
        await emitViolation(deps, v);
      }
    }

    // Check 2: LLM-artefact regex. Use the inline `body_preview` (≤320
    // chars from PR #149) when long enough — avoids an S3 fetch for
    // every row in the common-case clean sweep. The preview is the
    // first N chars of the body, which is exactly what the regex
    // inspects. body_preview MAY be shorter than ARTEFACT_HEAD_CHARS
    // for legitimately tiny posts (60-char "improvement" posts), in
    // which case "first 50 chars" reduces to "the whole preview" and
    // the regex behaves identically. Only fall back to S3 when
    // body_preview is missing.
    let head: string;
    if (row.body_preview && row.body_preview.length > 0) {
      head = row.body_preview.slice(0, ARTEFACT_HEAD_CHARS);
    } else if (row.body_ref) {
      try {
        head = await deps.fetchBodyHead(row.body_ref, ARTEFACT_HEAD_CHARS);
      } catch (err) {
        // Body fetch failures don't block the sweep. Log + skip; the
        // orphaned_body_ref check above already surfaced the S3 layer
        // problem if relevant.
        console.warn(
          JSON.stringify({
            event: "feed_health_body_fetch_failed",
            agent_slug: slug,
            post_id: postId,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
        head = "";
      }
    } else {
      head = "";
    }
    const trimmedHead = head.trim();
    for (const re of LLM_ARTEFACT_PATTERNS) {
      if (re.test(trimmedHead)) {
        const v: FeedHealthViolation = {
          check: "llm_artefact_in_head",
          agent_slug: slug,
          post_id: postId,
          detail: `pattern ${re.source} matched head="${trimmedHead.slice(0, 100)}"`,
        };
        violations.push(v);
        await emitViolation(deps, v);
        break; // one artefact violation per row is enough
      }
    }
  }

  // Heartbeat metrics — emitted even on clean sweeps so the absence-
  // of-signal alarm catches "the sweep stopped running".
  await deps.putCountMetric(METRIC_NAMESPACE, METRIC_SWEPT, rowsScanned, []);
  await deps.putCountMetric(METRIC_NAMESPACE, METRIC_VIOLATIONS_TOTAL, violations.length, []);

  return { rowsScanned, violations };
}

async function emitViolation(
  deps: FeedHealthDeps,
  v: FeedHealthViolation,
): Promise<void> {
  await deps.putCountMetric(METRIC_NAMESPACE, METRIC_VIOLATION, 1, [
    { Name: "Check", Value: v.check },
  ]);
}

// ── Runner adapter ───────────────────────────────────────────────────────

/**
 * DeterministicHandler entrypoint — the agent-runner invokes this when
 * a binding fires. Returns a DeterministicResult on a clean sweep;
 * throws `FeedHealthViolationsError` on any violation so the runner
 * records a `status=throw` RUN row.
 *
 * The runner does not pass deps — we use the default AWS SDK paths.
 * Tests that want to inject deps call `runFeedHealth()` directly; the
 * dispatch wrapper is a thin adapter that exists to satisfy the
 * skill-registry contract.
 */
export async function dispatchFeedHealth(
  _ctx: RunnerContext,
): Promise<DeterministicResult> {
  const result = await runFeedHealth();
  const summary = `feed-health: ${result.rowsScanned} rows swept, ${result.violations.length} violation(s) — stage=${STAGE}`;
  if (result.violations.length > 0) {
    // Throw AFTER emitting per-violation metrics + writing the
    // output. The runner's RUN row will capture the throw; the
    // CloudWatch alarm fires on `WfFeedHealthViolation` count.
    throw new FeedHealthViolationsError(result.violations);
  }
  return {
    output: JSON.stringify(
      {
        result: "ok",
        rows_scanned: result.rowsScanned,
        violations: [],
        stage: STAGE,
      },
      null,
      2,
    ),
    outputExt: "json",
    summary,
  };
}
