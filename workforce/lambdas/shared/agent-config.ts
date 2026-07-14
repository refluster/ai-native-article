// Write-time validation for agent identity/config mutations (ADR-0007).
//
// ADR-0007 makes the AGENT#{slug} DDB row the single authoritative store
// for agent identity/config, with agents-api as the single writer. The
// schema checks that used to run in CI against workforce/agents/*/agent.json
// (workforce/scripts/validate-agent-json.mjs) therefore move here, enforced
// synchronously at the write boundary — an invalid config is rejected with
// the violation list instead of ever landing in the row (W-4: fail loud,
// earlier than CI did).
//
// Two classes of check live here:
//   1. Intrinsic schema checks ported from validate-agent-json.mjs
//      (S1..S15 / S9 binding structure / R-N4 executor↔scheduler).
//   2. Blast-radius guards (ADR-0007 Decision §6): because human review of
//      config changes is now post-hoc (the weekly audit digest), these
//      ceilings bound what an unreviewed-but-schema-valid write can do.
//      Loosening any of them is a Zone B change.
//
// Checks that depended on repo files at validation time (routine_spec
// existence on disk, feed-post stagger collision across the agents tree)
// cannot run inside the Lambda; routine_spec stays a required string here
// and the stagger check ports with the weekly digest (migration step 4).
//
// This module is pure (no AWS imports): callers supply the cross-row
// context (aggregate budgets, skill ownership) via IdentityPatchContext.

import type { AgentBinding, AgentIdentity } from "./agent.js";

export interface ConfigViolation {
  rule: string;
  field: string;
  msg: string;
}

// Identity fields writable via PATCH. `slug` and `created_at` are immutable
// (a different slug is a different agent), and `identity_hash` / computed
// fields are never client-writable.
export const IDENTITY_PATCHABLE_FIELDS = [
  "first_name",
  "last_name",
  "residence",
  "role",
  "model",
  "prompt_version",
  "budget_monthly_usd_default",
  "default_project",
  "streams",
  "bindings",
  "system_prompt",
  "owner_email",
  "jd",
  "identity",
  "experience",
  "memory",
  "reports_to",
  "lateral",
] as const satisfies readonly (keyof AgentIdentity)[];

// Blast-radius ceiling per profile block (jd / identity / experience /
// memory — ADR-0007 step 6a). These are render-only SPA decks; 16 KB
// serialized bounds an unreviewed write far below the DDB item limit.
export const PROFILE_BLOCK_MAX_CHARS = 16 * 1024;

// Blast-radius ceiling on the persona prompt (ADR-0007 step 2). The live
// system.md bodies are 1–4 KB; 32 KB bounds an unreviewed write well below
// the DDB 400 KB item limit and the model-context budget while leaving
// generous headroom for richer personas.
export const SYSTEM_PROMPT_MAX_CHARS = 32 * 1024;

export type IdentityPatchableField = (typeof IDENTITY_PATCHABLE_FIELDS)[number];

// W-3 cap: sum of effective monthly budgets across non-archived agents.
// The single enforced source of truth (validate-agent-json.mjs retired in
// ADR-0007 migration step 6); governance.md §2 W-3 documents the same value.
// Raised 295 → 500 on 2026-07-14 for continued roster expansion (operator
// direction: positive consensus on growth, provisioning standing headroom so
// routine hires don't each require a cap raise) — and to close the doc/code
// drift this raise exposed: governance.md §2 had already recorded 250 → 295 on
// 2026-07-08 (India Energy desk) while this enforced constant was never lifted
// off 250, which wrongly rejected an in-envelope registration at 253/250.
// Earlier raises: 190 → 250 on 2026-06-28 (Media group, Epic-017); 160 → 190 on
// 2026-06-14 (Finance & Capital group). This constant is the *enforced* W-3 cap
// and MUST stay in lockstep with governance.md §2 — raising one without the
// other is exactly the drift that let the 253/250 false-reject happen.
export const W3_BUDGET_CAP_USD = 500;

