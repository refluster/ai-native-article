#!/usr/bin/env node
// Wire Nadia's `pr-autopilot` binding for the `agent-workforce` project via
// PATCH /agents/nadia (ADR-0007: bindings are DDB config, the agents-api is
// the single writer — each PATCH is validated at the write boundary and
// lands its own AUDIT item; W-5 keeps it one-persona-per-mutation).
//
// What this adds:
//   - pr-autopilot, every 6h, Nadia (PdM router lens), project=agent-workforce.
//     The project's github surface is refluster/ai-native-article — the
//     workforce's OWN repo — and adr-0011 retired the self-repo carve-out: it
//     is now treated **identically to an external delegated R-N10 target**
//     (root docs/governance.md §4.4 carries the delegation + the L0/L1 block).
//     So a 🟢 unanimous-green, **non-L0/L1**, consensus PR is **merged by the
//     agent**, exactly as on PSVL/asp-cloud; only a PR touching the L0/L1
//     boundary (governance / ADR / identity / schedule / production paths) —
//     or a 🔴 / non-consensus verdict — escalates to the operator. A 🟢
//     merge-ready L0/L1 hand-off carries `autopilot:reviewed` alongside
//     `autopilot:needs-human` so the operator's merge-ready queue is legible.
//     Every open PR is in scope — draft and non-draft, human- and bot-authored
//     (adr-0010). The cadence routes ≤5 PRs/tick (config.max_prs_per_tick →
//     the scan's `--max 5`).
//
// PREREQ:
//   1. workforce/projects/agent-workforce/project.json declares
//      github.{owner,repo} + the github.token credential type (this PR).
//   2. The PAT secret exists: wf/projects/agent-workforce/github.token
//      (operator stores it out of band — see
//      docs/runbooks/external-project-onboarding.md Step 2). pr-autopilot
//      needs Contents:R, Issues:R/W, Pull requests:R/W.
//   3. The data-plane deploy that syncs the pr-autopilot SKILL# row has run
//      (the R8 write-time check validates the binding against it).
//
// Idempotent + declares desired state. The binding is keyed on (skill,
// project_id). If Nadia has no agent-workforce pr-autopilot binding it is
// appended; if she has one that already equals this declaration it is a true
// no-op; if she has one that has DRIFTED (e.g. a stale note) it is replaced
// in place — same slot, so binding_idx stays load-bearing — so the corrected
// note/config re-syncs. Her separate asp-cloud pr-autopilot binding is matched
// out by project_id and left untouched in every case.
//
// Usage:
//   node workforce/scripts/wire-pr-autopilot-agent-workforce.mjs --dry-run
//   aws-vault exec <profile> -- \
//     node workforce/scripts/wire-pr-autopilot-agent-workforce.mjs

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

// Every 6h at :23 (00:23 / 06:23 / 12:23 / 18:23 UTC). Literal hour list so
// any cron parser agrees; the single-literal minute clears the agents-api
// hourly cadence floor (G1-cadence-floor).
const BINDING = {
  skill: "pr-autopilot",
  executor: "claude-code-routine",
  trigger: {
    scheduler: "external",
    invoked_by: "api",
    fired_from: "wf-orchestrator-tick",
    cron: "cron(23 0,6,12,18 ? * * *)",
  },
  routine_spec: ROUTINE_SPEC,
  project_id: PROJECT_ID,
  config: {
    sign_off_persona: "nadia",
    cycle_cap: 3,
    // The operator-set cap on PRs processed per tick — the CCR session runs
    // pr-autopilot-scan.mjs with `--max 5`.
    max_prs_per_tick: 5,
    nomination_rules: [
      {
        when: "diff touches workforce/lambdas/**, workforce/infra/**, any docs/adr/** or governance.md",
        nominate: ["dario"],
        rationale: "architecture / governance / infra lens",
      },
      {
        when: "diff touches newsletter/** (GAS L1→L4 pipeline, reader SPA)",
        nominate: ["dario"],
        rationale: "pipeline-architecture lens; Nadia keeps the PdM read",
      },
      {
        when: "docs-only / product-framing / roadmap surface",
        nominate: ["nadia"],
        rationale: "PdM self-review (router self-include)",
      },
    ],
    skip_list_default: ["yuki", "elena", "priya", "theo", "vikram", "noor", "aanya"],
    skip_list_rationale:
      "Cadence / finance / policy personas have no review surface on this repo's code + pipeline PRs; nominate only when their lens is actually implicated.",
  },
  note:
    "Nadia's PdM-lens pr-autopilot on the workforce's own repo (refluster/ai-native-article, via project agent-workforce). Fires every 6h; routes ≤5 PRs/tick — draft and non-draft, human- and bot-authored (adr-0010) — to reviewer lenses and drives each to a consensus verdict. Own-repo is a normal delegated R-N10 target (adr-0011, root docs/governance.md §4.4): a 🟢 unanimous-green, non-L0/L1 PR is merged by the agent; an L0/L1 (or 🔴 / non-consensus) PR escalates to the operator. A 🟢 merge-ready L0/L1 hand-off carries autopilot:reviewed + autopilot:needs-human so the operator's merge-ready queue is legible.",
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
// already equals what we declare) is distinguished from drift (e.g. a stale
// note/config that must re-sync) — order of keys in the GET response is not
// guaranteed to match our literal. Note: ARRAY order is preserved (significant)
// on purpose — config.nomination_rules is first-match precedence, so a reorder
// is semantic drift that SHOULD re-PATCH, not a cosmetic no-op.
const stable = (v) =>
  v && typeof v === "object" && !Array.isArray(v)
    ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`
    : Array.isArray(v)
      ? `[${v.map(stable).join(",")}]`
      : JSON.stringify(v);

// This script declares the DESIRED state of Nadia's (pr-autopilot @ agent-
// workforce) binding. Match on (skill, project_id) — Nadia also has a separate
// pr-autopilot binding for asp-cloud, which is preserved untouched.
//   - not present  → append (existing bindings keep their binding_idx).
//   - present, equal → true no-op.
//   - present, drifted → REPLACE in place (same slot, binding_idx preserved)
//     so a corrected note/config re-syncs to DDB. Earlier the script skipped on
//     mere presence, which left the live binding's stale (pre-adr-0011) note in
//     place after the prose was fixed — replace-on-drift closes that.
const idx = cur.bindings.findIndex(
  (b) => b.skill === BINDING.skill && b.project_id === BINDING.project_id,
);
const summary = `${BINDING.skill} @ ${PROJECT_ID} (${BINDING.trigger.cron})`;
let next;
let verb;
if (idx >= 0) {
  if (stable(cur.bindings[idx]) === stable(BINDING)) {
    console.log(`  - ${SLUG}: pr-autopilot @ ${PROJECT_ID} already bound + current, skipped (no-op).`);
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
