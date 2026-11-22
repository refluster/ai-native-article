// ledger-watch/ledger-payload.mjs — pure, network-free helpers for post.mjs.
//
// Mirrors the project ledger's observation validation (workflow-foundry
// apps/subsidy-registry/api/service.py: normalize_run, normalize_observation,
// validate_patch and its PROGRAM_FIELDS table) so that anything the ledger
// would answer with 400 or mark `rejected` fails HERE, before a feed receipt
// is spent. A receipt post has no delete counterpart on the feed (ADR-0017),
// so a run the ledger refuses after the receipt is a stray public post.
//
// Where this file is stricter than the ledger it says so (`// skill rule`):
// those are the cadence's own discipline (https fetch-failure URLs, no
// unknown run keys, a no-change may not cite a page that failed to load).
// Everything else is a one-to-one mirror. If the ledger's validation changes,
// change this file in the same breath. Two lenient corners of the ledger are
// deliberately not mirrored (this file refuses what the ledger would take,
// which can only cost a local rerun, never a stray receipt): Python's
// `re.match(…$)` accepts a code or slug with one trailing "\n", and
// `datetime.fromisoformat` accepts a lowercase "t", a 7+ digit fraction and
// an "+HH" offset.
//
// Contract v1.1 (API.md §5): change_type `unconfirmed`, an optional
// `run.fetch_failures[].program_code`, and `run.discovery_mode`. A ledger
// still on v1.0 rejects the first two, so post.mjs refuses to post a payload
// that uses them to a ledger that does not advertise v1.1 (see
// `ledgerContract` below) — the deploy order is ledger first, then this skill.
//
// Lengths are counted in code points, as Python's len() does.
// Nothing in this file touches the network or the filesystem; post.mjs owns
// the I/O. Exported for post-tests.ts.

import { createHash } from "node:crypto";

export const MAX_OBSERVATIONS = 20;

/** The ledger contract major this file mirrors. A worklist that reports a
 *  different major in `contract_version` stops the run before any feed post. */
export const LEDGER_CONTRACT_MAJOR = 1;
/** The contract version this file implements (API.md §5 = v1.1). */
export const LEDGER_CONTRACT_VERSION = "1.1";
export const MAX_REQUEST_BYTES = 256 * 1024;

// ── enums (service.py constants) ─────────────────────────────────────────────
export const STATUSES = ["open", "suspended", "closed", "pending_reopen"]; // `candidate` is never writable
const AUTO_TYPES = ["verified_no_change", "note", "budget_signal", "unconfirmed"]; // unconfirmed: v1.1 §5.1
const REVIEW_TYPES = ["status_changed", "amount_changed", "deadline_changed", "requirements_changed",
  "form_changed", "source_changed", "new_program"];
export const CHANGE_TYPES = Object.freeze([...AUTO_TYPES, ...REVIEW_TYPES]);
export const PROPOSED_REQUIRED = new Set(REVIEW_TYPES);
/** Types that say "I read this page this fire" — they may not cite a URL the
 *  run lists as failed to load. */
const READ_TYPES = new Set(["verified_no_change", "unconfirmed"]);
export const DISCOVERY_MODES = ["search", "seed_pages", "skipped"]; // v1.1 §5.4; absent = skipped
export const SEED_QUERY_PREFIX = "seed:";
const CONFIDENCE = ["high", "medium", "low"];
const NEXT_ACTION_TYPES = ["requote_open_estimates", "notify_active_cases", "update_eligibility_rules",
  "update_form_map", "contractor_enrollment", "confirm_with_client", "recheck", "none"];
const APPLICANTS = ["customer", "contractor", "customer_tax_return", "unknown"];
const RELEVANCE = ["direct", "adjacent", "pointer", "reference", "out_of_area", "not_covered"];
const DESKS = ["valeria", "soledad"];
const LEVELS = ["federal", "state", "regional", "utility", "city"];
const UTILITY_TYPES = ["gas", "electric", "water", "air_district"];
const EQUIPMENT = ["gas_tankless", "gas_storage", "hpwh", "hp_hvac", "other"];
const SEGMENTS = ["single_family", "multifamily", "commercial", "income_qualified"];
const PAYEES = ["customer", "contractor"];
const CHANNELS = ["online", "portal", "mail", "tax_return", "point_of_sale"];
const RULE_OPS = ["eq", "ne", "in", "not_in", "gte", "lte", "between", "present", "is_true", "is_false"];

