#!/usr/bin/env node
// Wire Ren's `issue-implement` binding for the `agent-workforce` project via
// PATCH /agents/ren (ADR-0007: bindings are DDB config, the agents-api is the
// single writer — each PATCH is validated at the write boundary and lands its
// own AUDIT item; W-5 keeps it one-persona-per-mutation).
//
// What this adds:
//   - issue-implement, ONCE A DAY, Ren (Engineer persona),
//     project=agent-workforce → the workforce's OWN repo,
//     refluster/ai-native-article. A claude-code-routine (R-N1(a)) fired by
//     the orchestrator-tick CCR path (scheduler=external, invoked_by=api).
//     Each day it picks up to 3 eligible open issues, catches up on each
//     issue's referenced epic/design doc plus this repo's governance
//     (CLAUDE.md / AGENTS.md / docs/governance.md / workforce/docs/governance.md
//     + the two ADR trees), implements the change, verifies with the repo's
//     own gate, and opens a DRAFT PR per issue.
//
//     It NEVER merges (deliverable.type=external-pr, not external-pr-merge)
//     and NEVER pushes the default branch (R-N9) — adr-0011 made the own-repo
//     a normal delegated R-N10 target for *review/merge* (that grant lives on
//     Nadia's pr-autopilot binding), NOT for this skill. Ren opens the draft
//     PR; Nadia's every-6h pr-autopilot on the same project is the review path
//     that picks it up (adr-0010: bot-authored drafts are in scope).
//
//     Because the target here is this repo, the deny-list additionally carves
//     out the operator-owned surface: `layer:L0` / `layer:L1` issues (the L0
//     invariants, the L1 statute docs and ADRs, Zone-A prompts/rubrics/
//     workflows — root CLAUDE.md "🚫 without operator approval") are never
//     picked up autonomously, and `type:tracker` epics are excluded because
//     they don't scope to a single coherent PR. Anything the deny-list misses
//     still hits the skill's own Step 3/6 escalation — a governance conflict
//     is commented + `issue-implement:needs-human`, never guessed at.
//
// PREREQ:
//   1. workforce/projects/agent-workforce/project.json declares
//      github.{owner:"refluster",repo:"ai-native-article"} + the github.token
//      credential type (pre-existing — shared with Nadia's pr-autopilot).
//   2. The PAT secret exists: wf/projects/agent-workforce/github.token, scoped
//      Contents:R/W, Issues:R/W, Pull requests:R/W (pre-existing, same reason).
//   3. The data-plane deploy that syncs the issue-implement SKILL# row has run
//      (the write-time check validates the binding against it) — it has, via
//      the asp-cloud binding of the same skill.
//
// This script declares the binding ENABLED (scheduler=external + invoked_by=api
// + the daily cron, in one write) — the bindings.md "enable a cadence"
// B-authority shape. Enabling a scheduled run is the operator's B-authority
// step; running this script (which needs AWS creds) IS that step — do not run
// it without the operator's go-ahead.
//
// Idempotent + declares desired state. Keyed on (skill, project_id): absent ->
// appended; equal -> true no-op; drifted -> replaced in place (binding_idx
// preserved). Ren's other bindings (issue-implement @ asp-cloud, feed-post,
// daily-research, …) are matched out by (skill, project_id) and left untouched.
//
// Usage:
//   node workforce/scripts/wire-issue-implement-ren-agent-workforce.mjs --dry-run
//   aws-vault exec <profile> -- \
//     node workforce/scripts/wire-issue-implement-ren-agent-workforce.mjs

import { ensureProxyAwareEntry } from "../../scripts/lib/proxy-bootstrap.mjs";
ensureProxyAwareEntry(import.meta.url);
import { reconcileBinding } from "../../scripts/lib/binding-reconcile.mjs";

import { spawnSync } from "node:child_process";

const API_BASE = (
  process.env.WF_AGENTS_API_BASE ??
  "https://sjhikazsf9.execute-api.us-west-2.amazonaws.com/prod"
).replace(/\/+$/, "");
const REGION = process.env.AWS_REGION ?? "us-west-2";
const DRY_RUN = process.argv.includes("--dry-run");

const SLUG = "ren";
const PROJECT_ID = "agent-workforce";
const ROUTINE_SPEC = "workforce/docs/routines/agent-runner.md";

