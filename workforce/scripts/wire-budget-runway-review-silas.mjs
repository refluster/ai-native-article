#!/usr/bin/env node
// Wire Silas's `budget-runway-review` binding for the `agent-workforce`
// project via PATCH /agents/silas (ADR-0007: bindings are DDB config, the
// agents-api is the single writer — each PATCH is validated at the write
// boundary and lands its own AUDIT item; W-5 keeps it one-persona-per-mutation).
//
// What this fixes (#570). #456 ([Epic-021 Story 2] Budget-utilisation &
// runway review cadence) closed on the strength of the skill shipping
// (`workforce/skills/budget-runway-review/` — SKILL.md + post.mjs +
// post-tests.ts), but nothing ever wrote the binding: `GET /agents/silas`
// carried only feed-post, daily-research, vp-monthly-report. A skill that
// exists but is never scheduled reads identically, from every dashboard
// that only checks "does the skill exist", to one that runs and finds
// nothing to say — precisely the failure class Epic-021 §B.1's own idle
// detector exists to catch. This binding is the fix; #570's own "re-verify
// a fire actually produces the artefact" ask is the operator's step once
// this PATCH lands and the next cron-matched tick fires (see PREREQ 3).
//
// What this adds — ONCE A MONTH, on the 1st, ahead of Maya's monthly-report
// (2nd) and the VP letters (3rd, silas included via vp-monthly-report at
// 02:39 UTC) — so any of them citing this month's utilisation read has a
// fresh one to cite (Epic-021 §A.1's "single reconciliation model" —
// SKILL.md's own framing):
//
//   silas   budget-runway-review   cron(9 1 1 * ? *)   01:09 UTC / 10:09 JST
//
// Single literal minute/hour/day-of-month so any cron parser agrees (clears
// the agents-api hourly cadence floor, G1-cadence-floor). 01:09 UTC sits
// >120 min clear of silas's two DAILY bindings (feed-post 08:57 UTC,
// daily-research 21:05 UTC — both recur every day, including the 1st) so
// this monthly fire never shares an orchestrator tick's 120-min window with
// either of them, and it lands on a different calendar day than
// vp-monthly-report (the 3rd) entirely.
//
// AUTHORITY: mutating persona bindings is B-authority (workforce governance
// §5); wiring a cadence a skill's own owner (silas, per meta.json `owners`)
// already ships code for, to close a named tracked gap (#570 / #456 /
// Epic-021 Story 2), is squarely inside issue-implement's action authority
// — no separate operator instruction beyond the issue itself.
//
// PREREQ (same ladder as wire-performance-refresh-tomas.mjs):
//   1. workforce/skills/budget-runway-review/ exists and passes
//      `npm run workforce:skills` (it does — shipped with #456; re-verified
//      at HEAD by this PR).
//   2. The data-plane deploy that syncs the budget-runway-review SKILL# row
//      has run — the write-time check validates the binding against it. If
//      this script fails with an unknown-skill error, that deploy has not
//      landed yet (it long since has: `workforce-skills.json` already lists
//      the skill, per #570's own re-verification).
//   3. Credentials already provisioned on agent-workforce:
//      workforce.feed_write_token (shared with feed-post/daily-research).
//      No NEW credential type is introduced (meta.json requires[] names
//      only that one type).
//
// This script declares the binding ENABLED (scheduler=external +
// invoked_by=api + the monthly cron, in one write) — running it (which
// needs AWS creds this routine does not hold) is the operator's B-authority
// step; issue-implement ships the mechanism, it does not execute it.
//
// Idempotent + declares desired state. Keyed on (skill, project_id): absent
// -> appended; equal -> true no-op; drifted -> replaced in place
// (binding_idx preserved). Silas's other bindings (feed-post, daily-research,
// vp-monthly-report) are matched out by (skill, project_id) and left
// untouched.
//
// Usage:
//   node workforce/scripts/wire-budget-runway-review-silas.mjs --dry-run
//   aws-vault exec <profile> -- \
//     node workforce/scripts/wire-budget-runway-review-silas.mjs

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

const SLUG = "silas";
const PROJECT_ID = "agent-workforce";
const ROUTINE_SPEC = "workforce/docs/routines/agent-runner.md";

const BINDING = {
  skill: "budget-runway-review",
  executor: "claude-code-routine",
  trigger: {
    scheduler: "external",
    invoked_by: "api",
    fired_from: "wf-orchestrator-tick",
    cron: "cron(9 1 1 * ? *)",
  },
  routine_spec: ROUTINE_SPEC,
  project_id: PROJECT_ID,
  config: {
    sign_off_persona: "silas",
    // config.teams (SKILL.md §"Read this first", item 5) is left unset —
    // no team → member-slug roster is registered yet, and the skill's own
    // fallback ("report the workforce total, say the split is unavailable")
    // is the correct default until an operator supplies one.
  },
  note:
    "Silas's monthly budget-utilisation & runway review on project agent-workforce (Epic-021 Story 2 / #456, wiring fix #570). Reads GET /stats + GET /performance + the live W-3 cost ceiling from governance.md (never recalled from memory), computes the compute_seconds_this_month/deliv_this_month proxy with its denominator stated, and posts ONE feed review carrying the utilisation read, the countable-vs-not data floor, and a written cap recommendation. Every fire posts — no skip path (SKILL.md: a flat month is a finding, not a no-op). This is the single reconciliation model the Epic-021 §A.1 investor letter (once wired) is meant to cite, so it fires on the 1st, ahead of Maya's monthly-report (2nd) and the VP letters (3rd, silas's own vp-monthly-report included). Credential: workforce.feed_write_token, pre-existing on this project.",
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
  console.log(`  - ${SLUG}: budget-runway-review @ ${PROJECT_ID} already bound + current, skipped (no-op).`);
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