export const PROGRAM_CODE = /^[a-z][a-z0-9_]{2,48}$/;
const SLUG = /^[a-z][a-z0-9_-]{1,40}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const OBSERVED_AT_TOLERANCE_MS = 14 * 3600_000; // observed_at may be up to (now + 14h).date()
const STARTED_AT_TOLERANCE_MS = 10 * 60_000;

/** Fields a `proposed` block may never carry (service.py NOT_WRITABLE incl. OPERATIONAL and COMPUTED). */
export const PROPOSED_FORBIDDEN = new Set(["code", "version", "updated_at", "updated_by", "status_history",
  "created_at", "created_by",
  "attention", "needs_human", "fetch_fail_streak", "fetch_fail_run", // OPERATIONAL (v1.1 adds the last three)
  "stale", "days_to_deadline", "pending_count", "verify_interval_effective"]);

// ── primitives (v_str, v_date, … in service.py) ──────────────────────────────
class Invalid extends Error {}
const fail = (path, msg) => { throw new Invalid(`${path}: ${msg}`); };
const chars = (s) => [...s].length;
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Python json.dumps(v, ensure_ascii=False) length (", " and ": " separators). */
function pyJsonLen(v) {
  const enc = (x) => {
    if (Array.isArray(x)) return `[${x.map(enc).join(", ")}]`;
    if (isObj(x)) return `{${Object.entries(x).map(([k, y]) => `${JSON.stringify(k)}: ${enc(y)}`).join(", ")}}`;
    return JSON.stringify(x);
  };
  return chars(enc(v));
}

