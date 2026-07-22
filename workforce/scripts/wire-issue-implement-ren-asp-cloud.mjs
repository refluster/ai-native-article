#!/usr/bin/env node
// Wire Ren's `issue-implement` binding for the `asp-cloud` project via
// PATCH /agents/ren (ADR-0007: bindings are DDB config, the agents-api is
// the single writer — each PATCH is validated at the write boundary and
// lands its own AUDIT item; W-5 keeps it one-persona-per-mutation).
//
// What this adds:
//   - issue-implement, ONCE A DAY, Ren (Engineer persona), project=asp-cloud.
//     A claude-code-routine (R-N1(a)) fired by the orchestrator-tick CCR path
//     (scheduler=external, invoked_by=api). Each day it picks up to 3 open
//     issues from PSVL/asp-cloud, catches up on each issue's referenced epic/
//     design doc plus the repo's own governance (AGENTS.md + whatever ADR/
//     CONTRIBUTING surface it discovers), implements the change, verifies it
//     with the repo's own gate, and opens a DRAFT PR per issue. It NEVER
//     merges (deliverable.type=external-pr, not external-pr-merge) and NEVER
//     pushes to the target's default branch (R-N9). Ambiguous or governance-
//     conflicting issues are skipped with a labelled comment, not guessed at.
//
// PREREQ:
//   1. workforce/projects/asp-cloud/project.json already declares
//      github.{owner:"PSVL",repo:"asp-cloud"} + the github.token credential
//      type (pre-existing — shared with pr-autopilot).
//   2. The PAT secret exists: wf/projects/asp-cloud/github.token, scoped
//      Contents:R/W, Issues:R/W, Pull requests:R/W (it pushes a branch,
//      opens a PR, comments/labels issues).
//   3. The data-plane deploy that syncs the issue-implement SKILL# row has
//      run (the write-time check validates the binding against it).
//
// This script declares the binding ENABLED (scheduler=external +
// invoked_by=api + the daily cron, in one write) — the bindings.md "enable a
// cadence" B-authority shape. Enabling a scheduled run is the operator's
// B-authority step; running this script (which needs AWS creds) IS that
// step — do not run it without the operator's go-ahead beyond what's already
// on record for this binding.
//
// Idempotent + declares desired state. Keyed on (skill, project_id): absent
// -> appended; equal -> true no-op; drifted -> replaced in place (binding_idx
// preserved). Ren's other bindings (pr-autopilot reviewer lens @ asp-cloud,
// code-task-brief, …) are matched out by (skill, project_id) and left
// untouched.
//
// Usage:
//   node workforce/scripts/wire-issue-implement-ren-asp-cloud.mjs --dry-run
//   aws-vault exec <profile> -- \
//     node workforce/scripts/wire-issue-implement-ren-asp-cloud.mjs

import { spawnSync } from "node:child_process";

const API_BASE = (
  process.env.WF_AGENTS_API_BASE ??
  "https://sjhikazsf9.execute-api.us-west-2.amazonaws.com/prod"
).replace(/\/+$/, "");
const REGION = process.env.AWS_REGION ?? "us-west-2";
const DRY_RUN = process.argv.includes("--dry-run");

const SLUG = "ren";
const PROJECT_ID = "asp-cloud";
const ROUTINE_SPEC = "workforce/docs/routines/agent-runner.md";

// Once a day at 03:17 UTC: cron(17 3 ? * * *). Single-literal minute+hour
// clears the agents-api hourly cadence floor (G1-cadence-floor); the slot is
// distinct from every other daily/multi-daily wire script checked in today
// (backlog-reconcile 02:41, pr-autopilot 00/06/12/18:23, memory-curation
// 20:52) so a fresh fire never collides with an adjacent cadence.
const BINDING = {
  skill: "issue-implement",
  executor: "claude-code-routine",
  trigger: {
    scheduler: "external",
    invoked_by: "api",
    fired_from: "wf-orchestrator-tick",
    cron: "cron(17 3 ? * * *)",
  },
  routine_spec: ROUTINE_SPEC,
  project_id: PROJECT_ID,
  config: {
    sign_off_persona: "ren",
    // Hard cap per fire (operator directive: "1回で対応するissueの数は3件まで").
    // The daily cadence, not a single run, works down the backlog.
    max_issues_per_run: 3,
    issue_selection: {
      deny_labels: ["blocked", "needs-design", "discussion", "duplicate", "wontfix", "question"],
      // Absent allow_labels/priority_label -> Step 1's plain-eligibility scan
      // (unassigned-or-Ren, not already claimed by an open PR, no deny label,
      // no issue-implement:in-progress / issue-implement:needs-human marker).
    },
  },
  note:
    "Ren's daily issue-implement on PSVL/asp-cloud (project asp-cloud). Fires once a day; picks up to 3 eligible open issues, catches up on each issue's referenced epic/design doc plus the repo's own governance (AGENTS.md + whatever ADR/CONTRIBUTING surface it discovers) and the surrounding code, implements the change, verifies with the repo's own gate, and opens a DRAFT PR per issue (Closes #N, R-N9 citation of run_id + agent). Never merges (deliverable.type=external-pr) and never pushes the default branch. Ambiguous or governance-conflicting issues are skipped with a labelled comment (issue-implement:needs-human), not guessed at.",
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

// Stable, key-order-independent serialization so a true no-op (the live
// binding already equals what we declare) is distinguished from drift.
// ARRAY order is preserved (significant) on purpose — issue_selection's
// deny_labels list is a real list, not a set, so a reorder is semantic
// drift that SHOULD re-PATCH, not a cosmetic no-op.
const stable = (v) =>
  v && typeof v === "object" && !Array.isArray(v)
    ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`
    : Array.isArray(v)
      ? `[${v.map(stable).join(",")}]`
      : JSON.stringify(v);

// Match on (skill, project_id). Not present -> append; equal -> no-op;
// drifted -> replace in place (binding_idx preserved) so a corrected
// note/config re-syncs.
const idx = cur.bindings.findIndex(
  (b) => b.skill === BINDING.skill && b.project_id === BINDING.project_id,
);
const summary = `${BINDING.skill} @ ${PROJECT_ID} (${BINDING.trigger.cron})`;
let next;
let verb;
if (idx >= 0) {
  if (stable(cur.bindings[idx]) === stable(BINDING)) {
    console.log(`  - ${SLUG}: issue-implement @ ${PROJECT_ID} already bound + current, skipped (no-op).`);
    process.exit(0);
  }
  next = cur.bindings.map((b, i) => (i === idx ? BINDING : b));
  verb = "updated (in-place, binding_idx preserved)";
} else {
  next = [...cur.bindings, BINDING];
  verb = "bound";
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
