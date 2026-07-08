#!/usr/bin/env node
// pr-autopilot/flaky-rerun.mjs — Epic-019 Story 2c: BOUNDED auto-rerun of
// known-flaky checks, under Farah's discipline (Epic-019 RFC 2026-07-07 Q2):
//
//   - The flake allowlist is a reviewed repo file (flaky-checks.json, sibling
//     of this module): an array of { check_name, evidence, expires }. EVERY
//     entry cites flake evidence (a URL or an issue ref) and carries an
//     expiry date — no evergreen exemptions. validate-skills.mjs (the
//     `workforce:skills` CI gate) rejects entries missing either, and warns
//     on expired ones; an expired entry never reruns at runtime either.
//   - R-10 / W-1-class editorial/deploy gates are CATEGORICALLY ineligible:
//     any check name matching EDITORIAL_INELIGIBLE_RE is a hard validation
//     error in the allowlist and an unconditional escalate at decision time,
//     even if an entry somehow slipped in (defence in depth).
//   - Max ONE rerun per PR, ever. The once-ever latch is the hidden audit
//     marker `<!-- autopilot:rerun:… -->` posted on the PR BEFORE any rerun
//     is triggered — so a crash mid-flight can forfeit the rerun, never
//     double it. A rerun-then-pass stays visible via that comment + the
//     `autopilot:reran` label (never a silent green); a rerun that still
//     fails escalates as `checks-failing`, never retried.
//   - C-4: unknown/ambiguous states (pending checks, an unreadable
//     allowlist, a rerun trigger that half-fails) THROW or return an
//     escalate decision — they never silently pass. Escalating is the safe
//     direction; the rerun is only ever an optimisation on top of it.
//
// Callers: pr-autopilot-post.mjs invokes attemptFlakyRerun() when a verdict
// is about to escalate with reason `checks-failing` — the rerun attempt
// happens BEFORE the escalation is posted, and only the all-allowlisted case
// defers it. This module deliberately does NOT touch pr-merge.mjs /
// verifyMergeable: the R-N10 predicate's decision flow stays byte-identical
// (a rerun just gives the checks a second chance to be genuinely green by
// the next verdict).
//
// Pure decision core (decideRerun, validateFlakyChecks, marker helpers) +
// a thin IO wrapper (attemptFlakyRerun) in the pr-merge.mjs makeGh style.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { assertReasonCode } from "./escalation-reasons.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The reviewed, evidenced, expiring flake allowlist (ships EMPTY — entries
 *  are added with evidence as real flakes occur, never pre-emptively). */
export const FLAKY_CHECKS_PATH = join(HERE, "flaky-checks.json");

/** Hard bound: one rerun per PR, ever (Farah's discipline). */
export const MAX_RERUNS_PER_PR = 1;

/** Label stamped on a PR whose checks were rerun — the metrics signal
 *  build-pr-metrics-github.mjs counts (rerun / rerun-then-pass per check),
 *  so a racy check is detectable and evictable. */
export const RERAN_LABEL = "autopilot:reran";

/** The once-ever latch: any comment/review body containing this prefix means
 *  the PR has had its one rerun. Extends the `<!-- autopilot:… -->` marker
 *  convention (needs-human / reviewed / reason:* / review:{slug}:green). */
export const RERUN_MARKER_PREFIX = "<!-- autopilot:rerun:";

/** R-10 / W-1 class: editorial + deploy gates are categorically
 *  rerun-ineligible (C-1: a truncation/deploy gate that fails is a real
 *  finding, never a flake to retry past). */
export const EDITORIAL_INELIGIBLE_RE = /deploy|article|truncat|editorial/i;

