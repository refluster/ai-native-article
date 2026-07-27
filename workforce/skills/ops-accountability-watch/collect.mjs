#!/usr/bin/env node
// ops-accountability-watch/collect.mjs — Step 1 of the Cadence's 3-script
// pipeline (collect -> sync-issues -> notify). Reads:
//   (a) recent GitHub Actions run history for this repo (github.token), and
//   (b) docs/memory-lint-backlog.md's own "watching" staleness rule,
// and prints one JSON object of normalized Findings to stdout.
//
// Self-observation (W-4, fail loud not silent): if (a) itself cannot be
// read, that failure becomes a Finding routed to the default owner rather
// than a silent empty sweep or an uncaught throw — a sweep that can't see
// its primary signal is itself worth a human's attention.
//
// Usage:
//   GITHUB_TOKEN=<credentials['github.token'].token> \
//     node collect.mjs --repo refluster/ai-native-article --lookback-hours 26
//
// Exit codes: 0 completed (see JSON for partial-failure findings), 1 bad
// args/env, 3 fatal (couldn't even read the local backlog file).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  extractCiFollowUps,
  latestRunPerWorkflow,
  findStaleWatchingEntries,
} from "./signals.mjs";
import { routeWorkflowOwner, routeGovernanceRegistryOwner } from "./owner-routing.mjs";

const GITHUB_API = process.env.GITHUB_API_URL ?? "https://api.github.com";
const MEMORY_LINT_BACKLOG_REL_PATH = "docs/memory-lint-backlog.md";

function parseArgs(argv) {
  const args = { lookbackHours: 26, repoRoot: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--repo") args.repo = argv[++i];
    else if (a === "--lookback-hours") args.lookbackHours = Number(argv[++i]);
    else if (a === "--repo-root") args.repoRoot = argv[++i];
  }
  return args;
}

function fail(code, message) {
  console.error(`collect.mjs: ${message}`);
  process.exit(code);
}

// project label for a workflow-based finding — a simplifying default (see
// signals.mjs header): workforce-surface workflows label project:workforce,
// everything else (article/podcast pipelines) labels project:article.
function projectForWorkflow(workflowFile) {
  return /^workforce-/.test(workflowFile) ||
    ["ci.yml", "check-workforce-api-routes.yml", "deploy-workforce-console.yml", "deploy-workforce-data-plane.yml"].includes(
      workflowFile,
    )
    ? "workforce"
    : "article";
}

async function fetchRecentRuns(repo, token, sinceMs) {
  const res = await fetch(`${GITHUB_API}/repos/${repo}/actions/runs?per_page=100`, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub Actions runs fetch failed: HTTP ${res.status}`);
  }
  const body = await res.json();
  return (body.workflow_runs ?? [])
    .map((r) => ({
      workflowFile: String(r.path ?? "").split("/").pop(),
      status: r.status,
      conclusion: r.conclusion,
      htmlUrl: r.html_url,
      createdAt: r.created_at,
      runNumber: r.run_number,
    }))
    .filter((r) => r.workflowFile && new Date(r.createdAt).getTime() >= sinceMs);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.repo) fail(1, "--repo owner/name is required");
  const token = process.env.GITHUB_TOKEN;
  if (!token) fail(1, "GITHUB_TOKEN env var is required");

  const now = new Date();
  const sinceMs = now.getTime() - args.lookbackHours * 3600_000;
  const sweptSurfaces = [];
  const findings = [];

  // --- Signal 1: CI run history ---
  try {
    const runs = await fetchRecentRuns(args.repo, token, sinceMs);
    const latest = latestRunPerWorkflow(runs);
    sweptSurfaces.push(...latest.map((r) => r.workflowFile));
    const ciFollowUps = extractCiFollowUps(latest);
    for (const run of ciFollowUps) {
      const routed = routeWorkflowOwner(run.workflowFile);
      findings.push({
        kind: "ci-run",
        key: `ci-run:${run.workflowFile}`,
        label: `${run.workflowFile} — ${run.conclusion}`,
        detailLines: [
          `Workflow: \`${run.workflowFile}\``,
          `Conclusion: \`${run.conclusion}\` (run #${run.runNumber})`,
          `Detected within the last ${args.lookbackHours}h sweep window.`,
        ],
        sourceUrl: run.htmlUrl,
        owner: routed.owner,
        ownerReason: routed.reason,
        project: projectForWorkflow(run.workflowFile),
        closeCondition: `Close when the next scheduled/triggered run of \`${run.workflowFile}\` completes with conclusion \`success\`.`,
      });
    }
  } catch (err) {
    // Self-observation: the sweep's own primary signal failed to read —
    // surface that as a finding instead of a silent empty result or crash.
    findings.push({
      kind: "self-observation-failure",
      key: "self-observation:github-actions-runs",
      label: "ops-accountability-watch could not read GitHub Actions run history",
      detailLines: [
        `Error: ${err.message}`,
        "The CI-follow-up half of this sweep did not run this fire; only the local governance-registry signal below is reliable for this fire.",
      ],
      sourceUrl: null,
      owner: routeGovernanceRegistryOwner().owner,
      ownerReason: "the sweep's own read path failed — routes to VP Operations & Reliability by default, never silently dropped",
      project: "workforce",
      closeCondition: "Close when the next fire successfully reads GitHub Actions run history end-to-end.",
    });
  }
  sweptSurfaces.push(MEMORY_LINT_BACKLOG_REL_PATH);

  // --- Signal 2: governance-registry staleness ---
  let backlogText;
  try {
    backlogText = readFileSync(join(args.repoRoot, MEMORY_LINT_BACKLOG_REL_PATH), "utf8");
  } catch (err) {
    fail(3, `could not read ${MEMORY_LINT_BACKLOG_REL_PATH}: ${err.message}`);
  }
  const staleEntries = findStaleWatchingEntries(backlogText, now);
  for (const entry of staleEntries) {
    const routed = routeGovernanceRegistryOwner();
    findings.push({
      kind: "backlog-stale",
      key: `backlog-stale:${entry.id}`,
      label: `${entry.id} stuck in "watching" ${entry.ageDays}d (>= 180d threshold)`,
      detailLines: [
        `Rule: ${entry.rule}`,
        `Opened: ${entry.openedOn} (${entry.ageDays} days ago)`,
        `docs/memory-lint-backlog.md §1's own promotion rule: a "watching" row is promoted, declined, or accepted once it has sat unrevised for >= 6 months.`,
      ],
      sourceUrl: null,
      owner: routed.owner,
      ownerReason: routed.reason,
      project: "workforce",
      closeCondition: `Close when ${entry.id}'s Status in docs/memory-lint-backlog.md changes from \`watching\` to \`accepted\`, \`promoted\`, or \`declined\`.`,
    });
  }

  console.log(JSON.stringify({ generatedAt: now.toISOString(), sweptSurfaces, findings }, null, 2));
  process.exit(0);
}

main().catch((err) => fail(3, err.stack ?? String(err)));
