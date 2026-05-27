// Runtime API surface that workforce skills (workforce/skills/{name}/handler.ts)
// import from. Kept separate from the agent-runner internals so the
// dependency direction is one-way:
//
//   workforce/skills/**/*.ts  →  workforce/lambdas/shared/skill-types.ts
//                                workforce/lambdas/shared/webhook.ts
//                                ...
//
// The agent-runner consumes deterministic handlers via the build-time
// generated workforce/lambdas/shared/skill-registry-generated.ts.

import type { CredentialBag } from "./credential-injector.js";

/**
 * Per-invocation context passed to a skill handler. Epic-010 Story 2-B
 * (#91) added `credentials` — a sealed bag whose readable keys exactly
 * match the skill's `meta.requires[]`. The TS shape is the widest
 * (`CredentialBag` defaulted to all known types) because the registry
 * stores all deterministic handlers under one type; the trust boundary
 * is enforced at RUNTIME via the bag's Proxy throw on undeclared keys.
 * Skill handlers that want stricter compile-time narrowing can re-type
 * `ctx.credentials` to `CredentialBag<R>` where R is a literal subset.
 */
export interface RunnerContext {
  /** Agent slug — fills the {slug} placeholder in handler output. */
  slug: string;
  /** ISO-8601 timestamp captured when the runner started this RUN. */
  startedAt: string;
  /** Sealed credential bag. Reads of keys not in `meta.requires[]` throw. */
  credentials: CredentialBag;
}

export interface DeterministicResult {
  /** Bytes the runner persists to S3 as runs/{slug}/{run_id}/output.{ext}. */
  output: string;
  /** File extension hint for the S3 key. */
  outputExt: "txt" | "json" | "md";
  /** Short summary the runner writes into RUN.output_summary. */
  summary: string;
  /** Optional external-publish side-effect status the runner can log. */
  side_effect?: { kind: string; status: number };
}

export type DeterministicHandler = (ctx: RunnerContext) => Promise<DeterministicResult>;
