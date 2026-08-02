#!/usr/bin/env node
// Wire Maya's `monthly-report` binding for the `agent-workforce` project via
// PATCH /agents/maya (ADR-0007: bindings are DDB config, the agents-api is
// the single writer — each PATCH is validated at the write boundary and
// lands its own AUDIT item; W-5 keeps it one-persona-per-mutation).
//
// What this adds:
//   - monthly-report, once per month (2nd, 01:09 UTC = 10:09 JST), Maya
//     (President; org-wide synthesis lens), project=agent-workforce. The Cadence reads
//     the month across the whole workforce (agents-api, git history, ADR/epic/
//     registry deltas, the published article corpus), consults the domain-
//     owner personas per section, and publishes one integrated letter to the
//     Notion unified Articles DB tagged `Monthly Report`
//     (workforce/skills/monthly-report/post.mjs owns the write).
//
// AUTHORITY: mutating a persona's bindings is B-authority (workforce
// governance §5); this wire executes the operator's explicit 2026-07-05
// instruction ("skillとして整理し、Mayaに、agent-workforce, once per month、
// でバインド") — the escalation is satisfied by that instruction, and the
// PATCH lands on the AUDIT# trail + weekly config digest as usual.
//
// PREREQ:
//   1. The monthly-report SKILL# row exists (R8 write-time check validates
//      the binding against it). First landing: the SKILL.md body via
//      POST /skills (ADR-0017 API-first, judgment slice), then the code-side
//      fields (requires[], archetype, post.mjs) via the git seed on the next
//      data-plane deploy after this PR merges (ADR-0008/0018 code slice).
//   2. wf/projects/agent-workforce/notion.integration_token exists (it does —
//      article-level2/3 and podcast-script already draw it).
//   3. Credential injection for the fire needs the deployed SKILL_REQUIRES
//      map to include monthly-report → notion.integration_token, i.e. the
//      data-plane deploy after this PR. The first scheduled fire (the 2nd of
//      next month) is comfortably after that.
//
// Idempotent + declares desired state, keyed on (skill, project_id):
//   - not present        → append (existing bindings keep their binding_idx)
//   - present, equal     → true no-op
//   - present, drifted   → replace in place (binding_idx preserved)
//
// Usage:
//   node workforce/scripts/wire-monthly-report-maya.mjs --dry-run
//   node workforce/scripts/wire-monthly-report-maya.mjs

import "../../scripts/lib/proxy-bootstrap.mjs";

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

// Monthly: the 2nd of each month at 01:09 UTC (10:09 JST — inside the working
// window, after the 1st's daily cadences have written their rows, so the
// month being reported on is complete). Single literal minute/hour/day so any
// cron parser agrees; the 2-hourly orchestrator tick's past-facing 120-min
// window catches it exactly once.
const BINDING = {
  skill: "monthly-report",
  executor: "claude-code-routine",
  trigger: {
    scheduler: "external",
    invoked_by: "api",
    fired_from: "wf-orchestrator-tick",
    cron: "cron(9 1 2 * ? *)",
  },
  routine_spec: ROUTINE_SPEC,
  project_id: PROJECT_ID,
  config: {
    sign_off_persona: "maya",
    // Domain-owner personas consulted per section (SKILL.md "Consult before
    // you synthesize"); the letter credits them. Swap seats here — not in the
    // skill body — when the org chart moves.
    consult_personas: ["nadia", "mateo", "farah", "celeste", "silas", "elena"],
  },
  note:
    "Maya's monthly Software Talent Network report (once per month, 2nd @ 10:09 JST). Reads the month across the whole workforce — per-agent delivery, org evolution, orchestration substrate, human-agent relationship, quality guards, external comms, and the macro industry/financial view distilled from the article corpus — consults the domain-owner personas per section, and publishes one integrated ~10-page letter to the Notion unified Articles DB tagged Monthly Report (post.mjs owns the write; W-1 guarded, chunked block append). Operator-instructed binding 2026-07-05.",
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
    console.log(`  - ${SLUG}: monthly-report @ ${PROJECT_ID} already bound + current, skipped (no-op).`);
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
