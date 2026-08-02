#!/usr/bin/env node
// Wire the new `skill-maturity-report` Cadence onto Sana (Skill Ops, the
// Agent Workforce Platform group's skill-axis IC — see
// workforce/docs/team/workforce-platform-charter.md) via PATCH /agents/sana
// (ADR-0007: bindings are DDB config, agents-api is the single writer — each
// PATCH is validated (R8 against SKILL# rows) and lands its own AUDIT item).
//
// This is the operator's post-merge step (governance.md §5: "Add a new
// EventBridge cron rule or enable a previously-disabled rule" is B-authority —
// the PR only adds the skill folder; this script exists so the operator has a
// one-command, idempotent way to flip it on, mirroring the pattern
// workforce/seed/org-benchmark-group/wire-cadences.mjs established). It makes
// no network call and no live change by merely being merged — it only acts
// when the operator actually runs it, under their own AWS credentials.
//
// Saturday 01:17 UTC is unused by every other weekly cadence's stagger table
// (workforce/seed/org-benchmark-group/wire-cadences.mjs runs Mon-Fri; see
// docs/runbooks/bindings.md's staggering rule) — a clean end-of-week slot for
// a report that reads the week's own EXEC/feed history before writing.
//
// PREREQ: this PR (workforce/skills/skill-maturity-report/) must be MERGED
// and the data-plane deploy finished — wf-seed-skills syncs the SKILL# row
// post-deploy, and the R8 write-time check validates the binding against it.
// Running this before the sync 422s with R8-binding-skill-exists (fail-loud,
// no partial write).
//
// Idempotent: if skill-maturity-report is already bound on sana, this is a
// no-op. Append-only — binding_idx is load-bearing (references/binding-and-cron.md).
//
// Usage:
//   node workforce/seed/wire-skill-maturity-report.mjs --dry-run
//   aws-vault exec <profile> -- node workforce/seed/wire-skill-maturity-report.mjs

import "../../scripts/lib/proxy-bootstrap.mjs";

import { spawnSync } from "node:child_process";

const API_BASE = (
  process.env.WF_AGENTS_API_BASE ??
  "https://sjhikazsf9.execute-api.us-west-2.amazonaws.com/prod"
).replace(/\/+$/, "");
const REGION = process.env.AWS_REGION ?? "us-west-2";
const DRY_RUN = process.argv.includes("--dry-run");

const ROUTINE_SPEC = "workforce/docs/routines/agent-runner.md";
const PROJECT_ID = "agent-workforce";
const SLUG = "sana";
const SKILL = "skill-maturity-report";
const CRON = "cron(17 1 ? * SAT *)"; // 01:17 UTC Saturday — unused by every other weekly stagger table

function binding() {
  return {
    skill: SKILL,
    executor: "claude-code-routine",
    trigger: {
      scheduler: "external",
      invoked_by: "api",
      fired_from: "wf-orchestrator-tick",
      cron: CRON,
    },
    routine_spec: ROUTINE_SPEC,
    project_id: PROJECT_ID,
    note: `Weekly skill-roster maturity patrol (agent-experience-and-skill-metrics.md §3). Fired by wf-orchestrator-tick; project_id=${PROJECT_ID}.`,
  };
}

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

async function getAgent(slug) {
  return await (await fetch(`${API_BASE}/agents/${slug}`)).json();
}

const cur = await getAgent(SLUG);
if (!Array.isArray(cur.bindings)) {
  console.error(`  ✗ ${SLUG}: GET returned no bindings[] (agent registered?)`);
  process.exit(1);
}
if (cur.bindings.some((b) => b.skill === SKILL)) {
  console.log(`  - ${SLUG}: ${SKILL} already bound, skipped`);
  process.exit(0);
}
const next = [...cur.bindings, binding()];
if (DRY_RUN) {
  console.log(`  [dry-run] ${SLUG}: would PATCH bindings -> +1 (${SKILL} @ ${CRON}); total ${next.length}`);
  console.log("Dry run complete.");
  process.exit(0);
}
const { status, json } = curlJson("PATCH", `/agents/${SLUG}`, { bindings: next });
if (status === 200) {
  console.log(`  ✓ ${SLUG}: bound ${SKILL} @ ${CRON}`);
  console.log("Done. Next orchestrator tick (rate 2h) picks the binding up — no deploy needed (ADR-0007 write=live).");
} else {
  console.error(`  ✗ ${SLUG}: HTTP ${status} ${JSON.stringify(json)}`);
  process.exit(1);
}