// Once a day at 04:11 UTC: cron(11 4 ? * * *). Single-literal minute+hour
// clears the agents-api hourly cadence floor (G1-cadence-floor). The slot is
// free across every checked-in wire script and sits ~1h after Ren's asp-cloud
// issue-implement (03:17) so the two daily implementation fires never share an
// orchestrator tick's 120-min window.
const BINDING = {
  skill: "issue-implement",
  executor: "claude-code-routine",
  trigger: {
    scheduler: "external",
    invoked_by: "api",
    fired_from: "wf-orchestrator-tick",
    cron: "cron(11 4 ? * * *)",
  },
  routine_spec: ROUTINE_SPEC,
  project_id: PROJECT_ID,
  config: {
    sign_off_persona: "ren",
    // Hard cap per fire (operator directive: "1回で対応するissueの数は3件まで").
    // The daily cadence, not a single run, works down the backlog.
    max_issues_per_run: 3,
    issue_selection: {
      deny_labels: [
        // Skill-default not-ready-for-autonomous-implementation set.
        "blocked",
        "needs-design",
        "discussion",
        "duplicate",
        "wontfix",
        "question",
        // This repo's own vocabulary (.github/labels.json).
        "wf:blocked",
        // Operator-owned surface — root CLAUDE.md's 🚫 list: L0 invariants,
        // L1 statute docs / ADRs, Zone-A design tokens / prompts / rubrics /
        // rosters / workflows. Never picked up autonomously.
        "layer:L0",
        "layer:L1",
        // Epic trackers don't scope to a single coherent PR; backlog-reconcile
        // owns the tracker itself.
        "type:tracker",
      ],
      // Absent allow_labels/priority_label -> Step 1's plain-eligibility scan
      // (unassigned-or-Ren, not already claimed by an open PR, no deny label,
      // no issue-implement:in-progress / issue-implement:needs-human marker).
    },
  },
  note:
    "Ren's daily issue-implement on the workforce's own repo refluster/ai-native-article (project agent-workforce). Fires once a day; picks up to 3 eligible open issues, catches up on each issue's referenced epic/design doc plus this repo's governance (CLAUDE.md, AGENTS.md, docs/governance.md, workforce/docs/governance.md and both ADR trees) and the surrounding code, implements the change, verifies with the repo's own gate (npm run lint / test / validate-*), and opens a DRAFT PR per issue (Closes #N, R-N9 citation of run_id + agent). Never merges (deliverable.type=external-pr) and never pushes main — the R-N10 merge grant of adr-0011 belongs to Nadia's pr-autopilot on this same project, which is the review path that picks these drafts up (adr-0010). Operator-owned surface is excluded by deny_labels (layer:L0, layer:L1 — the L0 invariants, L1 statute docs/ADRs and Zone-A files) plus type:tracker epics; anything the labels miss still escalates via the skill's Step 6 (comment + issue-implement:needs-human), never guessed at.",
};

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

const cur = await (await fetch(`${API_BASE}/agents/${SLUG}`)).json();
if (!Array.isArray(cur.bindings)) {
  console.error(`  ✗ ${SLUG}: GET returned no bindings[] (agent registered?)`);
  process.exit(1);
}

const summary = `${BINDING.skill} @ ${PROJECT_ID} (${BINDING.trigger.cron})`;
const { bindings: next, verb, changed } = reconcileBinding(
  cur.bindings,
  BINDING,
  (b) => b.skill === BINDING.skill && b.project_id === BINDING.project_id,
);
if (!changed) {
  console.log(`  - ${SLUG}: issue-implement @ ${PROJECT_ID} already bound + current, skipped (no-op).`);
  process.exit(0);
}
if (DRY_RUN) {
  console.log(`  [dry-run] ${SLUG}: would PATCH bindings -> ${verb} (${summary}); total ${next.length}`);
  process.exit(0);
}

const { status, json } = curlJson("PATCH", `/agents/${SLUG}`, { bindings: next });
if (status === 200) {
  console.log(`  ✓ ${SLUG}: ${verb} ${summary}`);
  console.log("Done. Next orchestrator tick picks the binding up — no deploy needed (ADR-0007 write=live).");
} else {
  console.error(`  ✗ ${SLUG}: HTTP ${status} ${JSON.stringify(json)}`);
  process.exit(1);
}
