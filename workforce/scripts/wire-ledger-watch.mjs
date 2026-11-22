#!/usr/bin/env node
// Wire the ledger-watch Cadence onto the two incentive desks — `soledad`
// (utility & regional) and `valeria` (state & federal) — at project
// `workflow-foundry`, once a day, on a globally unique minute. Job 9 of the
// Residential Trades Desk round (workforce/docs/hires/
// residential-trades-desk-hire-round.md §5); operator runbook:
// workforce/docs/runbooks/ledger-watch.md.
//
// DRY-RUN BY DEFAULT. Nothing is written unless `--apply` is passed, and
// running with `--apply` is the operator's B-authority step (workforce
// governance §5: mutating a persona's bindings). Bindings are DDB config; the
// agents-api is the single writer (ADR-0007), so each PATCH /agents/{slug} is
// validated at the write boundary (R8-binding-skill-exists, G1-cadence-floor,
// W3-cap) and lands its own AUDIT item. Ownership is not a binding
// prerequisite (ADR-0012).
//
// What it writes, per desk, in ONE PATCH:
//   - bindings[]: the current list + one appended ledger-watch binding
//     (scheduler=external + invoked_by=api + a single-literal-minute cron in
//     one write — never the manual+cron dead-cron state, runbooks/bindings.md)
//     whose config.ledger_api_url comes from the required --ledger-url. The
//     skill reads it from binding.config (agent-runner.md step 2) and fails
//     loud without it; the URL is not a constant anywhere.
//   - budget_monthly_usd_default, raised to ceil(modelled burn of the new
//     bindings[]) when the current figure would no longer carry them
//     (ADR-0037: advisory, but runbooks/bindings.md asks for the budget line
//     to move in the same PATCH so /performance and R-19 stay honest). Never
//     lowered. An agent with an operational override is left alone and named.
//
// Idempotent, keyed on (skill, project_id):
//   - absent                         → append (existing binding_idx untouched)
//   - present, same ledger_api_url   → no-op, unless --fires-per-day asks for
//     a different cadence (below)
//   - present, different URL         → refuse (exit 1); this script never
//     replaces a live binding's URL. Change it deliberately, by hand, if needed.
//
// --fires-per-day <n> (n ∈ 1, 2, 3, 4, 6; operator direction 2026-11-22, a
// two-week 4× experiment). Omitted: an existing binding's cron is left alone
// and a new binding is daily. Given: the cron keeps the binding's literal
// minute (G1-cadence-floor wants a single literal there) and its BASE hour,
// and spreads n fires evenly over 24 h with an hour LIST, hours ascending —
// base 22, n=4 → cron(19 4,10,16,22 ? * * *). Lists are what the matcher
// supports (cron-match.ts matchField splits on ","), what agent-config.ts
// itself recommends (S9-binding-duplicate: "cron(0 9,17 ? * * *)"), and what
// lib/budget-runway.mjs counts (120 fires / 30 days for 4 hours), so the
// write, the tick and the W-3 estimate agree by construction. An existing
// binding is updated IN PLACE: only trigger.cron changes, plus one dated line
// appended to note that records the change, the reason and the base cron
// ("[base cron(M H ? * * *)]") — the base hour cannot be read back from a list,
// so a later --fires-per-day reads it from that marker. bound_at, config,
// every other field, every other binding and binding_idx are preserved. The
// same PATCH moves budget_monthly_usd_default by exactly the change in
// modelled burn (medium USD 0.20 × 30 × Δn), up or down, so 1 → 4 → 1 lands
// back on the starting figure.
//
// Tick spacing: the orchestrator ticks rate(2 hours) and asks matchesNow()
// "did this cron fire in the last 120 minutes?" — a yes/no, so two fires of
// one binding inside one window collapse into one dispatch. With n ≤ 6 the
// fires are ≥ 4 h apart, i.e. always in different windows. The tick's dedup
// claim (handler.ts step D, DEFAULT_DEDUP_MINUTES = 60 for ledger-watch,
// keyed agent × skill × project) is far shorter than that spacing, so it
// cannot suppress the 2nd…nth fire of the day either. (One known overlap: an
// on-demand POST /dispatch stamps the same slot, so a scheduled fire within
// 60 min after one is skipped — true of the daily cadence too.)
//
// The stagger: the same djb2 family as wire-daily-cadences-all-agents.mjs /
// wire-feed-view-all-agents.mjs — minute-of-day = djb2(slug + "#ledger-watch")
// % 1440, forward-walked off a taken-set seeded with EVERY live binding's cron
// minute across all agents AND all projects, so no new fire shares a minute
// with any existing one.
//
// W-3 pre-flight: prints the roster's planned budget sum and modelled burn
// before/after, and refuses (exit 1, nothing written) if either would cross
// the aggregate ceiling (W3_CEILING_USD, default 800 = governance.md §2).
//
// PREREQ (see the runbook): the ledger-watch SKILL# row exists (data-plane
// deploy after the skill PR merges — R8 rejects the PATCH before that), the
// project ledger is deployed and --ledger-url is its base URL, and
// workforce.feed_write_token resolves for project workflow-foundry.
//
// Usage:
//   node workforce/scripts/wire-ledger-watch.mjs --ledger-url https://<id>.execute-api.<region>.amazonaws.com
//   aws-vault exec <profile> -- node workforce/scripts/wire-ledger-watch.mjs --ledger-url <url> --apply
//   node workforce/scripts/wire-ledger-watch.mjs --ledger-url <url> --fires-per-day 4 [--reason "<why>"] [--apply]
//
// Exit: 0 planned / applied / nothing to do · 1 refused (bad args, drift,
// W-3, override present, failed PATCH or read-back) · 3 roster unreadable.

