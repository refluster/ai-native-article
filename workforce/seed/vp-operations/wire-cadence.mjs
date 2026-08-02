#!/usr/bin/env node
// Wire the ops-accountability-watch Cadence onto petra via PATCH /agents/petra
// (ADR-0007: bindings are DDB config, agents-api is the single writer — the
// PATCH is validated (R8 against SKILL# rows) and lands its own AUDIT item).
//
// PREREQ: the PR adding workforce/skills/ops-accountability-watch/ must be
// MERGED and the data-plane deploy finished — wf-seed-skills syncs the
// SKILL# row and build-skill-registry.mjs regenerates SKILL_REQUIRES.
// Running this before that sync 422s with R8-binding-skill-exists (fail-loud,
// no partial write). petra must already be registered (register.mjs) before
// this runs.
//
// Idempotent: if petra already carries an ops-accountability-watch binding,
// this script updates it in place (same binding_idx) rather than duplicating
// it — safe to re-run after a SKILL.md bump.
//
// Usage:
//   node workforce/seed/vp-operations/wire-cadence.mjs --dry-run
//   aws-vault exec <profile> -- node workforce/seed/vp-operations/wire-cadence.mjs

import "../../../scripts/lib/proxy-bootstrap.mjs";

import { spawnSync } from "node:child_process";

const API_BASE = (
  process.env.WF_AGENTS_API_BASE ??
  "https://sjhikazsf9.execute-api.us-west-2.amazonaws.com/prod"
).replace(/\/+$/, "");
const REGION = process.env.AWS_REGION ?? "us-west-2";
const DRY_RUN = process.argv.includes("--dry-run");

const ROUTINE_SPEC = "workforce/docs/routines/agent-runner.md";
const PROJECT_ID = "agent-workforce"; // supplies github.token + discord.webhook_url

// Daily, 09:47 UTC — offset from every existing scheduled workflow in this
// repo (article deploys 06/12/18:17 UTC, workforce API-route check 08:17 UTC,
// podcast 18:37 UTC, weekly-content-insights Mondays 02:00 UTC) so this sweep
// never contends with them for GitHub API rate limit.
const BINDING = {
  skill: "ops-accountability-watch",
  executor: "claude-code-routine",
  trigger: {
    scheduler: "external",
    invoked_by: "api",
    fired_from: "wf-orchestrator-tick",
    cron: "cron(47 9 ? * * *)",
  },
  routine_spec: ROUTINE_SPEC,
  project_id: PROJECT_ID,
  // observation mode per workforce/docs/runbooks/chat-notification-policy.md
  // §5 — every fire posts (Awareness Only included) until the operator
  // confirms four consecutive clean weekly (Monday) fires and flips this to
  // "steady" (a separate, explicit PATCH — not something this Cadence
  // decides for itself mid-run).
  config: { mode: "observation" },
  note:
    "ops-accountability-watch Cadence (workforce/docs/hires/vp-operations-hire-round.md). Daily sweep of GitHub Actions run history + docs/memory-lint-backlog.md staleness, owner-routed GitHub Issue ledger, one aggregate Discord notification per fire. project_id=agent-workforce supplies github.token + discord.webhook_url. Launched in observation mode (config.mode) per chat-notification-policy.md §5 — operator flips to steady after 4 consecutive clean weekly fires.",
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

async function main() {
  const cur = await (await fetch(`${API_BASE}/agents/petra`)).json();
  if (!Array.isArray(cur.bindings)) {
    console.error("  ✗ petra: GET returned no bindings[] — is petra registered yet? Run register.mjs first.");
    process.exit(1);
  }
  const existingIdx = cur.bindings.findIndex((b) => b.skill === "ops-accountability-watch");
  const next = [...cur.bindings];
  if (existingIdx >= 0) {
    next[existingIdx] = BINDING; // preserve binding_idx by replacing in place
  } else {
    next.push(BINDING);
  }

  if (DRY_RUN) {
    console.log(
      `  [dry-run] petra: would PATCH bindings -> ops-accountability-watch @ ${BINDING.trigger.cron} (${existingIdx >= 0 ? "replace" : "append"}); total ${next.length}`,
    );
    process.exit(0);
  }

  const { status, json } = curlJson("PATCH", "/agents/petra", { bindings: next });
  if (status !== 200) {
    console.error(`  ✗ petra: HTTP ${status} ${JSON.stringify(json)}`);
    process.exit(1);
  }
  console.log(`  ✓ petra: bound ops-accountability-watch @ ${BINDING.trigger.cron} (observation mode)`);
  console.log("Done. Next orchestrator tick (rate 2h) picks the binding up — no deploy needed (ADR-0007 write=live).");
}

main();
