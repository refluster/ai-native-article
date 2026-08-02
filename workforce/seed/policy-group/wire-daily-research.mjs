#!/usr/bin/env node
// Wire the generic `daily-research` Cadence onto the first research cohort via
// PATCH /agents/{slug} (ADR-0007: bindings are DDB config, agents-api is the
// single writer — each PATCH is validated (R8 against SKILL# rows) and lands its
// own AUDIT item). Epic-015.
//
// Phase 3 of the Epic-015 rollout. This script ADDS the daily-research binding to
// grace + ishaan, landing it **PAUSED** — scheduler:"manual", the runbook's
// "declarative-pending" shape (runbooks/bindings.md §Executor × scheduler), which
// wf-orchestrator-tick does NOT dispatch (it only fires
// executor=claude-code-routine + scheduler=external + invoked_by=api). So adding
// the binding is governance §5 A-authority ("lands Enabled:false-equivalent");
// ENABLING it (flip scheduler→external + add cron) is the separate B-authority
// Phase-4 step the operator performs — see ENABLE_SNIPPET at the bottom.
//
// Phase 6 (Epic-015 §Staged rollout) — COHORT-2 expansion, operator greenlight
// 2026-06-21. After the grace+ishaan pilot proved out, the operator directed
// expanding daily-research to the next cohort of personas with an external
// information frontier: dario, mateo, maya, mei, aoi, hana, farah. These land
// **ENABLED** (scheduler:external + invoked_by:api + a daily cron) — the operator's
// in-message direction is the Phase-6 B-authority cost approval, so cohort-2 skips
// the PAUSED→Phase-4 dance the pilot used. They are no_skip:FALSE (skill default):
// unlike grace's/ishaan's always-on grid regulatory machines, these beats have
// genuine quiet windows and SHOULD skip when nothing material moved (Epic-015
// §"Cost (W-3)" / §"Feed signal-to-noise"). A light per-persona parity pass
// (Appendix A, cohort-2) confirmed each carries a frontier; the v0.3.0 SKILL.md
// "pull from live inputs" change (synthesise memory + colleagues' activity + a
// live web search) further hardens the skill for thinner source-lists.
//
// This script does NOT touch grid-watch / india-grid-watch — deprecating those
// (Phase 5) is a later, B-authority step gated on the Phase-4 parity observation.
//
// PREREQ: the PR adding workforce/skills/daily-research must be MERGED and the
// data-plane deploy finished — wf-seed-skills syncs SKILL# rows post-deploy, and
// the R8 write-time check validates bindings against those rows. Running this
// before the sync 422s with R8-binding-skill-exists (fail-loud, no partial write).
//
// Idempotent: existing bindings are preserved; daily-research already bound on an
// agent is skipped, never duplicated or reordered (binding_idx is load-bearing).
//
// Usage:
//   node workforce/seed/policy-group/wire-daily-research.mjs --dry-run
//   aws-vault exec <profile> -- node workforce/seed/policy-group/wire-daily-research.mjs

import "../../../scripts/lib/proxy-bootstrap.mjs";

import { spawnSync } from "node:child_process";

const API_BASE = (
  process.env.WF_AGENTS_API_BASE ??
  "https://sjhikazsf9.execute-api.us-west-2.amazonaws.com/prod"
).replace(/\/+$/, "");
const REGION = process.env.AWS_REGION ?? "us-west-2";
const DRY_RUN = process.argv.includes("--dry-run");

const ROUTINE_SPEC = "workforce/docs/routines/agent-runner.md";
const PROJECT_ID = "agent-workforce";

// The binding lands PAUSED: scheduler:"manual" (declarative-pending). No cron yet
// — the operator adds it at Phase 4. config.no_skip:true because both Grace's US
// beat and Ishaan's India beat are live federal-and-state regulatory machines that
// always carry a citable standing item (Epic-015 §Proposed solution).
function dailyResearchBinding(noSkip) {
  return {
    skill: "daily-research",
    executor: "claude-code-routine",
    trigger: {
      scheduler: "manual", // PAUSED — not dispatched by orchestrator-tick until Phase 4 flips it to "external"
    },
    routine_spec: ROUTINE_SPEC,
    project_id: PROJECT_ID,
    config: { no_skip: noSkip },
    note: "daily-research Cadence (Epic-015), landed PAUSED (scheduler=manual). Phase 4 (operator, B-authority) flips scheduler→external + invoked_by=api + a staggered cron to enable. project_id=agent-workforce supplies workforce.feed_write_token.",
  };
}

// Cohort-2 (Phase 6) lands ENABLED. Minute-of-day = djb2(slug + "#daily-research")
// % 1440, forward-walked off each agent's existing feed-post slot so the two
// cadences never share a tick (same djb2 family as wire-cadences.mjs, but spread
// across the full 24h rather than the 09:00–18:00 JST feed window). Crons are
// pinned here as the declarative record of what was applied live (ADR-0007:
// agents-api/DDB is the source of truth; this script is the reproducible applier).
const COHORT2_CRON = {
  dario: "cron(44 18 ? * * *)",
  mateo: "cron(35 14 ? * * *)",
  maya: "cron(9 11 ? * * *)",
  mei: "cron(44 7 ? * * *)",
  aoi: "cron(30 12 ? * * *)",
  hana: "cron(9 23 ? * * *)",
  farah: "cron(35 11 ? * * *)",
};

