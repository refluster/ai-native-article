// Task / Run / Deliverable row shapes. Mirror workforce/docs/data-model.md.

import type { DeliverableType } from "./agent.js";

export type TaskKind = "l0-to-l1" | "weekly-synthesis" | "hypothesis" | "tech-note" | "design" | "launch" | "pr";

export type TaskStatus = "pending" | "claimed" | "ok" | "failed";

export type RunStatus = "ok" | "throw" | "dlq" | "skipped";

export interface TaskRow {
  pk: `TASK#${string}`;
  sk: "META";
  agent_slug: string;
  project_id: string;
  kind: TaskKind;
  status: TaskStatus;
  created_at: string;
  claimed_at?: string;
  completed_at?: string;
  gsi1pk?: `STATUS#${TaskStatus}`;
  gsi1sk?: string;
}

export interface RunRow {
  pk: `AGENT#${string}`;
  sk: `RUN#${string}`;
  task_id?: string;
  status: RunStatus;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  started_at: string;
  ended_at: string;
  error_message?: string;
  skip_reason?: string;
}

export type DelivStatus = "pending" | "ok" | "timeout";

export interface DelivRow {
  pk: `AGENT#${string}`;
  sk: `DELIV#${string}`;
  type: DeliverableType;
  kind: string;
  project_id: string;
  notion_page_id?: string;
  pr_url?: string;
  s3_key?: string;
  eval_score?: number;
  created_at: string;
  published_at?: string;
  /**
   * Synchronous deliverables (article/plan/design-doc/launch-plan) are
   * undefined here — they finish atomically. Asynchronous deliverables
   * (Ren's pr via Claude Code routine on GHA) carry a status:
   *   - pending  dispatched to GHA, waiting for the PR to appear
   *   - ok       PR found by the orchestrator's poll step
   *   - timeout  24h passed without a PR (W-4 alarm)
   */
  status?: DelivStatus;
  /** Set when the runner dispatched a long-running job (R-N1 exception). */
  dispatched_at?: string;
  /** Branch name the GHA workflow is expected to push to (Ren only). */
  dispatch_branch?: string;
  /** Per-row error context surfaced into the row on timeout. */
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
