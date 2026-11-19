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
// Append-only + idempotent, keyed on (skill, project_id):
//   - absent                         → append (existing binding_idx untouched)
//   - present, same ledger_api_url   → no-op
//   - present, different URL         → refuse (exit 1); this script never
//     replaces a live binding. Change it deliberately, by hand, if needed.
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
//
// Exit: 0 planned / applied / nothing to do · 1 refused (bad args, drift,
// W-3, override present, failed PATCH or read-back) · 3 roster unreadable.

import { ensureProxyAwareEntry } from "../../scripts/lib/proxy-bootstrap.mjs";
ensureProxyAwareEntry(import.meta.url);
import { reconcileBinding } from "../../scripts/lib/binding-reconcile.mjs";
import { loadCostClasses } from "./check-budget-runway.mjs";
import { modelledMonthlyBurn } from "./lib/budget-runway.mjs";

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

/**
 * Pure planner. `agents` is the live roster (GET /agents items, with
 * bindings); returns one entry per desk: { slug, action, ... }.
 * action ∈ "append" | "noop" | "drift" | "override" | "missing".
 */
export function planLedgerWatch({ agents, desks = DESKS, ledgerUrl, costClassOf }) {
  const taken = new Set();
  for (const a of agents) {
    for (const b of a.bindings ?? []) {
      const m = cronMinute(b?.trigger?.cron);
      if (m != null) taken.add(m);
    }
  }
  const claim = (base) => {
    if (taken.size >= 1440) throw new Error("all 1440 minutes of the day are taken — no collision-free slot left");
    let m = base % 1440;
    while (taken.has(m)) m = (m + 1) % 1440;
    taken.add(m);
    return m;
  };
  const bySlug = new Map(agents.map((a) => [a.slug, a]));
  const plan = [];
  for (const slug of [...desks].sort()) {
    const a = bySlug.get(slug);
    if (!a || a.archived) {
      plan.push({ slug, action: "missing" });
      continue;
    }
    const existing = (a.bindings ?? []).find(isLedgerWatch);
    if (existing) {
      const live = existing.config?.ledger_api_url;
      plan.push(live === ledgerUrl ? { slug, action: "noop", cron: existing.trigger?.cron } : { slug, action: "drift", live, wanted: ledgerUrl });
      continue;
    }
    const cron = minuteToCron(claim(djb2(`${slug}#${SKILL}`)));
    const desired = ledgerWatchBinding(slug, cron, ledgerUrl);
    const burnBefore = modelledMonthlyBurn(a.bindings ?? [], costClassOf).total_usd;
    const burnAfter = modelledMonthlyBurn([...(a.bindings ?? []), desired], costClassOf).total_usd;
    const budgetNow = Number(a.budget_monthly_usd_default ?? 0);
    const budgetNext = Math.max(budgetNow, Math.ceil(burnAfter));
    if (a.budget_monthly_usd_override != null && Math.ceil(burnAfter) > Number(a.budget_monthly_usd_override)) {
      plan.push({ slug, action: "override", override: a.budget_monthly_usd_override, burnAfter });
      continue;
    }
    plan.push({ slug, action: "append", cron, desired, burnBefore, burnAfter, budgetNow, budgetNext });
  }
  return plan;
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

async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const i = argv.indexOf("--ledger-url");
  const ledgerUrl = normaliseLedgerUrl(i >= 0 ? argv[i + 1] : undefined);
  if (!ledgerUrl) {
    console.error("wire-ledger-watch: --ledger-url <https://…> is required (the deployed project ledger's base URL, no query string).");
    process.exit(1);
  }
  if (!/^https:\/\/[a-z0-9]+\.execute-api\.[a-z0-9-]+\.amazonaws\.com(\/|$)/.test(ledgerUrl)) {
    console.error(`wire-ledger-watch: note — ${ledgerUrl} is not an execute-api host; only those are known reachable from the agent-runner's network. Confirm egress before --apply.`);
  }

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

  const plan = planLedgerWatch({ agents, ledgerUrl, costClassOf });
  let refused = false;
  for (const p of plan) {
    if (p.action === "missing") { refused = true; console.error(`  ✗ ${p.slug}: not an active registered agent`); }
    if (p.action === "drift") { refused = true; console.error(`  ✗ ${p.slug}: ${SKILL} @ ${PROJECT_ID} already bound with ledger_api_url=${p.live}; wanted ${p.wanted}. Not replacing a live binding.`); }
    if (p.action === "override") { refused = true; console.error(`  ✗ ${p.slug}: budget_monthly_usd_override=${p.override} is below the new modelled burn ${p.burnAfter}; the override is the operator's figure — adjust it first.`); }
    if (p.action === "noop") console.log(`  - ${p.slug}: ${SKILL} @ ${PROJECT_ID} already bound (${p.cron}), no-op.`);
  }
  const appends = plan.filter((p) => p.action === "append");

  const before = rosterTotals(agents, costClassOf);
  const addedBurn = appends.reduce((s, p) => s + (p.burnAfter - p.burnBefore), 0);
  const addedPlanned = appends.reduce((s, p) => s + (p.budgetNext - p.budgetNow), 0);
  const after = { planned: before.planned + addedPlanned, burn: Math.round((before.burn + addedBurn) * 100) / 100 };
  console.log(
    `W-3 (estimate): planned budgets USD ${before.planned} → ${after.planned}/mo; modelled burn USD ${before.burn} → ${after.burn}/mo ` +
      `(+${addedBurn.toFixed(2)}: ${appends.length} × daily ${costClasses.get(SKILL)}); ceiling USD ${W3_CEILING_USD}.`,
  );
  if (after.planned > W3_CEILING_USD || after.burn > W3_CEILING_USD) {
    console.error(`  ✗ W-3: the result would cross the USD ${W3_CEILING_USD} aggregate ceiling. Nothing written (raising it is a Zone A amendment).`);
    process.exit(1);
  }
  if (refused) process.exit(1);
  if (appends.length === 0) {
    console.log("Nothing to do.");
    process.exit(0);
  }

  let failed = false;
  for (const p of appends) {
    const cur = await getJson(`/agents/${p.slug}`);
    if (!Array.isArray(cur.bindings)) { console.error(`  ✗ ${p.slug}: GET returned no bindings[]`); failed = true; continue; }
    if (cur.bindings.some(isLedgerWatch)) { console.log(`  - ${p.slug}: bound concurrently, skipped.`); continue; }
    const { bindings: next } = reconcileBinding(cur.bindings, p.desired, isLedgerWatch);
    const patch = { bindings: next };
    if (p.budgetNext > Number(cur.budget_monthly_usd_default ?? 0)) patch.budget_monthly_usd_default = p.budgetNext;
    const budgetNote = "budget_monthly_usd_default" in patch ? `budget ${p.budgetNow} → ${p.budgetNext}` : `budget ${p.budgetNow} unchanged`;
    const line = `${p.slug}: +${SKILL} @ ${PROJECT_ID} ${p.cron} (binding_idx ${cur.bindings.length}); burn ${p.burnBefore} → ${p.burnAfter}/mo; ${budgetNote}`;
    if (!apply) { console.log(`  [dry-run] ${line}`); continue; }
    const { status, json } = curlJson("PATCH", `/agents/${p.slug}`, patch);
    if (status !== 200) { failed = true; console.error(`  ✗ ${p.slug}: HTTP ${status} ${JSON.stringify(json)}`); continue; }
    const check = await getJson(`/agents/${p.slug}`);
    const landed = (check.bindings ?? []).find(isLedgerWatch);
    if (!landed || landed.config?.ledger_api_url !== ledgerUrl || landed.trigger?.cron !== p.cron) {
      failed = true;
      console.error(`  ✗ ${p.slug}: PATCH returned 200 but the read-back does not show the binding as sent`);
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