// An ENABLED daily-research binding (cohort-2, Phase 6). Unlike dailyResearchBinding
// (which lands PAUSED for the operator to enable at Phase 4), this carries the live
// trigger shape wf-orchestrator-tick dispatches, per the operator's Phase-6
// greenlight. no_skip:false — non-grid beats skip on quiet windows (skill default).
function enabledResearchBinding(slug) {
  return {
    skill: "daily-research",
    executor: "claude-code-routine",
    trigger: {
      scheduler: "external",
      invoked_by: "api",
      fired_from: "wf-orchestrator-tick",
      cron: COHORT2_CRON[slug],
    },
    routine_spec: ROUTINE_SPEC,
    project_id: PROJECT_ID,
    config: { no_skip: false },
    note: "daily-research Cadence (Epic-015 Phase-6 cohort-2), landed ENABLED per operator greenlight 2026-06-21. no_skip:false — non-grid beat, skips on quiet windows. project_id=agent-workforce supplies workforce.feed_write_token.",
  };
}

const PLAN = [
  { slug: "grace", add: [dailyResearchBinding(true)] },
  { slug: "ishaan", add: [dailyResearchBinding(true)] },
  ...Object.keys(COHORT2_CRON).map((slug) => ({ slug, add: [enabledResearchBinding(slug)] })),
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
  const existingIdx = cur.bindings.findIndex((b) => b.skill === "daily-research");

  let next;
  let summary;
  if (existingIdx === -1) {
    // Not bound yet — append (binding_idx is load-bearing; never reorder). The
    // binding's own trigger decides PAUSED (scheduler:manual) vs ENABLED
    // (scheduler:external + cron); cohort-2 lands ENABLED, the pilot landed PAUSED.
    next = [...cur.bindings, ...add];
    summary = add
      .map((b) => {
        const t = b.trigger ?? {};
        const enabled = t.scheduler === "external";
        return `${b.skill} @ ${t.scheduler}${t.cron ? " " + t.cron : ""} (${enabled ? "ENABLED" : "PAUSED"}, no_skip:${b.config?.no_skip === true})`;
      })
      .join(", ");
  } else {
    // Already bound — idempotently RECONCILE config.no_skip *in place* to THIS
    // PLAN entry's intended value, without touching the (possibly already-enabled)
    // trigger. The intent is per-cohort, so read it off the PLAN binding rather
    // than hardcoding true: grace/ishaan are no_skip:true (always-on grid beats —
    // the standing-obligation flag the Phase-4 enable used to silently drop, same
    // drift class as the cron-without-scheduler bug, PR #348), while cohort-2 is
    // no_skip:false (non-grid beats that SHOULD skip on quiet windows). Hardcoding
    // true here would flip cohort-2 into standing-item spam on any re-run — the
    // very failure mode no_skip governs, inverted. Reconciling to the entry's
    // intent makes a re-run a true no-op for BOTH cohorts.
    const desiredNoSkip = add[0]?.config?.no_skip === true;
    const b = cur.bindings[existingIdx];
    if ((b.config?.no_skip === true) === desiredNoSkip) {
      console.log(`  - ${slug}: daily-research already bound with no_skip:${desiredNoSkip}, nothing to do`);
      continue;
    }
    const repaired = { ...b, config: { ...(b.config ?? {}), no_skip: desiredNoSkip } };
    next = cur.bindings.map((x, i) => (i === existingIdx ? repaired : x));
    const t = repaired.trigger ?? {};
    summary = `daily-research config.no_skip → ${desiredNoSkip} (trigger preserved: ${t.scheduler}${t.cron ? " " + t.cron : ""})`;
  }

  if (DRY_RUN) {
    console.log(`  [dry-run] ${slug}: would PATCH bindings -> ${summary}; total ${next.length}`);
    continue;
  }
  const { status, json } = curlJson("PATCH", `/agents/${slug}`, { bindings: next });
  if (status === 200) {
    console.log(`  ✓ ${slug}: ${summary}`);
  } else {
    failed = true;
    console.error(`  ✗ ${slug}: HTTP ${status} ${JSON.stringify(json)}`);
  }
}

if (failed) process.exit(1);
console.log(
  DRY_RUN
    ? "Dry run complete."
    : "Done. New bindings land PAUSED (enable at Phase 4); already-enabled bindings now carry no_skip:true.",
);

// ── Phase 4 (operator, B-authority): enable a paused binding ─────────────────
// After observing the binding is in place, the operator enables it by PATCHing the
// daily-research binding to the live trigger shape (a distinct minute-of-day to
// avoid stampeding /fire — reuse the djb2 stagger from wire-cadences.mjs). MERGE
// the trigger; do NOT replace the whole binding — preserving config.no_skip:true:
//
//   {
//     ...existingBinding,                 // keep skill, executor, routine_spec,
//                                         // project_id, AND config.no_skip:true
//     trigger: {
//       scheduler: "external",
//       invoked_by: "api",
//       fired_from: "wf-orchestrator-tick",
//       cron: "cron(M H ? * * *)"         // UTC; e.g. grace 01:07 = 21:07 ET, after the US docket day
//     },
//   }
//
// Dropping config.no_skip here is what stranded daily-research in skip-default and
// produced the all-skips feed (it shares the grid beat with grid-watch / india-
// grid-watch, so without the standing-obligation flag every item reads as already
// covered). Re-running THIS script repairs that flag idempotently. This is the
// Phase-4 cron-enable B-authority step (governance §5). Keep grid-watch bound
// until Phase 4 parity is confirmed; remove it only at Phase 5.
