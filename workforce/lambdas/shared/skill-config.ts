// Write-time validation for skill judgment-config mutations (ADR-0008).
//
// ADR-0008 makes the SKILL#{name} DDB row authoritative for a skill's
// judgment-side fields, with agents-api the single writer. The shape checks
// that validate-skills.mjs runs in CI against the git folder therefore also
// run here, synchronously at the write boundary, plus the blast-radius
// ceilings that bound an unreviewed-but-schema-valid write (review is the
// post-hoc weekly digest, as with agent config).
//
// Code-side fields are NOT writable here by design: write-scripts and
// requires[] stay git-owned (they are executable code / the credential
// trust boundary), and archetype/deliverable stay with the C1–C3 CI
// invariants. `name` and `created_at` are immutable.
//
// This module is pure (no AWS imports): callers supply the cross-row
// context (does an owner agent exist) via SkillPatchContext.

export interface SkillConfigViolation {
  rule: string;
  field: string;
  msg: string;
}

export const SKILL_PATCHABLE_FIELDS = [
  "body",
  "description",
  "version",
  "status",
  "owners",
  "cost_class",
  "improvement_agent",
  // Operational override — pre-dates ADR-0008 ("PATCH-able in v2" per
  // skill-row.ts) but only gains a write path now.
  "improvement_agent_override",
] as const;

export type SkillPatchableField = (typeof SKILL_PATCHABLE_FIELDS)[number];

// Blast-radius ceiling on the judgment body. Live SKILL.md bodies are
// 2–8 KB; 64 KB bounds an unreviewed write far below the DDB item limit
// while leaving headroom for richer skill contracts.
export const SKILL_BODY_MAX_CHARS = 64 * 1024;
// Mirrors validate-skills.mjs DESCRIPTION_MAX (Anthropic frontmatter spec).
export const SKILL_DESCRIPTION_MAX_CHARS = 1024;

const SEMVER = /^\d+\.\d+\.\d+$/;
const AGENT_SLUG = /^[a-z]+$/;
const XML_TAG = /<[^>]+>/;
const STATUSES = new Set(["active", "stale", "deprecated"]);
const COST_CLASSES = new Set(["small", "medium", "large"]);

export interface SkillPatchContext {
  /** Lookup: agent slug → true when an AGENT#{slug}/META row exists.
   *  Replaces the CI-era owners cross-check against workforce/agents/
   *  (which degraded to shape-only when ADR-0007 deleted that tree —
   *  the API can check existence against the live rows again). */
  agentExists: (slug: string) => boolean;
}

export function validateSkillPatch(
  patch: Readonly<Record<string, unknown>>,
  ctx: SkillPatchContext,
): SkillConfigViolation[] {
  const out: SkillConfigViolation[] = [];
  const v = (rule: string, field: string, msg: string) => out.push({ rule, field, msg });

  if ("body" in patch) {
    if (typeof patch.body !== "string" || patch.body.trim().length === 0) {
      v("K1-body", "body", "body must be a non-empty string");
    } else if (patch.body.length > SKILL_BODY_MAX_CHARS) {
      v(
        "G4-body-size",
        "body",
        `body is ${patch.body.length} chars; the write-time ceiling is ${SKILL_BODY_MAX_CHARS}`,
      );
    }
  }
  if ("description" in patch) {
    if (typeof patch.description !== "string" || patch.description.length === 0) {
      v("M3-description-empty", "description", "description must be a non-empty string");
    } else {
      if (patch.description.length > SKILL_DESCRIPTION_MAX_CHARS) {
        v(
          "M3-description-length",
          "description",
          `description is ${patch.description.length} chars (max ${SKILL_DESCRIPTION_MAX_CHARS})`,
        );
      }
      if (XML_TAG.test(patch.description)) {
        v("M3-description-xml", "description", "description must not contain XML tags");
      }
    }
  }
  if ("version" in patch) {
    if (typeof patch.version !== "string" || !SEMVER.test(patch.version)) {
      v("J3-version", "version", `version must be semver x.y.z`);
    }
  }
  if ("status" in patch && !STATUSES.has(patch.status as string)) {
    v("J4-status", "status", `status "${String(patch.status)}" not in {active, stale, deprecated}`);
  }
  if ("cost_class" in patch && !COST_CLASSES.has(patch.cost_class as string)) {
    v("J6-cost-class", "cost_class", `cost_class "${String(patch.cost_class)}" not in {small, medium, large}`);
  }
  if ("owners" in patch) {
    if (!Array.isArray(patch.owners) || patch.owners.length === 0) {
      v("J7-owners", "owners", "owners must be a non-empty array");
    } else {
      const seen = new Set<string>();
      for (const s of patch.owners) {
        if (typeof s !== "string" || !AGENT_SLUG.test(s)) {
          v("J7-owner-shape", "owners", `owner "${String(s)}" must match ${AGENT_SLUG}`);
          continue;
        }
        if (seen.has(s)) v("J7-owner-duplicate", "owners", `duplicate owner "${s}"`);
        seen.add(s);
        if (!ctx.agentExists(s)) {
          v("J7-owner-exists", "owners", `owner "${s}" has no AGENT#${s} row`);
        }
      }
    }
  }
  for (const field of ["improvement_agent", "improvement_agent_override"] as const) {
    if (!(field in patch)) continue;
    const val = patch[field];
    if (val === null) continue;
    if (typeof val !== "string" || !AGENT_SLUG.test(val)) {
      v("J8-improvement-agent", field, `${field} must be null or an agent slug`);
    } else if (!ctx.agentExists(val)) {
      v("J8-improvement-agent-exists", field, `${field} "${val}" has no AGENT#${val} row`);
    }
  }
  return out;
}
