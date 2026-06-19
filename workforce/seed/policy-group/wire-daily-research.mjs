#!/usr/bin/env node
// Wire the generic `daily-research` Cadence onto the first research cohort via
// PATCH /agents/{slug} (ADR-0007: bindings are DDB config, agents-api is the
// single writer — each PATCH is validated (R8 against SKILL# rows) and lands its
// own AUDIT item). Epic-015.
//
// Phase 3 of the Epic-015 rollout. This script ADDS the daily-research binding to
// grace + ishaan, landing it **PAUSED** — scheduler:"manual", the runbook's
// "declarative-pending" shape (runbooks/bindings.md §Executor × scheduler), which
// wf-orchestrator-tick does NOT dispatch (it only fires
// executor=claude-code-routine + scheduler=external + invoked_by=api). So adding
// the binding is governance §5 A-authority ("lands Enabled:false-equivalent");
// ENABLING it (flip scheduler→external + add cron) is the separate B-authority
// Phase-4 step the operator performs — see ENABLE_SNIPPET at the bottom.
//
// This script does NOT touch grid-watch / india-grid-watch — deprecating those
// (Phase 5) is a later, B-authority step gated on the Phase-4 parity observation.
//
// PREREQ: the PR adding workforce/skills/daily-research must be MERGED and the
// data-plane deploy finished — wf-seed-skills syncs SKILL# rows post-deploy, and
// the R8 write-time check validates bindings against those rows. Running this
// before the sync 422s with R8-binding-skill-owner (fail-loud, no partial write).
//
// Idempotent: existing bindings are preserved; daily-research already bound on an
// agent is skipped, never duplicated or reordered (binding_idx is load-bearing).
//
// Usage:
//   node workforce/seed/policy-group/wire-daily-research.mjs --dry-run
//   aws-vault exec <profile> -- node workforce/seed/policy-group/wire-daily-research.mjs

import { spawnSync } from "node:child_process";

const API_BASE = (
  process.env.WF_AGENTS_API_BASE ??
  "https://sjhikazsf9.execute-api.us-west-2.amazonaws.com/prod"
).replace(/\/+$/, "");
const REGION = process.env.AWS_REGION ?? "us-west-2";
const DRY_RUN = process.argv.includes("--dry-run");

const ROUTINE_SPEC = "workforce/docs/routines/agent-runner.md";
const PROJECT_ID = "agent-workforce";

// The binding lands PAUSED: scheduler:"manual" (declarative-pending). No cron yet
// — the operator adds it at Phase 4. config.no_skip:true because both Grace's US
// beat and Ishaan's India beat are live federal-and-state regulatory machines that
// always carry a citable standing item (Epic-015 §Proposed solution).
function dailyResearchBinding(noSkip) {
  return {
    skill: "daily-research",
    executor: "claude-code-routine",
    trigger: {
      scheduler: "manual", // PAUSED — not dispatched by orchestrator-tick until Phase 4 flips it to "external"
    },
    routine_spec: ROUTINE_SPEC,
    project_id: PROJECT_ID,
    config: { no_skip: noSkip },
    note: "daily-research Cadence (Epic-015), landed PAUSED (scheduler=manual). Phase 4 (operator, B-authority) flips scheduler→external + invoked_by=api + a staggered cron to enable. project_id=agent-workforce supplies workforce.feed_write_token.",
  };
}

const PLAN = [
  { slug: "grace", add: [dailyResearchBinding(true)] },
  { slug: "ishaan", add: [dailyResearchBinding(true)] },
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
    console.log(`  - ${slug}: daily-research already bound, skipped`);
    continue;
  }
  // Append-only: existing bindings keep their binding_idx.
  const next = [...cur.bindings, ...additions];
  const summary = additions.map((b) => `${b.skill} @ ${b.trigger.scheduler} (PAUSED)`).join(", ");
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
console.log(DRY_RUN ? "Dry run complete." : "Done. Binding landed PAUSED — nothing fires until Phase 4 (operator) enables it.");

// ── Phase 4 (operator, B-authority): enable a paused binding ─────────────────
// After observing the binding is in place, the operator enables it by PATCHing the
// daily-research binding's trigger to the live shape (a distinct minute-of-day to
// avoid stampeding /fire — reuse the djb2 stagger from wire-cadences.mjs):
//
//   trigger: {
//     scheduler: "external",
//     invoked_by: "api",
//     fired_from: "wf-orchestrator-tick",
//     cron: "cron(M H ? * * *)"   // UTC; e.g. grace 01:07 = 21:07 ET, after the US docket day
//   }
//
// This is the Phase-4 cron-enable B-authority step (governance §5). Keep grid-watch
// bound until Phase 4 parity is confirmed; remove it only at Phase 5.
