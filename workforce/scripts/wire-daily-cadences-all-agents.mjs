#!/usr/bin/env node
// Bind BOTH daily Cadences — feed-post (Epic-011 §3) and daily-research
// (Epic-015) — onto EVERY active agent, once a day, minute-staggered, on the
// agent-workforce project. Per the operator's direction ("daily-research と
// feed-post は全員にバインド、1日1回、タイミングは分散、プロジェクトは
// agent-workforce"), which is the B-authority cost greenlight (governance §5;
// same shape as the Epic-015 Phase-6 cohort-2 "operator in-message direction is
// the cost approval").
//
// Bindings are DDB config; the agents-api is the single writer (ADR-0007) — each
// PATCH /agents/{slug} is validated at the write boundary (R8-binding-skill-exists
// against the live SKILL# rows, G1-cadence-floor against the cron) and lands its
// own AUDIT item. Ownership is NOT a binding prerequisite (ADR-0012), so binding a
// skill onto an agent absent from its meta.json owners[] is intended and valid —
// owners[] stays the authorship / Rule-11 / improvement set, unchanged here.
//
// What it does, per active agent (GET /agents → !archived && !paused):
//   - feed-post   @ agent-workforce, ENABLED, once daily. Minute-of-day =
//     djb2(slug) % 540 → the 09:00–18:00 JST feed window (UTC 00:00–08:59),
//     forward-walked off the GLOBAL taken-set (below). Identical family to the
//     retired stagger-feed-cron.mjs / seed/policy-group/wire-cadences.mjs
//     (verified to reproduce all 26 live feed-post minutes exactly).
//   - daily-research @ agent-workforce, ENABLED, once daily, config.no_skip:false
//     (skill default — non-grid beats SKIP on quiet windows; the grid personas'
//     no_skip:true bindings already exist and are left untouched). Minute-of-day =
//     djb2(slug + "#daily-research") % 1440 → spread across the full 24h,
//     forward-walked off the GLOBAL taken-set (verified to reproduce the 7 live
//     cohort-2 daily-research minutes exactly before the global-walk was added).
//
// The stagger. A SINGLE global taken-set — seeded with every live
// agent-workforce cron minute-of-day (both skills, all agents) and extended as
// each new slot is claimed — guarantees every NEWLY-added fire lands on a
// globally-unique minute: no two new bindings, and no new binding and any
// existing one, share a tick. (Pre-existing cross-skill collisions among already-
// live bindings are left as-is; this script never rewrites a live cron.)
//
// The ENABLE shape (runbooks/bindings.md §"enable a paused cadence"): each new
// binding is written scheduler=external + invoked_by=api + fired_from=
// wf-orchestrator-tick + a single-literal-minute cron IN ONE WRITE — never the
// scheduler=manual + cron "dead cron" state that once stranded daily-research
// (PR #348). wf-orchestrator-tick's isOrchestratorOwnedCcr gate dispatches exactly
// this shape.
//
// Idempotent + append-only. Keyed on (skill, project_id): a skill already bound
// on the agent for agent-workforce is SKIPPED — never duplicated, reordered, or
// reconciled (binding_idx is load-bearing; existing config incl. no_skip:true is
// preserved). So a re-run only ever fills genuinely-missing bindings.
//
// PREREQ: the feed-post + daily-research SKILL# rows are already synced (both
// skills are long-live). No deploy needed — ADR-0007 write=live; the next
// orchestrator tick (rate 2h) picks the new bindings up.
//
// Usage:
//   node workforce/scripts/wire-daily-cadences-all-agents.mjs --dry-run
//   aws-vault exec <profile> -- \
//     node workforce/scripts/wire-daily-cadences-all-agents.mjs

import { spawnSync } from "node:child_process";

const API_BASE = (
  process.env.WF_AGENTS_API_BASE ??
  "https://sjhikazsf9.execute-api.us-west-2.amazonaws.com/prod"
).replace(/\/+$/, "");
const REGION = process.env.AWS_REGION ?? "us-west-2";
const DRY_RUN = process.argv.includes("--dry-run");

const ROUTINE_SPEC = "workforce/docs/routines/agent-runner.md";
const PROJECT_ID = "agent-workforce";

// djb2 — the stagger family shared by every workforce cadence wiring script.
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

function feedPostBinding(slug, cron) {
  return {
    skill: "feed-post",
    executor: "claude-code-routine",
    trigger: {
      scheduler: "external",
      invoked_by: "api",
      fired_from: "wf-orchestrator-tick",
      cron,
    },
    routine_spec: ROUTINE_SPEC,
    project_id: PROJECT_ID,
    note: `Daily feed-post (Epic-011 §3 cadence); minute = djb2 stagger inside the 09:00-18:00 JST window (same algorithm as the retired stagger-feed-cron.mjs), globally collision-free. Fired by wf-orchestrator-tick; project_id=${PROJECT_ID} bundles workforce.feed_write_token. Wired at the all-agents daily-cadence roll-out (operator direction).`,
  };
}

