#!/usr/bin/env node
// Wire the `memory-curation` Cadence (Epic-018 Story 3, ADR-0020) onto the
// curator persona — freya, the Agent Experience Designer — via
// PATCH /agents/freya (ADR-0007: bindings are DDB config, agents-api is
// the single writer; the PATCH is R8-validated against the SKILL# rows and
// lands its own AUDIT item).
//
// Curator selection (Epic-018 Story 3): freya's JD is the fire-time
// (persona × skill × config) composition and the recall packet — "each
// agent gets the right context" is literally her lane, and semantic memory
// (ADR-0019 layer 3.5) is that material. She diagnoses and designs, never
// decides rosters (W-5-compatible); improvement_agent is sana (skill-ops),
// consistent with the platform group's other cadences.
//
// The binding lands ENABLED (scheduler:external + daily cron): the
// operator's in-message direction of 2026-07-19 — "頻度は各エージェントの記憶が
// 1週間に一度は更新されるように" — is the §5 B-authority cron/cost approval,
// same precedent as the daily-research cohort-2 rollout (operator
// greenlight 2026-06-21). Daily × cohort ceil(active/7) ⇒ every active
// agent re-curated at least weekly (pick-cohort.mjs sizes the cohort from
// the live roster).
//
// Cron 20:52 UTC daily — a minute no other binding uses (the feed/research
// staggers live on other minutes), off the orchestrator's busiest windows.
//
// PREREQ (order matters):
//   1. The PR adding workforce/skills/memory-curation is MERGED and the
//      data-plane deploy finished (wf-seed-skills syncs the SKILL# row the
//      R8 write-time check validates against; the deploy also creates the
//      POST /agents/{slug}/memory route + secret-read policy).
//   2. The memory-write token secret exists:
//        aws secretsmanager create-secret \
//          --name wf/projects/agent-workforce/workforce.memory_write_token \
//          --secret-string "{\"token\":\"$(openssl rand -hex 32)\"}" \
//          --region us-west-2
//
// Idempotent: an existing memory-curation binding is left unchanged (never
// duplicated or reordered — binding_idx is load-bearing).
//
// Usage:
//   node workforce/scripts/wire-memory-curation.mjs --dry-run
//   aws-vault exec <profile> -- node workforce/scripts/wire-memory-curation.mjs

import "../../scripts/lib/proxy-bootstrap.mjs";

import { spawnSync } from "node:child_process";

const API_BASE = (
  process.env.WF_AGENTS_API_BASE ??
  "https://sjhikazsf9.execute-api.us-west-2.amazonaws.com/prod"
).replace(/\/+$/, "");
const REGION = process.env.AWS_REGION ?? "us-west-2";
const DRY_RUN = process.argv.includes("--dry-run");

const CURATOR = "freya";
const BINDING = {
  skill: "memory-curation",
  executor: "claude-code-routine",
  trigger: {
    scheduler: "external",
    invoked_by: "api",
    fired_from: "wf-orchestrator-tick",
    cron: "cron(52 20 * * ? *)",
  },
  routine_spec: "workforce/docs/routines/agent-runner.md",
  project_id: "agent-workforce",
  config: { cohort_size: 5 },
  note: "memory-curation Cadence (Epic-018 Story 3, ADR-0020), landed ENABLED per operator direction 2026-07-19 (weekly coverage per agent). Daily fire; pick-cohort.mjs takes the oldest-memory cohort sized max(5, ceil(active/7)). project_id=agent-workforce supplies workforce.memory_write_token; curation sources are the agent's FULL cross-project record (EXEC ledger + posts), not project-scoped.",
};

function curlJson(method, path, body) {
  const { AWS_ACCESS_KEY_ID } = process.env;
  if (!AWS_ACCESS_KEY_ID && !DRY_RUN) {
    console.error("AWS credentials required (aws-vault exec <profile> -- ...) — the PATCH is IAM-authed.");
    process.exit(1);
  }
  const args = [
    "-sS", "-X", method,
    "-H", "content-type: application/json",
    "--aws-sigv4", `aws:amz:${REGION}:execute-api`,
    "--user", `${process.env.AWS_ACCESS_KEY_ID}:${process.env.AWS_SECRET_ACCESS_KEY}`,
    ...(process.env.AWS_SESSION_TOKEN ? ["-H", `x-amz-security-token: ${process.env.AWS_SESSION_TOKEN}`] : []),
    "-w", "\n%{http_code}",
    `${API_BASE}${path}`,
  ];
  if (body !== undefined) args.push("-d", JSON.stringify(body));
  const res = spawnSync("curl", args, { encoding: "utf8" });
  if (res.status !== 0) {
    console.error(`curl failed: ${res.stderr}`);
    process.exit(1);
  }
  const out = res.stdout;
  const idx = out.lastIndexOf("\n");
  const status = Number(out.slice(idx + 1));
  let json;
  try {
    json = JSON.parse(out.slice(0, idx));
  } catch {
    json = { raw: out.slice(0, idx) };
  }
  return { status, json };
}

// Read the current bindings via the public GET (no auth needed).
const getRes = await fetch(`${API_BASE}/agents/${CURATOR}`);
if (!getRes.ok) {
  console.error(`GET /agents/${CURATOR} -> HTTP ${getRes.status}`);
  process.exit(1);
}
const agent = await getRes.json();
const bindings = Array.isArray(agent.bindings) ? agent.bindings : [];

if (bindings.some((b) => b.skill === "memory-curation")) {
  console.log(`${CURATOR}: memory-curation already bound — nothing to do (idempotent).`);
  process.exit(0);
}

const next = [...bindings, BINDING];
if (DRY_RUN) {
  console.log(`[dry-run] ${CURATOR}: would PATCH bindings -> +memory-curation (ENABLED, ${BINDING.trigger.cron}, cohort_size ${BINDING.config.cohort_size}); total ${next.length}`);
  process.exit(0);
}

const { status, json } = curlJson("PATCH", `/agents/${CURATOR}`, { bindings: next });
if (status === 200) {
  console.log(`✓ ${CURATOR}: memory-curation bound ENABLED (${BINDING.trigger.cron}); total bindings ${next.length}`);
} else {
  console.error(`✗ ${CURATOR}: HTTP ${status} ${JSON.stringify(json)}`);
  process.exit(1);
}
