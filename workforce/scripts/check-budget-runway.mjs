#!/usr/bin/env node
// check-budget-runway.mjs — does every agent's W-3 cap cover what its
// bindings are modelled to burn in a month? (ML-038; candidate R-19)
//
// #661 made the per-agent cap real: the orchestrator charges a modelled cost
// per dispatched fire (small 0.05 / medium 0.20 / large 0.60 USD, the skill's
// declared cost_class) and refuses to dispatch once the month's spend would
// cross `budget_monthly_usd_override ?? budget_monthly_usd_default`. The caps
// it started enforcing on 2026-09-09 were never sized against the bindings'
// fire cadence, so the agents that did the most work died first and quietly:
// nadia (the PR router, USD 75/mo modelled vs an USD 8 cap) on 09-11, ren (the
// author lane) on 09-13, ingrid (the article pipeline) on 09-09. The only
// trace was a CloudWatch WARN per tick.
//
// This reads the LIVE roster from the public agents-api (caps + bindings are
// DDB config, not git — a PR cannot change them, so this is a scheduled audit
// like R-13/R-15, not a PR gate) and reports, per non-archived agent, the
// modelled monthly burn against the effective cap. Exit 1 when any agent's
// cap is below its burn — that agent WILL be refused mid-month — so the daily
// run reddens instead of the pipeline stopping unannounced.
//
// The arithmetic lives in workforce/scripts/lib/budget-runway.mjs, a mirror of
// workforce/lambdas/shared/budget-runway.ts (the write-time W3-runway guard);
// budget-runway-parity-tests.ts keeps the two equal.
//
// Usage:
//   node workforce/scripts/check-budget-runway.mjs            # table + exit code
//   node workforce/scripts/check-budget-runway.mjs --json     # machine-readable
//   node workforce/scripts/check-budget-runway.mjs --warn-ratio 0.8
//   WF_AGENTS_API_BASE=… node workforce/scripts/check-budget-runway.mjs
//
// Exit: 0 every cap covers its burn · 1 at least one cap is outrun ·
//       3 roster unreadable (an audit that cannot run is not a pass)

import { ensureProxyAwareEntry } from "../../scripts/lib/proxy-bootstrap.mjs";
ensureProxyAwareEntry(import.meta.url);

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { budgetRunway } from "./lib/budget-runway.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");
const SKILLS_DIR = join(REPO_ROOT, "workforce", "skills");
/** The execute-api origin — reachable from allowlists that block the custom
 *  domain (same default every write-script and request-dispatch.mjs use). */
const DEFAULT_API_BASE = "https://sjhikazsf9.execute-api.us-west-2.amazonaws.com/prod";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

/** skill name → declared cost_class, from the in-repo meta.json files (the
 *  source the Lambda's generated registry is built from). */
export function loadCostClasses(skillsDir = SKILLS_DIR) {
  const out = new Map();
  for (const e of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    try {
      const meta = JSON.parse(readFileSync(join(skillsDir, e.name, "meta.json"), "utf8"));
      if (meta?.name && meta?.cost_class) out.set(meta.name, meta.cost_class);
    } catch {
      // A skill without a readable meta.json is validate-skills' finding.
    }
  }
  return out;
}

async function fetchRoster(apiBase) {
  const agents = [];
  let cursor;
  for (let page = 0; page < 40; page++) {
    const q = new URLSearchParams({ page_size: "50" });
    if (cursor) q.set("cursor", cursor);
    const res = await fetch(`${apiBase}/agents?${q}`, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`GET /agents → HTTP ${res.status}`);
    const body = await res.json();
    agents.push(...(body.items ?? []));
    cursor = body.cursor ?? body.next_cursor;
    if (!cursor) break;
  }
  return agents;
}

