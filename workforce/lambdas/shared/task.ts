// Run / Deliverable row shapes. Mirrors workforce/docs/data-model.md.
//
// v1 (1-stage routing): one RUN row per skill execution, fully
// describing what fired, when, and where the output landed. DELIV rows
// only exist for executions that produce a queryable external resource
// (Notion page, GitHub PR). Deterministic side-effects like Discord
// posts are RUN-only — the audit trail is RUN.output_s3_key.

import type { DeliverableType } from "./skill.js";

export type RunStatus = "ok" | "throw" | "dlq" | "skipped";

export interface RunRow {
  pk: `AGENT#${string}`;
  sk: `RUN#${string}`;
  /** Index into agent.bindings[] that triggered this run. */
  binding_idx: number;
  /** Skill that ran (== agent.bindings[binding_idx].skill). */
  skill_name: string;
  /** Skill meta.json:version at the time of the run. */
  skill_version: string;
  /** Cron that fired this run. Captured for retrospective audit even if
   *  the binding's cron is later changed. */
  cron: string;
  status: RunStatus;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  started_at: string;
  ended_at: string;
  /** S3 key with the full output payload (LLM text, deterministic JSON,
   *  Claude-Code brief, ...). Always present on status=ok. */
  output_s3_key?: string;
  /** First 240 chars of the output, for quick display without S3 fetch. */
  output_summary?: string;
  error_message?: string;
  skip_reason?: string;
}

export type DelivStatus = "pending" | "ok" | "timeout";

export interface DelivRow {
  pk: `AGENT#${string}`;
  sk: `DELIV#${string}`;
  /** Mirrors the RUN row that produced this deliverable. */
  run_id: string;
  type: DeliverableType;
  project_id: string;
  /** Notion page id, when publish_notion fired. */
  notion_page_id?: string;
  notion_page_url?: string;
  /** GitHub PR URL, set by orchestrator's poll step for claude-code-routine. */
  pr_url?: string;
  /** Branch name the GHA workflow is expected to push to (claude-code-routine only). */
  dispatch_branch?: string;
  created_at: string;
  published_at?: string;
  status?: DelivStatus;
  dispatched_at?: string;
  error_message?: string;
}

export function newUlid(): string {
  // Crockford base32 ULID, time-sortable. Inline rather than a dep —
  // ~30 lines we'd be on the hook to keep updated. v1 quality is fine.
  const time = Date.now();
  const TIME_LEN = 10;
  const RAND_LEN = 16;
  const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

  let s = "";
  let t = time;
  for (let i = 0; i < TIME_LEN; i++) {
    s = ALPHABET[t & 31] + s;
    t = Math.floor(t / 32);
  }
  const rand = new Uint8Array(RAND_LEN);
  cryptoRandom(rand);
  for (let i = 0; i < RAND_LEN; i++) {
    s += ALPHABET[rand[i]! & 31];
  }
  return s;
}

function cryptoRandom(out: Uint8Array): void {
  // Node 19+ exposes globalThis.crypto; Lambda nodejs24.x has it.
  globalThis.crypto.getRandomValues(out);
}
