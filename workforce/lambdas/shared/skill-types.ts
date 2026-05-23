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

export interface RunnerContext {
  /** Agent slug — fills the {slug} placeholder in handler output. */
  slug: string;
  /** ISO-8601 timestamp captured when the runner started this RUN. */
  startedAt: string;
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