/** Pure: roster → per-agent runway rows. Exported for tests. */
export function auditRoster(agents, costClassOf, { warnRatio = 0.8 } = {}) {
  const rows = [];
  for (const a of agents) {
    if (a.archived) continue;
    const cap = a.budget_monthly_usd_effective ?? a.budget_monthly_usd_override ?? a.budget_monthly_usd_default;
    const r = budgetRunway(a.bindings ?? [], Number(cap), costClassOf);
    rows.push({
      slug: a.slug,
      cap_usd: r.cap_usd,
      burn_usd: r.total_usd,
      ratio: r.ratio,
      fits: r.fits,
      warn: r.fits && r.ratio >= warnRatio,
      cap_reached_on_day: r.cap_reached_on_day,
      heaviest: [...r.per_binding]
        .filter((b) => b.usd_per_month > 0)
        .sort((x, y) => y.usd_per_month - x.usd_per_month)
        .slice(0, 2)
        .map((b) => `${b.skill}@${b.project_id ?? "?"}:${b.usd_per_month}`),
    });
  }
  rows.sort((x, y) => y.ratio - x.ratio);
  return rows;
}

async function main() {
  const apiBase = String(process.env.WF_AGENTS_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, "");
  const warnRatio = Number(arg("warn-ratio", "0.8"));
  const asJson = process.argv.includes("--json");
  const costClasses = loadCostClasses();
  const costClassOf = (skill) => costClasses.get(skill);

  let agents;
  try {
    agents = await fetchRoster(apiBase);
  } catch (e) {
    console.error(`check-budget-runway: roster unreadable (${e instanceof Error ? e.message : String(e)}) — cannot audit`);
    process.exit(3);
  }

  const rows = auditRoster(agents, costClassOf, { warnRatio });
  const outrun = rows.filter((r) => !r.fits);
  const warned = rows.filter((r) => r.warn);
  const capSum = rows.reduce((a, r) => a + r.cap_usd, 0);
  const burnSum = rows.reduce((a, r) => a + r.burn_usd, 0);

  if (asJson) {
    console.log(JSON.stringify({ agents: rows.length, outrun: outrun.map((r) => r.slug), warned: warned.map((r) => r.slug), cap_sum_usd: r2(capSum), burn_sum_usd: r2(burnSum), rows }, null, 2));
  } else {
    console.log(`${"agent".padEnd(10)} ${"cap".padStart(7)} ${"burn/mo".padStart(8)} ${"ratio".padStart(6)}  ${"caps on".padStart(7)}  heaviest bindings`);
    for (const r of rows) {
      const flag = !r.fits ? "  ✗ OUTRUN" : r.warn ? "  ! near" : "";
      console.log(
        `${r.slug.padEnd(10)} ${r.cap_usd.toFixed(2).padStart(7)} ${r.burn_usd.toFixed(2).padStart(8)} ${(r.ratio * 100).toFixed(0).padStart(5)}%  ${String(r.cap_reached_on_day ?? "—").padStart(7)}  ${r.heaviest.join(", ")}${flag}`,
      );
    }
    console.log(`\n${rows.length} non-archived agent(s) · caps sum USD ${r2(capSum)} · modelled burn sum USD ${r2(burnSum)}/mo`);
  }

  if (outrun.length > 0) {
    console.error(
      `\n❌ ML-038: ${outrun.length} agent(s) whose cap is below their modelled monthly burn — the orchestrator will refuse ` +
        `their fires mid-month (${outrun.map((r) => `${r.slug} day ${r.cap_reached_on_day}`).join(", ")}). ` +
        `Raise budget_monthly_usd_default/_override via agents-api PATCH, or thin the bindings.`,
    );
    process.exit(1);
  }
  if (warned.length > 0) {
    console.error(`\n⚠️  ${warned.length} agent(s) within ${Math.round((1 - warnRatio) * 100)}% of their cap: ${warned.map((r) => r.slug).join(", ")}`);
  }
  console.log("\n✅ every non-archived agent's cap covers its modelled monthly burn.");
  process.exit(0);
}

function r2(n) {
  return Math.round(n * 100) / 100;
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((e) => {
    console.error(`check-budget-runway: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(3);
  });
}
