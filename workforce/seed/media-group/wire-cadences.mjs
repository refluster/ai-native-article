#!/usr/bin/env node
// Wire the `podcast-script` Cadence onto the Podcast Scriptwriter (rhys) via
// PATCH /agents/{slug} (ADR-0007: bindings are DDB config, agents-api is the
// single writer — each PATCH is validated (R8 against SKILL# rows) and lands
// its own AUDIT item). Epic-017 Story 3.
//
// The binding lands **PAUSED** — scheduler:"manual", the runbook's
// "declarative-pending" shape (runbooks/bindings.md §Executor × scheduler),
// which wf-orchestrator-tick does NOT dispatch (it only fires
// executor=claude-code-routine + scheduler=external + invoked_by=api). So
// ADDING the binding is governance §5 A-authority ("lands Enabled:false-
// equivalent"); ENABLING it (flip scheduler→external + add cron) is the
// separate B-authority step the operator performs — see ENABLE_SNIPPET below.
//
// PREREQ: the PR adding workforce/skills/podcast-script must be MERGED and the
// data-plane deploy finished — wf-seed-skills syncs SKILL# rows post-deploy,
// and the R8 write-time check validates bindings against those rows. Running
// this before the sync 422s with R8-binding-skill-exists (fail-loud, no
// partial write). The scriptwriter persona (rhys) must also be registered
// (register.mjs) first.
//
// Idempotent: existing bindings are preserved; podcast-script already bound on
// the agent is skipped, never duplicated or reordered (binding_idx is
// load-bearing — see references/binding-and-cron.md).
//
// Usage:
//   node workforce/seed/media-group/wire-cadences.mjs --dry-run
//   aws-vault exec <profile> -- node workforce/seed/media-group/wire-cadences.mjs

import { spawnSync } from "node:child_process";

const API_BASE = (
  process.env.WF_AGENTS_API_BASE ??
  "https://sjhikazsf9.execute-api.us-west-2.amazonaws.com/prod"
).replace(/\/+$/, "");
const REGION = process.env.AWS_REGION ?? "us-west-2";
const DRY_RUN = process.argv.includes("--dry-run");

const ROUTINE_SPEC = "workforce/docs/routines/agent-runner.md";
const PROJECT_ID = "agent-workforce";

// The binding lands PAUSED: scheduler:"manual" (declarative-pending). No cron
// yet — the operator adds it when enabling (ENABLE_SNIPPET). podcast-script
// reads the Notion integration token (its requires[]), supplied by the
// agent-workforce project credential bag at fire time.
// All three podcast persona cadences land PAUSED (scheduler:"manual"), Notion-
// only (no AWS). The operator enables each (B-authority) by flipping
// scheduler→external + invoked_by=api + a daily cron. project_id=agent-workforce
// supplies notion.integration_token.
function pausedCadence(skill, note) {
  return {
    skill,
    executor: "claude-code-routine",
    trigger: { scheduler: "manual" },
    routine_spec: ROUTINE_SPEC,
    project_id: PROJECT_ID,
    note,
  };
}

const PLAN = [
  // Stage none→script-ready (Rhys writes the script; Idris co-owns compliance).
  { slug: "rhys", add: [pausedCadence("podcast-script",
    "podcast-script Cadence (Epic-017), PAUSED. none→script-ready: writes the script + Idris compliance verdict, up to 5/fire. Enable = daily cron (B).")] },
  // Stage approved→ (Odette casts the voice param the CI synthesis reads).
  { slug: "odette", add: [pausedCadence("podcast-cast",
    "podcast-cast Cadence (Epic-017), PAUSED. Sets podcastVoice on up to 5 approved episodes. Enable = daily cron (B).")] },
  // Stage audio-ready→ (Celeste writes the show-notes the CI publish folds in).
  { slug: "celeste", add: [pausedCadence("podcast-shownotes",
    "podcast-shownotes Cadence (Epic-017), PAUSED. Sets podcastShowNotes on up to 5 audio-ready episodes. Enable = daily cron (B).")] },
];

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

let failed = false;
for (const { slug, add } of PLAN) {
  const cur = await (await fetch(`${API_BASE}/agents/${slug}`)).json();
  if (!Array.isArray(cur.bindings)) {
    console.error(`  ✗ ${slug}: GET returned no bindings[] (agent registered?)`);
    failed = true;
    continue;
  }
  const bound = new Set(cur.bindings.map((b) => b.skill));
  const additions = add.filter((b) => !bound.has(b.skill));
  if (additions.length === 0) {
    console.log(`  - ${slug}: podcast-script already bound, skipped`);
    continue;
  }
  // Append-only: existing bindings keep their binding_idx.
  const next = [...cur.bindings, ...additions];
  const summary = additions
    .map((b) => `${b.skill} @ ${b.trigger.scheduler} (PAUSED)`)
    .join(", ");
  if (DRY_RUN) {
    console.log(`  [dry-run] ${slug}: would PATCH bindings -> +${additions.length} (${summary}); total ${next.length}`);
    continue;
  }
  const { status, json } = curlJson("PATCH", `/agents/${slug}`, { bindings: next });
  if (status === 200) {
    console.log(`  ✓ ${slug}: bound ${summary}`);
  } else {
    failed = true;
    console.error(`  ✗ ${slug}: HTTP ${status} ${JSON.stringify(json)}`);
  }
}

if (failed) process.exit(1);
console.log(DRY_RUN ? "Dry run complete." : "Done. Binding landed PAUSED — nothing fires until the operator enables it (ENABLE_SNIPPET).");

// ── Enable a paused binding (operator, B-authority) ──────────────────────────
// After confirming the binding is in place, the operator enables it by PATCHing
// the podcast-script binding to the live trigger shape. MERGE the trigger; do
// NOT replace the whole binding (preserve skill, executor, routine_spec,
// project_id). Pick a minute-of-day that doesn't collide with rhys's other
// cadences (reuse the djb2 stagger from wire-cadences.mjs in policy-group).
//
//   {
//     ...existingBinding,                 // keep skill/executor/routine_spec/project_id
//     trigger: {
//       scheduler: "external",
//       invoked_by: "api",
//       fired_from: "wf-orchestrator-tick",
//       cron: "cron(M H ? * * *)"         // UTC; weekly is plenty for V1 (one episode/article cadence)
//     },
//   }
//
// This is the Phase-1 cron-enable B-authority step (governance §5).
