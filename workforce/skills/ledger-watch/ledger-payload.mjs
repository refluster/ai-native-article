// ledger-watch/ledger-payload.mjs — pure, network-free helpers for post.mjs.
//
// The project ledger's contract (`POST /v1/observations`, API v1 §2.2–§4)
// is mirrored here so a malformed run fails BEFORE a feed receipt is spent:
// a receipt post has no delete counterpart on the feed (ADR-0017), so every
// payload error the ledger would reject must be caught locally first.
//
// Nothing in this file touches the network or the filesystem; post.mjs owns
// the I/O. Exported for post-tests.ts.

import { createHash } from "node:crypto";

export const MAX_OBSERVATIONS = 20;
export const MAX_REQUEST_BYTES = 256 * 1024;

export const CHANGE_TYPES = Object.freeze([
  "verified_no_change",
  "note",
  "budget_signal",
  "status_changed",
  "amount_changed",
  "deadline_changed",
  "requirements_changed",
  "form_changed",
  "source_changed",
  "new_program",
]);
/** change_types whose `proposed` block is mandatory (API §2.2). */
export const PROPOSED_REQUIRED = new Set([
  "status_changed",
  "amount_changed",
  "deadline_changed",
  "requirements_changed",
  "form_changed",
  "source_changed",
  "new_program",
]);
export const PROGRAM_STATUSES = new Set(["open", "suspended", "closed", "pending_reopen"]);
export const CONFIDENCE = new Set(["high", "medium", "low"]);
export const NEXT_ACTION_TYPES = new Set([
  "requote_open_estimates",
  "notify_active_cases",
  "update_eligibility_rules",
  "update_form_map",
  "contractor_enrollment",
  "confirm_with_client",
  "recheck",
  "none",
]);
/** Fields a `proposed` block may never carry (identity, versioning, computed). */
export const PROPOSED_FORBIDDEN = new Set([
  "code",
  "version",
  "updated_at",
  "updated_by",
  "status_history",
  "stale",
  "days_to_deadline",
  "pending_count",
]);
export const PROGRAM_CODE = /^[a-z][a-z0-9_]{2,48}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const RUN_KEYS = new Set(["agent_slug", "started_at", "checked_programs", "fetch_failures", "discovery_queries", "note", "skill_version"]);
const OBS_KEYS = new Set(["program_code", "change_type", "observed_at", "summary", "evidence", "proposed", "confidence", "next_actions", "affects"]);

/** Character count in code points (what a human means by "600 字"). */
const chars = (s) => [...s].length;
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isHttpsUrl = (u) => {
  if (typeof u !== "string") return false;
  try {
    const x = new URL(u);
    return x.protocol === "https:" && x.hostname.length > 0;
  } catch {
    return false;
  }
};
const validDate = (s) => typeof s === "string" && ISO_DATE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

/**
 * Validate and normalise a parsed ledger payload.
 * Returns `{ errors: string[], payload }`. `payload` is a normalised copy
 * (run.skill_version filled from the caller when absent); it is meaningful
 * only when `errors` is empty.
 *
 * @param {unknown} raw
 * @param {{ agent: string, skillVersion?: string, today: string }} ctx
 *   `today` is the UTC date (YYYY-MM-DD) observed_at may not exceed.
 */
export function validatePayload(raw, ctx) {
  const errors = [];
  const err = (path, msg) => errors.push(`${path}: ${msg}`);
  if (!isObj(raw)) return { errors: ["payload: must be a JSON object {run, observations}"], payload: raw };

  for (const k of Object.keys(raw)) {
    if (k !== "run" && k !== "observations") err("payload", `unknown key "${k}" (only run, observations)`);
  }

  // ── run (§2.3) ──
  const run = isObj(raw.run) ? { ...raw.run } : null;
  if (!run) {
    err("run", "required object");
  } else {
    for (const k of Object.keys(run)) if (!RUN_KEYS.has(k)) err("run", `unknown key "${k}"`);
    if (run.agent_slug !== ctx.agent) {
      err("run.agent_slug", `must equal --agent "${ctx.agent}" (the ledger checks it against the attestation)`);
    }
    if (typeof run.started_at !== "string" || !ISO_DATETIME.test(run.started_at) || Number.isNaN(Date.parse(run.started_at))) {
      err("run.started_at", "required ISO date-time, e.g. 2026-11-19T15:30:00Z");
    }
    for (const k of ["checked_programs", "discovery_queries"]) {
      if (run[k] === undefined) continue;
      if (!Array.isArray(run[k]) || run[k].some((x) => typeof x !== "string" || x.length === 0)) {
        err(`run.${k}`, "must be an array of non-empty strings");
      }
    }
    if (Array.isArray(run.checked_programs)) {
      run.checked_programs.forEach((c, i) => {
        if (typeof c === "string" && !PROGRAM_CODE.test(c)) err(`run.checked_programs[${i}]`, `"${c}" is not a program code`);
      });
    }
    if (run.fetch_failures !== undefined) {
      if (!Array.isArray(run.fetch_failures)) {
        err("run.fetch_failures", "must be an array of {url, reason}");
      } else {
        run.fetch_failures.forEach((f, i) => {
          if (!isObj(f) || !isHttpsUrl(f.url)) err(`run.fetch_failures[${i}].url`, "must be an https:// URL");
          if (!isObj(f) || typeof f.reason !== "string" || f.reason.trim().length === 0) {
            err(`run.fetch_failures[${i}].reason`, "required non-empty string (e.g. \"HTTP 403\")");
          }
        });
      }
    }
    if (run.note !== undefined && typeof run.note !== "string") err("run.note", "must be a string");
    if (run.skill_version === undefined && ctx.skillVersion) run.skill_version = ctx.skillVersion;
    if (ctx.skillVersion && run.skill_version !== ctx.skillVersion) {
      err("run.skill_version", `"${run.skill_version}" differs from --skill-version "${ctx.skillVersion}"`);
    }
  }

  // ── observations (§2.2) ──
  const failedUrls = new Set(
    Array.isArray(run?.fetch_failures) ? run.fetch_failures.filter(isObj).map((f) => f.url) : [],
  );
  const obs = raw.observations;
  if (!Array.isArray(obs)) {
    err("observations", "required array (may be empty)");
  } else {
    if (obs.length > MAX_OBSERVATIONS) err("observations", `${obs.length} entries; max ${MAX_OBSERVATIONS} per run`);
    obs.forEach((o, i) => validateObservation(o, `observations[${i}]`, { today: ctx.today, failedUrls }, err));
  }

  return { errors, payload: { run, observations: obs } };
}

