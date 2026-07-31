#!/usr/bin/env node
// Wire Nadia's `issue-triage` binding for the `agent-workforce` project via
// PATCH /agents/nadia (ADR-0007: bindings are DDB config, the agents-api is the
// single writer — validated at the write boundary, one AUDIT item per write;
// W-5 keeps it one-persona-per-mutation).
//
// What this adds (adr-0022, the dispatcher end of the issue→merge flow):
//   - issue-triage, ONCE A DAY at 02:23 UTC, Nadia (PdM routing persona),
//     project=agent-workforce → refluster/ai-native-article. A CCR
//     claude-code-routine fired by the orchestrator-tick path.
//
//     Each fire it assigns up to 10 open issues to exactly one lane
//     (implement / design / operator) as `wf:lane:*` + `wf:owner:*` labels plus
//     a stated dispatch comment, and re-examines issues parked in a
//     `*:needs-human` state for more than 14 days. Comment + label only — it
//     never edits, closes, or implements anything (R-N9).
//
//     The slot is 02:23 UTC, ~1h45m BEFORE Ren's 04:11 issue-implement on the
//     same project, so an issue laned this morning is workable the same day
//     rather than tomorrow. The daily loop is: triage 02:23 → implement 04:11 →
//     design 04:47 → remediate 06:29.
//
// PREREQ — SEED THE SKILL BODY FIRST (`wf:ren` R2 on #518). A binding whose
// skill has no `SKILL#` row fails EVERY fire: agent-runner.md step 2 resolves
// the body with `GET /skills/issue-triage` and refuses to fall back to the git copy
// on a non-2xx. Merging the PR puts the folder in git; it does NOT create the
// DDB row. Run the data-plane seed and confirm `GET /skills/issue-triage` returns
// 200 BEFORE running this script — see the runbook's Step 0.
//
// PREREQ: the project's github.token secret + the issue-triage SKILL# row
// (data-plane seed). See workforce/docs/runbooks/issue-to-merge-flow.md.
//
// ENABLING A CRON IS THE OPERATOR'S B-AUTHORITY STEP (governance.md §5): this
// script declares the binding enabled in ONE write (scheduler=external +
// invoked_by=api + cron, atomically — never the `manual`+cron dead-cron state),
// so running it IS that step. Do not run it without the operator's go-ahead.
//
// Idempotent, keyed on (skill, project_id): absent -> appended; equal -> no-op;
// drifted -> replaced in place (binding_idx preserved).
//
// Usage:
//   node workforce/scripts/wire-issue-triage-nadia-agent-workforce.mjs --dry-run
//   aws-vault exec <profile> -- \
//     node workforce/scripts/wire-issue-triage-nadia-agent-workforce.mjs

import { spawnSync } from "node:child_process";

const API_BASE = (
  process.env.WF_AGENTS_API_BASE ??
  "https://sjhikazsf9.execute-api.us-west-2.amazonaws.com/prod"
).replace(/\/+$/, "");
const REGION = process.env.AWS_REGION ?? "us-west-2";
const DRY_RUN = process.argv.includes("--dry-run");

const PROJECT_ID = "agent-workforce";
const ROUTINE_SPEC = "workforce/docs/routines/agent-runner.md";

const SLUG = "nadia";

const BINDING = {
  skill: "issue-triage",
  executor: "claude-code-routine",
  trigger: {
    scheduler: "external",
    invoked_by: "api",
    fired_from: "wf-orchestrator-tick",
    cron: "cron(23 2 ? * * *)",
  },
  routine_spec: ROUTINE_SPEC,
  project_id: PROJECT_ID,
  config: {
    sign_off_persona: "nadia",
    // Oldest-activity-first, so the aged tail (the issues that stopped being
    // looked at) drains rather than the newest churn being re-triaged.
    max_issues_per_run: 10,
    // A parked issue is re-examined after this long. 14d is chosen to be longer
    // than a typical blocking PR's lifetime and shorter than the ~6 weeks the
    // 2026-07 backlog tail actually sat untouched.
    requeue_days: 14,
    // Lane -> default owning persona. The router may name a different persona
    // when an issue's surface plainly belongs to one (finance, design system),
    // and says why in the dispatch comment.
    lane_owners: {
      implement: "ren",
      design: "dario",
      operator: "maya",
    },
  },
  note:
    "Nadia's daily issue-triage on refluster/ai-native-article (project agent-workforce), adr-0022. Assigns every open issue to exactly one lane — wf:lane:implement (issue-implement/ren), wf:lane:design (issue-design/dario), wf:lane:operator (human-only work, named explicitly) — as machine-readable labels plus a stated dispatch comment, and re-examines issues parked in *:needs-human for >14d so no state is absorbing. Comment+label only (R-N9); never closes or edits issues. Fires 02:23 UTC, ahead of Ren's 04:11 issue-implement so same-day dispatch is workable same-day.",
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
// note/config re-syncs. Other bindings on this persona are matched out by
// (skill, project_id) and preserved untouched.
const idx = cur.bindings.findIndex(
  (b) => b.skill === BINDING.skill && b.project_id === BINDING.project_id,
);
const summary = `${BINDING.skill} @ ${PROJECT_ID} (${BINDING.trigger.cron})`;
let next;
let verb;
if (idx >= 0) {
  if (stable(cur.bindings[idx]) === stable(BINDING)) {
    console.log(`  - ${SLUG}: ${BINDING.skill} @ ${PROJECT_ID} already bound + current, skipped (no-op).`);
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