const SLUG = /^[a-z]+$/;
const MODEL = /^(anthropic|azure|claude-code):[a-z0-9-]+(?:-[a-z0-9.]+)*$/;
const SEMVER = /^\d+\.\d+\.\d+$/;
const CRON = /^cron\(([^)]+)\)$/;
const SKILL_NAME = /^[a-z][a-z0-9-]*$/;
const RESIDENCE = /^.+,\s*.+$/;

// ADR-0005: single execution substrate. Re-introducing `lambda` (or the
// runner-era `gha`/`cli` shapes) is the #243-class regression this guard
// keeps red. Widening this set requires amending ADR-0005 first.
const ALLOWED_EXECUTORS = new Set(["claude-code-routine"]);
const ALLOWED_SCHEDULERS = new Set([
  "eventbridge",
  "claude-code-routine",
  "gha",
  "external",
  "manual",
]);
const ALLOWED_INVOKED_BY = new Set(["api", "repository_dispatch", "manual"]);
const ALLOWED_STREAMS = new Set(["internal", "client", "editorial"]);

export interface IdentityPatchContext {
  /** Sum of effective (override ?? default) monthly budgets across all
   *  OTHER non-archived agents, for the W-3 aggregate ceiling. Callers
   *  only need to compute this when the patch touches budget fields. */
  otherAgentsEffectiveBudgetUsd: number;
  /** Lookup: skill name → owners[] from the SKILL#{name}/META row, or
   *  undefined when no such skill exists. Used for the binding existence
   *  cross-check; ownership no longer gates bindings (adr-0012). */
  skillOwners: (name: string) => readonly string[] | undefined;
  /** Optional lookup: skill name → lifecycle status. When supplied, a NEW
   *  binding targeting an `archived` skill is rejected (ADR-0017 — archive
   *  is a soft delete; history stays, new wiring stops). Callers that
   *  don't resolve status (older tests) skip the check. */
  skillStatus?: (name: string) => string | undefined;
}

