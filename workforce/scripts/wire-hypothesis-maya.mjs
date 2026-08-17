#!/usr/bin/env node
// Wire Maya's `hypothesis` binding for the `agent-workforce` project via
// PATCH /agents/maya (ADR-0007: bindings are DDB config, the agents-api is
// the single writer — each PATCH is validated at the write boundary and
// lands its own AUDIT item; W-5 keeps it one-persona-per-mutation).
//
// What this fixes (#603). ROADMAP.md Phase 4's "Maya hypothesis cadence"
// line named the `hypothesis` skill's acceptance bar as "Maya's weekly
// `hypothesis` task fires, hypothesis article published on kohuehara.xyz
// under Maya byline" — but the skill was authored (2026-07-03) and later
// hardened for ADR-0005 bilingual compliance (PR #593 / commit `ab33534`)
// without ever landing a binding: `GET /agents/maya` carried only
// `feed-post`, `legal-amendment-review-committee`, `daily-research`, and
// `monthly-report`. `invocations_this_month: 0` on the skill row for six-plus
// weeks confirms it has never fired. Same failure class as #570
// (`budget-runway-review` shipped with no binding, fixed by
// `wire-budget-runway-review-silas.mjs`) — a skill built and hardened, never
// wired to a cron, so it structurally cannot run. This binding is the fix.
//
// What this adds — ONCE A WEEK, Thursday 05:09 UTC (14:09 JST):
//
//   maya   hypothesis   cron(9 5 ? * THU *)   05:09 UTC / 14:09 JST
//
// Single literal minute/hour/day-of-week so any cron parser agrees (clears
// the agents-api hourly cadence floor, G1-cadence-floor). 05:09 UTC sits
// >120 min clear of Maya's two DAILY bindings (feed-post 01:21 UTC,
// daily-research 11:09 UTC — both recur every day, including Thursdays):
//   05:09 - 01:21 = 3h48m clear; 11:09 - 05:09 = 6h00m clear.
// On the rare Thursday that falls on the 2nd of the month, it also sits
// well clear of monthly-report (01:09 UTC, 4h00m away) and the yearly
// legal-amendment-review-committee binding (Jan 2, a different project
// entirely — asp-cloud).
//
// AUTHORITY: mutating persona bindings is B-authority (workforce governance
// §5); wiring a cadence a skill's own owner (maya, per meta.json `owners`)
// already ships hardened code for, to close a named tracked gap (#603,
// itself citing the accepted #570 precedent), is squarely inside
// issue-implement's action authority — no separate operator instruction
// beyond the issue itself (mirrors wire-budget-runway-review-silas.mjs's own
// authority note for the identical failure class).
//
// PREREQ (same ladder as wire-budget-runway-review-silas.mjs):
//   1. workforce/skills/hypothesis/ exists and passes `npm run
//      workforce:skills` (it does — shipped 2026-07-03, ADR-0005-hardened by
//      PR #593 / commit `ab33534`; re-verified at HEAD by this PR).
//   2. The data-plane deploy that syncs the hypothesis SKILL# row has run —
//      the write-time check validates the binding against it. If this
//      script fails with an unknown-skill error, that deploy has not landed
//      yet (it long since has: `workforce-skills.json` already lists the
//      skill).
//   3. Credentials already provisioned on agent-workforce:
//      notion.integration_token (shared with article-level2/level3/
//      monthly-report/podcast-script). No NEW credential type is
//      introduced (meta.json requires[] names only that one type).
//
// This script declares the binding ENABLED (scheduler=external +
// invoked_by=api + the weekly cron, in one write) — running it (which needs
// AWS creds this routine does not hold) is the operator's B-authority step;
// issue-implement ships the mechanism, it does not execute it.
//
// Idempotent + declares desired state. Keyed on (skill, project_id): absent
// -> appended; equal -> true no-op; drifted -> replaced in place
// (binding_idx preserved). Maya's other bindings (feed-post, daily-research,
// monthly-report, legal-amendment-review-committee) are matched out by
// (skill, project_id) and left untouched.
//
// Usage:
//   node workforce/scripts/wire-hypothesis-maya.mjs --dry-run
//   aws-vault exec <profile> -- \
//     node workforce/scripts/wire-hypothesis-maya.mjs

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

const SLUG = "maya";
const PROJECT_ID = "agent-workforce";
const ROUTINE_SPEC = "workforce/docs/routines/agent-runner.md";

const BINDING = {
  skill: "hypothesis",
  executor: "claude-code-routine",
  trigger: {
    scheduler: "external",
    invoked_by: "api",
    fired_from: "wf-orchestrator-tick",
    cron: "cron(9 5 ? * THU *)",
  },
  routine_spec: ROUTINE_SPEC,
  project_id: PROJECT_ID,
  config: {
    sign_off_persona: "maya",
  },
  note:
    "Maya's weekly product-hypothesis article on project agent-workforce (ROADMAP.md Phase 4 'Maya hypothesis cadence', wiring fix #603). A concrete, falsifiable claim about user needs / market direction / AI-product dynamics, grounded in recent observations, published to the unified Notion Articles DB as Type=analysis, Author=maya, Status=ready, with the English edition on an EN child page (ADR-0005). Fires Thursdays at 05:09 UTC, clear of Maya's other DAILY/MONTHLY bindings by the >120min G1-cadence-floor margin. Same failure class + fix shape as #570 (wire-budget-runway-review-silas.mjs).",
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
  console.log(`  - ${SLUG}: hypothesis @ ${PROJECT_ID} already bound + current, skipped (no-op).`);
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
