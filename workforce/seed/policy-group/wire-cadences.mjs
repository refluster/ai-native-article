#!/usr/bin/env node
// Wire the Policy & Regulatory Affairs group's cadence bindings via
// PATCH /agents/{slug} (ADR-0007: bindings are DDB config, agents-api is
// the single writer — each PATCH is validated (R8 against SKILL# rows)
// and lands its own AUDIT item).
//
//   - feed-post, daily, all five (tessa/grace/ishaan/astrid/mei) — minute
//     staggered with the SAME djb2 algorithm the retired
//     workforce/seed/stagger-feed-cron.mjs used (verified to reproduce all
//     21 existing live assignments), so the new five land on their
//     deterministic, collision-free slots.
//   - grid-watch, daily, grace only — the US grid-regulation research
//     digest (workforce/skills/grid-watch). Fires 01:07 UTC = 21:07 ET,
//     after the US business day's docket issuances, landing on the feed
//     at 10:07 JST.
//
// PREREQ: the PR adding workforce/skills/grid-watch + the feed-post
// owners[] amendment must be MERGED and the data-plane deploy finished —
// wf-seed-skills syncs SKILL# rows post-deploy, and the R8 write-time
// check validates bindings against those rows. Running this before the
// sync 422s with R8-binding-skill-exists (fail-loud, no partial write).
//
// Idempotent: existing bindings are preserved; a (skill) already bound on
// an agent is skipped, never duplicated or reordered (binding_idx is
// load-bearing — see references/binding-and-cron.md).
//
// Usage:
//   node workforce/seed/policy-group/wire-cadences.mjs --dry-run
//   aws-vault exec <profile> -- node workforce/seed/policy-group/wire-cadences.mjs

import { ensureProxyAwareEntry } from "../../../scripts/lib/proxy-bootstrap.mjs";
ensureProxyAwareEntry(import.meta.url);

import { spawnSync } from "node:child_process";

const API_BASE = (
  process.env.WF_AGENTS_API_BASE ??
  "https://sjhikazsf9.execute-api.us-west-2.amazonaws.com/prod"
).replace(/\/+$/, "");
const REGION = process.env.AWS_REGION ?? "us-west-2";
const DRY_RUN = process.argv.includes("--dry-run");

const ROUTINE_SPEC = "workforce/docs/routines/agent-runner.md";
const PROJECT_ID = "agent-workforce";

// djb2(slug) % 540 with alphabetical forward-walk collision resolution over
// the FULL roster — identical to the retired stagger-feed-cron.mjs, so the
// existing agents' minutes are reproduced and the new five get the next
// deterministic free slots.
function djb2(str) {
  let h = 5381 >>> 0;
  for (let i = 0; i < str.length; i++) h = (((h << 5) + h) + str.charCodeAt(i)) >>> 0;
  return h >>> 0;
}
const ROSTER = [
  "aanya", "aoi", "astrid", "dario", "elena", "farah", "freya", "grace",
  "hana", "ishaan", "kai", "levi", "mateo", "maya", "mei", "mira", "nadia",
  "noor", "priya", "ren", "sana", "sora", "tessa", "theo", "vikram", "yuki",
].sort();
const minuteOfDay = new Map();
{
  const taken = new Set();
  for (const s of ROSTER) {
    let m = djb2(s) % 540;
    while (taken.has(m)) m = (m + 1) % 540;
    taken.add(m);
    minuteOfDay.set(s, m);
  }
}
const cronFor = (slug) => {
  const m = minuteOfDay.get(slug);
  return `cron(${m % 60} ${Math.floor(m / 60)} ? * * *)`;
};

const FEED_NOTE = (slug) =>
  `Daily feed-post (Epic-011 §3 cadence); minute = djb2 stagger inside the 09:00-18:00 JST window (same algorithm as the retired stagger-feed-cron.mjs). Fired by wf-orchestrator-tick; project_id=${PROJECT_ID} bundles workforce.feed_write_token. Wired at the policy-group onboarding (PR for workforce/seed/policy-group).`;

function feedPostBinding(slug) {
  return {
    skill: "feed-post",
    executor: "claude-code-routine",
    trigger: {
      scheduler: "external",
      invoked_by: "api",
      fired_from: "wf-orchestrator-tick",
      cron: cronFor(slug),
    },
    routine_spec: ROUTINE_SPEC,
    project_id: PROJECT_ID,
    note: FEED_NOTE(slug),
  };
}

const GRID_WATCH_BINDING = {
  skill: "grid-watch",
  executor: "claude-code-routine",
  trigger: {
    scheduler: "external",
    invoked_by: "api",
    fired_from: "wf-orchestrator-tick",
    cron: "cron(7 1 ? * * *)",
  },
  routine_spec: ROUTINE_SPEC,
  project_id: PROJECT_ID,
  note: "Daily US grid-regulation research digest (grid-watch Cadence). 01:07 UTC = 21:07 ET — after the US business day's docket issuances; lands on the feed 10:07 JST. project_id=agent-workforce supplies workforce.feed_write_token.",
};

const PLAN = [
  { slug: "tessa", add: [feedPostBinding("tessa")] },
  { slug: "grace", add: [feedPostBinding("grace"), GRID_WATCH_BINDING] },
  { slug: "ishaan", add: [feedPostBinding("ishaan")] },
  { slug: "astrid", add: [feedPostBinding("astrid")] },
  { slug: "mei", add: [feedPostBinding("mei")] },
];

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

let failed = false;
for (const { slug, add } of PLAN) {
  const cur = await (await fetch(`${API_BASE}/agents/${slug}`)).json();
  if (!Array.isArray(cur.bindings)) {
    console.error(`  ✗ ${slug}: GET returned no bindings[] (agent registered?)`);
    failed = true;
    continue;
  }
  const bound = new Set(cur.bindings.map((b) => b.skill));
  const additions = add.filter((b) => !bound.has(b.skill));
  if (additions.length === 0) {
    console.log(`  - ${slug}: all target skills already bound, skipped`);
    continue;
  }
  // Append-only: existing bindings keep their binding_idx.
  const next = [...cur.bindings, ...additions];
  const summary = additions.map((b) => `${b.skill} @ ${b.trigger.cron}`).join(", ");
  if (DRY_RUN) {
    console.log(`  [dry-run] ${slug}: would PATCH bindings -> +${additions.length} (${summary}); total ${next.length}`);
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
console.log(DRY_RUN ? "Dry run complete." : "Done. Next orchestrator tick (rate 2h) picks the bindings up — no deploy needed (ADR-0007 write=live).");