export function validateIdentityPatch(
  patch: Readonly<Record<string, unknown>>,
  ctx: IdentityPatchContext,
): ConfigViolation[] {
  const out: ConfigViolation[] = [];
  const v = (rule: string, field: string, msg: string) => out.push({ rule, field, msg });

  for (const field of ["first_name", "last_name"] as const) {
    if (field in patch && (typeof patch[field] !== "string" || patch[field].length === 0)) {
      v("S3-name", field, `${field} must be a non-empty string`);
    }
  }
  if ("residence" in patch) {
    if (typeof patch.residence !== "string" || !RESIDENCE.test(patch.residence)) {
      v("S3-residence", "residence", `residence must be "City, Country/Region" form`);
    }
  }
  if ("role" in patch && (typeof patch.role !== "string" || patch.role.length === 0)) {
    v("S4-role", "role", "role must be a non-empty string");
  }
  if ("model" in patch) {
    // Doubles as the blast-radius model allowlist: only the three known
    // provider prefixes are writable (ADR-0007 Decision §6).
    if (typeof patch.model !== "string" || !MODEL.test(patch.model)) {
      v("S5-model", "model", `model must match provider:name with provider in {anthropic, azure, claude-code}`);
    }
  }
  if ("prompt_version" in patch) {
    if (typeof patch.prompt_version !== "string" || !SEMVER.test(patch.prompt_version)) {
      v("S7-semver", "prompt_version", "prompt_version must be semver x.y.z");
    }
  }
  if ("system_prompt" in patch) {
    if (typeof patch.system_prompt !== "string" || patch.system_prompt.trim().length === 0) {
      v("S16-system-prompt", "system_prompt", "system_prompt must be a non-empty string");
    } else if (patch.system_prompt.length > SYSTEM_PROMPT_MAX_CHARS) {
      v(
        "G2-prompt-size",
        "system_prompt",
        `system_prompt is ${patch.system_prompt.length} chars; the write-time ceiling is ${SYSTEM_PROMPT_MAX_CHARS}`,
      );
    }
  }
  if ("budget_monthly_usd_default" in patch) {
    out.push(...budgetCeiling("budget_monthly_usd_default", patch.budget_monthly_usd_default, ctx));
  }
  if ("default_project" in patch) {
    if (typeof patch.default_project !== "string" || patch.default_project.length === 0) {
      v("S10-default-project", "default_project", "default_project must be a non-empty string");
    }
  }
  if ("streams" in patch) {
    if (!Array.isArray(patch.streams) || patch.streams.length === 0) {
      v("S11-streams", "streams", "streams must be a non-empty array");
    } else {
      for (const s of patch.streams) {
        if (!ALLOWED_STREAMS.has(s as string)) {
          v("S11-stream-value", "streams", `stream "${String(s)}" not in {internal, client, editorial}`);
        }
      }
    }
  }
  if ("bindings" in patch) {
    if (!Array.isArray(patch.bindings)) {
      v("S9-bindings", "bindings", "bindings must be an array");
    } else {
      patch.bindings.forEach((b, i) => out.push(...validateBinding(b, i, ctx)));
    }
  }
  if ("owner_email" in patch) {
    if (patch.owner_email !== null && typeof patch.owner_email !== "string") {
      v("S14-owner-email", "owner_email", "owner_email must be null or string");
    }
  }
  // Profile blocks (ADR-0007 step 6a): null or a plain object, bounded by
  // the G3 size ceiling. Contents are SPA-rendered decks, not contracts —
  // structural freedom is intentional, the ceiling is the guard.
  for (const field of ["jd", "identity", "experience", "memory"] as const) {
    if (!(field in patch)) continue;
    const val = patch[field];
    if (val === null) continue;
    if (typeof val !== "object" || Array.isArray(val)) {
      v("S17-profile-block", field, `${field} must be null or a plain object`);
    } else if (JSON.stringify(val).length > PROFILE_BLOCK_MAX_CHARS) {
      v("G3-profile-size", field, `${field} exceeds the ${PROFILE_BLOCK_MAX_CHARS}-char serialized ceiling`);
    }
  }
  // Org edges: slug lists. Edge targets are validated as slug-shaped only —
  // cross-row existence (and the no-cycle property) is enforced by the
  // manifest builder's depth derivation, which throws on a broken graph.
  for (const field of ["reports_to", "lateral"] as const) {
    if (!(field in patch)) continue;
    const val = patch[field];
    if (!Array.isArray(val) || val.some((s) => typeof s !== "string" || !SLUG.test(s))) {
      v("S18-org-edges", field, `${field} must be an array of agent slugs`);
    }
  }
  return out;
}

// ─── S19 — role ↔ system_prompt header coherence (ML-014) ──────────────────
// Persona prompts open with `# {Name} — {Title} — {Location}` by convention
// (32/33 conformed exactly when this landed; the 33rd was the incident). The
// {Title} copy and the `role` field are two hand-written statements of the
// same fact with no shared source: on AGENT#maya, `role` was flipped
// Founder→President (mid-June 2026, pre-audit-trail) while the W-5-protected
// prompt kept "Founder" — and every artefact generated FROM the prompt
// inherited the stale title until an operator caught it in a published
// report (2026-07-06). The check runs on the EFFECTIVE row (current row
// merged with the mutation) whenever `role` or `system_prompt` is written:
// a parseable header title must equal `role` exactly — a title change
// updates both fields in one mutation. Prompts without the header
// convention are not constrained (the convention is strong, not a schema).
// The stock auditor is workforce/scripts/check-identity-drift.mjs.