function dailyResearchBinding(slug, cron) {
  return {
    skill: "daily-research",
    executor: "claude-code-routine",
    trigger: {
      scheduler: "external",
      invoked_by: "api",
      fired_from: "wf-orchestrator-tick",
      cron,
    },
    routine_spec: ROUTINE_SPEC,
    project_id: PROJECT_ID,
    config: { no_skip: false },
    note: `daily-research Cadence (Epic-015), landed ENABLED at the all-agents roll-out (operator direction). no_skip:false — non-grid beat, skips on quiet windows (skill default). Minute = djb2(slug+"#daily-research") spread over 24h, globally collision-free. project_id=${PROJECT_ID} supplies workforce.feed_write_token.`,
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

// ── Roster + global slot assignment (deterministic, roster-driven) ───────────
const list = await (await fetch(`${API_BASE}/agents`)).json();
const items = (list.items ?? []).filter((a) => !a.archived && !a.paused);
if (items.length === 0) throw new Error("GET /agents returned no active agents");
const roster = items.map((a) => a.slug).sort();

// Does this agent already carry (skill @ agent-workforce)?
const hasBinding = (agent, skill) =>
  (agent.bindings ?? []).some((b) => b.skill === skill && b.project_id === PROJECT_ID);
const bySlug = new Map(items.map((a) => [a.slug, a]));

// Seed a SINGLE global taken-set from every live agent-workforce cron minute
// (both skills, all agents) so new slots never collide with a live fire.
const taken = new Set();
for (const a of items) {
  for (const b of a.bindings ?? []) {
    if (b.project_id !== PROJECT_ID) continue;
    const m = cronMinute(b.trigger?.cron);
    if (m != null) taken.add(m);
  }
}
// Window-scoped saturation guard (C-4: fail loud, never spin forever). The
// forward-walk stays inside [0, mod), so it can only loop endlessly if EVERY
// minute in that window is already taken. We check window occupancy, NOT
// taken.size — the global taken-set also holds daily-research minutes ≥ 540, so
// a bare `taken.size >= mod` would false-positive on the 540-slot feed-post
// window while it still has free ticks.
const windowFull = (mod) => {
  for (let i = 0; i < mod; i++) if (!taken.has(i)) return false;
  return true;
};
const claim = (base, mod) => {
  if (windowFull(mod)) {
    throw new Error(
      `stagger window [0,${mod}) is fully saturated — no collision-free minute left`,
    );
  }
  let m = base % mod;
  while (taken.has(m)) m = (m + 1) % mod;
  taken.add(m);
  return m;
};

// Build the plan. feed-post first (0..539 window), then daily-research (0..1439),
// both drawing from the same global taken-set. Alphabetical roster order makes the
// forward-walk deterministic.
const additions = new Map(roster.map((s) => [s, []]));
for (const s of roster) {
  if (hasBinding(bySlug.get(s), "feed-post")) continue;
  additions.get(s).push(feedPostBinding(s, minuteToCron(claim(djb2(s), 540))));
}
for (const s of roster) {
  if (hasBinding(bySlug.get(s), "daily-research")) continue;
  additions.get(s).push(dailyResearchBinding(s, minuteToCron(claim(djb2(s + "#daily-research"), 1440))));
}

const plan = roster.filter((s) => additions.get(s).length > 0);
const totalNew = plan.reduce((n, s) => n + additions.get(s).length, 0);
console.log(
  `Roster: ${roster.length} active agents. New bindings to add: ${totalNew} ` +
    `(${plan.reduce((n, s) => n + additions.get(s).filter((b) => b.skill === "feed-post").length, 0)} feed-post, ` +
    `${plan.reduce((n, s) => n + additions.get(s).filter((b) => b.skill === "daily-research").length, 0)} daily-research).`,
);
if (totalNew === 0) {
  console.log("Every active agent already has both cadences bound on agent-workforce — nothing to do.");
  process.exit(0);
}

// ── Apply (per-agent GET-then-PATCH; append-only, binding_idx preserved) ─────
let failed = false;
for (const slug of plan) {
  // Re-GET fresh immediately before PATCH so we append onto the current bindings[]
  // (avoids clobbering a concurrent write; binding_idx of existing entries kept).
  const cur = await (await fetch(`${API_BASE}/agents/${slug}`)).json();
  if (!Array.isArray(cur.bindings)) {
    console.error(`  ✗ ${slug}: GET returned no bindings[] (agent registered?)`);
    failed = true;
    continue;
  }
  // Idempotent guard against drift between the list read and now.
  const toAdd = additions.get(slug).filter(
    (b) => !cur.bindings.some((x) => x.skill === b.skill && x.project_id === PROJECT_ID),
  );
  if (toAdd.length === 0) {
    console.log(`  - ${slug}: both cadences already bound, skipped (no-op).`);
    continue;
  }
  const next = [...cur.bindings, ...toAdd];
  const summary = toAdd.map((b) => `${b.skill} @ ${b.trigger.cron}`).join(", ");
  if (DRY_RUN) {
    console.log(`  [dry-run] ${slug}: would PATCH bindings -> +${toAdd.length} (${summary}); total ${next.length}`);
    continue;
  }
  const { status, json } = curlJson("PATCH", `/agents/${slug}`, { bindings: next });
  if (status === 200) {
    console.log(`  ✓ ${slug}: bound ${summary}`);
  } else {
    failed = true;
    console.error(`  ✗ ${slug}: HTTP ${status} ${JSON.stringify(json)}`);
  }
}

if (failed) process.exit(1);
console.log(
  DRY_RUN
    ? "Dry run complete."
    : "Done. Next orchestrator tick (rate 2h) picks the bindings up — no deploy needed (ADR-0007 write=live).",
);
