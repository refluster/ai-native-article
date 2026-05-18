// Deterministic hash of an agent's identity fields. Used by the seed
// Lambda to detect whether a re-seed actually changes identity (cheap
// noop) vs writes through (real change). Also surfaced to the API so
// callers can optimistic-concurrency check identity.

import { createHash } from "node:crypto";
import type { AgentIdentity } from "./agent.js";

const IDENTITY_KEYS = [
  "slug",
  "first_name",
  "last_name",
  "residence",
  "role",
  "model",
  "primary_deliverable_type",
  "primary_deliverable_kind",
  "code_execution",
  "prompt_version",
  "schedule_cron_default",
  "schedule_note",
  "budget_monthly_usd_default",
  "skills",
  "default_project",
  "streams",
  "created_at",
] as const;

export function identityHash(identity: AgentIdentity, systemMd: string): string {
  const canonical: Record<string, unknown> = {};
  for (const k of IDENTITY_KEYS) {
    canonical[k] = identity[k];
  }
  canonical["__system_md_sha"] = sha256(systemMd);
  return sha256(JSON.stringify(canonical));
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