export function promptHeaderTitle(systemPrompt: unknown): string | null {
  if (typeof systemPrompt !== "string") return null;
  const first = systemPrompt.split(/\r?\n/, 1)[0] ?? "";
  const m = first.match(/^#\s+[^—]+—\s*([^—]+?)\s*—/);
  return m?.[1]?.trim() ?? null;
}

export function validateIdentityCoherence(
  effective: Readonly<Record<string, unknown>>,
): ConfigViolation[] {
  const role = typeof effective.role === "string" ? effective.role.trim() : "";
  const title = promptHeaderTitle(effective.system_prompt);
  if (!role || title === null || title === role) return [];
  return [
    {
      rule: "S19-role-prompt-title",
      field: "system_prompt",
      msg: `system_prompt header title "${title}" does not match role "${role}" — a title change writes both fields in one mutation (ML-014)`,
    },
  ];
}

// Fields a POST /agents create body must carry. Everything else writable
// (jd / identity / experience / memory / org edges / owner_email) is
// optional at create time and PATCHable later. `bindings` is required but
// may be `[]` — a new hire typically gets its cadence wired in a second
// step (any existing skill is bindable; ownership is not a prerequisite —
// adr-0012).
export const AGENT_CREATE_REQUIRED_FIELDS = [
  "slug",
  "first_name",
  "last_name",
  "residence",
  "role",
  "model",
  "prompt_version",
  "budget_monthly_usd_default",
  "default_project",
  "streams",
  "bindings",
  "system_prompt",
] as const;

/**
 * Validation for POST /agents (ADR-0007 Decision §2 — the C of the "full
 * CRUD over identity fields" the decision sanctions). Checks required-field
 * presence plus the slug shape, then reuses the per-field PATCH rules so a
 * created row can never carry config a PATCH would have rejected. The
 * caller supplies the same cross-row context as for a patch; `created_at`
 * and the operational/computed slices are server-set, never client-supplied.
 */
export function validateAgentCreate(
  body: Readonly<Record<string, unknown>>,
  ctx: IdentityPatchContext,
): ConfigViolation[] {
  const out: ConfigViolation[] = [];
  for (const field of AGENT_CREATE_REQUIRED_FIELDS) {
    if (!(field in body) || body[field] === undefined || body[field] === null) {
      out.push({ rule: "S0-required", field, msg: `${field} is required on create` });
    }
  }
  if ("slug" in body && (typeof body.slug !== "string" || !SLUG.test(body.slug))) {
    out.push({ rule: "S2-slug", field: "slug", msg: "slug must match /^[a-z]+$/" });
  }
  const { slug: _slug, ...identityFields } = body;
  out.push(...validateIdentityPatch(identityFields, ctx));
  // A create carries the full row, so the S19 coherence check runs on the
  // body directly — a seeded persona can't be born with a role↔prompt split.
  out.push(...validateIdentityCoherence(body));
  return out;
}

/** Guard for the operational budget override (PATCH budget_monthly_usd_override).
 *  `null` clears the override (the default budget takes effect again). */
export function validateBudgetOverride(
  value: unknown,
  ctx: Pick<IdentityPatchContext, "otherAgentsEffectiveBudgetUsd">,
): ConfigViolation[] {
  if (value === null) return [];
  return budgetCeiling("budget_monthly_usd_override", value, ctx);
}

function budgetCeiling(
  field: string,
  value: unknown,
  ctx: Pick<IdentityPatchContext, "otherAgentsEffectiveBudgetUsd">,
): ConfigViolation[] {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return [{ rule: "S8-budget", field, msg: `${field} must be a positive number` }];
  }
  const total = ctx.otherAgentsEffectiveBudgetUsd + value;
  if (total > W3_BUDGET_CAP_USD) {
    return [
      {
        rule: "W3-cap",
        field,
        msg: `effective budgets would sum to USD ${total} across non-archived agents, exceeding the W-3 cap (${W3_BUDGET_CAP_USD})`,
      },
    ];
  }
  return [];
}

