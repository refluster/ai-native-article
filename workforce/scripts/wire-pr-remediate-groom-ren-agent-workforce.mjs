#!/usr/bin/env node
// Wire Ren's `pr-remediate` GROOM-lane binding for the `agent-workforce`
// project via PATCH /agents/ren (ADR-0007 write path; W-5 one-persona-per-
// mutation).
//
// What this adds (adr-0030, the HUMAN lane's groomer):
//   - pr-remediate with `config.lane: "groom"`, ONCE A DAY at 02:41 UTC, Ren,
//     project=agent-workforce → refluster/ai-native-article. A CCR
//     claude-code-routine (R-N1(a)) fired by the orchestrator-tick path.
//
//     Each fire it reads the `autopilot:needs-human` queue and, for every PR
//     that has fallen behind its base, merges the base in and pushes — so the
//     operator's decision does not also cost a conflict resolution. It
//     resolves ONLY conflicts that are additive on both sides, and refuses any
//     whose two sides allocate the same registry id (the ML-027 collision
//     guard). It moves no label, addresses no finding, and never merges.
//
//     Why daily, not twice: unlike the author lane, nothing here races a
//     staleness sweep. The queue's bottleneck is an operator decision, and a
//     second fire would re-read the same queue against the same base and skip
//     every PR (the attempt marker is keyed by base SHA — adr-0030). One fire
//     per day matches the base's own rate of motion.
//
//     02:41 UTC sits well clear of Ren's other fires (04:11 issue-implement,
//     06:29/18:29 pr-remediate author lane) so no two Ren fires share an
//     orchestrator tick window, and after the 23:xx/00:23 pr-autopilot tick
//     whose escalations it will groom.
//
// ⚠️ THE MATCHER IS THE SHARP EDGE HERE. Every other wire-*.mjs keys its
// binding by (skill, project_id). Ren already has a `pr-remediate @
// agent-workforce` binding for the AUTHOR lane, so that key would match it and
// this script would REPLACE the author lane rather than add the groom lane —
// silently removing the queue-drainer adr-0022 depends on. The matcher below
// therefore keys by (skill, project_id, config.lane), and treats a binding with
// no `config.lane` as the author lane (which is what pr-remediate's SKILL.md
// says an omitted lane means).
//
// PREREQ — SEED THE SKILL BODY FIRST. The groom lane lives in pr-remediate's
// SKILL.md Step G, which reaches the live agent only once `wf-seed-skills` has
// propagated version ≥ 0.3.0 (ADR-0018 version gate). Merging the PR puts it in
// git; it does NOT update the DDB row. Confirm before running this:
//   curl -s https://workforce-api.kohuehara.xyz/skills/pr-remediate | jq -r .version
// A binding whose skill body predates Step G will fire an author-lane run
// against the human queue — which the scan refuses (every candidate classifies
// `not-in-lane`), so it fails safe, but it also does nothing.
//
// ENABLING A CRON IS THE OPERATOR'S B-AUTHORITY STEP (governance.md §5).
//
// Usage:
//   node workforce/scripts/wire-pr-remediate-groom-ren-agent-workforce.mjs --dry-run
//   aws-vault exec <profile> -- \
//     node workforce/scripts/wire-pr-remediate-groom-ren-agent-workforce.mjs

import { ensureProxyAwareEntry } from "../../scripts/lib/proxy-bootstrap.mjs";
ensureProxyAwareEntry(import.meta.url);
import { reconcileBinding } from "../../scripts/lib/binding-reconcile.mjs";

import { spawnSync } from "node:child_process";

const API_BASE = (
  process.env.WF_AGENTS_API_BASE ??
  "https://sjhikazsf9.execute-api.us-west-2.amazonaws.com/prod"
).replace(/\/+$/, "");
const REGION = process.env.AWS_REGION ?? "us-west-2";
const DRY_RUN = process.argv.includes("--dry-run");

const PROJECT_ID = "agent-workforce";
const ROUTINE_SPEC = "workforce/docs/routines/agent-runner.md";
const SLUG = "ren";
const LANE = "groom";

const BINDING = {
  skill: "pr-remediate",
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
    lane: LANE,
    sign_off_persona: "ren",
    // Higher than the author lane's 3: a groom pass is a base merge plus an
    // additive resolution, not a diagnosis, and most candidates come back
    // `decision-ready` or `already-groomed` at zero cost.
    max_prs_per_run: 5,
  },
  note:
    "Ren's daily pr-remediate GROOM lane on refluster/ai-native-article (project agent-workforce), adr-0030. Reads the autopilot:needs-human queue and keeps it decision-ready: merges the base branch into any escalated PR that has fallen behind and pushes to its HEAD branch, resolving ONLY conflicts additive on both sides and refusing any whose sides allocate a shared registry id (the ML-027 collision guard). Moves no label, addresses no finding, never merges, never touches the default branch — the operator's decision is untouched; only the decay around it is removed. Motivated by the 2026-09-07 queue drain: seven PRs at a median 28 days, six of which arrived mergeable and conflicted while waiting, four already panel-green. Bounded by base SHA: one attempt per base, claimed before the work, and three consecutive blocked bases drop the PR from the lane. Distinct from Ren's 06:29/18:29 author-lane binding on the same skill — the two lanes never work one PR, since a PR carrying both labels is not-in-lane for the groomer.",
};

/** (skill, project_id, lane) — NOT the usual (skill, project_id). Ren carries
 *  two bindings for this skill on this project and the coarser key would make
 *  each overwrite the other. An absent `config.lane` is the author lane. */
const laneOf = (b) => String(b?.config?.lane ?? "author");
const matchFn = (b) =>
  b.skill === BINDING.skill && b.project_id === BINDING.project_id && laneOf(b) === LANE;

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

// Fail loud rather than quietly creating a second author lane: if the author
// binding this one sits beside has gone missing, the operator should know
// before a groom binding lands next to nothing (C-4 / W-4).
const authorLane = cur.bindings.find(
  (b) => b.skill === BINDING.skill && b.project_id === PROJECT_ID && laneOf(b) === "author",
);
if (!authorLane) {
  console.error(
    `  ⚠ ${SLUG}: no AUTHOR-lane pr-remediate @ ${PROJECT_ID} binding found. The groom lane is an addition to it, ` +
      `not a replacement — wire wire-pr-remediate-ren-agent-workforce.mjs first, or confirm the author lane was ` +
      `retired deliberately before re-running this.`,
  );
  process.exit(1);
}

const summary = `${BINDING.skill}[lane=${LANE}] @ ${PROJECT_ID} (${BINDING.trigger.cron})`;
const { bindings: next, verb, changed } = reconcileBinding(cur.bindings, BINDING, matchFn);
if (!changed) {
  console.log(`  - ${SLUG}: ${summary} already bound + current, skipped (no-op).`);
  process.exit(0);
}
if (DRY_RUN) {
  console.log(`  [dry-run] ${SLUG}: would PATCH bindings -> ${verb} (${summary}); total ${next.length}`);
  console.log(`  [dry-run] author lane preserved: ${authorLane.trigger?.cron ?? "(no cron)"}`);
  process.exit(0);
}

const { status, json } = curlJson("PATCH", `/agents/${SLUG}`, { bindings: next });
if (status === 200) {
  console.log(`  ✓ ${SLUG}: ${verb} ${summary}; bindings now ${json?.bindings?.length ?? next.length}`);
  process.exit(0);
}
console.error(`  ✗ ${SLUG}: PATCH -> HTTP ${status} ${JSON.stringify(json)}`);
process.exit(1);
