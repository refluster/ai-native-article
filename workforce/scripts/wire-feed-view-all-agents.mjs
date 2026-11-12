#!/usr/bin/env node
// Bind the feed-view Cadence onto EVERY active agent, once a day,
// minute-staggered, on the agent-workforce project. Operator direction
// (2026-11-10): "feed-viewというskillを作り、workforceの全員にデイリーで実行して
// もらって" — the B-authority cost greenlight (governance §5), same shape as the
// all-agents feed-post / daily-research roll-out (wire-daily-cadences-all-agents.mjs).
//
// What feed-view does: read the 20 most recent feed posts, set aside your own,
// 👍-like the single most interesting one (workforce/skills/feed-view/SKILL.md).
//
// W-3. feed-view is cost_class small (USD 0.05 modelled per fire), so one
// daily binding per agent adds USD 1.50/mo each — 69 agents ≈ USD 103.5/mo
// modelled. The script prints the roster's modelled burn before and after
// and REFUSES (exit 1, nothing written) if the result would cross the
// aggregate W-3 ceiling (governance.md §2; W3_CEILING_USD, default 800 =
// lambdas/shared/agent-config.ts W3_BUDGET_CAP_USD). Per-agent budgets are
// advisory (ADR-0037) and are not checked here.
//
// Bindings are DDB config; the agents-api is the single writer (ADR-0007) —
// each PATCH /agents/{slug} is validated at the write boundary
// (R8-binding-skill-exists against the live SKILL# rows, G1-cadence-floor)
// and lands its own AUDIT item. Ownership is NOT a binding prerequisite
// (ADR-0012). The governance §8.1 mass-edit exemption covers this: additive
// bindings[] writes wiring the same new skill across many agents.
//
// The stagger. Minute-of-day = djb2(slug + "#feed-view") % 1440, forward-walked
// off a GLOBAL taken-set seeded with every live agent-workforce cron minute, so
// no new fire shares a tick with any existing one (same family as the
// daily-cadences script).
//
// The ENABLE shape: scheduler=external + invoked_by=api + fired_from=
// wf-orchestrator-tick + a single-literal-minute cron, in one write
// (runbooks/bindings.md §"enable a paused cadence").
//
// Idempotent + append-only: an agent already carrying feed-view @
// agent-workforce is skipped; binding_idx of existing entries is never moved.
//
// PREREQ: the feed-view SKILL# row is synced (the data-plane deploy's
// wf-seed-skills, after this skill merges) and wf-feed-likes-api is live
// (same deploy). Before that, R8-binding-skill-exists rejects every PATCH.
//
// Usage:
//   node workforce/scripts/wire-feed-view-all-agents.mjs --dry-run
//   aws-vault exec <profile> -- node workforce/scripts/wire-feed-view-all-agents.mjs
//   [--only=slug1,slug2]  restrict the write set (taken-set still roster-wide)

import { ensureProxyAwareEntry } from "../../scripts/lib/proxy-bootstrap.mjs";
ensureProxyAwareEntry(import.meta.url);

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const API_BASE = (
  process.env.WF_AGENTS_API_BASE ??
  "https://sjhikazsf9.execute-api.us-west-2.amazonaws.com/prod"
).replace(/\/+$/, "");
const REGION = process.env.AWS_REGION ?? "us-west-2";
const DRY_RUN = process.argv.includes("--dry-run");
const ONLY_ARG = process.argv.find((a) => a.startsWith("--only="));
const ONLY = ONLY_ARG
  ? new Set(ONLY_ARG.slice("--only=".length).split(",").map((x) => x.trim()).filter(Boolean))
  : null;
const W3_CEILING_USD = Number(process.env.W3_CEILING_USD || 800);

const SKILL = "feed-view";
const ROUTINE_SPEC = "workforce/docs/routines/agent-runner.md";
const PROJECT_ID = "agent-workforce";
const HERE = dirname(fileURLToPath(import.meta.url));
const META = JSON.parse(readFileSync(join(HERE, "..", "skills", SKILL, "meta.json"), "utf8"));
const COST_CLASS_USD = { small: 0.05, medium: 0.2, large: 0.6 };
const FIRE_USD = COST_CLASS_USD[META.cost_class];
if (FIRE_USD === undefined) throw new Error(`${SKILL}/meta.json cost_class "${META.cost_class}" is not small|medium|large`);