import { ensureProxyAwareEntry } from "../../scripts/lib/proxy-bootstrap.mjs";
ensureProxyAwareEntry(import.meta.url);
import { reconcileBinding } from "../../scripts/lib/binding-reconcile.mjs";
import { loadCostClasses } from "./check-budget-runway.mjs";
import { bindingFiresPerMonth, COST_CLASS_USD, modelledMonthlyBurn } from "./lib/budget-runway.mjs";

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SKILL = "ledger-watch";
export const PROJECT_ID = "workflow-foundry";
export const DESKS = Object.freeze(["soledad", "valeria"]);
const ROUTINE_SPEC = "workforce/docs/routines/agent-runner.md";

export function djb2(str) {
  let h = 5381 >>> 0;
  for (let i = 0; i < str.length; i++) h = (((h << 5) + h) + str.charCodeAt(i)) >>> 0;
  return h >>> 0;
}
export const minuteToCron = (m) => `cron(${m % 60} ${Math.floor(m / 60)} ? * * *)`;
export const cronMinute = (cron) => {
  const x = /cron\((\d+) (\d+) /.exec(cron ?? "");
  return x ? Number(x[2]) * 60 + Number(x[1]) : null;
};

/** Daily-shaped cron `cron(M H ? * * *)` or `cron(M H1,H2,… ? * * *)` →
 *  { minute, hours (ascending) }; any other shape (steps, ranges, a DoM/DoW
 *  restriction) → null. */
export function parseDailyCron(cron) {
  const x = /^cron\((\d{1,2}) (\d{1,2}(?:,\d{1,2})*) \? \* \* \*\)$/.exec(String(cron ?? "").trim());
  if (!x) return null;
  const minute = Number(x[1]);
  const hours = x[2].split(",").map(Number).sort((a, b) => a - b);
  if (minute > 59 || hours.some((h) => h > 23) || new Set(hours).size !== hours.length) return null;
  return { minute, hours };
}

/** Every minute-of-day a cron fires at, for the collision taken-set. Covers
 *  the daily and hour-list shapes; other shapes fall back to cronMinute. */
export function cronMinutesOfDay(cron) {
  const d = parseDailyCron(cron);
  if (d) return d.hours.map((h) => h * 60 + d.minute);
  const m = cronMinute(cron);
  return m == null ? [] : [m];
}

export const ALLOWED_FIRES_PER_DAY = Object.freeze([1, 2, 3, 4, 6]);

/** n fires/day, evenly spaced over 24 h from the base hour, hours ascending.
 *  Every n in ALLOWED_FIRES_PER_DAY divides 24, so the spacing is exact and
 *  ≥ 4 h — never two fires inside one 2-hourly tick window. */
export function spreadCron(minute, baseHour, n) {
  if (!ALLOWED_FIRES_PER_DAY.includes(n)) throw new Error(`--fires-per-day must be one of ${ALLOWED_FIRES_PER_DAY.join(", ")} (got ${n})`);
  const step = 24 / n;
  const hours = Array.from({ length: n }, (_, k) => (baseHour + k * step) % 24).sort((a, b) => a - b);
  return `cron(${minute} ${hours.join(",")} ? * * *)`;
}

const BASE_MARKER = /\[base (cron\(\d{1,2} \d{1,2} \? \* \* \*\))\]/g;

/** The binding's base (once-a-day) slot: the cron itself when it is a single
 *  hour; else the LAST `[base cron(…)]` marker in note, which must agree with
 *  the live list (same minute, and the list is exactly its even spread).
 *  Returns { minute, baseHour, n } or { error }. */
export function resolveBase(binding) {
  const cron = binding?.trigger?.cron;
  const d = parseDailyCron(cron);
  if (!d) return { error: `cron ${JSON.stringify(cron)} is not cron(M H ? * * *) or cron(M H1,H2,… ? * * *)` };
  if (d.hours.length === 1) return { minute: d.minute, baseHour: d.hours[0], n: 1 };
  const markers = [...String(binding?.note ?? "").matchAll(BASE_MARKER)];
  if (markers.length === 0) return { error: `cron ${cron} lists ${d.hours.length} hours but note carries no [base cron(…)] marker — the base hour is unknown` };
  const base = parseDailyCron(markers[markers.length - 1][1]);
  const n = d.hours.length;
  if (base.minute !== d.minute || !ALLOWED_FIRES_PER_DAY.includes(n) || spreadCron(base.minute, base.hours[0], n) !== `cron(${d.minute} ${d.hours.join(",")} ? * * *)`) {
    return { error: `cron ${cron} is not the even ${n}×/day spread of the note's base ${markers[markers.length - 1][1]} (hand-edited?)` };
  }
  return { minute: d.minute, baseHour: base.hours[0], n };
}

const cadenceWord = (n) => (n === 1 ? "daily" : `${n}×/day`);
const round2 = (x) => Math.round(x * 100) / 100;
const minuteLabel = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** The dated note line an in-place cadence change appends. */
export function cadenceNoteLine({ today, fromCron, toCron, fromN, toN, baseCron, reason, budgetFrom, budgetTo }) {
  return (
    `${today}: cadence changed ${cadenceWord(fromN)} → ${cadenceWord(toN)} (${fromCron} → ${toCron}) by wire-ledger-watch.mjs --fires-per-day ${toN}; ` +
    `why: ${reason}. budget_monthly_usd_default ${budgetFrom} → ${budgetTo}. [base ${baseCron}]`
  );
}

/** https base URL, no query/fragment, trailing slashes trimmed; else null. */
export function normaliseLedgerUrl(raw) {
  let u;
  try {
    u = new URL(String(raw ?? ""));
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.search || u.hash) return null;
  return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
}

export function ledgerWatchBinding(slug, cron, ledgerUrl) {
  return {
    skill: SKILL,
    executor: "claude-code-routine",
    trigger: { scheduler: "external", invoked_by: "api", fired_from: "wf-orchestrator-tick", cron },
    routine_spec: ROUTINE_SPEC,
    project_id: PROJECT_ID,
    config: { ledger_api_url: ledgerUrl },
    note:
      `Daily ledger-watch (job 9, Residential Trades Desk round): re-verify the ${PROJECT_ID} incentive ledger's ` +
      `worklist for ${slug}'s desk against primary pages, post a feed receipt, submit observations to ` +
      `config.ledger_api_url via post.mjs. Minute = djb2(slug+"#${SKILL}") over 24h, globally collision-free. ` +
      `Runbook: workforce/docs/runbooks/ledger-watch.md.`,
  };
}

const isLedgerWatch = (b) => b?.skill === SKILL && b?.project_id === PROJECT_ID;

/** Planned-budget delta of a default-budget change: zero when an override is
 *  the effective figure (the default then plans nothing). */
const plannedDelta = (a, from, to) => (a.budget_monthly_usd_override != null ? 0 : round2(to - from));

/**
 * Pure planner. `agents` is the live roster (GET /agents items, with
 * bindings); returns one entry per desk: { slug, action, ... }.
 * action ∈ "append" | "update" | "noop" | "drift" | "override" | "missing" | "unreadable".
 *
 * `firesPerDay` undefined = leave an existing cron alone / daily for a new
 * binding. Throws on an n outside ALLOWED_FIRES_PER_DAY.
 */
export function planLedgerWatch({ agents, desks = DESKS, ledgerUrl, costClassOf, firesPerDay, reason = "operator direction", today = new Date().toISOString().slice(0, 10) }) {
  if (firesPerDay !== undefined && !ALLOWED_FIRES_PER_DAY.includes(firesPerDay)) {
    throw new Error(`--fires-per-day must be one of ${ALLOWED_FIRES_PER_DAY.join(", ")} (got ${firesPerDay})`);
  }
  // minute-of-day → owners ("slug/skill@project"), from EVERY live binding.
  const takenBy = new Map();
  for (const a of agents) {
    for (const b of a.bindings ?? []) {
      for (const m of cronMinutesOfDay(b?.trigger?.cron)) {
        takenBy.set(m, [...(takenBy.get(m) ?? []), `${a.slug}/${b.skill}@${b.project_id ?? "-"}`]);
      }
    }
  }
  const claim = (base) => {
    if (takenBy.size >= 1440) throw new Error("all 1440 minutes of the day are taken — no collision-free slot left");
    let m = base % 1440;
    while (takenBy.has(m)) m = (m + 1) % 1440;
    takenBy.set(m, ["(claimed)"]);
    return m;
  };
  // Extra fire minutes another binding already uses (informational: the tick
  // batches per 2 h window, so a shared minute costs nothing but tidiness).
  const sharedMinutes = (cron, self) =>
    cronMinutesOfDay(cron)
      .filter((m) => (takenBy.get(m) ?? []).some((o) => o !== self))
      .map((m) => ({ m, label: `${minuteLabel(m)} (${takenBy.get(m).filter((o) => o !== self).join(", ")})` }));
  const burnOf = (bindings) => modelledMonthlyBurn(bindings, costClassOf).total_usd;
  const overrideBelow = (a, burn) => a.budget_monthly_usd_override != null && Math.ceil(burn) > Number(a.budget_monthly_usd_override);

  const bySlug = new Map(agents.map((a) => [a.slug, a]));
  const plan = [];
  for (const slug of [...desks].sort()) {
    const a = bySlug.get(slug);
    if (!a || a.archived) {
      plan.push({ slug, action: "missing" });
      continue;
    }
    const bindings = a.bindings ?? [];
    const budgetNow = Number(a.budget_monthly_usd_default ?? 0);
    const idx = bindings.findIndex(isLedgerWatch);
    if (idx >= 0) {
      const existing = bindings[idx];
      const live = existing.config?.ledger_api_url;
      if (live !== ledgerUrl) {
        plan.push({ slug, action: "drift", live, wanted: ledgerUrl });
        continue;
      }
      const fromCron = existing.trigger?.cron;
      if (firesPerDay === undefined) {
        plan.push({ slug, action: "noop", cron: fromCron });
        continue;
      }
      const base = resolveBase(existing);
      if (base.error) {
        plan.push({ slug, action: "unreadable", idx, reason: base.error });
        continue;
      }
      const toCron = spreadCron(base.minute, base.baseHour, firesPerDay);
      if (toCron === fromCron) {
        plan.push({ slug, action: "noop", cron: fromCron });
        continue;
      }
      const baseCron = `cron(${base.minute} ${base.baseHour} ? * * *)`;
      const burnBefore = burnOf(bindings);
      const draft = { ...existing, trigger: { ...existing.trigger, cron: toCron } };
      const burnAfter = burnOf(bindings.map((b, i) => (i === idx ? draft : b)));
      const burnDelta = round2(burnAfter - burnBefore);
      const budgetNext = Math.max(0, round2(budgetNow + burnDelta));
      if (overrideBelow(a, burnAfter)) {
        plan.push({ slug, action: "override", override: a.budget_monthly_usd_override, burnAfter });
        continue;
      }
      const line = cadenceNoteLine({ today, fromCron, toCron, fromN: base.n, toN: firesPerDay, baseCron, reason, budgetFrom: budgetNow, budgetTo: budgetNext });
      const note = existing.note ? `${existing.note}\n${line}` : line;
      // `desired` is what reconcileBinding compares and writes: the live
      // binding with only trigger.cron and note changed, minus bound_at (it
      // carries the live one forward).
      const { bound_at: _boundAt, ...rest } = existing;
      const desired = { ...rest, trigger: { ...existing.trigger, cron: toCron }, note };
      plan.push({
        slug, action: "update", idx, fromCron, cron: toCron, fromN: base.n, toN: firesPerDay, desired, noteLine: line,
        burnBefore, burnAfter, burnDelta, budgetNow, budgetNext, plannedDelta: plannedDelta(a, budgetNow, budgetNext),
        firesBefore: bindingFiresPerMonth(existing), firesAfter: bindingFiresPerMonth(draft),
        usdPerFire: COST_CLASS_USD[costClassOf(SKILL)],
        // New fire minutes only; the base minute was the original collision-free claim.
        shared: sharedMinutes(toCron, `${slug}/${SKILL}@${PROJECT_ID}`).filter((x) => x.m !== base.baseHour * 60 + base.minute).map((x) => x.label),
      });
      continue;
    }
    const m = claim(djb2(`${slug}#${SKILL}`));
    const n = firesPerDay ?? 1;
    const cron = spreadCron(m % 60, Math.floor(m / 60), n);
    for (const x of cronMinutesOfDay(cron)) if (!takenBy.has(x)) takenBy.set(x, ["(claimed)"]);
    const desired = ledgerWatchBinding(slug, cron, ledgerUrl);
    if (n > 1) desired.note += `\n${cadenceNoteLine({ today, fromCron: minuteToCron(m), toCron: cron, fromN: 1, toN: n, baseCron: minuteToCron(m), reason, budgetFrom: "-", budgetTo: "-" })}`;
    const burnBefore = burnOf(bindings);
    const burnAfter = burnOf([...bindings, desired]);
    const budgetNext = Math.max(budgetNow, Math.ceil(burnAfter));
    if (overrideBelow(a, burnAfter)) {
      plan.push({ slug, action: "override", override: a.budget_monthly_usd_override, burnAfter });
      continue;
    }
    plan.push({
      slug, action: "append", cron, desired, burnBefore, burnAfter, burnDelta: round2(burnAfter - burnBefore), budgetNow, budgetNext,
      plannedDelta: plannedDelta(a, budgetNow, budgetNext),
    });
  }
  return plan;
}

/** W-3 roster totals before/after a plan: planned (effective) budgets and modelled burn. */
export function w3Projection(agents, plan, costClassOf, ceiling) {
  const before = rosterTotals(agents, costClassOf);
  const writes = plan.filter((p) => p.action === "append" || p.action === "update");
  const after = {
    planned: round2(before.planned + writes.reduce((x, p) => x + p.plannedDelta, 0)),
    burn: round2(before.burn + writes.reduce((x, p) => x + p.burnDelta, 0)),
  };
  return { before, after, ceiling, crosses: after.planned > ceiling || after.burn > ceiling };
}

/** Planned-budget sum (effective figures, non-archived) and modelled burn sum. */
export function rosterTotals(agents, costClassOf) {
  let planned = 0;
  let burn = 0;
  for (const a of agents) {
    if (a.archived) continue;
    planned += Number(a.budget_monthly_usd_effective ?? a.budget_monthly_usd_override ?? a.budget_monthly_usd_default ?? 0);
    burn += modelledMonthlyBurn(a.bindings ?? [], costClassOf).total_usd;
  }
  return { planned: Math.round(planned * 100) / 100, burn: Math.round(burn * 100) / 100 };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const API_BASE = (process.env.WF_AGENTS_API_BASE ?? "https://sjhikazsf9.execute-api.us-west-2.amazonaws.com/prod").replace(/\/+$/, "");
const REGION = process.env.AWS_REGION ?? "us-west-2";
const W3_CEILING_USD = Number(process.env.W3_CEILING_USD || 800);

function curlJson(method, path, body) {
  const { AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN } = process.env;
  const args = ["-sS", "-X", method, "-H", "content-type: application/json", "-w", "\n%{http_code}", `${API_BASE}${path}`];
  if (method !== "GET") {
    if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) throw new Error("AWS credentials missing — run under `aws-vault exec <profile> --`");
    args.push("--aws-sigv4", `aws:amz:${REGION}:execute-api`, "--user", `${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}`);
    if (AWS_SESSION_TOKEN) args.push("-H", `x-amz-security-token: ${AWS_SESSION_TOKEN}`);
    args.push("--data-binary", "@-");
  }
  const res = spawnSync("curl", args, { input: method === "GET" ? undefined : JSON.stringify(body), encoding: "utf8" });
  if (res.status !== 0) throw new Error(`curl failed: ${res.stderr}`);
  const out = res.stdout;
  const nl = out.lastIndexOf("\n");
  return { status: Number(out.slice(nl + 1)), json: out.slice(0, nl) ? JSON.parse(out.slice(0, nl)) : undefined };
}

async function getJson(path) {
  const res = await fetch(`${API_BASE}${path}`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status}`);
  return res.json();
}

async function fetchRoster() {
  const agents = [];
  let cursor;
  for (let page = 0; page < 40; page++) {
    const q = new URLSearchParams({ page_size: "50" });
    if (cursor) q.set("cursor", cursor);
    const body = await getJson(`/agents?${q}`);
    agents.push(...(body.items ?? []));
    cursor = body.cursor ?? body.next_cursor;
    if (!cursor) break;
  }
  return agents;
}

function argValue(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

/** Stable, key-order-independent serialisation for the read-back compare. */
const stable = (v) =>
  Array.isArray(v) ? `[${v.map(stable).join(",")}]` : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}` : JSON.stringify(v);

async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const ledgerUrl = normaliseLedgerUrl(argValue(argv, "--ledger-url"));
  if (!ledgerUrl) {
    console.error("wire-ledger-watch: --ledger-url <https://…> is required (the deployed project ledger's base URL, no query string).");
    process.exit(1);
  }
  if (!/^https:\/\/[a-z0-9]+\.execute-api\.[a-z0-9-]+\.amazonaws\.com(\/|$)/.test(ledgerUrl)) {
    console.error(`wire-ledger-watch: note — ${ledgerUrl} is not an execute-api host; only those are known reachable from the agent-runner's network. Confirm egress before --apply.`);
  }
  let firesPerDay;
  if (argv.includes("--fires-per-day")) {
    const raw = argValue(argv, "--fires-per-day");
    firesPerDay = /^\d+$/.test(raw ?? "") ? Number(raw) : NaN;
    if (!ALLOWED_FIRES_PER_DAY.includes(firesPerDay)) {
      console.error(`wire-ledger-watch: --fires-per-day must be one of ${ALLOWED_FIRES_PER_DAY.join(", ")} (got ${raw ?? "nothing"}).`);
      process.exit(1);
    }
  }
  const reason = (argValue(argv, "--reason") ?? "temporary cadence experiment (operator direction)").replace(/\s+/g, " ").trim();

  let agents;
  try {
    agents = await fetchRoster();
  } catch (e) {
    console.error(`wire-ledger-watch: roster unreadable (${e instanceof Error ? e.message : String(e)})`);
    process.exit(3);
  }
  const costClasses = loadCostClasses();
  const costClassOf = (s) => costClasses.get(s);
  if (costClasses.get(SKILL) === undefined) throw new Error(`${SKILL}/meta.json has no cost_class`);

  const plan = planLedgerWatch({ agents, ledgerUrl, costClassOf, firesPerDay, reason });
  let refused = false;
  for (const p of plan) {
    if (p.action === "missing") { refused = true; console.error(`  ✗ ${p.slug}: not an active registered agent`); }
    if (p.action === "drift") { refused = true; console.error(`  ✗ ${p.slug}: ${SKILL} @ ${PROJECT_ID} already bound with ledger_api_url=${p.live}; wanted ${p.wanted}. Not replacing a live binding.`); }
    if (p.action === "override") { refused = true; console.error(`  ✗ ${p.slug}: budget_monthly_usd_override=${p.override} is below the new modelled burn ${p.burnAfter}; the override is the operator's figure — adjust it first.`); }
    if (p.action === "unreadable") { refused = true; console.error(`  ✗ ${p.slug}: binding_idx ${p.idx}: ${p.reason}. Not guessing — fix the cron or note by hand.`); }
    if (p.action === "noop") console.log(`  - ${p.slug}: ${SKILL} @ ${PROJECT_ID} already bound (${p.cron}), no-op.`);
  }
  const writes = plan.filter((p) => p.action === "append" || p.action === "update");

  const w3 = w3Projection(agents, plan, costClassOf, W3_CEILING_USD);
  const burnDelta = writes.reduce((x, p) => x + p.burnDelta, 0);
  console.log(
    `W-3 (estimate): planned budgets USD ${w3.before.planned} → ${w3.after.planned}/mo; modelled burn USD ${w3.before.burn} → ${w3.after.burn}/mo ` +
      `(${burnDelta >= 0 ? "+" : ""}${burnDelta.toFixed(2)} across ${writes.length} write(s), ${costClasses.get(SKILL)} = USD ${COST_CLASS_USD[costClasses.get(SKILL)]}/fire); ceiling USD ${W3_CEILING_USD}.`,
  );
  if (w3.crosses) {
    console.error(`  ✗ W-3: the result would cross the USD ${W3_CEILING_USD} aggregate ceiling. Nothing written (raising it is a Zone A amendment).`);
    process.exit(1);
  }
  if (refused) process.exit(1);
  if (writes.length === 0) {
    console.log("Nothing to do.");
    process.exit(0);
  }

  let failed = false;
  for (const p of writes) {
    const cur = await getJson(`/agents/${p.slug}`);
    if (!Array.isArray(cur.bindings)) { console.error(`  ✗ ${p.slug}: GET returned no bindings[]`); failed = true; continue; }
    const curIdx = cur.bindings.findIndex(isLedgerWatch);
    let patch;
    let line;
    if (p.action === "append") {
      if (curIdx >= 0) { console.log(`  - ${p.slug}: bound concurrently, skipped.`); continue; }
      const { bindings: next } = reconcileBinding(cur.bindings, p.desired, isLedgerWatch);
      patch = { bindings: next };
      if (p.budgetNext > Number(cur.budget_monthly_usd_default ?? 0)) patch.budget_monthly_usd_default = p.budgetNext;
      const budgetNote = "budget_monthly_usd_default" in patch ? `budget ${p.budgetNow} → ${p.budgetNext}` : `budget ${p.budgetNow} unchanged`;
      line = `${p.slug}: +${SKILL} @ ${PROJECT_ID} ${p.cron} (binding_idx ${cur.bindings.length}); burn ${p.burnBefore} → ${p.burnAfter}/mo; ${budgetNote}`;
    } else {
      // Concurrency guard: the binding we planned against must still be the live one.
      const live = cur.bindings[curIdx];
      if (curIdx !== p.idx || live?.trigger?.cron !== p.fromCron || live?.config?.ledger_api_url !== ledgerUrl || Number(cur.budget_monthly_usd_default ?? 0) !== p.budgetNow) {
        console.error(`  ✗ ${p.slug}: the live binding or budget changed since the roster read (idx ${curIdx}, cron ${live?.trigger?.cron}, budget ${cur.budget_monthly_usd_default}); re-run.`);
        failed = true;
        continue;
      }
      const { bindings: next, changed } = reconcileBinding(cur.bindings, p.desired, isLedgerWatch);
      if (!changed) { console.log(`  - ${p.slug}: already at ${p.cron}, no-op.`); continue; }
      patch = { bindings: next };
      if (p.budgetNext !== p.budgetNow) patch.budget_monthly_usd_default = p.budgetNext;
      line =
        `${p.slug}: ${SKILL} @ ${PROJECT_ID} binding_idx ${p.idx} trigger.cron ${p.fromCron} → ${p.cron} (in place); ` +
        `fires ${p.firesBefore} → ${p.firesAfter}/30d × USD ${p.usdPerFire} = burn ${p.burnBefore} → ${p.burnAfter}/mo (${p.burnDelta >= 0 ? "+" : ""}${p.burnDelta}); ` +
        `budget_monthly_usd_default ${p.budgetNow} → ${p.budgetNext}` +
        `${p.shared.length ? `\n      (info) new fire minutes shared with other bindings: ${p.shared.join("; ")}` : ""}` +
        `\n      note += ${JSON.stringify(p.noteLine)}`;
    }
    if (!apply) { console.log(`  [dry-run] ${line}`); continue; }
    const { status, json } = curlJson("PATCH", `/agents/${p.slug}`, patch);
    if (status !== 200) { failed = true; console.error(`  ✗ ${p.slug}: HTTP ${status} ${JSON.stringify(json)}`); continue; }
    const check = await getJson(`/agents/${p.slug}`);
    const after = check.bindings ?? [];
    const landedIdx = after.findIndex(isLedgerWatch);
    const landed = after[landedIdx];
    let ok = landed && landed.config?.ledger_api_url === ledgerUrl && landed.trigger?.cron === p.cron;
    if (ok && p.action === "update") {
      ok =
        landedIdx === p.idx &&
        landed.note === p.desired.note &&
        after.length === patch.bindings.length &&
        after.every((b, i) => stable(b) === stable(patch.bindings[i])) &&
        Number(check.budget_monthly_usd_default ?? 0) === p.budgetNext;
    }
    if (!ok) {
      failed = true;
      console.error(`  ✗ ${p.slug}: PATCH returned 200 but the read-back does not show the bindings/budget as sent`);
      continue;
    }
    console.log(`  ✓ ${line}`);
  }
  if (failed) process.exit(1);
  console.log(apply ? "Applied. The next orchestrator tick (rate 2h) picks the bindings up — no deploy needed (ADR-0007)." : "Dry run only — re-run with --apply to write.");
}

function isEntry() {
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1] ?? ""));
  } catch {
    return false;
  }
}
if (isEntry()) {
  main().catch((e) => {
    console.error(`wire-ledger-watch: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
