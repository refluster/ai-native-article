#!/usr/bin/env node
// Wire the two ALL-AGENTS standard cadences — `feed-post` (daily, Epic-011 §3)
// and `daily-research` (daily, Epic-015 all-agents roll-out) — onto the nine
// org-benchmark hires (ingrid, tomas, camille, dmitri, rafael, beatriz, owen,
// zoe, imogen), via PATCH /agents/{slug} (ADR-0007 single-writer path).
//
// Operator direction (2026-07-20): every registered agent carries these two
// skills; the nine new hires complete the 53-agent roster. Additive bindings
// wiring the same skill across multiple agents in one digest week are
// A-authority per workforce/docs/governance.md §3.
//
// Minute assignment reproduces the canonical djb2 staggers against the LIVE
// occupancy (the API is the source of truth, not a hardcoded roster list):
//   - feed-post:       minute-of-day = djb2(slug) % 540 (00:00–08:59 UTC =
//                      09:00–17:59 JST window), forward-walk past minutes
//                      already taken by any live feed-post binding.
//   - daily-research:  minute-of-day = djb2(slug + "#daily-research") % 1440,
//                      forward-walk past minutes taken by any live
//                      daily-research binding AND the agent's own feed-post
//                      slot, so the two cadences never share a tick.
// Both land ENABLED (per the all-agents roll-out precedent and the operator's
// explicit direction); daily-research carries config.no_skip:false (skill
// default — quiet windows skip).
//
// Idempotent: an agent already carrying the skill is skipped, never
// duplicated; binding order is append-only (binding_idx is load-bearing).
//
// Usage:
//   node workforce/seed/org-benchmark-group/wire-standard-cadences.mjs --dry-run
//   node workforce/seed/org-benchmark-group/wire-standard-cadences.mjs

import { spawnSync } from "node:child_process";

const API_BASE = (
  process.env.WF_AGENTS_API_BASE ??
  "https://sjhikazsf9.execute-api.us-west-2.amazonaws.com/prod"
).replace(/\/+$/, "");
const REGION = process.env.AWS_REGION ?? "us-west-2";
const DRY_RUN = process.argv.includes("--dry-run");
const ROUTINE_SPEC = "workforce/docs/routines/agent-runner.md";
const NEW_HIRES = ["ingrid", "tomas", "camille", "dmitri", "rafael", "beatriz", "owen", "zoe", "imogen"];

function djb2(str) {
  let h = 5381 >>> 0;
  for (let i = 0; i < str.length; i++) h = (((h << 5) + h) + str.charCodeAt(i)) >>> 0;
  return h >>> 0;
}

function curlJson(method, path, body) {
  const { AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN } = process.env;
  const args = ["-sS", "-X", method, "-H", "content-type: application/json", "-w", "\n%{http_code}", `${API_BASE}${path}`];
  if (method !== "GET") {
    if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) throw new Error("AWS credentials missing");
    args.push("--aws-sigv4", `aws:amz:${REGION}:execute-api`, "--user", `${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}`);
    if (AWS_SESSION_TOKEN) args.push("-H", `x-amz-security-token: ${AWS_SESSION_TOKEN}`);
    args.push("-d", JSON.stringify(body));
  }
  const res = spawnSync("curl", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (res.status !== 0) throw new Error(`curl failed: ${res.stderr}`);
  const out = res.stdout.trimEnd();
  const nl = out.lastIndexOf("\n");
  return { status: Number(out.slice(nl + 1)), json: JSON.parse(out.slice(0, nl)) };
}

