#!/usr/bin/env node
// Wire Elena's `weekly-project-report` binding for the `project-ind` project
// via PATCH /agents/elena (ADR-0007: bindings are DDB config, the agents-api
// is the single writer — each PATCH is validated at the write boundary and
// lands its own AUDIT item; W-5 keeps it one-persona-per-mutation).
//
// What this adds:
//   - weekly-project-report, once per week (Monday 07:15 JST = Sunday 22:15
//     UTC), Elena (editorial owner; the panel's editor-in-chief seat from the
//     project-ind 週報第1号), project=project-ind. The Cadence convenes a 5-8
//     turn panel from config.panel_pool, writes the weekly delta report, and
//     publishes it to the project repo's reports/ via publish-report.mjs
//     (GitHub contents API, wf/projects/project-ind/github.token).
//
// AUTHORITY: mutating a persona's bindings is B-authority (workforce
// governance §5); this wire executes the operator's explicit 2026-07-21
// instruction ("週単位でレポートする仕組みを作って…全体のリードは編集長に
// 担当してもらう(bindする)") — the escalation is satisfied by that
// instruction, and the PATCH lands on the AUDIT# trail as usual.
//
// PREREQ:
//   1. The weekly-project-report SKILL# row exists (R8 write-time check
//      validates the binding against it) — lands via the git skill seed on
//      the data-plane deploy after this PR merges (ADR-0008/0018).
//   2. wf/projects/project-ind/github.token exists (it does — verified
//      2026-07-21; it is the same credential the reports read-path uses).
//   3. Credential injection for the fire needs the deployed SKILL_REQUIRES
//      map to include weekly-project-report → github.token, i.e. the
//      data-plane deploy after this PR merges. First scheduled fire is the
//      following Monday — comfortably after that.
//
// Idempotent + declares desired state, keyed on (skill, project_id):
//   - not present        → append (existing bindings keep their binding_idx)
//   - present, equal     → true no-op
//   - present, drifted   → replace in place (binding_idx preserved)
//
// Usage:
//   node workforce/scripts/wire-weekly-project-report.mjs --dry-run
//   node workforce/scripts/wire-weekly-project-report.mjs

import "../../scripts/lib/proxy-bootstrap.mjs";

import { spawnSync } from "node:child_process";

const API_BASE = (
  process.env.WF_AGENTS_API_BASE ??
  "https://sjhikazsf9.execute-api.us-west-2.amazonaws.com/prod"
).replace(/\/+$/, "");
const REGION = process.env.AWS_REGION ?? "us-west-2";
const DRY_RUN = process.argv.includes("--dry-run");

const SLUG = "elena";
const PROJECT_ID = "project-ind";
const ROUTINE_SPEC = "workforce/docs/routines/agent-runner.md";

// Weekly: Monday 07:15 JST = Sunday 22:15 UTC. Single literal minute/hour +
// day-of-week so any cron parser agrees; the 2-hourly orchestrator tick's
// past-facing 120-min window catches it exactly once. Minute :15 avoids the
// :00 stampede and (checked at authoring time) no live binding shares
// minute-of-day 1335 on SUN.
const BINDING = {
  skill: "weekly-project-report",
  executor: "claude-code-routine",
  trigger: {
    scheduler: "external",
    invoked_by: "api",
    fired_from: "wf-orchestrator-tick",
    cron: "cron(15 22 ? * SUN *)",
  },
  routine_spec: ROUTINE_SPEC,
  project_id: PROJECT_ID,
  config: {
    report_lang: "ja",
    panel_min_turns: 5,
    panel_max_turns: 8,
    // Candidate pool the editor-in-chief seats 4-7 members from each week,
    // per that week's material (SKILL.md Phase 1). Swap seats here — not in
    // the skill body — when the org chart or project focus moves.
    panel_pool: [
      "tessa", "anjali", "ishaan", "amara", "grace",          // policy/research (US+India)
      "rohan", "sneha", "sofia", "jay", "julian",              // India desk + finance
      "dario", "ren", "farah", "nadia",                        // dev + PM
      "corinne", "marisol",                                     // IR
      "celeste",                                                // media/external comms
    ],
  },
  note:
    "Elena's weekly project-ind report (Mon 07:15 JST). Convenes a 5-8 turn panel from panel_pool (roster picked per week: US/India research, dev, IR, media), writes the sponsor-facing weekly delta report (ja, 3000-6000 chars, 週報第1号 editorial law), publishes to PSVL/project-ind reports/ via publish-report.mjs (GitHub contents API, W-1-family guards, commit=publish). Operator-instructed binding 2026-07-21.",
};

function curlJson(method, path, body) {
  const { AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN } = process.env;
  const args = ["-sS", "-X", method, "-H", "content-type: application/json", "-w", "\n%{http_code}", `${API_BASE}${path}`];
  if (method !== "GET") {
    if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
      throw new Error("AWS credentials missing — run with AWS credentials in the environment");
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

// Stable, key-order-independent serialization: distinguishes a true no-op from
// drift (array order stays significant on purpose).
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
  console.log("Done. Next orchestrator tick picks the binding up — no deploy needed (ADR-0007 write=live). Credential injection for the fire activates with the post-merge data-plane deploy (SKILL_REQUIRES).");
} else {
  console.error(`  ✗ ${SLUG}: HTTP ${status} ${JSON.stringify(json)}`);
  process.exit(1);
}
