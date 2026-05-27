// Unit tests for workforce/lambdas/shared/artefact-writer.ts.
//
// Covers Epic-010 Story 3 (#92) acceptance criteria that are testable
// at the helper layer:
//
//   AC 2 — redaction regex catches each named secret shape and throws.
//   AC 4 — artifact_ref.summary truncation enforced (≤512 chars).
//   AC 5 — write order: PutObject runs BEFORE the caller's EXEC insert
//          (asserted here at the helper level; the runner-side
//          structural assertion lives in
//          agent-runner/dual-write-tests.ts).
//
// AC 1 (cross-project IAM denial) and AC 3 (failed_artefact_redaction
// ledger row) are runner-/infra-layer; covered separately in
// agent-runner/dual-write-tests.ts and the README PR write-up.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

process.env.BUCKET_NAME = "wf-bucket-test";
process.env.TABLE_NAME = "wf-table-test";
process.env.STAGE = "test";

// --- S3 mock -------------------------------------------------------------
//
// One module-scoped mock so a single test can assert the SDK call AND
// the writer's return value. The mock records every PutObject input in
// order so the write-order test can assert the count + payload.

interface PutObjectCall {
  Bucket: string;
  Key: string;
  ContentType: string;
  Body: Buffer;
}
const putObjectCalls: PutObjectCall[] = [];

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    async send(cmd: { input: PutObjectCall }) {
      // Defensive copy — the writer mutates Buffer-backed bodies via
      // Buffer.from before send; we want the snapshot at send-time.
      putObjectCalls.push({ ...cmd.input });
      return {};
    }
  },
  PutObjectCommand: class {
    input: PutObjectCall;
    constructor(input: PutObjectCall) {
      this.input = input;
    }
  },
}));

// `./project.js` is type-only here (we import `asProjectId` for the
// brand) but its module body transitively touches `./ddb.js`, which
// throws at evaluation time if TABLE_NAME isn't set. Stubbing `./ddb.js`
// keeps the artefact-writer tests focused on S3 behaviour without
// pulling in the DDB env-var guard.
vi.mock("./ddb.js", () => ({
  getItem: vi.fn(),
  putItem: vi.fn(),
  conditionalPutItem: vi.fn(),
  deleteItem: vi.fn(),
  queryBySkPrefix: vi.fn(async () => []),
  queryByGsi: vi.fn(async () => []),
}));
// Same rationale for `./secrets.js` — project.ts imports getSecret for
// getCredential(); we never exercise that path here.
vi.mock("./secrets.js", () => ({
  getSecret: vi.fn(),
}));

import {
  REDACTION_PATTERNS,
  RedactionViolation,
  assertNoSecrets,
  assertValidArtifactRef,
  writeEmptyReceipt,
  writeProjectArtefact,
} from "./artefact-writer.js";
import type { ArtifactRef, ProjectId } from "./project.js";
import { asProjectId } from "./project.js";

beforeEach(() => {
  putObjectCalls.length = 0;
});

// --- Redaction (AC 2) ----------------------------------------------------

describe("REDACTION_PATTERNS — assertNoSecrets()", () => {
  it("catches a GitHub PAT (ghp_… prefix)", () => {
    const body = "leaked token: ghp_abcdefghijklmnopqrstuvwxyz1234567890";
    expect(() => assertNoSecrets(body)).toThrow(RedactionViolation);
    try {
      assertNoSecrets(body);
    } catch (err) {
      expect((err as RedactionViolation).pattern).toBe("github_pat");
      // Error message includes the pattern name, NOT the matched value.
      expect((err as Error).message).toContain("github_pat");
      expect((err as Error).message).not.toContain("ghp_abcdefg");
    }
  });

  it("catches the other GitHub token prefixes (gho_, ghu_, ghs_, ghr_)", () => {
    for (const prefix of ["gho_", "ghu_", "ghs_", "ghr_"]) {
      const body = `value=${prefix}abcdefghijklmnopqrstuvwxyz1234567890XX`;
      expect(() => assertNoSecrets(body)).toThrow(/github_pat/);
    }
  });

  it("catches an Anthropic API key (sk-ant-… prefix)", () => {
    const body = "key sk-ant-abcdefghijklmnopqrstuvwxyz0123456789 in body";
    expect(() => assertNoSecrets(body)).toThrow(/anthropic_api_key/);
  });

  it("catches a Discord bot token (xxx.yyy.zzz canonical shape)", () => {
    // Real format: 24-28 base64url chars, 6-7 base64url chars, 27+ base64url chars.
    const body =
      "found token: AbCdEfGhIjKlMnOpQrStUvWx.AbCdEf.GhIjKlMnOpQrStUvWxYz0123456789 stop";
    expect(() => assertNoSecrets(body)).toThrow(/discord_bot_token/);
  });

  it("catches a Secrets Manager ARN substring", () => {
    const body =
      "credential at arn:aws:secretsmanager:us-east-1:123456789012:secret:wf/anthropic-AbCdEf was used";
    expect(() => assertNoSecrets(body)).toThrow(/secrets_manager_arn/);
  });

  it("does NOT trip on prose that looks adjacent but is not a credential", () => {
    // No token prefix, no ARN scheme, no Discord-shape dots.
    const body = "The github token contract is documented at /docs/github-token.md.";
    expect(() => assertNoSecrets(body)).not.toThrow();
  });

  it("exports the four canonical patterns by name", () => {
    const names = REDACTION_PATTERNS.map((p) => p.name).sort();
    expect(names).toEqual([
      "anthropic_api_key",
      "discord_bot_token",
      "github_pat",
      "secrets_manager_arn",
    ]);
  });
});

// --- ArtifactRef validation (AC 4) --------------------------------------