function isRealDate(s) {
  if (typeof s !== "string" || !DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
/** ISO datetime WITH a zone, not a bare date (parse_datetime + v_datetime). */
function parseZonedDateTime(s) {
  if (typeof s !== "string" || DATE.test(s)) return null;
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(:(\d{2})(\.\d{1,6})?)?(Z|[+-](\d{2}):?(\d{2}))$/.exec(s);
  if (!m) return null;
  // Date.parse rolls 2026-02-30 over to March and takes T24:00; Python's
  // fromisoformat refuses both, so check the fields first.
  if (!isRealDate(m[1]) || Number(m[2]) > 23 || Number(m[3]) > 59 || Number(m[5] ?? 0) > 59) return null;
  if (m[8] !== undefined && (Number(m[8]) > 23 || Number(m[9]) > 59)) return null;
  const t = Date.parse(s.replace(" ", "T"));
  return Number.isNaN(t) ? null : new Date(t);
}

const vStr = (max, { nullable = true, min = 0 } = {}) => (p, v) => {
  if (v === null && nullable) return;
  if (typeof v !== "string") fail(p, "must be a string");
  if (chars(v) < min) fail(p, `at least ${min} character(s)`);
  if (chars(v) > max) fail(p, `at most ${max} characters`);
};
const vDate = ({ nullable = true } = {}) => (p, v) => {
  if (v === null && nullable) return;
  if (!isRealDate(v)) fail(p, "must be an ISO date (YYYY-MM-DD)");
};
const vDateTime = (p, v) => {
  if (v === null) return;
  if (!parseZonedDateTime(v)) fail(p, "must be an ISO date-time with a time zone");
};
const vEnum = (values, { nullable = false } = {}) => (p, v) => {
  if (v === null && nullable) return;
  if (!values.includes(v)) fail(p, `must be one of ${values.join("|")}`);
};
const vBool = ({ nullable = false } = {}) => (p, v) => {
  if (v === null && nullable) return;
  if (typeof v !== "boolean") fail(p, "must be true/false");
};
const vInt = (lo, hi) => (p, v) => {
  if (!Number.isInteger(v) || v < lo || v > hi) fail(p, `must be an integer ${lo}–${hi}`);
};
const vNumber = (p, v) => {
  if (v === null) return;
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) fail(p, "must be a number ≥ 0");
};
const vUrl = ({ nullable = false } = {}) => (p, v) => {
  if (v === null && nullable) return;
  vStr(2000, { nullable: false })(p, v);
  if (!v.startsWith("https://") || v.length <= "https://".length) fail(p, "must be an https:// URL");
};
const vList = (item, { max = 100, nullable = false } = {}) => (p, v) => {
  if (v === null && nullable) return;
  if (!Array.isArray(v)) fail(p, "must be an array");
  if (v.length > max) fail(p, `at most ${max} entries`);
  v.forEach((x, i) => item(`${p}[${i}]`, x));
};
/** fields === null → any JSON object up to 20000 serialised characters. */
const vDict = (fields, { nullable = false } = {}) => (p, v) => {
  if (v === null && nullable) return;
  if (!isObj(v)) fail(p, "must be an object");
  if (fields === null) {
    if (pyJsonLen(v) > 20000) fail(p, "too large");
    return;
  }
  for (const [k, x] of Object.entries(v)) {
    if (!(k in fields)) fail(`${p}.${k}`, "is not a writable field");
    fields[k](`${p}.${k}`, x);
  }
};
const enumList = (values) => vList(vEnum(values), { max: values.length, nullable: true });
const strList = (n, len, { nullable = false } = {}) => vList(vStr(len, { nullable: false, min: 1 }), { max: n, nullable });
const vCode = (p, v) => {
  if (typeof v !== "string" || !PROGRAM_CODE.test(v)) fail(p, `must be a program code (${PROGRAM_CODE})`);
};

// ── program fields a `proposed` block may write (PROGRAM_FIELDS) ─────────────
const PROCESS_FIELDS = {
  pre_approval_required: vBool({ nullable: true }),
  permit_number_required: vBool({ nullable: true }),
  contractor_enrollment_required: vBool({ nullable: true }),
  install_by: vDate(),
  apply_by: vDate(),
  payee_options: enumList(PAYEES),
  required_documents: strList(50, 300, { nullable: true }),
  application_channel: vEnum(CHANNELS, { nullable: true }),
  application_url: vUrl({ nullable: true }),
  processing_time_note: vStr(600),
};
const UTILITY_FIELDS = { type: vEnum(UTILITY_TYPES), id: vStr(60, { nullable: false, min: 1 }) };
const JURISDICTION_FIELDS = {
  level: vEnum(LEVELS, { nullable: true }),
  counties: strList(30, 60, { nullable: true }),
  cities: strList(100, 80, { nullable: true }),
  utilities: vList(vDict(UTILITY_FIELDS), { max: 20, nullable: true }),
  territory_note: vStr(1000),
};
const BUDGET_FIELDS = { total_usd: vNumber, remaining_usd: vNumber, as_of: vDate(), note: vStr(600) };
const FORM_FIELDS = { url: vUrl({ nullable: true }), version: vStr(100), link_pattern: vStr(200), version_from: vStr(200) };
const SOURCE_FIELDS = {
  url: vUrl(),
  kind: vEnum(["html", "pdf"], { nullable: true }),
  watch: strList(10, 40),
  look_for_ja: vStr(1000),
  primary_source: vBool(),
  focus_start: vStr(200),
  focus_end: vStr(200),
  url_origin: vStr(100),
  last_checked: vDate(),
  checked_by: vStr(200),
  last_fetch_note_ja: vStr(600),
};
const vSource = (p, v) => {
  vDict(SOURCE_FIELDS)(p, v);
  if (!("url" in v)) fail(p, "url is required");
};
const vRule = (p, v) => {
  vDict(null)(p, v);
  vStr(200, { nullable: false, min: 1 })(`${p}.fact`, v.fact ?? null);
  vEnum(RULE_OPS)(`${p}.op`, v.op ?? null);
  vStr(600, { nullable: false, min: 1 })(`${p}.reason`, v.reason ?? null);
};
const PROGRAM_FIELDS = {
  name: vStr(200, { nullable: false }),
  name_ja: vStr(200, { nullable: false }),
  reference: vStr(400, { nullable: false }),
  applicant: vEnum(APPLICANTS),
  applicant_note_ja: vStr(1000),
  primary: vBool(),
  relevance: vEnum(RELEVANCE),
  follows: (p, v) => { if (v !== null) vCode(p, v); },
  requires_program: (p, v) => { if (v !== null) vCode(p, v); },
  status: vEnum(STATUSES),
  status_as_of: vDate({ nullable: false }),
  status_since: vDate(),
  status_note_ja: vStr(2000),
  effective_from: vDate(),
  deadline: vDate(),
  form_version: vStr(100),
  form: vDict(FORM_FIELDS, { nullable: true }),
  amount: vDict(null),
  stackable_with: vList(vCode, { max: 50 }),
  not_stackable_with: vList(vCode, { max: 50 }),
  stacking_note_ja: vStr(1000),
  watch_terms: strList(30, 100),
  sources: vList(vSource, { max: 20 }),
  rules: vList(vRule, { max: 50 }),
  alternative_choice_en: vStr(300),
  owner_desk: vEnum(DESKS, { nullable: true }),
  jurisdiction: vDict(JURISDICTION_FIELDS, { nullable: true }),
  equipment: enumList(EQUIPMENT),
  customer_segments: enumList(SEGMENTS),
  process: vDict(PROCESS_FIELDS, { nullable: true }),
  budget: vDict(BUDGET_FIELDS, { nullable: true }),
  open_questions: strList(50, 600),
  verify_interval_days: vInt(1, 365),
  last_verified_at: vDateTime,
};

function validatePatch(patch, p = "proposed") {
  if (!isObj(patch)) fail(p, "must be an object");
  for (const [k, v] of Object.entries(patch)) {
    if (PROPOSED_FORBIDDEN.has(k)) fail(`${p}.${k}`, "is not writable through an observation");
    if (!(k in PROGRAM_FIELDS)) fail(`${p}.${k}`, "is not a known program field");
    PROGRAM_FIELDS[k](`${p}.${k}`, v);
  }
}

// ── observation (normalize_observation) ─────────────────────────────────────
const OBS_KEYS = new Set(["program_code", "change_type", "observed_at", "summary", "evidence", "proposed",
  "confidence", "next_actions", "affects"]);
const EVIDENCE_FIELDS = { url: vUrl(), quote: vStr(500, { nullable: false, min: 1 }), page_date: vDate(), primary_source: vBool() };
const ACTION_FIELDS = { type: vEnum(NEXT_ACTION_TYPES), detail: vStr(300), due: vDate() };

function validateObservation(o, p, { now, failedUrls, knownCodes }) {
  if (!isObj(o)) fail(p, "must be an object");
  for (const k of Object.keys(o)) if (!OBS_KEYS.has(k)) fail(`${p}.${k}`, "unknown key");
  vCode(`${p}.program_code`, o.program_code);
  vEnum(CHANGE_TYPES)(`${p}.change_type`, o.change_type ?? null);
  vDate({ nullable: false })(`${p}.observed_at`, o.observed_at ?? null);
  const latest = new Date(now.getTime() + OBSERVED_AT_TOLERANCE_MS).toISOString().slice(0, 10);
  if (o.observed_at > latest) fail(`${p}.observed_at`, `${o.observed_at} is in the future`);
  vStr(600, { nullable: false, min: 1 })(`${p}.summary`, o.summary ?? null);
  if (!o.summary.trim()) fail(`${p}.summary`, "must not be blank");

  vList((q, e) => {
    vDict(EVIDENCE_FIELDS)(q, e);
    for (const k of ["url", "quote", "primary_source"]) if (!(k in e)) fail(`${q}.${k}`, "is required");
  }, { max: 5 })(`${p}.evidence`, o.evidence ?? null);
  if (o.evidence.length === 0) fail(`${p}.evidence`, "at least one entry");

  const ct = o.change_type;
  const proposed = o.proposed ?? null;
  if (PROPOSED_REQUIRED.has(ct)) {
    if (proposed === null) fail(`${p}.proposed`, `is required for ${ct}`);
    validatePatch(proposed, `${p}.proposed`);
    if (Object.keys(proposed).length === 0) fail(`${p}.proposed`, "must not be empty");
    if (ct === "new_program") {
      if (!("status" in proposed)) fail(`${p}.proposed.status`, "is required for new_program");
      if (!["name", "name_ja", "reference"].some((k) => proposed[k])) {
        fail(`${p}.proposed`, "new_program needs a name, name_ja or reference");
      }
    }
  } else if (ct === "budget_signal") {
    if (proposed !== null) {
      validatePatch(proposed, `${p}.proposed`);
      if (Object.keys(proposed).some((k) => k !== "budget")) fail(`${p}.proposed`, "budget_signal may only propose `budget`");
    }
  } else if (proposed !== null) {
    fail(`${p}.proposed`, `must be absent for ${ct}`);
  }

  vEnum(CONFIDENCE)(`${p}.confidence`, o.confidence ?? null);
  vList((q, a) => {
    vDict(ACTION_FIELDS)(q, a);
    if (!("type" in a)) fail(`${q}.type`, "is required");
  }, { max: 10, nullable: true })(`${p}.next_actions`, o.next_actions ?? []);
  const affects = o.affects ?? {};
  vDict(null, { nullable: true })(`${p}.affects`, affects);
  if (pyJsonLen(affects) > 2000) fail(`${p}.affects`, "at most 2000 serialised characters");

  // The ledger answers `rejected: unknown_program` for these. The script
  // reads the known codes from the public worklist before posting.
  if (knownCodes && ct !== "new_program" && !knownCodes.has(o.program_code)) {
    fail(`${p}.program_code`, `"${o.program_code}" is not in the ledger (use new_program for a new one)`);
  }
  // skill rules
  if (READ_TYPES.has(ct)) {
    const bad = o.evidence.filter((e) => failedUrls.has(e.url)).map((e) => e.url);
    if (bad.length) fail(`${p}.evidence`, `${ct} cites ${bad.join(", ")}, which run.fetch_failures says could not be read`);
  }
  if (ct === "new_program" && !o.evidence.some((e) => e.primary_source === true)) {
    fail(`${p}.evidence`, "new_program needs at least one primary_source: true entry");
  }
}

// ── run (normalize_run) ──────────────────────────────────────────────────────
const RUN_KEYS = new Set(["agent_slug", "started_at", "checked_programs", "fetch_failures", "discovery_queries",
  "discovery_mode", "note", "skill_version"]);
const FAILURE_FIELDS = {
  url: vStr(2000, { nullable: false }),
  reason: vStr(300, { nullable: false }),
  program_code: (p, v) => { if (v !== null) vCode(p, v); }, // v1.1 §5.2, optional
};

function validateRun(run, { agent, now, knownCodes }) {
  if (!isObj(run)) fail("run", "required object");
  for (const k of Object.keys(run)) if (!RUN_KEYS.has(k)) fail(`run.${k}`, "unknown key"); // skill rule
  if (typeof run.agent_slug !== "string" || !SLUG.test(run.agent_slug)) fail("run.agent_slug", `must match ${SLUG}`);
  if (run.agent_slug !== agent) fail("run.agent_slug", `must equal --agent "${agent}" (the ledger checks it against the attestation)`);
  const started = parseZonedDateTime(run.started_at);
  if (!started) fail("run.started_at", "required ISO date-time with a time zone, e.g. 2026-11-19T15:30:00Z");
  if (started.getTime() > now.getTime() + STARTED_AT_TOLERANCE_MS) fail("run.started_at", "is in the future");
  vList(vCode, { max: 200, nullable: true })("run.checked_programs", run.checked_programs ?? []);
  vList((q, f) => {
    vDict(FAILURE_FIELDS)(q, f);
    vUrl()(`${q}.url`, f.url ?? null); // skill rule: a failure names the https page that failed
    if (typeof f.reason !== "string" || !f.reason.trim()) fail(`${q}.reason`, "required, e.g. \"HTTP 403\""); // skill rule
    // skill rule: a program_code the ledger does not hold would silently never
    // count toward that row's fetch_fail_streak.
    if (knownCodes && typeof f.program_code === "string" && !knownCodes.has(f.program_code)) {
      fail(`${q}.program_code`, `"${f.program_code}" is not in the ledger`);
    }
  }, { max: 100, nullable: true })("run.fetch_failures", run.fetch_failures ?? []);
  const queries = run.discovery_queries ?? [];
  strList(50, 300, { nullable: true })("run.discovery_queries", queries);
  vEnum(DISCOVERY_MODES, { nullable: true })("run.discovery_mode", run.discovery_mode ?? null);
  vStr(1000)("run.note", run.note ?? null);
  vStr(40)("run.skill_version", run.skill_version ?? null);

  // skill rules (0.2.0): say how discovery ran, and make the record match it.
  const mode = run.discovery_mode;
  const list = Array.isArray(queries) ? queries : [];
  const seeds = list.filter((q) => typeof q === "string" && q.startsWith(SEED_QUERY_PREFIX));
  if (mode === undefined || mode === null) {
    fail("run.discovery_mode", `required: one of ${DISCOVERY_MODES.join("|")} (skipped needs the reason in run.note)`);
  }
  if (mode === "skipped" && !(typeof run.note === "string" && run.note.trim())) {
    fail("run.note", "discovery_mode \"skipped\" needs the reason in run.note");
  }
  if (mode === "seed_pages") {
    if (seeds.length === 0) fail("run.discovery_queries", `discovery_mode "seed_pages" needs one "${SEED_QUERY_PREFIX}<url>" entry per seed page read`);
    for (const q of seeds) {
      if (!q.slice(SEED_QUERY_PREFIX.length).startsWith("https://")) fail("run.discovery_queries", `"${q}" must be ${SEED_QUERY_PREFIX}https://…`);
    }
  }
  if (mode === "search" && list.length === seeds.length) {
    fail("run.discovery_queries", "discovery_mode \"search\" needs the search queries you ran");
  }
}

/** True when the payload uses a construct a v1.0 ledger rejects (API.md §5). */
export function usesContractV11(payload) {
  const obs = Array.isArray(payload?.observations) ? payload.observations : [];
  const failures = Array.isArray(payload?.run?.fetch_failures) ? payload.run.fetch_failures : [];
  return obs.some((o) => o?.change_type === "unconfirmed") || failures.some((f) => isObj(f) && "program_code" in f);
}

/**
 * Read the contract handshake from a parsed worklist response.
 * Returns `{ major, version, v11, warning?, error? }`:
 *  - `contract_version` absent → `warning` (proceed; the ledger cannot be checked);
 *  - present but not "MAJOR[.MINOR…]" (string or integer) → `error`;
 *  - present with a major other than LEDGER_CONTRACT_MAJOR → `error`.
 * `v11` is true when the ledger advertises v1.1 by version (≥ 1.1) or, while
 * it does not send a version yet, by the v1.1 worklist field
 * `discovery.seed_urls` (API.md §5.4).
 */
export function ledgerContract(worklist) {
  const seedUrls = Array.isArray(worklist?.discovery?.seed_urls);
  const raw = worklist?.contract_version;
  if (raw === undefined || raw === null) {
    return {
      major: null, version: null, v11: seedUrls,
      warning: `the ledger's worklist carries no contract_version; cannot confirm it speaks contract v${LEDGER_CONTRACT_MAJOR}.x (proceeding)`,
    };
  }
  const text = typeof raw === "number" && Number.isInteger(raw) ? String(raw) : raw;
  if (typeof text !== "string" || !/^\d+(\.\d+)*$/.test(text)) {
    return { major: null, version: raw, v11: false, error: `the ledger reports an unreadable contract_version ${JSON.stringify(raw)}` };
  }
  const [major, minor = 0] = text.split(".").map(Number);
  if (major !== LEDGER_CONTRACT_MAJOR) {
    return {
      major, version: text, v11: false,
      error: `the ledger speaks contract v${text}; this skill implements v${LEDGER_CONTRACT_VERSION} (major ${LEDGER_CONTRACT_MAJOR}). Update ledger-payload.mjs to the new contract before posting`,
    };
  }
  return { major, version: text, v11: minor >= 1 || seedUrls };
}

/**
 * Validate and normalise a parsed ledger payload.
 * Returns `{ errors: string[], payload }`. `payload` is a normalised copy
 * (run.skill_version filled from ctx.skillVersion — meta.json — when absent); it is meaningful
 * only when `errors` is empty. One error per observation, like the ledger.
 *
 * @param {unknown} raw
 * @param {{ agent: string, skillVersion?: string, now?: Date, knownCodes?: Set<string> }} ctx
 */
export function validatePayload(raw, ctx) {
  const now = ctx.now ?? new Date();
  const errors = [];
  const attempt = (fn) => {
    try { fn(); } catch (e) { if (e instanceof Invalid) errors.push(e.message); else throw e; }
  };
  if (!isObj(raw)) return { errors: ["payload: must be a JSON object {run, observations}"], payload: raw };
  for (const k of Object.keys(raw)) {
    if (k !== "run" && k !== "observations") errors.push(`payload: unknown key "${k}" (only run, observations)`);
  }
  const run = isObj(raw.run) ? { ...raw.run } : raw.run;
  if (isObj(run)) {
    if (run.skill_version === undefined && ctx.skillVersion) run.skill_version = ctx.skillVersion;
    if (ctx.skillVersion && run.skill_version !== ctx.skillVersion) {
      errors.push(`run.skill_version: "${run.skill_version}" differs from the skill's version "${ctx.skillVersion}" (meta.json)`);
    }
  }
  attempt(() => validateRun(run, { agent: ctx.agent, now, knownCodes: ctx.knownCodes }));

  const failedUrls = new Set(
    Array.isArray(run?.fetch_failures) ? run.fetch_failures.filter(isObj).map((f) => f.url) : [],
  );
  const obs = raw.observations;
  if (!Array.isArray(obs)) {
    errors.push("observations: required array (may be empty)");
  } else {
    if (obs.length > MAX_OBSERVATIONS) errors.push(`observations: ${obs.length} entries; max ${MAX_OBSERVATIONS} per run`);
    obs.forEach((o, i) => attempt(() => validateObservation(o, `observations[${i}]`, { now, failedUrls, knownCodes: ctx.knownCodes })));
  }
  return { errors, payload: { run, observations: obs } };
}

// ── feed receipt body (W-1) ──────────────────────────────────────────────────

/** The feed endpoint's own LLM-artefact prelude set (shared/post.ts). */
const ARTEFACT_PRELUDES = [
  /^as an ai/i, /^here is the/i, /^here's the/i, /^i apologi[sz]e/i, /^certainly[!,]/i,
  /^sure[!,]/i, /^of course[!,]/i, /^i'?m sorry/i, /^i cannot/i, /^i can'?t/i,
];
export const SUMMARY_MIN_CHARS = 40;
export const SUMMARY_MAX_CHARS = 900;
export const RECEIPT_PREFIX = "ledger-receipt: sha256:";

/** W-1 guards for the human-readable receipt text. Returns error strings. */
export function validateSummary(text) {
  const errors = [];
  const s = text.trim();
  if (s.length === 0) return ["summary: empty (W-1)"];
  const head = s.slice(0, 50);
  if (ARTEFACT_PRELUDES.some((re) => re.test(head))) errors.push(`summary: opens with an LLM-failure artefact (W-1): "${head}"`);
  const n = chars(s);
  if (n < SUMMARY_MIN_CHARS) errors.push(`summary: ${n} characters; at least ${SUMMARY_MIN_CHARS} (W-1 short body)`);
  if (n > SUMMARY_MAX_CHARS) errors.push(`summary: ${n} characters; at most ${SUMMARY_MAX_CHARS} (a status line, not an article)`);
  if (s.includes("ledger-receipt:")) errors.push("summary: must not carry a ledger-receipt line — post.mjs appends it");
  if (/^[[{]/.test(s) || /\{\s*"[a-z_]+"\s*:/.test(s)) errors.push("summary: looks like JSON — the feed body is prose; the payload travels separately");
  const links = s.match(/https:\/\/\S+/g) ?? [];
  if (links.length < 1) errors.push("summary: cite at least one https:// source link");
  if (links.length > 3) errors.push(`summary: ${links.length} links; at most 3`);
  return errors;
}

export function sha256Hex(s) {
  return createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");
}

/** The exact feed body: the summary, a blank line, the receipt line. */
export function composeReceiptBody(summary, hex) {
  return `${summary.trim()}\n\n${RECEIPT_PREFIX}${hex}`;
}

export const DISPOSITIONS = new Set(["auto_applied", "pending_review", "duplicate", "rejected"]);
