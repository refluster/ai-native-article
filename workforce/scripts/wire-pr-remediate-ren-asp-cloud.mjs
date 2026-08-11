#!/usr/bin/env node
// Wire Ren's `pr-remediate` binding for the `asp-cloud` project via
// PATCH /agents/ren (ADR-0007 write path; W-5 one-persona-per-mutation).
//
// WHY THIS EXISTS (the bug it closes). `pr-remediate` — the AUTHOR lane's
// worker (adr-0022) — was wired for `agent-workforce` ONLY
// (wire-pr-remediate-ren-agent-workforce.mjs). Nadia's `pr-autopilot` runs on
// `asp-cloud` every 6h and routes agent-fixable PRs into
// `autopilot:needs-author` there, so that project has had a lane with no
// worker since the lane shipped. The observable result, on the record:
// PSVL/asp-cloud#692 and #693 were handed to the author lane on 2026-08-07
// with concrete, mechanical remediation briefs (#693: regenerate the frontend
// OSS-disclosure artefact — one command), sat untouched, and were escalated to
// the operator 36h later by the deterministic sweep with
// `autopilot:reason:author-stale`. The sweep's comment said "the pr-remediate
// cadence did not pick it up"; it never could.
//
// The event-driven hand-off (adr-0025) does NOT substitute for this wiring —
// `POST /dispatch` fires an *already-declared* binding and correctly 404s when
// none exists (R-N4: dispatch never invents an execution). The two ship
// together: this makes the lane work at all, the dispatch makes it work in
// seconds.
//
// What this adds:
//   - pr-remediate, TWICE A DAY at 07:51 and 19:51 UTC, Ren (engineer persona),
//     project=asp-cloud → PSVL/asp-cloud. A CCR claude-code-routine (R-N1(a))
//     fired by the orchestrator-tick path.
//
//     Both fires sit 6 min after a pr-autopilot tick on this project
//     (`cron(45 1/6 …)` → 01:45 / 07:45 / 13:45 / 19:45), so each picks up the
//     labels that tick just wrote. They also clear Ren's 03:17 asp-cloud
//     issue-implement and his 04:11 agent-workforce one, and sit 12h apart from
//     his 06:29/18:29 agent-workforce pr-remediate — so no two Ren fires share
//     an orchestrator tick window.
//
//     Twice a day rather than once, for the same reason the agent-workforce
//     binding is: the lane is what the 36h `author-stale` sweep escalates
//     around, and at one fire a day a PR gets at most one attempt before the
//     sweep hands it to a human. With adr-0025 the cron is the completeness
//     floor rather than the normal path — the hand-off itself dispatches the
//     fire — but the floor still has to be able to drain the queue alone.
//
//     It NEVER merges and NEVER pushes the default branch (external-pr, not
//     external-pr-merge; R-N9). Bounded: 3 attempts per PR (claimed before the
//     work), plus the sweep's 36h escalation even if this cadence never fires.
//
// PREREQ — the `pr-remediate` SKILL# row must exist (it does; the cadence has
// been running on agent-workforce since #518). PREREQ — the project's
// github.token secret at `wf/projects/asp-cloud/github.token` with Contents R/W
// on the branch namespace + Pull requests R/W (already provisioned for Ren's
// issue-implement binding on this project, which pushes PR branches there).
//
// ENABLING A CRON IS THE OPERATOR'S B-AUTHORITY STEP (governance.md §5).
//
// Usage:
//   node workforce/scripts/wire-pr-remediate-ren-asp-cloud.mjs --dry-run
//   aws-vault exec <profile> -- \
//     node workforce/scripts/wire-pr-remediate-ren-asp-cloud.mjs

import { ensureProxyAwareEntry } from "../../scripts/lib/proxy-bootstrap.mjs";
ensureProxyAwareEntry(import.meta.url);

import { spawnSync } from "node:child_process";

const API_BASE = (
  process.env.WF_AGENTS_API_BASE ??
  "https://sjhikazsf9.execute-api.us-west-2.amazonaws.com/prod"
).replace(/\/+$/, "");
const REGION = process.env.AWS_REGION ?? "us-west-2";
const DRY_RUN = process.argv.includes("--dry-run");

const PROJECT_ID = "asp-cloud";
const ROUTINE_SPEC = "workforce/docs/routines/agent-runner.md";

const SLUG = "ren";

const BINDING = {
  skill: "pr-remediate",
  executor: "claude-code-routine",
  trigger: {
    scheduler: "external",
    invoked_by: "api",
    fired_from: "wf-orchestrator-tick",
    cron: "cron(51 7,19 ? * * *)",
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
    "Ren's twice-daily pr-remediate on PSVL/asp-cloud (project asp-cloud), adr-0022. Closes the gap that stranded #692/#693: pr-autopilot has routed agent-fixable PRs into autopilot:needs-author on this repo since the lane shipped, with no worker bound to that queue for this project — every one aged 36h and escalated author-stale. Works the queue — base conflicts, behind branches, and open blocking lens findings from the panel's remediation brief — resolving semantically, verifying with the repo's own gate (yarn typecheck && yarn lint, per its CLAUDE.md), pushing to the PR's HEAD branch (never main), and clearing the label so pr-autopilot re-routes at cycle N+1. Never merges (external-pr). Fires 07:51 and 19:51 UTC, each 6 min after a pr-autopilot tick (45 1/6) so it picks up that tick's labels, and clear of Ren's 03:17 issue-implement here. Under adr-0025 the cron is the completeness floor: the hand-off itself dispatches this binding, so most fires start seconds after the label, not at the next cron.",
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
// ARRAY order is preserved (significant) on purpose.
const stable = (v) =>
  v && typeof v === "object" && !Array.isArray(v)
    ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`
    : Array.isArray(v)
      ? `[${v.map(stable).join(",")}]`
      : JSON.stringify(v);

// Match on (skill, project_id). Not present -> append; equal -> no-op;
// drifted -> replace in place (binding_idx preserved). Ren's other bindings —
// including his agent-workforce pr-remediate — are matched out by
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
  console.log("The lane's backlog on PSVL/asp-cloud drains on the next fire (or immediately, on the next adr-0025 hand-off dispatch).");
} else {
  console.error(`  ✗ ${SLUG}: HTTP ${status} ${JSON.stringify(json)}`);
  process.exit(1);
}
