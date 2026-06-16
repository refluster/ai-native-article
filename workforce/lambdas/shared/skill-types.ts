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
 *
 * Phase 7 PR3a additions (Lambda-resident multi-project skills):
 *
 * - `project_id` — the resolved project (per Epic-010 §3); the same
 *   id `credentials` were drawn from. Handlers that write to the
 *   PROJECT#{id}/EXEC#* ledger or read PROJECT#{id}/META need it.
 *   Defaults to `self/{slug}` when the invocation didn't specify
 *   (matches RunnerEvent.project_id default).
 *
 * - `args` — invocation-time arguments. For cron-driven bindings this
 *   is always `{}`. For `external` / `manual` schedulers it carries the
 *   trigger payload (e.g. `{pr_url, mode, cycle?}` for pr-autopilot /
 *   pr-review). Handlers MUST treat untrusted values as untrusted —
 *   the runner does not validate `args` shape.
 *
 * - `binding_config` — the `agent.json:bindings[i].config` block for
 *   the firing binding. Skills overlay persona-specific behaviour
 *   here (nomination_rules, checklist_sections, lens_name, ...) per
 *   bindings.md §"persona overlay". Shape is skill-specific; handlers
 *   own validation.
 */
export interface RunnerContext {
  /** Agent slug — fills the {slug} placeholder in handler output. */
  slug: string;
  /** ISO-8601 timestamp captured when the runner started this RUN. */
  startedAt: string;
  /** Sealed credential bag. Reads of keys not in `meta.requires[]` throw. */
  credentials: CredentialBag;
  /** Resolved project id (Epic-010 §3). Defaults to `self/{slug}`. */
  project_id: string;
  /** Invocation-time arguments. Empty for cron-driven bindings. */
  args: Readonly<Record<string, unknown>>;
  /** Binding-level config block (persona overlay). Shape is skill-specific. */
  binding_config: Readonly<Record<string, unknown>>;
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
  /**
   * Optional LLM-cost accounting from inside the handler. Phase 7 PR3a:
   * handlers that themselves call Anthropic (e.g. pr-autopilot) MUST set
   * these so the runner writes accurate tokens_in / tokens_out / cost_usd
   * to the RUN row and respects W-3 (monthly budget cap) on the next
   * pre-flight. Missing fields default to 0 (current discord-ping
   * pattern — deterministic, no LLM, zero cost).
   */
  tokens_in?: number;
  tokens_out?: number;
  cost_usd?: number;
}

export type DeterministicHandler = (ctx: RunnerContext) => Promise<DeterministicResult>;
