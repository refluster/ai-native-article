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
  "prompt_version",
  "budget_monthly_usd_default",
  "bindings",
  "default_project",
  "streams",
  "created_at",
  // ADR-0007 step 6a: profile blocks + org edges join the row. Adding
  // them here changes every agent's hash exactly once — intended: the
  // next post-deploy seed write-throughs all non-ddb-owned rows with
  // the new fields (the final backfill before the tree retires at 6b).
  "owner_email",
  "jd",
  "identity",
  "experience",
  "memory",
  "reports_to",
  "lateral",
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
