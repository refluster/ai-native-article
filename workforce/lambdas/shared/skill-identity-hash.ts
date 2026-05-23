// Skill identity hash — sha256 over the identity-bearing fields + the
// SKILL.md body. Used by seed-skills to detect noop vs writethrough.

import { createHash } from "node:crypto";
import type { SkillIdentity } from "./skill-row.js";

const IDENTITY_KEYS = [
  "name",
  "version",
  "description",
  "status",
  "executor",
  "deliverable",
  "cost_class",
  "owners",
  "improvement_agent",
  "created_at",
] as const;

export function skillIdentityHash(identity: SkillIdentity): string {
  const canonical: Record<string, unknown> = {};
  for (const k of IDENTITY_KEYS) {
    canonical[k] = identity[k];
  }
  canonical["__body_sha"] = sha256(identity.body);
  return sha256(JSON.stringify(canonical));
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
