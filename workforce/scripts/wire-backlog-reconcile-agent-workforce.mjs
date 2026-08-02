#!/usr/bin/env node
// Wire Nadia's `backlog-reconcile` binding for the `agent-workforce` project via
// PATCH /agents/nadia (ADR-0007: bindings are DDB config, the agents-api is the
// single writer — each PATCH is validated at the write boundary and lands its own
// AUDIT item; W-5 keeps it one-persona-per-mutation).
//
// What this adds:
//   - backlog-reconcile, ONCE A DAILY, Nadia (PM lens), project=agent-workforce.
//     A claude-code-routine (R-N1(a)) fired by the orchestrator-tick CCR path
//     (scheduler=external, invoked_by=api). Each day it re-grounds the repo's
//     planning artifacts (epics/specs + their open issues) against what has
//     actually shipped, fans out subsystem-owner audit subagents, rewrites
//     statuses with dated evidence notes, trues up the issue set (close / retire
//     / rewrite-split / file-new), and opens a DRAFT PR. It NEVER self-merges and
//     it escalates every Obsoleted/Rejected reclassification to the operator.
//
//     Routing (config below): a fixed standing core — Mateo (substrate/data),
//     Dario (eng-quality/governance), Nadia (product/console/IA, router self-
//     include), Aoi (design / agent-experience / content surfaces) — plus
//     first-match routing_rules that pull in specialists (pipeline, legal,
//     finance, SRE, GTM, memory) ONLY for the partitions that implicate them.
//
// PREREQ:
//   1. workforce/projects/agent-workforce/project.json declares github.{owner,repo}
//      + the github.token credential type (already present — shared with pr-autopilot).
//   2. The PAT secret exists: wf/projects/agent-workforce/github.token. backlog-
//      reconcile needs Contents:R, Issues:R/W, Pull requests:R/W (it edits planning
//      docs in a branch, opens a draft PR, and closes/rewrites/opens issues).
//   3. The data-plane deploy that syncs the backlog-reconcile SKILL# row has run
//      (the write-time check validates the binding's skill against it).
//
// This script declares the binding ENABLED (scheduler=external + invoked_by=api +
// the daily cron, in one write) — the §bindings.md "enable a cadence" B-authority
// shape. Enabling a scheduled run is the operator's B-authority step; running this
// script (which needs AWS creds) IS that step.
//
// Idempotent + declares desired state. Keyed on (skill, project_id): absent →
// appended; equal → true no-op; drifted → replaced in place (binding_idx preserved).
// Nadia's other bindings (pr-autopilot @ agent-workforce / asp-cloud, …) are matched
// out by (skill, project_id) and left untouched.
//
// Usage:
//   node workforce/scripts/wire-backlog-reconcile-agent-workforce.mjs --dry-run
//   aws-vault exec <profile> -- \
//     node workforce/scripts/wire-backlog-reconcile-agent-workforce.mjs

import "../../scripts/lib/proxy-bootstrap.mjs";

import { spawnSync } from "node:child_process";

const API_BASE = (
  process.env.WF_AGENTS_API_BASE ??
  "https://sjhikazsf9.execute-api.us-west-2.amazonaws.com/prod"
).replace(/\/+$/, "");
const REGION = process.env.AWS_REGION ?? "us-west-2";
const DRY_RUN = process.argv.includes("--dry-run");

const SLUG = "nadia";
const PROJECT_ID = "agent-workforce";
const ROUTINE_SPEC = "workforce/docs/routines/agent-runner.md";