function djb2(str) {
  let h = 5381 >>> 0;
  for (let i = 0; i < str.length; i++) h = (((h << 5) + h) + str.charCodeAt(i)) >>> 0;
  return h >>> 0;
}
const minuteToCron = (m) => `cron(${m % 60} ${Math.floor(m / 60)} ? * * *)`;
const cronMinute = (cron) => {
  const x = /cron\((\d+) (\d+)/.exec(cron ?? "");
  return x ? Number(x[2]) * 60 + Number(x[1]) : null;
};

function feedViewBinding(cron) {
  return {
    skill: SKILL,
    executor: "claude-code-routine",
    trigger: {
      scheduler: "external",
      invoked_by: "api",
      fired_from: "wf-orchestrator-tick",
      cron,
    },
    routine_spec: ROUTINE_SPEC,
    project_id: PROJECT_ID,
    note: `Daily feed-view: read the latest 20 feed posts, like the single most interesting one that is not your own. Minute = djb2(slug+"#feed-view") over 24h, globally collision-free. project_id=${PROJECT_ID} supplies workforce.feed_write_token. Wired at the all-agents roll-out (operator direction 2026-11-10).`,
    bound_at: new Date().toISOString(),
  };
}

function curlJson(method, path, body) {
  const { AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN } = process.env;
  const args = ["-sS", "-X", method, "-H", "content-type: application/json", "-w", "\n%{http_code}", `${API_BASE}${path}`];
  if (method !== "GET") {
    if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
      throw new Error("AWS credentials missing — run under `aws-vault exec <profile> --`");
    }
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

// ── Roster + slot assignment ─────────────────────────────────────────────────
const list = await (await fetch(`${API_BASE}/agents`)).json();
const items = (list.items ?? []).filter((a) => !a.archived && !a.paused);
if (items.length === 0) throw new Error("GET /agents returned no active agents");
const roster = items.map((a) => a.slug).sort();
if (ONLY) {
  const unknown = [...ONLY].filter((x) => !roster.includes(x));
  if (unknown.length > 0) throw new Error(`--only names agents that are not active: ${unknown.join(", ")}`);
}
const targets = ONLY ? roster.filter((x) => ONLY.has(x)) : roster;
const bySlug = new Map(items.map((a) => [a.slug, a]));
const hasBinding = (agent) =>
  (agent.bindings ?? []).some((b) => b.skill === SKILL && b.project_id === PROJECT_ID);

const taken = new Set();
for (const a of items) {
  for (const b of a.bindings ?? []) {
    if (b.project_id !== PROJECT_ID) continue;
    const m = cronMinute(b.trigger?.cron);
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

const plan = [];
for (const s of targets) {
  if (hasBinding(bySlug.get(s))) continue;
  plan.push([s, feedViewBinding(minuteToCron(claim(djb2(`${s}#${SKILL}`))))]);
}
console.log(`Roster: ${roster.length} active agents${ONLY ? ` (write set ${targets.length} via --only)` : ""}. New ${SKILL} bindings: ${plan.length}.`);
if (plan.length === 0) {
  console.log(`Every target already has ${SKILL} bound on ${PROJECT_ID} — nothing to do.`);
  process.exit(0);
}

// ── W-3 pre-flight: refuse before writing anything ───────────────────────────
// Reuse the R-19 audit's own arithmetic (check-budget-runway.mjs --json) for
// the current modelled burn, then add one daily small fire per new binding.
const audit = spawnSync(process.execPath, [join(HERE, "check-budget-runway.mjs"), "--json"], {
  encoding: "utf8",
  env: { ...process.env, W3_CEILING_USD: String(W3_CEILING_USD) },
});
let burnBefore;
try {
  // --json prints the object first, then its human summary lines; take the
  // object (first "{" through the last "}" line at column 0).
  const out = audit.stdout;
  const j = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("\n}") + 2));
  burnBefore = j.burn_sum_usd;
} catch {
  /* fall through */
}
if (typeof burnBefore !== "number") {
  throw new Error(`W-3 pre-flight: could not read the roster's modelled burn from check-budget-runway.mjs --json (exit ${audit.status}): ${audit.stdout.slice(0, 300)} ${audit.stderr.slice(0, 300)}`);
}
const added = plan.length * 30 * FIRE_USD;
const burnAfter = burnBefore + added;
console.log(`W-3: modelled burn USD ${burnBefore.toFixed(1)}/mo + ${plan.length} × 30 × ${FIRE_USD} = +${added.toFixed(1)} → USD ${burnAfter.toFixed(1)}/mo (ceiling ${W3_CEILING_USD}).`);
if (burnAfter > W3_CEILING_USD) {
  console.error(`✗ W-3: USD ${burnAfter.toFixed(1)}/mo would exceed the aggregate ceiling USD ${W3_CEILING_USD}. Nothing written. Raising the cap is a Zone A amendment (governance.md §2).`);
  process.exit(1);
}

// ── Apply (per-agent GET-then-PATCH; append-only) ────────────────────────────
let failed = false;
for (const [slug, binding] of plan) {
  const cur = await (await fetch(`${API_BASE}/agents/${slug}`)).json();
  if (!Array.isArray(cur.bindings)) {
    console.error(`  ✗ ${slug}: GET returned no bindings[]`);
    failed = true;
    continue;
  }
  if (cur.bindings.some((x) => x.skill === SKILL && x.project_id === PROJECT_ID)) {
    console.log(`  - ${slug}: already bound, skipped.`);
    continue;
  }
  const next = [...cur.bindings, binding];
  if (DRY_RUN) {
    console.log(`  [dry-run] ${slug}: would append ${SKILL} @ ${binding.trigger.cron} (bindings ${cur.bindings.length} → ${next.length})`);
    continue;
  }
  const { status, json } = curlJson("PATCH", `/agents/${slug}`, { bindings: next });
  if (status === 200) console.log(`  ✓ ${slug}: bound ${SKILL} @ ${binding.trigger.cron}`);
  else {
    failed = true;
    console.error(`  ✗ ${slug}: HTTP ${status} ${JSON.stringify(json)}`);
  }
}
if (failed) process.exit(1);
console.log(DRY_RUN ? "Dry run complete." : "Done. The next orchestrator tick (rate 2h) picks the bindings up — no deploy needed (ADR-0007).");
