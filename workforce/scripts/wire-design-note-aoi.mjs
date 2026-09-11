#!/usr/bin/env node
// Wire Aoi's `design-note` binding for the `agent-workforce` project via
// PATCH /agents/aoi (ADR-0007: bindings are DDB config, the agents-api is
// the single writer — each PATCH is validated at the write boundary and
// lands its own AUDIT item; W-5 keeps it one-persona-per-mutation).
//
// What this closes (ROADMAP.md Phase 4 "Aoi design note"). The `design-note`
// skill was authored alongside the initial skill repository (2026-05-18,
// meta.json `created_at`) with Aoi as its sole owner, but no binding was ever
// written: the ROADMAP's acceptance criterion ("Aoi's bi-weekly design task
// fires, design note published") is unmet because there is no scheduled
// entry to fire. This is the same "skill built, never wired" failure class
// as #570 (budget-runway-review) and #603 (hypothesis): a cadence that
// structurally cannot run until a binding row lands in DDB. This script is
// the git deliverable that provides the mechanism; the operator runs it with
// AWS credentials as the B-authority step.
//
// What this adds — TWICE A MONTH, on the 7th and 21st at 10:23 UTC:
//
//   aoi   design-note   cron(23 10 7,21 * ? *)   10:23 UTC / 19:23 JST
//
// Day-of-month 7 and 21 approximate a bi-weekly (fortnightly) cadence; the
// pair is spaced ~14 days apart across all months. 10:23 UTC (19:23 JST —
// late afternoon / early evening in Japan) clears Aoi's daily bindings:
//   feed-post fires in the 00:00–08:59 UTC window (djb2("aoi") % 540):
//     10:23 UTC is >83 min past the 08:59 ceiling, or >620 min clear of the
//     typical early-morning JST feed-post slot — well above the G1-cadence
//     floor on any day the 7th or 21st falls.
//   daily-research fires at djb2("aoi"+"#daily-research") % 1440 minutes;
//     the exact minute is DDB-resident (not available without AWS creds),
//     but 10:23 UTC occupies a distinct window from most daily-research slots
//     (which cluster around mid-day JST in practice). If the agents-api
//     returns a G1-floor error on the first PATCH attempt, adjust the minute
//     by ±30 before re-running.
//
// AUTHORITY: mutating persona bindings is B-authority (workforce governance
// §5); wiring a cadence a skill's own owner (aoi, per meta.json `owners`)
// already ships code for, to close a named ROADMAP item, is squarely inside
// issue-implement's action authority — no separate operator instruction is
// needed beyond the ROADMAP item itself. Same authority argument as
// wire-hypothesis-maya.mjs and wire-budget-runway-review-silas.mjs.
//
// PREREQ:
//   1. workforce/skills/design-note/ exists and passes `npm run
//      workforce:skills` (it does — in the registry since 2026-05-18;
//      re-verified at HEAD by this PR).
//   2. The data-plane deploy that syncs the design-note SKILL# row has run —
//      the write-time check validates the binding against it. If this script
//      fails with an unknown-skill error, that deploy has not landed yet
//      (it long since has: `workforce-skills.json` already lists the skill,
//      confirmed at HEAD).
//   3. No new credential type is introduced — design-note's meta.json carries
//      no `requires[]` field (deliverable is a design-doc, not a Notion page),
//      so the standard workforce invocation path applies with no provisioning
//      needed.
//
// This script declares the binding ENABLED (scheduler=external +
// invoked_by=api + the bi-monthly cron, in one write) — running it (which
// needs AWS creds this routine does not hold) is the operator's B-authority
// step; the workforce-builder routine ships the mechanism, it does not
// execute it.
//
// Idempotent + declares desired state. Keyed on (skill, project_id): absent
// -> appended; equal -> true no-op; drifted -> replaced in place
// (binding_idx preserved). Aoi's other bindings (feed-post, daily-research,
// and any others) are matched out by (skill, project_id) and left untouched.
//
// Usage:
//   node workforce/scripts/wire-design-note-aoi.mjs --dry-run
//   aws-vault exec <profile> -- \
//     node workforce/scripts/wire-design-note-aoi.mjs

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

const SLUG = "aoi";
const PROJECT_ID = "agent-workforce";
const ROUTINE_SPEC = "workforce/docs/routines/agent-runner.md";

const BINDING = {
  skill: "design-note",
  executor: "claude-code-routine",
  trigger: {
    scheduler: "external",
    invoked_by: "api",
    fired_from: "wf-orchestrator-tick",
    cron: "cron(23 10 7,21 * ? *)",
  },
  routine_spec: ROUTINE_SPEC,
  project_id: PROJECT_ID,
  config: {
    sign_off_persona: "aoi",
  },
  note:
    "Aoi's bi-weekly (fortnightly) design-note on project agent-workforce (ROADMAP.md Phase 4 'Aoi design note'). Produces one reviewable design decision — intent, IA/component scope, and acceptance criteria — in Japanese (300-800 words) for a UI or visual-system change. Fires on the 7th and 21st of each month at 10:23 UTC (19:23 JST), spaced ~14 days apart. No Notion publish (design-note meta.json: publish_notion: false); deliverable lands in the workforce execution ledger as a design-doc artefact. Same failure class + fix shape as #570 (wire-budget-runway-review-silas.mjs) and #603 (wire-hypothesis-maya.mjs).",
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
  console.log(`  - ${SLUG}: design-note @ ${PROJECT_ID} already bound + current, skipped (no-op).`);
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
