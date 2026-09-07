#!/usr/bin/env node
// Wire Dario's `issue-design` binding for the `agent-workforce` project via
// PATCH /agents/dario (ADR-0007 write path; W-5 one-persona-per-mutation).
//
// What this adds (adr-0022, the design lane's worker):
//   - issue-design, ONCE A DAY at 04:47 UTC, Dario (architecture persona),
//     project=agent-workforce → refluster/ai-native-article. A CCR
//     claude-code-routine (R-N1(a)) fired by the orchestrator-tick path.
//
//     Each fire it takes up to 2 `wf:lane:design` issues — the architecture /
//     product / L0-L1 tail that `issue-implement` structurally cannot take —
//     and drafts the artefact they owe: an ADR, an epic decomposition, a
//     statute-amendment PROPOSAL, or a design record. Deliverable is a document
//     diff in a DRAFT PR; it never implements the decision it proposes and
//     never merges (external-pr, not external-pr-merge).
//
//     This does NOT widen what may be merged autonomously. An L0/L1 artefact
//     still escalates to the operator by the existing pr-autopilot predicate —
//     the change is that it arrives as a reviewable diff instead of as an
//     untouched issue. max 2/fire because design work is slower and dearer per
//     item than implementation (W-3).
//
// PREREQ — SEED THE SKILL BODY FIRST (`wf:ren` R2 on #518). A binding whose
// skill has no `SKILL#` row fails EVERY fire: agent-runner.md step 2 resolves
// the body with `GET /skills/issue-design` and refuses to fall back to the git copy
// on a non-2xx. Merging the PR puts the folder in git; it does NOT create the
// DDB row. Run the data-plane seed and confirm `GET /skills/issue-design` returns
// 200 BEFORE running this script — see the runbook's Step 0.
//
// PREREQ: the project's github.token secret + the issue-design SKILL# row.
// Wire issue-triage FIRST and let it run one cycle — until issues carry
// wf:lane:design this cadence correctly finds nothing (a cheap no-op).
//
// ENABLING A CRON IS THE OPERATOR'S B-AUTHORITY STEP (governance.md §5).
//
// Usage:
//   node workforce/scripts/wire-issue-design-dario-agent-workforce.mjs --dry-run
//   aws-vault exec <profile> -- \
//     node workforce/scripts/wire-issue-design-dario-agent-workforce.mjs

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

const PROJECT_ID = "agent-workforce";
const ROUTINE_SPEC = "workforce/docs/routines/agent-runner.md";

const SLUG = "dario";

const BINDING = {
  skill: "issue-design",
  executor: "claude-code-routine",
  trigger: {
    scheduler: "external",
    invoked_by: "api",
    fired_from: "wf-orchestrator-tick",
    cron: "cron(47 4 ? * * *)",
  },
  routine_spec: ROUTINE_SPEC,
  project_id: PROJECT_ID,
  config: {
    sign_off_persona: "dario",
    max_issues_per_run: 2,
  },
  note:
    "Dario's daily issue-design on refluster/ai-native-article (project agent-workforce), adr-0022. Works the wf:lane:design issues — architecture / product / L0-L1 items whose deliverable is a decision or document, which issue-implement structurally cannot take — into a DRAFT PR carrying an ADR, an epic decomposition, a statute-amendment proposal, or a design record. Never implements the decision it proposes and never merges (external-pr); an L0/L1 artefact still escalates to the operator by the existing predicate, arriving as a reviewable diff instead of an untouched issue. 2 issues/fire (design work is dearer per item). Fires 04:47 UTC, after triage (02:23) has laned the backlog.",
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
  console.log(`  - ${SLUG}: ${BINDING.skill} @ ${PROJECT_ID} already bound + current, skipped (no-op).`);
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