// Once a day at 02:41 UTC: cron(41 2 ? * * *). 02:00 UTC is Nadia's APAC-morning
// planning slot — her *weekly* pdm cron is cron(0 2 ? * MON *) (Mondays) from the
// Q2 hire round; THIS cadence runs DAILY, nudged to :41 so the single-literal
// minute + hour clears the agents-api hourly cadence floor (G1-cadence-floor).
const BINDING = {
  skill: "backlog-reconcile",
  executor: "claude-code-routine",
  trigger: {
    scheduler: "external",
    invoked_by: "api",
    fired_from: "wf-orchestrator-tick",
    cron: "cron(41 2 ? * * *)",
  },
  routine_spec: ROUTINE_SPEC,
  project_id: PROJECT_ID,
  config: {
    sign_off_persona: "nadia",
    // The standing core — audits on EVERY run. Pairs a lens (the surface owned)
    // with the agent slug. Deliberately not all-engineers: Aoi gives the design /
    // agent-experience / content surface a first-class auditor.
    partition_owners: [
      { agent: "mateo", lens: "backend / lambdas / infra / data-plane / API + scalability" },
      { agent: "dario", lens: "engineering quality / governance / ADRs / CI / tests" },
      { agent: "nadia", lens: "product / console / IA / roadmap framing (router self-include)" },
      { agent: "aoi", lens: "design system / agent-experience / content & article surfaces / brand voice" },
    ],
    // Routed specialists — first-match. Pulled in ONLY for the partitions whose
    // surface they own; otherwise they never see the fan-out.
    routing_rules: [
      {
        when: "partition touches newsletter/** (GAS L1→L4 pipeline, reader SPA) or the article-level2/3 skills",
        nominate: ["elena"],
        rationale: "article-pipeline owner",
      },
      {
        when: "partition touches recall / long-term memory / embeddings (Epic-012 surfaces)",
        nominate: ["hana", "freya"],
        rationale: "data-plane memory + agent-experience lens",
      },
      {
        when: "partition touches governance / legal / policy / compliance",
        nominate: ["priya", "tessa"],
        rationale: "legal & policy lens",
      },
      {
        when: "partition touches cost / budget / billing / finance",
        nominate: ["silas"],
        rationale: "finance lens",
      },
      {
        when: "partition touches reliability / SRE / SLO / alarms / uptime",
        nominate: ["farah"],
        rationale: "forward-assurance / SLO lens",
      },
      {
        when: "partition touches India / GTM / market-entry",
        nominate: ["vikram", "aanya"],
        rationale: "India market lens",
      },
    ],
    skip_list_default: ["kai", "yuki", "noor", "mira", "levi"],
    skip_list_rationale:
      "Brand / GTM / counsel personas have no standing audit surface on this repo's planning items; the pipeline/legal/finance/SRE/GTM/memory specialists are pulled in by routing_rules when (and only when) their surface appears in a partition.",
  },
  note:
    "Nadia's daily backlog-reconcile on the workforce's own repo (refluster/ai-native-article, via project agent-workforce). Fires once a day; re-grounds epics/specs + their open issues against shipped reality, fans out a standing audit core (mateo/dario/nadia/aoi) plus first-match routed specialists, rewrites statuses with dated evidence notes, trues up the issue set (close/retire/rewrite-split/file-new), and opens a DRAFT PR. Never self-merges; escalates every Obsoleted/Rejected reclassification (a design decision) to the operator for sign-off.",
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

// Stable, key-order-independent serialization so a true no-op (the live binding
// already equals what we declare) is distinguished from drift. ARRAY order is
// preserved (significant) on purpose — routing_rules is first-match precedence,
// so a reorder is semantic drift that SHOULD re-PATCH, not a cosmetic no-op.
const stable = (v) =>
  v && typeof v === "object" && !Array.isArray(v)
    ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`
    : Array.isArray(v)
      ? `[${v.map(stable).join(",")}]`
      : JSON.stringify(v);

// Match on (skill, project_id). Not present → append; equal → no-op; drifted →
// replace in place (binding_idx preserved) so a corrected note/config re-syncs.
const idx = cur.bindings.findIndex(
  (b) => b.skill === BINDING.skill && b.project_id === BINDING.project_id,
);
const summary = `${BINDING.skill} @ ${PROJECT_ID} (${BINDING.trigger.cron})`;
let next;
let verb;
if (idx >= 0) {
  if (stable(cur.bindings[idx]) === stable(BINDING)) {
    console.log(`  - ${SLUG}: backlog-reconcile @ ${PROJECT_ID} already bound + current, skipped (no-op).`);
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