describe("assertValidArtifactRef()", () => {
  function validRef(overrides: Partial<ArtifactRef> = {}): ArtifactRef {
    return {
      uri: "s3://wf-bucket-test/projects/p/2026/05/01H/output.md",
      content_hash: "0".repeat(64),
      content_type: "text/markdown; charset=utf-8",
      size_bytes: 42,
      summary: "ok",
      ...overrides,
    };
  }

  it("accepts a well-formed ref", () => {
    expect(() => assertValidArtifactRef(validRef())).not.toThrow();
  });

  it("rejects a 513-char summary (AC 4 boundary)", () => {
    expect(() =>
      assertValidArtifactRef(validRef({ summary: "x".repeat(513) })),
    ).toThrow(/summary exceeds 512/);
  });

  it("accepts a 512-char summary (AC 4 boundary inclusive)", () => {
    expect(() =>
      assertValidArtifactRef(validRef({ summary: "x".repeat(512) })),
    ).not.toThrow();
  });

  it("rejects a negative size_bytes", () => {
    expect(() => assertValidArtifactRef(validRef({ size_bytes: -1 }))).toThrow(
      /size_bytes.*≥ 0/,
    );
  });

  it("rejects a malformed content_hash (not 64-char hex)", () => {
    expect(() => assertValidArtifactRef(validRef({ content_hash: "deadbeef" }))).toThrow(
      /content_hash.*64-char/,
    );
  });
});

// --- writeProjectArtefact — happy path + ordering -----------------------

describe("writeProjectArtefact()", () => {
  const PID: ProjectId = asProjectId("acme");
  const FIXED_NOW = new Date("2026-05-27T12:34:56.000Z");

  it("returns an ArtifactRef with sha256 hash + uri matching the project-prefixed key", async () => {
    const body = "hello world\n";
    const ref = await writeProjectArtefact({
      projectId: PID,
      execUlid: "01HEXEC",
      filename: "output.md",
      body,
      contentType: "text/markdown; charset=utf-8",
      summary: "hello",
      now: FIXED_NOW,
    });
    const expectHash = createHash("sha256").update(Buffer.from(body, "utf8")).digest("hex");
    expect(ref).toEqual({
      uri: "s3://wf-bucket-test/projects/acme/2026/05/01HEXEC/output.md",
      content_hash: expectHash,
      content_type: "text/markdown; charset=utf-8",
      size_bytes: Buffer.byteLength(body, "utf8"),
      summary: "hello",
    });
  });

  it("formats the {yyyy}/{mm} prefix using UTC, zero-padded", async () => {
    await writeProjectArtefact({
      projectId: PID,
      execUlid: "01J",
      filename: "x.json",
      body: "{}",
      contentType: "application/json",
      summary: "",
      now: new Date("2026-01-09T00:00:00.000Z"),
    });
    expect(putObjectCalls[0]!.Key).toBe("projects/acme/2026/01/01J/x.json");
  });

  it("writes the body to S3 BEFORE returning the ref (AC 5)", async () => {
    let bodyAtSendTime: string | undefined;
    const body = "ordered write";
    await writeProjectArtefact({
      projectId: PID,
      execUlid: "01ORD",
      filename: "f.txt",
      body,
      contentType: "text/plain; charset=utf-8",
      summary: "",
      now: FIXED_NOW,
    });
    bodyAtSendTime = putObjectCalls[0]!.Body.toString("utf8");
    expect(bodyAtSendTime).toBe(body);
    expect(putObjectCalls).toHaveLength(1);
    expect(putObjectCalls[0]!.Bucket).toBe("wf-bucket-test");
    expect(putObjectCalls[0]!.ContentType).toBe("text/plain; charset=utf-8");
  });

  it("throws RedactionViolation BEFORE PutObject (AC 2 + AC 5)", async () => {
    await expect(
      writeProjectArtefact({
        projectId: PID,
        execUlid: "01BAD",
        filename: "leak.md",
        body: "secret ghp_abcdefghijklmnopqrstuvwxyz1234567890 here",
        contentType: "text/markdown; charset=utf-8",
        summary: "",
        now: FIXED_NOW,
      }),
    ).rejects.toThrow(RedactionViolation);
    // Critical AC 5 invariant: NO S3 PutObject on redaction failure —
    // an EXEC row would otherwise point at a published-then-redacted
    // object, which defeats the purpose of the guard.
    expect(putObjectCalls).toHaveLength(0);
  });

  it("rejects a >512-char summary at the writer seam (AC 4)", async () => {
    await expect(
      writeProjectArtefact({
        projectId: PID,
        execUlid: "01LONG",
        filename: "x.md",
        body: "ok",
        contentType: "text/markdown; charset=utf-8",
        summary: "x".repeat(513),
        now: FIXED_NOW,
      }),
    ).rejects.toThrow(/summary exceeds 512/);
    expect(putObjectCalls).toHaveLength(0);
  });
});

// --- writeEmptyReceipt — fire-and-forget skills -------------------------

describe("writeEmptyReceipt()", () => {
  it("writes a zero-byte receipt under the project-prefixed key", async () => {
    const PID = asProjectId("acme");
    const ref = await writeEmptyReceipt(
      PID,
      "01RECEIPT",
      new Date("2026-05-27T00:00:00.000Z"),
    );
    expect(ref.uri).toBe("s3://wf-bucket-test/projects/acme/2026/05/01RECEIPT/receipt.txt");
    expect(ref.size_bytes).toBe(0);
    expect(ref.summary).toBe("");
    // sha256 of empty buffer.
    expect(ref.content_hash).toBe(
      createHash("sha256").update(Buffer.alloc(0)).digest("hex"),
    );
    expect(putObjectCalls).toHaveLength(1);
    expect(putObjectCalls[0]!.Body.byteLength).toBe(0);
  });
});
