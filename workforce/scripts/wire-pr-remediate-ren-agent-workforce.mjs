#!/usr/bin/env node
// Wire Ren's `pr-remediate` binding for the `agent-workforce` project via
// PATCH /agents/ren (ADR-0007 write path; W-5 one-persona-per-mutation).
//
// What this adds (adr-0022, the AUTHOR lane's worker):
//   - pr-remediate, ONCE A DAY at 06:29 UTC, Ren (engineer persona),
//     project=agent-workforce → refluster/ai-native-article. A CCR
//     claude-code-routine (R-N1(a)) fired by the orchestrator-tick path.
//
//     Each fire it works up to 3 PRs labelled `autopilot:needs-author` — the
//     agent-fixable queue pr-autopilot hands off to: a conflict with main
//     (the #517 shape: another PR merged first), a behind branch, or open
//     blocking lens findings. It resolves, verifies with the target repo's own
//     gate, pushes to the PR's HEAD branch, and clears the label so the next
//     pr-autopilot tick re-routes at cycle N+1.
//
//     It NEVER merges and NEVER pushes the default branch (external-pr, not
//     external-pr-merge; R-N9). The lane is bounded by construction: 3 attempts
//     per PR, and pr-autopilot-sweep.mjs escalates anything untouched for 36h
//     even if this cadence never fires — so the two-outcome contract holds.
//
//     06:29 UTC sits after Ren's 04:11 issue-implement (so the two Ren fires
//     never share an orchestrator tick window) and gives the every-6h
//     pr-autopilot a pass to have labelled the overnight PRs.
//
// PREREQ — SEED THE SKILL BODY FIRST (`wf:ren` R2 on #518). A binding whose
// skill has no `SKILL#` row fails EVERY fire: agent-runner.md step 2 resolves
// the body with `GET /skills/pr-remediate` and refuses to fall back to the git copy
// on a non-2xx. Merging the PR puts the folder in git; it does NOT create the
// DDB row. Run the data-plane seed and confirm `GET /skills/pr-remediate` returns
// 200 BEFORE running this script — see the runbook's Step 0.
//
// PREREQ: the project's github.token secret (Contents R/W on the branch
// namespace, Pull requests R/W) + the pr-remediate SKILL# row. Independent of
// the issue lanes — it can be wired before or after issue-triage.
//
// ENABLING A CRON IS THE OPERATOR'S B-AUTHORITY STEP (governance.md §5).
//
// Usage:
//   node workforce/scripts/wire-pr-remediate-ren-agent-workforce.mjs --dry-run
//   aws-vault exec <profile> -- \
//     node workforce/scripts/wire-pr-remediate-ren-agent-workforce.mjs

import { spawnSync } from "node:child_process";

const API_BASE = (
  process.env.WF_AGENTS_API_BASE ??
  "https://sjhikazsf9.execute-api.us-west-2.amazonaws.com/prod"
).replace(/\/+$/, "");
const REGION = process.env.AWS_REGION ?? "us-west-2";
const DRY_RUN = process.argv.includes("--dry-run");

const PROJECT_ID = "agent-workforce";
const ROUTINE_SPEC = "workforce/docs/routines/agent-runner.md";

const SLUG = "ren";

const BINDING = {
  skill: "pr-remediate",
  executor: "claude-code-routine",
  trigger: {
    scheduler: "external",
    invoked_by: "api",
    fired_from: "wf-orchestrator-tick",
    cron: "cron(29 6 ? * * *)",
  },
  routine_spec: ROUTINE_SPEC,
  project_id: PROJECT_ID,
  config: {
    sign_off_persona: "ren",
    // One PR at a time within the fire (a shared working tree cannot hold two
    // resolutions); this caps how many the fire attempts at all.
    max_prs_per_run: 3,
  },
  note:
    "Ren's daily pr-remediate on refluster/ai-native-article (project agent-workforce), adr-0022. Works the autopilot:needs-author queue — base conflicts (the #517 shape: main moved under the branch), behind branches, and open blocking lens findings — resolving semantically, verifying with the repo's own gate, pushing to the PR's HEAD branch (never main), and clearing the label so pr-autopilot re-routes at cycle N+1. Never merges (external-pr). Bounded: 3 attempts per PR, plus the sweep's 36h author-stale escalation, so the lane can never absorb a PR. Fires 06:29 UTC, after Ren's 04:11 issue-implement.",
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
