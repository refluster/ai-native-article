#!/usr/bin/env node
// Wire the org-benchmark round's (2026-07) cadence bindings via
// PATCH /agents/{slug} (ADR-0007: bindings are DDB config, agents-api is
// the single writer — each PATCH is validated (R8 against SKILL# rows)
// and lands its own AUDIT item).
//
// One WEEKLY cadence per new agent, executor claude-code-routine (same as
// the policy group's cadences), staggered across weekdays so no two heavy
// runs share an hour and the operator's week opens with the attention
// ledger:
//
//   day  UTC    agent    skill
//   MON  00:07  camille  attention-ledger    (opens the operator's week)
//   TUE  01:17  ingrid   editorial-desk
//   WED  00:27  tomas    org-metrics-pulse
//   WED  02:37  dmitri   reader-signal
//   THU  00:47  rafael   red-team-audit
//   THU  02:57  beatriz  research-sync
//   FRI  00:07  owen     verification-sweep
//   FRI  01:27  zoe      memory-hygiene
//   FRI  02:47  imogen   audience-loop
//
// PREREQ: the PRs adding the nine workforce/skills/* cadences above must
// be MERGED and the data-plane deploy finished — wf-seed-skills syncs
// SKILL# rows post-deploy, and the R8 write-time check validates bindings
// against those rows. Running this before the sync 422s with
// R8-binding-skill-exists (fail-loud, no partial write).
//
// Idempotent: existing bindings are preserved; a (skill) already bound on
// an agent is skipped, never duplicated or reordered (binding_idx is
// load-bearing — see references/binding-and-cron.md).
//
// REBINDS (--include-rebinds, default OFF): the org-benchmark memo also
// proposes moving article-level2 + article-level3 elena → ingrid, and
// vp-monthly-report maya → camille. Removing a binding from a live agent
// is B-AUTHORITY — operator approval required before running with the
// flag. Without the flag this script only ever appends.
//
// Usage:
//   node workforce/seed/org-benchmark-group/wire-cadences.mjs --dry-run
//   aws-vault exec <profile> -- node workforce/seed/org-benchmark-group/wire-cadences.mjs
//   aws-vault exec <profile> -- node workforce/seed/org-benchmark-group/wire-cadences.mjs --include-rebinds

import { spawnSync } from "node:child_process";

const API_BASE = (
  process.env.WF_AGENTS_API_BASE ??
  "https://sjhikazsf9.execute-api.us-west-2.amazonaws.com/prod"
).replace(/\/+$/, "");
const REGION = process.env.AWS_REGION ?? "us-west-2";
const DRY_RUN = process.argv.includes("--dry-run");
const INCLUDE_REBINDS = process.argv.includes("--include-rebinds");

const ROUTINE_SPEC = "workforce/docs/routines/agent-runner.md";
const PROJECT_ID = "agent-workforce";

// Weekly stagger table (header comment above is the human-readable copy).
// cron(min hour ? * DOW *) — EventBridge 6-field weekly expressions.
const WEEKLY = [
  { slug: "camille", skill: "attention-ledger",   cron: "cron(7 0 ? * MON *)",  why: "opens the operator's week with the attention ledger" },
  { slug: "ingrid",  skill: "editorial-desk",     cron: "cron(17 1 ? * TUE *)", why: "editorial desk sweep" },
  { slug: "tomas",   skill: "org-metrics-pulse",  cron: "cron(27 0 ? * WED *)", why: "mid-week org metrics pulse" },
  { slug: "dmitri",  skill: "reader-signal",      cron: "cron(37 2 ? * WED *)", why: "mid-week reader-signal read" },
  { slug: "rafael",  skill: "red-team-audit",     cron: "cron(47 0 ? * THU *)", why: "weekly red-team audit" },
  { slug: "beatriz", skill: "research-sync",      cron: "cron(57 2 ? * THU *)", why: "cross-desk research sync" },
  { slug: "owen",    skill: "verification-sweep", cron: "cron(7 0 ? * FRI *)",  why: "weekly merged-PR verification sweep" },
  { slug: "zoe",     skill: "memory-hygiene",    cron: "cron(27 1 ? * FRI *)", why: "weekly memory-hygiene sweep" },
  { slug: "imogen",  skill: "audience-loop",      cron: "cron(47 2 ? * FRI *)", why: "weekly audience experiment loop" },
];

