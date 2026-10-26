#!/usr/bin/env node
// Wire Tessa's `regulatory-situation-report` binding for the `agent-workforce`
// project via PATCH /agents/tessa (ADR-0007: bindings are DDB config, the
// agents-api is the single writer — each PATCH is validated at the write
// boundary and lands its own AUDIT item; W-5 keeps it one-persona-per-mutation).
//
// What this fixes (#632). `workforce/skills/regulatory-situation-report/`
// (PR #624) is `status: active` with `owners: ["tessa"]`, but `GET /agents/tessa`
// lists only feed-post, daily-research and vp-monthly-report, so the cadence
// can never fire. The earlier parks (issue-implement 2026-08-29, issue-design
// 2026-09-16) were blocked on one thing: SKILL.md makes `config.desk_slugs`
// required with no fallback, and the roster is an editorial call. The router's
// 2026-10-06 dispatch asks the implementer to state that call and let the
// reviewer confirm it; this is that statement.
//
// DESK ROSTER (judgement — reviewer to confirm or amend before the operator
// runs this). Tessa's own policy group plus the two cross-market desks that
// report to her, i.e. everyone already feeding the energy-regulation beat the
// report covers (US / India / EU / carbon-market regulation, 2026-08-27 precedent):
//
//   grace    Grid Policy Analyst, US              (policy-group)
//   ishaan   Grid Policy Analyst, India           (policy-group)
//   astrid   Director, Standards & Disclosure     (policy-group, EU/Brussels)
//   mei      Director, Carbon Markets Research    (policy-group)
//   amara    Power & Grid Systems Analyst         (india-energy-group, reports_to tessa)
//   anjali   Research Director, India Energy Desk (india-energy-group, reports_to tessa)
//
// Six desks clears min_cross_desk (3) with room for a quiet desk. Deliberately
// excluded: org-benchmark-group (tomas et al. — organisational benchmarking,
// not regulation) and the other india-energy analysts (jay, rohan, sneha,
// sofia, julian — market/field/finance beats that report to anjali or silas,
// not tessa). Widening the roster is a PATCH of config.desk_slugs, not code.
//
// CRON — quarterly, 5th of Jan/Apr/Jul/Oct at 07:23 UTC, matching the skill's
// 90-day default window. Clear of tessa's other fires by more than the 120-min
// orchestrator window: feed-post 01:09 UTC and daily-research 13:41 UTC both
// recur daily (6 h either side), vp-monthly-report fires on the 3rd. Single
// literal minute/hour/day so the G1 cadence floor is satisfied.
//
// AUTHORITY: mutating persona bindings is B-authority (workforce governance
// §5). This script is the mechanism; running it needs AWS creds this routine
// does not hold and is the operator's step. W-3: cost_class large (~0.60 USD
// per fire) x 4 fires/year — negligible against the 600 USD ceiling.
//
// PREREQ: the SKILL# row for regulatory-situation-report exists (it does:
// `GET /skills/regulatory-situation-report` -> active); credential
// `github.token` is already provisioned on agent-workforce (meta.json
// requires[] names only that type).
//
// Idempotent + declares desired state. Keyed on (skill, project_id): absent
// -> appended; equal -> true no-op; drifted -> replaced in place
// (binding_idx preserved). Tessa's other bindings are left untouched.
//
// Usage:
//   node workforce/scripts/wire-regulatory-situation-report-tessa.mjs --dry-run
//   aws-vault exec <profile> -- \
//     node workforce/scripts/wire-regulatory-situation-report-tessa.mjs

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

const SLUG = "tessa";
const PROJECT_ID = "agent-workforce";
const ROUTINE_SPEC = "workforce/docs/routines/agent-runner.md";

const BINDING = {
  skill: "regulatory-situation-report",
  executor: "claude-code-routine",
  trigger: {
    scheduler: "external",
    invoked_by: "api",
    fired_from: "wf-orchestrator-tick",
    cron: "cron(23 7 5 1,4,7,10 ? *)",
  },
  routine_spec: ROUTINE_SPEC,
  project_id: PROJECT_ID,
  config: {
    sign_off_persona: "tessa",
    desk_slugs: ["grace", "ishaan", "astrid", "mei", "amara", "anjali"],
    window_days: 90,
  },
  note:
    "Tessa's quarterly cross-desk regulatory situation report on project agent-workforce (#632). Harvests the full corpus of her six regulation-adjacent desks over 90 days, extracts only patterns seen independently on 3+ desks, and publishes a Japanese industry-executive report to reports/ via github.token. Skips when a report already exists for the window or the harvest fails its completeness check. Quarterly (5th of Jan/Apr/Jul/Oct, 07:23 UTC); large cost class, ~0.60 USD x 4 fires/year. Roster is an editorial judgement pending reviewer confirmation.",
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
  console.log(`  - ${SLUG}: regulatory-situation-report @ ${PROJECT_ID} already bound + current, skipped (no-op).`);
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
