#!/usr/bin/env node
// Wire Tomas's `performance-refresh` binding for the `agent-workforce` project
// via PATCH /agents/tomas (ADR-0007: bindings are DDB config, the agents-api is
// the single writer — each PATCH is validated at the write boundary and lands
// its own AUDIT item; W-5 keeps it one-persona-per-mutation).
//
// What this adds:
//   - performance-refresh, ONCE A DAY, Tomas (Organizational Performance
//     Scientist), project=agent-workforce. A claude-code-routine (R-N1(a))
//     fired by the orchestrator-tick CCR path (scheduler=external,
//     invoked_by=api).
//
//     Each day it runs the bundled refresh.mjs, which republishes
//     PERF#{scope}/PR (per repo scope) and PERF#{scope}/REPO (every scope +
//     the workforce aggregate) from live GitHub data, reads back what
//     GET /performance now serves, and posts ONE feed note naming anything
//     that came back stale, degraded, or missing.
//
// WHY TOMAS. The refresh is mechanical; the judgment is measurement-integrity —
// "did the numbers move, and is any block quietly frozen or undercounted?".
// That is Tomas's standing brief (`org-metrics-pulse` calls itself "the
// measurement layer of epics 016/019/020"), and this daily fire is the
// operational counterpart to that weekly narrative note: this one keeps the
// data honest, that one interprets it. Routing it to a platform persona would
// split the metric's definition from its upkeep, which is how the PR block
// froze for a month unnoticed in the first place (Epic-016 OP-012 / #437).
//
// PREREQ:
//   1. workforce/skills/performance-refresh/ exists and passes
//      `npm run workforce:skills` (+ the skill-registry codegen is committed).
//   2. The data-plane deploy that syncs the performance-refresh SKILL# row has
//      run — the write-time check validates the binding against it. If this
//      script fails with an unknown-skill error, that deploy has not landed yet.
//   3. Credentials already provisioned on agent-workforce:
//      wf/projects/agent-workforce/github.token (shared with Nadia's
//      pr-autopilot) and workforce.feed_write_token (shared with feed-post).
//      No NEW credential type is introduced.
//
// This script declares the binding ENABLED (scheduler=external + invoked_by=api
// + the daily cron, in one write) — the bindings.md "enable a cadence"
// B-authority shape. Enabling a scheduled run is the operator's B-authority
// step; running this script (which needs AWS creds) IS that step — do not run
// it without the operator's go-ahead.
//
// Idempotent + declares desired state. Keyed on (skill, project_id): absent ->
// appended; equal -> true no-op; drifted -> replaced in place (binding_idx
// preserved). Tomas's other bindings (org-metrics-pulse, feed-post,
// daily-research) are matched out by (skill, project_id) and left untouched.
//
// Usage:
//   node workforce/scripts/wire-performance-refresh-tomas.mjs --dry-run
//   aws-vault exec <profile> -- \
//     node workforce/scripts/wire-performance-refresh-tomas.mjs

import "../../scripts/lib/proxy-bootstrap.mjs";

import { spawnSync } from "node:child_process";

const API_BASE = (
  process.env.WF_AGENTS_API_BASE ??
  "https://sjhikazsf9.execute-api.us-west-2.amazonaws.com/prod"
).replace(/\/+$/, "");
const REGION = process.env.AWS_REGION ?? "us-west-2";
const DRY_RUN = process.argv.includes("--dry-run");

const SLUG = "tomas";
const PROJECT_ID = "agent-workforce";
const ROUTINE_SPEC = "workforce/docs/routines/agent-runner.md";

// Once a day at 05:33 UTC: cron(33 5 ? * * *).
//   - AFTER the wf-performance-reducer's 02:00 UTC lifecycle snapshot, so the
//     read-back can tell a fresh funnel from a stalled one on the same day.
//   - BEFORE the 06:17 UTC gh-pages/console deploy, so a deploy that day ships
//     against already-refreshed roll-ups.
//   - Clear of every checked-in wire-script slot and of Tomas's own feed-post
//     (04:09) and daily-research (21:13), so two of his fires never share an
//     orchestrator tick's 120-min window.
// Single-literal minute+hour clears the agents-api hourly cadence floor
// (G1-cadence-floor).
const BINDING = {
  skill: "performance-refresh",
  executor: "claude-code-routine",
  trigger: {
    scheduler: "external",
    invoked_by: "api",
    fired_from: "wf-orchestrator-tick",
    cron: "cron(33 5 ? * * *)",
  },
  routine_spec: ROUTINE_SPEC,
  project_id: PROJECT_ID,
  config: {
    sign_off_persona: "tomas",
    // Matches the console's 3-month decks; shortening it would silently
    // truncate every chart the refresh feeds.
    days: 90,
    // A REPO/PR block older than this many hours is reported as stale. One
    // daily cycle (24h) plus a 6h buffer for a late/slow fire.
    stale_hours: 30,
    // Where a frozen upstream is routed. The reducer + data plane are Hana's;
    // a missing project credential is the operator's.
    escalation_routing: {
      reducer_or_data_plane: "hana",
      missing_credential: "_operator",
    },
  },
  note:
    "Tomas's daily performance-refresh on project agent-workforce. Runs the bundled refresh.mjs, which republishes PERF#{scope}/PR (per repo scope, via build-pr-metrics-github.mjs --publish-ddb) and PERF#{scope}/REPO (every scope plus the workforce aggregate, via build-repo-performance.mjs --publish-ddb) from live GitHub data over a trailing 90 days, then reads back GET /performance and reports per-scope freshness. Posts one feed note per fire naming every block that came back stale, degraded (an undercount from a rate-limited page or a code_frequency timeout — never a real low), or missing. It does NOT refresh the lifecycle funnel: that stays the wf-performance-reducer Lambda's 02:00 UTC job, and this fire only observes it so a stalled reducer becomes visible instead of silently freezing the deck (the failure mode that left the PR block stuck at 2026-06-23 for a month — Epic-016 OP-012 / #437). No PR, no repo write; a frozen reducer or an unresolvable credential escalates via a PROPOSE-> line rather than being absorbed. Credentials: github.token + workforce.feed_write_token, both pre-existing on this project.",
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
const stable = (v) =>
  v && typeof v === "object" && !Array.isArray(v)
    ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`
    : Array.isArray(v)
      ? `[${v.map(stable).join(",")}]`
      : JSON.stringify(v);

const idx = cur.bindings.findIndex(
  (b) => b.skill === BINDING.skill && b.project_id === BINDING.project_id,
);
const summary = `${BINDING.skill} @ ${PROJECT_ID} (${BINDING.trigger.cron})`;
let next;
let verb;
if (idx >= 0) {
  if (stable(cur.bindings[idx]) === stable(BINDING)) {
    console.log(`  - ${SLUG}: performance-refresh @ ${PROJECT_ID} already bound + current, skipped (no-op).`);
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