const GREEN_CONCLUSIONS = new Set(["success", "neutral", "skipped"]);
// Evidence = a URL, or an issue ref (`#123` / `owner/repo#123`).
const EVIDENCE_RE = /^(https?:\/\/\S+|(?:[\w.-]+\/[\w.-]+)?#\d+)$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ENTRY_KEYS = new Set(["check_name", "evidence", "expires"]);

const todayIso = () => new Date().toISOString().slice(0, 10);

/** Validate the allowlist file's entries. Pure; returns { errors, warnings }.
 *  errors  — reject the file (CI red via validate-skills.mjs; runtime throw):
 *            not an array, malformed entry, missing/invalid evidence or
 *            expires, duplicate check_name, or an editorial/deploy-class
 *            check name (categorically ineligible — hard error, never warn).
 *  warnings — an EXPIRED entry: legal in git (history stays reviewable) but
 *            inert at runtime; warn so the operator prunes it. */
export function validateFlakyChecks(entries, { today = todayIso() } = {}) {
  const errors = [];
  const warnings = [];
  if (!Array.isArray(entries)) {
    errors.push("flaky-checks.json must be a JSON array of { check_name, evidence, expires }");
    return { errors, warnings };
  }
  const seen = new Set();
  entries.forEach((e, i) => {
    const at = `entry[${i}]`;
    if (e === null || typeof e !== "object" || Array.isArray(e)) {
      errors.push(`${at} must be an object { check_name, evidence, expires }`);
      return;
    }
    for (const k of Object.keys(e)) {
      if (!ENTRY_KEYS.has(k)) errors.push(`${at} has unknown key "${k}" (allowed: check_name, evidence, expires)`);
    }
    if (typeof e.check_name !== "string" || e.check_name.trim().length === 0) {
      errors.push(`${at} check_name must be a non-empty string (the exact GitHub check-run name)`);
    } else {
      if (EDITORIAL_INELIGIBLE_RE.test(e.check_name)) {
        errors.push(
          `${at} check_name "${e.check_name}" matches the editorial/deploy gate class ` +
            `(${EDITORIAL_INELIGIBLE_RE}) — R-10/W-1-class checks are CATEGORICALLY rerun-ineligible (Epic-019 Story 2c)`,
        );
      }
      const norm = e.check_name.trim().toLowerCase();
      if (seen.has(norm)) errors.push(`${at} duplicate check_name "${e.check_name}"`);
      seen.add(norm);
    }
    if (typeof e.evidence !== "string" || !EVIDENCE_RE.test(e.evidence.trim())) {
      errors.push(
        `${at} evidence must be a URL or issue ref (#123 / owner/repo#123) — ` +
          `every flake exemption cites its evidence; no evidence, no entry (Farah's discipline)`,
      );
    }
    if (typeof e.expires !== "string" || !ISO_DATE_RE.test(e.expires) || Number.isNaN(Date.parse(e.expires))) {
      errors.push(`${at} expires must be a real YYYY-MM-DD date — no evergreen exemptions`);
    } else if (e.expires < today) {
      warnings.push(`${at} "${e.check_name}" expired ${e.expires} — inert at runtime; prune it (or re-evidence a still-live flake)`);
    }
  });
  return { errors, warnings };
}

/** Read + validate the allowlist file. Throws loud (C-4) on an unreadable /
 *  unparseable / invalid file — the caller escalates instead of guessing. */
export function loadAllowlist(path = FLAKY_CHECKS_PATH) {
  const entries = JSON.parse(readFileSync(path, "utf8"));
  const { errors } = validateFlakyChecks(entries);
  if (errors.length > 0) throw new Error(`flaky-checks.json invalid: ${errors.join("; ")}`);
  return entries;
}

/** The unexpired, validated allowlist as a Map(lowercased check_name → entry).
 *  Throws (C-4) if the entries are malformed — a broken allowlist never
 *  silently authorises a rerun. */
export function activeAllowlist(entries, today = todayIso()) {
  const { errors } = validateFlakyChecks(entries, { today });
  if (errors.length > 0) throw new Error(`flaky-checks allowlist invalid: ${errors.join("; ")}`);
  const map = new Map();
  for (const e of entries) {
    if (e.expires >= today) map.set(e.check_name.trim().toLowerCase(), e);
  }
  return map;
}

/** Has this PR already had its one rerun? (prefix match on the audit marker) */
export function hasRerunMarker(bodies) {
  return (bodies ?? []).some((b) => String(b || "").includes(RERUN_MARKER_PREFIX));
}

const sanitizeName = (n) => String(n).replace(/-->/g, "→").replace(/\|/g, "/").trim();

/** The audit marker: rerun ordinal + the machine-readable check names, so
 *  build-pr-metrics-github.mjs can count reruns per check. */
export function rerunMarker(checkNames) {
  return `${RERUN_MARKER_PREFIX}1 checks=${checkNames.map(sanitizeName).join("|")} -->`;
}

const RERUN_MARKER_RE = /<!--\s*autopilot:rerun:\d+\s+checks=([^>]*?)\s*-->/g;

/** Parse every rerun marker in a body → [{ checks: [names] }]. */
export function findRerunMarkers(body) {
  const found = [];
  const re = new RegExp(RERUN_MARKER_RE.source, "g");
  let m;
  while ((m = re.exec(String(body ?? ""))) !== null) {
    found.push({ checks: m[1].split("|").map((s) => s.trim()).filter(Boolean) });
  }
  return found;
}

/** PURE decision core. Given the failing check NAMES, the allowlist entries,
 *  and every comment/review body on the PR (for the once-ever latch):
 *    → { reran: true, checks, evidence }                    trigger the rerun
 *    → { reran: false, escalateWith: "checks-failing", why } escalate normally
 *  Throws (C-4) on ambiguous input (empty/unnamed failing set) or a
 *  malformed allowlist — never a silent pass. */
export function decideRerun({ failingChecks, entries, bodies = [], today = todayIso() } = {}) {
  if (!Array.isArray(failingChecks)) {
    throw new Error("decideRerun: failingChecks must be an array of check names (C-4: ambiguous input never silently passes)");
  }
  const names = failingChecks.map((n) => String(n ?? "").trim());
  if (names.length === 0 || names.some((n) => n.length === 0)) {
    throw new Error("decideRerun: an empty or unnamed failing-check set is ambiguous — refusing to decide (C-4)");
  }
  const escalate = (why) => ({ reran: false, escalateWith: assertReasonCode("checks-failing"), why });

  // Categorical ineligibility first — even an allowlisted editorial gate
  // never reruns (the validator makes such an entry impossible; this is the
  // runtime backstop).
  const editorial = names.filter((n) => EDITORIAL_INELIGIBLE_RE.test(n));
  if (editorial.length > 0) {
    return escalate(`editorial/deploy-class check(s) are categorically rerun-ineligible (R-10/W-1): ${editorial.join(", ")}`);
  }
  const active = activeAllowlist(entries, today); // throws on a malformed allowlist
  const notAllowed = names.filter((n) => !active.has(n.toLowerCase()));
  if (notAllowed.length > 0) {
    return escalate(`failing check(s) not on the unexpired flake allowlist: ${notAllowed.join(", ")} — a rerun needs EVERY failing check allowlisted`);
  }
  if (hasRerunMarker(bodies)) {
    return escalate(
      `this PR already used its one rerun (max ${MAX_RERUNS_PER_PR}; the ${RERUN_MARKER_PREFIX}… --> marker is present) — a rerun that still fails escalates, never retried`,
    );
  }
  return {
    reran: true,
    checks: names,
    evidence: names.map((n) => {
      const e = active.get(n.toLowerCase());
      return { check: n, evidence: e.evidence, expires: e.expires };
    }),
  };
}

/** The visible audit comment: check names + allowlist evidence + the hidden
 *  once-ever marker. A rerun-then-pass stays visible through this forever. */
export function rerunAuditBody(decision) {
  return [
    `**Autopilot flaky-check rerun — 1 of max ${MAX_RERUNS_PER_PR} (Epic-019 Story 2c).**`,
    "",
    "Every failing check is on the evidenced, unexpired flake allowlist" +
      " (workforce/skills/pr-autopilot/flaky-checks.json) — triggering one bounded rerun" +
      " instead of escalating `checks-failing`:",
    "",
    ...decision.evidence.map((e) => `- \`${sanitizeName(e.check)}\` — allowlisted flake (evidence: ${e.evidence}, expires ${e.expires})`),
    "",
    "If the rerun still fails, the next verdict escalates `checks-failing` — never retried." +
      ` A rerun-then-pass stays visible via this comment and the \`${RERAN_LABEL}\` label (never a silent green).`,
    "",
    "— pr-autopilot flaky-rerun (deterministic; see workforce/skills/pr-autopilot/SKILL.md)",
    "",
    rerunMarker(decision.checks),
  ].join("\n");
}

/** Thin-IO wrapper (gh = pr-merge.mjs makeGh client). Re-reads the PR's live
 *  check state, decides via decideRerun, and — only on a rerun decision —
 *  posts the audit marker comment FIRST (the once-ever latch must exist
 *  before any rerun fires), stamps `autopilot:reran`, then triggers:
 *    - POST /actions/runs/{id}/rerun-failed-jobs for each failed workflow run
 *      at the head sha (GitHub Actions checks), and
 *    - POST /check-runs/{id}/rerequest for each failing non-Actions check run.
 *  Returns { reran: true, checks, triggered } or
 *          { reran: false, escalateWith: "checks-failing", why }.
 *  Throws (C-4) on any ambiguous/half-failed state — the caller escalates. */
export async function attemptFlakyRerun(gh, repo, prNumber, { entries = loadAllowlist(), today = todayIso() } = {}) {
  const escalate = (why) => ({ reran: false, escalateWith: assertReasonCode("checks-failing"), why });
  if (!Array.isArray(entries) || entries.length === 0) {
    return escalate("the flake allowlist is empty — nothing is rerun-eligible");
  }

  const { status, json: p } = await gh("GET", `/repos/${repo}/pulls/${prNumber}`);
  if (status !== 200 || !p?.head?.sha) throw new Error(`GET pull #${prNumber} → HTTP ${status} — cannot determine head sha (C-4)`);

  const { status: cs, json: cj } = await gh("GET", `/repos/${repo}/commits/${p.head.sha}/check-runs?per_page=100`);
  if (cs !== 200 || !Array.isArray(cj?.check_runs)) throw new Error(`GET check-runs for #${prNumber} → HTTP ${cs} — check state unknown (C-4)`);
  const runs = cj.check_runs;
  const pending = runs.filter((c) => c.status !== "completed");
  if (pending.length > 0) {
    return escalate(`check state ambiguous: ${pending.length} check run(s) not completed (e.g. '${pending[0].name}') — not rerunning`);
  }
  const failing = runs.filter((c) => !GREEN_CONCLUSIONS.has(c.conclusion));
  if (failing.length === 0) {
    return escalate("no failing check runs found at rerun time — nothing to rerun (re-verdict instead)");
  }

  // Once-ever latch: scan every comment + review body for the rerun marker.
  const [c, rv] = await Promise.all([
    gh("GET", `/repos/${repo}/issues/${prNumber}/comments?per_page=100`),
    gh("GET", `/repos/${repo}/pulls/${prNumber}/reviews?per_page=100`),
  ]);
  const bodies = [
    ...(Array.isArray(c.json) ? c.json.map((x) => x.body) : []),
    ...(Array.isArray(rv.json) ? rv.json.map((x) => x.body) : []),
  ];

  const decision = decideRerun({ failingChecks: failing.map((x) => x.name), entries, bodies, today });
  if (!decision.reran) return decision;

  // Audit marker FIRST: if this comment cannot land, no rerun fires — a crash
  // after this point can forfeit the one rerun but never duplicate it.
  const cm = await gh("POST", `/repos/${repo}/issues/${prNumber}/comments`, { body: rerunAuditBody(decision) });
  if (cm.status !== 201) {
    throw new Error(`rerun audit comment on #${prNumber} → HTTP ${cm.status} — refusing to rerun without the max-1 latch (C-4)`);
  }
  // Metrics label (best-effort: a label hiccup must not lose the rerun the
  // marker already committed us to).
  const lc = await gh("POST", `/repos/${repo}/labels`, {
    name: RERAN_LABEL,
    color: "fbca04", // yellow — telemetry, not a work queue
    description: "Epic-019 Story 2c — this PR's known-flaky failing checks were auto-rerun once (audit comment carries the evidence).",
  });
  if (lc.status !== 201 && lc.status !== 422) console.error(`flaky-rerun: WARN ensure label "${RERAN_LABEL}" → HTTP ${lc.status}`);
  const lr = await gh("POST", `/repos/${repo}/issues/${prNumber}/labels`, { labels: [RERAN_LABEL] });
  if (lr.status !== 200) console.error(`flaky-rerun: WARN could not label #${prNumber} ${RERAN_LABEL} → HTTP ${lr.status}`);

  // Trigger. GitHub Actions checks rerun via their workflow runs; anything
  // else (external check apps) via check-run rerequest.
  let triggered = 0;
  const hasActionsFailing = failing.some((x) => (x.app?.slug || "") === "github-actions");
  if (hasActionsFailing) {
    const { status: ws, json: wj } = await gh("GET", `/repos/${repo}/actions/runs?head_sha=${p.head.sha}&per_page=100`);
    if (ws !== 200 || !Array.isArray(wj?.workflow_runs)) throw new Error(`GET workflow runs for ${p.head.sha} → HTTP ${ws} — cannot trigger rerun (C-4)`);
    for (const run of wj.workflow_runs) {
      if (run.status === "completed" && !GREEN_CONCLUSIONS.has(run.conclusion)) {
        const rr = await gh("POST", `/repos/${repo}/actions/runs/${run.id}/rerun-failed-jobs`);
        if (rr.status !== 201) throw new Error(`rerun-failed-jobs on workflow run ${run.id} → HTTP ${rr.status} — half-triggered rerun, escalate (C-4)`);
        triggered++;
      }
    }
  }
  for (const x of failing) {
    if ((x.app?.slug || "") !== "github-actions") {
      const rr = await gh("POST", `/repos/${repo}/check-runs/${x.id}/rerequest`);
      if (rr.status !== 201) throw new Error(`rerequest check-run ${x.id} ('${x.name}') → HTTP ${rr.status} — half-triggered rerun, escalate (C-4)`);
      triggered++;
    }
  }
  if (triggered === 0) {
    throw new Error("decided to rerun but found nothing to trigger (no failed workflow run, no rerequestable check run) — ambiguous state, escalate (C-4)");
  }
  return { reran: true, checks: decision.checks, triggered };
}