function weeklyBinding({ slug, skill, cron, why }) {
  return {
    skill,
    executor: "claude-code-routine",
    trigger: {
      scheduler: "external",
      invoked_by: "api",
      fired_from: "wf-orchestrator-tick",
      cron,
    },
    routine_spec: ROUTINE_SPEC,
    project_id: PROJECT_ID,
    note: `Weekly ${skill} cadence (${why}); org-benchmark round 2026-07 — see docs/hires/org-benchmark-nine-hire-round.md. Fired by wf-orchestrator-tick; project_id=${PROJECT_ID}. Wired at the org-benchmark-group onboarding.`,
  };
}

const PLAN = WEEKLY.map((w) => ({ slug: w.slug, add: [weeklyBinding(w)] }));

// B-AUTHORITY rebinds proposed by the org-benchmark memo. Each moves an
// existing binding object verbatim from `from` to `to` (the binding keeps
// its trigger/cron/note as configured on the source agent).
const REBINDS = [
  { skill: "article-level2",    from: "elena", to: "ingrid" },
  { skill: "article-level3",    from: "elena", to: "ingrid" },
  { skill: "vp-monthly-report", from: "maya",  to: "camille" },
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

async function getAgent(slug) {
  return await (await fetch(`${API_BASE}/agents/${slug}`)).json();
}

let failed = false;

for (const { slug, add } of PLAN) {
  const cur = await getAgent(slug);
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

if (INCLUDE_REBINDS) {
  console.log("");
  console.log("################################################################");
  console.log("# B-AUTHORITY: operator approval required.                     #");
  console.log("# --include-rebinds removes live bindings from elena and maya  #");
  console.log("# per the org-benchmark memo. Do NOT run without an explicit   #");
  console.log("# operator 'yes' on the memo's rebind section.                 #");
  console.log("################################################################");
  for (const { skill, from, to } of REBINDS) {
    const src = await getAgent(from);
    const dst = await getAgent(to);
    if (!Array.isArray(src.bindings) || !Array.isArray(dst.bindings)) {
      console.error(`  ✗ rebind ${skill} ${from}->${to}: missing bindings[] on one side`);
      failed = true;
      continue;
    }
    const moving = src.bindings.find((b) => b.skill === skill);
    const already = dst.bindings.some((b) => b.skill === skill);
    if (!moving && already) {
      console.log(`  - rebind ${skill}: already moved ${from}->${to}, skipped`);
      continue;
    }
    if (!moving) {
      console.error(`  ✗ rebind ${skill}: not bound on ${from} and not present on ${to} — nothing to move`);
      failed = true;
      continue;
    }
    const srcNext = src.bindings.filter((b) => b.skill !== skill);
    const dstNext = already ? dst.bindings : [...dst.bindings, moving];
    if (DRY_RUN) {
      console.log(`  [dry-run] rebind ${skill}: would PATCH ${to} +1 (${already ? "already present" : moving.trigger?.cron}) then ${from} -1`);
      continue;
    }
    // Add to destination FIRST, then remove from source — a crash between
    // the two leaves the cadence double-bound (loud, visible) rather than
    // unbound (silent coverage gap).
    if (!already) {
      const addRes = curlJson("PATCH", `/agents/${to}`, { bindings: dstNext });
      if (addRes.status !== 200) {
        failed = true;
        console.error(`  ✗ rebind ${skill}: add to ${to} HTTP ${addRes.status} ${JSON.stringify(addRes.json)} — ${from} left untouched`);
        continue;
      }
    }
    const rmRes = curlJson("PATCH", `/agents/${from}`, { bindings: srcNext });
    if (rmRes.status !== 200) {
      failed = true;
      console.error(`  ✗ rebind ${skill}: remove from ${from} HTTP ${rmRes.status} ${JSON.stringify(rmRes.json)} — now double-bound on ${from}+${to}, re-run to converge`);
      continue;
    }
    console.log(`  ✓ rebind ${skill}: moved ${from} -> ${to}`);
  }
} else {
  console.log("  (rebinds skipped — pass --include-rebinds after operator approval to move article-level2/3 elena->ingrid and vp-monthly-report maya->camille)");
}

if (failed) process.exit(1);
console.log(DRY_RUN ? "Dry run complete." : "Done. Next orchestrator tick (rate 2h) picks the bindings up — no deploy needed (ADR-0007 write=live).");