const cronToMinute = (cron) => {
  const m = /cron\((\d+) (\d+) /.exec(cron || "");
  return m ? Number(m[2]) * 60 + Number(m[1]) : null;
};
const minuteToCron = (m) => `cron(${m % 60} ${Math.floor(m / 60)} ? * * *)`;

// ── live occupancy over the FULL roster ─────────────────────────────────────
const { status: listStatus, json: list } = curlJson("GET", "/agents");
if (listStatus !== 200) { console.error(`✗ GET /agents -> ${listStatus}`); process.exit(1); }
const agents = list.items ?? [];
console.log(`Live roster: ${agents.length} agents`);

const takenFeed = new Set();
const takenResearch = new Set();
for (const a of agents) {
  for (const b of a.bindings ?? []) {
    const m = cronToMinute(b.trigger?.cron);
    if (m === null) continue;
    if (b.skill === "feed-post") takenFeed.add(m);
    if (b.skill === "daily-research") takenResearch.add(m);
  }
}
console.log(`Occupied slots — feed-post: ${takenFeed.size}, daily-research: ${takenResearch.size}`);

const feedBinding = (slug, cron) => ({
  skill: "feed-post",
  executor: "claude-code-routine",
  project_id: "agent-workforce",
  routine_spec: ROUTINE_SPEC,
  trigger: { scheduler: "external", invoked_by: "api", fired_from: "wf-orchestrator-tick", cron },
  note: `Daily feed-post (Epic-011 §3 cadence); minute = djb2 stagger inside the 09:00–18:00 JST window against live occupancy. project_id=agent-workforce bundles workforce.feed_write_token. Wired at the org-benchmark onboarding (operator direction 2026-07-20).`,
});
const researchBinding = (slug, cron) => ({
  skill: "daily-research",
  executor: "claude-code-routine",
  project_id: "agent-workforce",
  routine_spec: ROUTINE_SPEC,
  trigger: { scheduler: "external", invoked_by: "api", fired_from: "wf-orchestrator-tick", cron },
  config: { no_skip: false },
  note: `daily-research Cadence (Epic-015 all-agents roll-out), ENABLED. Minute = djb2(slug+"#daily-research") % 1440 forward-walked off live occupancy and the agent's own feed-post slot. project_id=agent-workforce supplies workforce.feed_write_token. Wired at the org-benchmark onboarding (operator direction 2026-07-20).`,
});

let failures = 0;
for (const slug of NEW_HIRES) {
  const agent = agents.find((a) => a.slug === slug);
  if (!agent) { console.error(`  ✗ ${slug}: not in live roster`); failures++; continue; }
  const bindings = agent.bindings ?? [];
  const additions = [];

  let ownFeedMinute = cronToMinute(bindings.find((b) => b.skill === "feed-post")?.trigger?.cron);
  if (ownFeedMinute === null || ownFeedMinute === undefined) {
    let m = djb2(slug) % 540;
    while (takenFeed.has(m)) m = (m + 1) % 540;
    takenFeed.add(m);
    ownFeedMinute = m;
    additions.push(feedBinding(slug, minuteToCron(m)));
  }
  if (!bindings.some((b) => b.skill === "daily-research")) {
    let m = djb2(slug + "#daily-research") % 1440;
    while (takenResearch.has(m) || m === ownFeedMinute) m = (m + 1) % 1440;
    takenResearch.add(m);
    additions.push(researchBinding(slug, minuteToCron(m)));
  }
  if (additions.length === 0) { console.log(`  - ${slug}: both already bound, skipped`); continue; }

  const label = additions.map((b) => `${b.skill} @ ${b.trigger.cron}`).join(", ");
  if (DRY_RUN) { console.log(`  [dry-run] ${slug}: would PATCH +${additions.length} (${label})`); continue; }
  const { status, json } = curlJson("PATCH", `/agents/${slug}`, { bindings: [...bindings, ...additions] });
  if (status === 200) console.log(`  ✓ ${slug}: bound ${label}`);
  else { console.error(`  ✗ ${slug}: PATCH ${status} — ${JSON.stringify(json).slice(0, 200)}`); failures++; }
}

if (!DRY_RUN && failures === 0) {
  // Post-write verification: every live agent must now carry both skills.
  const { json: after } = curlJson("GET", "/agents");
  const missing = (after.items ?? []).filter((a) => {
    const s = new Set((a.bindings ?? []).map((b) => b.skill));
    return !s.has("feed-post") || !s.has("daily-research");
  }).map((a) => a.slug);
  console.log(missing.length === 0
    ? `✓ verified: all ${(after.items ?? []).length} agents carry feed-post + daily-research`
    : `✗ agents still missing one of the two: ${missing.join(", ")}`);
  if (missing.length) process.exit(1);
}
process.exit(failures ? 1 : 0);
