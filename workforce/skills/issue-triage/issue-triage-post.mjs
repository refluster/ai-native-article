#!/usr/bin/env node
// issue-triage/issue-triage-post.mjs — the dispatcher's only write surface
// (adr-0022).
//
// Assigns one issue to one lane: posts the dispatch comment, stamps
// `wf:lane:<lane>` + `wf:owner:<slug>`, and — on a re-queue — clears the parked
// `*:needs-human` label that made the issue invisible to every worker. Label +
// comment only: it never edits an issue body, never closes an issue, never
// opens a PR (the same comment+label posture as pr-autopilot-post.mjs, whose
// ML-012 @-mention guard is imported rather than re-implemented).
//
// Re-laning an issue REPLACES its lane label — an issue is in exactly one lane,
// or the "who owns this" question the whole vocabulary exists to answer has two
// answers again.
//
// Usage:
//   GITHUB_TOKEN=… node workforce/skills/issue-triage/issue-triage-post.mjs \
//     --project agent-workforce --issue 463 --lane design --owner dario \
//     --body-file /tmp/dispatch-463.md [--requeue]
//
// Exit codes: 0 posted · 1 bad args / refused guard · 2 endpoint rejected · 3 network.

import { ensureProxyAwareEntry } from "../../../scripts/lib/proxy-bootstrap.mjs"
ensureProxyAwareEntry(import.meta.url)

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { projectRepo } from "../pr-autopilot/pr-autopilot-scan.mjs";
import { makeGh } from "../pr-autopilot/pr-merge.mjs";
import { findRawMentions } from "../pr-autopilot/pr-autopilot-post.mjs";
import { LANES, LANE_LABEL_PREFIX, PARKED_LABELS, assertLane, laneLabel, ownerLabel } from "./issue-lanes.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");

const LANE_LABEL_META = {
  implement: { color: "1d76db", description: `Dispatched: ${LANES.implement}` },
  design: { color: "5319e7", description: `Dispatched: ${LANES.design}` },
  operator: { color: "b60205", description: `Dispatched: ${LANES.operator}` },
};
const OWNER_LABEL_META = { color: "d4c5f9", description: "Assigned workforce persona (a slug, not a GitHub account — ML-012)." };

/** Labels to remove when applying `lane` to an issue currently carrying
 *  `current`: every OTHER lane label (one lane per issue), plus — on a requeue —
 *  the parked needs-human markers that excluded it from every worker's scan.
 *  Pure + exported: the "exactly one lane" invariant is unit-tested. */
export function labelsToRemove(current = [], lane, { requeue = false } = {}) {
  assertLane(lane);
  const keep = laneLabel(lane);
  return current
    .map((l) => String(l || ""))
    .filter((l) => (l.toLowerCase().startsWith(LANE_LABEL_PREFIX) && l !== keep) || (requeue && PARKED_LABELS.includes(l.toLowerCase())));
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}
const flag = (name) => process.argv.includes(`--${name}`);

async function main() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const projectId = arg("project");
  const issue = arg("issue");
  const lane = arg("lane");
  const owner = arg("owner");
  const bodyFile = arg("body-file");
  const requeue = flag("requeue");
  let repo = arg("repo");

  if (!token) return die(2, "GITHUB_TOKEN (or GH_TOKEN) env is required");
  if (!issue || !/^\d+$/.test(issue)) return die(1, "--issue <number> is required (positive integer)");
  if (!bodyFile) return die(1, "--body-file <path> is required — a dispatch with no stated reason is not a dispatch");
  try {
    assertLane(lane);
  } catch (e) {
    return die(1, e instanceof Error ? e.message : String(e));
  }
  // The operator lane is the one lane with no agent worker, so it is the one
  // that must name a human-visible owner too — but an owner is required on all
  // three: an unowned lane is how the old backlog looked.
  let ownerLbl;
  try {
    ownerLbl = ownerLabel(owner);
  } catch (e) {
    return die(1, `--owner <slug>: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!repo && projectId) {
    try {
      const r = projectRepo(REPO_ROOT, projectId);
      repo = `${r.owner}/${r.repo}`;
    } catch (e) {
      return die(1, e.message);
    }
  }
  if (!repo || !/^[^/]+\/[^/]+$/.test(repo)) return die(1, "--repo <owner>/<repo> (or --project <id>) is required");

  let body;
  try {
    body = readFileSync(bodyFile, "utf8");
  } catch {
    return die(1, `body-file unreadable: ${bodyFile}`);
  }
  if (body.trim().length === 0) return die(1, "body-file is empty — refusing to post an empty dispatch (W-4)");
  const mentions = findRawMentions(body);
  if (mentions.length > 0) {
    return die(1, `body contains raw GitHub @-mention(s): ${mentions.join(", ")} — reference agents as \`wf:<slug>\` (ML-012)`);
  }

  const gh = makeGh({ token, userAgent: "workforce-issue-triage" });

  let current = [];
  try {
    const r = await gh("GET", `/repos/${repo}/issues/${issue}`);
    if (r.status !== 200) return die(3, `GET issue ${issue} -> HTTP ${r.status}`);
    current = Array.isArray(r.json?.labels) ? r.json.labels.map((l) => (typeof l === "string" ? l : l?.name)) : [];
  } catch (e) {
    return die(3, e?.msg || e?.message || String(e));
  }

  const c = await gh("POST", `/repos/${repo}/issues/${issue}/comments`, { body });
  if (c.status !== 201) return die(c.status < 500 ? 2 : 3, `POST comment -> HTTP ${c.status}`);

  const meta = LANE_LABEL_META[lane];
  for (const [name, m] of [
    [laneLabel(lane), meta],
    [ownerLbl, OWNER_LABEL_META],
  ]) {
    const cr = await gh("POST", `/repos/${repo}/labels`, { name, color: m.color, description: m.description });
    if (cr.status !== 201 && cr.status !== 422) console.error(`issue-triage-post: WARN ensure label "${name}" -> HTTP ${cr.status}`);
  }
  const l = await gh("POST", `/repos/${repo}/issues/${issue}/labels`, { labels: [laneLabel(lane), ownerLbl] });
  if (l.status !== 200) console.error(`issue-triage-post: WARN could not label #${issue} -> HTTP ${l.status}`);

  for (const name of labelsToRemove(current, lane, { requeue })) {
    const d = await gh("DELETE", `/repos/${repo}/issues/${issue}/labels/${encodeURIComponent(name)}`);
    if (d.status !== 200 && d.status !== 404) console.error(`issue-triage-post: WARN could not clear "${name}" -> HTTP ${d.status}`);
  }

  console.error(`issue-triage-post: #${issue} -> lane "${lane}", owner "${owner}"${requeue ? " (re-queued)" : ""}`);
  return 0;
}

function die(code, msg) {
  console.error(`issue-triage-post: ${msg}`);
  return code;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(await main().catch((e) => die(3, e instanceof Error ? e.message : String(e))));
}