function validateBinding(
  raw: unknown,
  i: number,
  ctx: IdentityPatchContext,
): ConfigViolation[] {
  const out: ConfigViolation[] = [];
  const v = (rule: string, msg: string) =>
    out.push({ rule, field: `bindings[${i}]`, msg });

  if (typeof raw !== "object" || raw === null) {
    v("S9-binding-object", "binding must be an object");
    return out;
  }
  const b = raw as Partial<AgentBinding>;

  if (typeof b.skill !== "string" || !SKILL_NAME.test(b.skill)) {
    v("S9-binding-skill", `skill "${String(b.skill)}" must be kebab-case`);
    return out;
  }
  // Skill cross-check against the SKILL# rows: the skill must EXIST. The
  // former owner cross-check (R8-binding-skill-owner — agent must be in the
  // skill's owners[]) was removed by adr-0012: binding is decoupled from
  // ownership, so any agent may bind any existing skill. owners[] keeps its
  // authorship/Rule-11/improvement meaning; it no longer gates bindings.
  if (ctx.skillOwners(b.skill) === undefined) {
    v("R8-binding-skill-exists", `skill "${b.skill}" has no SKILL#${b.skill} row`);
  } else if (ctx.skillStatus?.(b.skill) === "archived") {
    v("R8-binding-skill-archived", `skill "${b.skill}" is archived — unarchive it (PATCH status) before binding (ADR-0017)`);
  }

  if (!ALLOWED_EXECUTORS.has(b.executor as string)) {
    v("S9-binding-executor", `executor "${String(b.executor)}" must be one of ${[...ALLOWED_EXECUTORS].join("|")}`);
    return out;
  }
  if (typeof b.trigger !== "object" || b.trigger === null) {
    v("S9-binding-trigger", "trigger must be an object");
    return out;
  }
  const t = b.trigger;
  if (!ALLOWED_SCHEDULERS.has(t.scheduler as string)) {
    v("S9-binding-scheduler", `trigger.scheduler "${String(t.scheduler)}" must be one of ${[...ALLOWED_SCHEDULERS].join("|")}`);
    return out;
  }
  if (t.scheduler === "eventbridge") {
    if (typeof t.cron !== "string" || !CRON.test(t.cron)) {
      v("S9-binding-cron", `trigger.cron "${String(t.cron)}" must be cron(...) form when scheduler=eventbridge`);
    }
  }
  // Blast-radius cadence floor (ADR-0007 Decision §6): an unreviewed write
  // must not be able to schedule sub-hourly work. A cron whose minute field
  // is anything but a single literal minute (`*`, steps, lists, ranges)
  // fires more than once per hour and is rejected. The orchestrator's RUN
  // dedup bounds actual dispatch further; this bounds the declared intent.
  if (typeof t.cron === "string") {
    const m = CRON.exec(t.cron);
    const minuteField = m?.[1]?.trim().split(/\s+/)[0];
    if (minuteField !== undefined) {
      if (!/^\d{1,2}$/.test(minuteField) || Number(minuteField) > 59) {
        v(
          "G1-cadence-floor",
          `trigger.cron "${t.cron}" fires more than once per hour (minute field "${minuteField}"); the write-time cadence floor is hourly`,
        );
      }
    }
  }
  if (b.executor === "claude-code-routine" && t.scheduler === "claude-code-routine") {
    if (!t.github_event && !t.cron) {
      v("S9-binding-ccr-trigger", "CCR binding requires either trigger.github_event or trigger.cron");
    }
  }
  if (t.scheduler === "external") {
    if (!ALLOWED_INVOKED_BY.has(t.invoked_by as string)) {
      v("S9-binding-external-invoked-by", `scheduler=external requires trigger.invoked_by in ${[...ALLOWED_INVOKED_BY].join("|")}`);
    }
  }
  // CCR-batched bindings MUST declare a project_id (PR β; no default
  // fallback per operator Q3-revise).
  if (
    b.executor === "claude-code-routine" &&
    t.scheduler === "external" &&
    t.invoked_by === "api"
  ) {
    if (typeof b.project_id !== "string" || b.project_id.length === 0) {
      v("S9-binding-ccr-batch-project", "CCR-batched binding (scheduler=external + invoked_by=api) requires explicit project_id");
    }
  }
  if (b.executor === "claude-code-routine") {
    if (typeof b.routine_spec !== "string" || b.routine_spec.length === 0) {
      v("S9-binding-routine-spec", "executor=claude-code-routine requires routine_spec");
    }
  }
  if (b.note !== undefined && typeof b.note !== "string") {
    v("S9-binding-note", "note must be a string if present");
  }
  return out;
}