function validateObservation(o, p, { today, failedUrls }, err) {
  if (!isObj(o)) return err(p, "must be an object");
  for (const k of Object.keys(o)) if (!OBS_KEYS.has(k)) err(p, `unknown key "${k}"`);

  if (typeof o.program_code !== "string" || !PROGRAM_CODE.test(o.program_code)) {
    err(`${p}.program_code`, `must match ${PROGRAM_CODE}`);
  }
  if (!CHANGE_TYPES.includes(o.change_type)) err(`${p}.change_type`, `must be one of ${CHANGE_TYPES.join("|")}`);
  if (!validDate(o.observed_at)) err(`${p}.observed_at`, "required ISO date (YYYY-MM-DD)");
  else if (o.observed_at > today) err(`${p}.observed_at`, `${o.observed_at} is in the future (today is ${today} UTC)`);
  if (typeof o.summary !== "string" || o.summary.trim().length === 0 || chars(o.summary) > 600) {
    err(`${p}.summary`, "required, 1–600 characters");
  }
  if (!CONFIDENCE.has(o.confidence)) err(`${p}.confidence`, "must be high|medium|low");

  // evidence
  if (!Array.isArray(o.evidence) || o.evidence.length < 1 || o.evidence.length > 5) {
    err(`${p}.evidence`, "required, 1–5 entries");
  } else {
    o.evidence.forEach((e, j) => {
      const q = `${p}.evidence[${j}]`;
      if (!isObj(e)) return err(q, "must be an object");
      if (!isHttpsUrl(e.url)) err(`${q}.url`, "must be an https:// URL");
      if (typeof e.quote !== "string" || e.quote.trim().length === 0 || chars(e.quote) > 500) {
        err(`${q}.quote`, "required, 1–500 characters copied verbatim from the page");
      }
      if (typeof e.primary_source !== "boolean") err(`${q}.primary_source`, "must be a boolean");
      if (e.page_date !== undefined && e.page_date !== null && !validDate(e.page_date)) {
        err(`${q}.page_date`, "must be an ISO date or null");
      }
      for (const k of Object.keys(e)) {
        if (!["url", "quote", "page_date", "primary_source"].includes(k)) err(q, `unknown key "${k}"`);
      }
    });
    if (o.change_type === "verified_no_change") {
      // A page that could not be read cannot verify anything: the run must
      // list it as a fetch failure OR cite it as evidence, never both.
      const bad = o.evidence.filter((e) => isObj(e) && failedUrls.has(e.url));
      if (bad.length > 0) {
        err(`${p}.evidence`, `verified_no_change cites ${bad.map((e) => e.url).join(", ")}, which run.fetch_failures says could not be read`);
      }
    }
    if (o.change_type === "new_program" && !o.evidence.some((e) => isObj(e) && e.primary_source === true)) {
      err(`${p}.evidence`, "new_program needs at least one primary_source: true entry");
    }
  }

  // proposed
  if (PROPOSED_REQUIRED.has(o.change_type)) {
    if (!isObj(o.proposed) || Object.keys(o.proposed).length === 0) {
      err(`${p}.proposed`, `required non-empty object for ${o.change_type}`);
    }
  }
  if (o.proposed !== undefined && o.proposed !== null) {
    if (!isObj(o.proposed)) {
      err(`${p}.proposed`, "must be an object");
    } else {
      for (const k of Object.keys(o.proposed)) {
        if (PROPOSED_FORBIDDEN.has(k)) err(`${p}.proposed.${k}`, "is not writable through an observation");
      }
      if ("status" in o.proposed && !PROGRAM_STATUSES.has(o.proposed.status)) {
        err(`${p}.proposed.status`, `must be one of ${[...PROGRAM_STATUSES].join("|")} (candidate is set by the ledger)`);
      }
      if (o.change_type === "budget_signal" && Object.keys(o.proposed).some((k) => k !== "budget")) {
        err(`${p}.proposed`, "budget_signal may only propose `budget`");
      }
    }
  }

  // next_actions
  if (o.next_actions !== undefined) {
    if (!Array.isArray(o.next_actions)) {
      err(`${p}.next_actions`, "must be an array");
    } else {
      o.next_actions.forEach((a, j) => {
        const q = `${p}.next_actions[${j}]`;
        if (!isObj(a)) return err(q, "must be an object");
        if (!NEXT_ACTION_TYPES.has(a.type)) err(`${q}.type`, `must be one of ${[...NEXT_ACTION_TYPES].join("|")}`);
        if (a.detail !== undefined && (typeof a.detail !== "string" || chars(a.detail) > 300)) {
          err(`${q}.detail`, "must be a string of ≤ 300 characters");
        }
        if (a.due !== undefined && a.due !== null && !validDate(a.due)) err(`${q}.due`, "must be an ISO date or null");
      });
    }
  }

  if (o.affects !== undefined && !isObj(o.affects)) err(`${p}.affects`, "must be an object of conditions");
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
