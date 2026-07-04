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
  "display_name",
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
const STATUSES = new Set(["active", "stale", "deprecated", "archived"]);
const COST_CLASSES = new Set(["small", "medium", "large"]);

export interface SkillPatchContext {
  /** Lookup: agent slug → row state. Replaces the CI-era owners cross-check
   *  against workforce/agents/ (which degraded to shape-only when ADR-0007
   *  deleted that tree — the API can check against the live rows again).
   *  `archived` is rejected too (M4, PR #304 review): a retired agent can
   *  neither own a skill nor run its improvement loop. */
  agentState: (slug: string) => "active" | "archived" | undefined;
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
  if ("display_name" in patch) {
    const d = patch.display_name;
    if (typeof d !== "string" || d.trim().length === 0 || d.trim().length > 120) {
      v("N1-display-name", "display_name", "display_name must be a 1..120 char string after trim");
    } else if (XML_TAG.test(d)) {
      v("N1-display-name-xml", "display_name", "display_name must not contain XML tags");
    }
  }
  if ("version" in patch) {
    if (typeof patch.version !== "string" || !SEMVER.test(patch.version)) {
      v("J3-version", "version", `version must be semver x.y.z`);
    }
  }
  if ("status" in patch && !STATUSES.has(patch.status as string)) {
    v("J4-status", "status", `status "${String(patch.status)}" not in {active, stale, deprecated, archived}`);
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
        const state = ctx.agentState(s);
        if (state === undefined) {
          v("J7-owner-exists", "owners", `owner "${s}" has no AGENT#${s} row`);
        } else if (state === "archived") {
          v("J7-owner-archived", "owners", `owner "${s}" is archived — a retired agent cannot own a skill`);
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
    } else {
      const state = ctx.agentState(val);
      if (state === undefined) {
        v("J8-improvement-agent-exists", field, `${field} "${val}" has no AGENT#${val} row`);
      } else if (state === "archived") {
        v("J8-improvement-agent-archived", field, `${field} "${val}" is archived`);
      }
    }
  }
  return out;
}

// ─── POST /skills — API-first creation (ADR-0017) ─────────────────────────
//
// ADR-0008 kept creation git-only because "a new skill needs its script".
// ADR-0017 splits that: a JUDGMENT-ONLY skill (no bundled write-script, no
// requires[], no deliverable, no archetype) may be created entirely through
// the API — validated here, audited, live on the next fire once bound. A
// skill that needs a write-script / credentials still enters via the git
// scaffold (cadence-forge), because those are code and the credential trust
// boundary (ADR-0008's reasoning stands for the code slice).

export const SKILL_NAME_MAX = 64;
const SKILL_NAME = /^[a-z][a-z0-9-]*$/;
const RESERVED_NAME_TOKENS = ["anthropic", "claude"];

export interface SkillCreateInput {
  name: string;
  description: string;
  body: string;
  display_name?: string;
  version?: string;
  status?: string;
  cost_class?: string;
  owners?: string[];
  improvement_agent?: string | null;
}

export function validateSkillCreate(
  input: Readonly<Record<string, unknown>>,
  ctx: SkillPatchContext,
): SkillConfigViolation[] {
  const out: SkillConfigViolation[] = [];
  const v = (rule: string, field: string, msg: string) => out.push({ rule, field, msg });

  const name = input.name;
  if (typeof name !== "string" || !SKILL_NAME.test(name) || name.length > SKILL_NAME_MAX) {
    v("S0-name", "name", `name must match ${SKILL_NAME} and be ≤${SKILL_NAME_MAX} chars — it is the immutable slug (rename via display_name)`);
  } else if (RESERVED_NAME_TOKENS.some((t) => name.includes(t))) {
    v("S0-name-reserved", "name", `name must not contain a reserved token (${RESERVED_NAME_TOKENS.join(", ")}) — Anthropic skill-name compatibility`);
  }

  // Required judgment fields.
  if (!("description" in input)) v("M3-description-empty", "description", "description is required");
  if (!("body" in input)) v("K1-body", "body", "body is required");
  if (!("owners" in input)) v("J7-owners", "owners", "owners is required (\u22651 existing agent slug \u2014 the authorship/Rule-11 set)");

  // Shared field checks (body/description/display_name/version/status/
  // cost_class/owners/improvement_agent) — same rules as PATCH.
  const patchLike: Record<string, unknown> = { ...input };
  delete patchLike.name;
  out.push(...validateSkillPatch(patchLike, ctx));

  // Unknown / code-side keys are rejected: write-scripts, requires[],
  // archetype, deliverable enter via git only (ADR-0008 code slice).
  const allowed = new Set(["name", "description", "body", "display_name", "version", "status", "cost_class", "owners", "improvement_agent"]);
  for (const k of Object.keys(input)) {
    if (!allowed.has(k)) v("S1-unknown-key", k, `"${k}" is not creatable via the API (code-side fields enter via the git scaffold)`);
  }
  return out;
}
