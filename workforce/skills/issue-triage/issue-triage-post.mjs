#!/usr/bin/env node
// issue-triage/issue-triage-post.mjs — the dispatcher's only write surface
// (adr-0022, extended by adr-0038).
//
// Assigns one issue to one lane: posts the dispatch comment, stamps
// `wf:lane:<lane>` + `wf:owner:<slug>` (+ `wf:human:<role>` on the operator
// lane), clears the hand-back/parked labels the router has just answered, and
// — adr-0038 — asks the lane's worker to start NOW instead of at its next cron.
// Label + comment only: it never edits an issue body, never closes an issue,
// never opens a PR (the same comment+label posture as pr-autopilot-post.mjs,
// whose ML-012 @-mention guard is imported rather than re-implemented).
//
// Re-laning an issue REPLACES its lane label — an issue is in exactly one lane,
// or the "who owns this" question the whole vocabulary exists to answer has two
// answers again.
//
// Two bounds, both mechanical and both mirroring the PR half of this loop:
//   - the HOP CAP (`applyHopCap`) forces `operator` once an issue has been
//     routed HOP_CAP times, so route → hand back → route cannot ping-pong;
//   - the dispatch is best-effort (adr-0025), so a failed wake costs latency,
//     never correctness — the binding's cron remains the completeness floor.
//
// Usage:
//   GITHUB_TOKEN=… node workforce/skills/issue-triage/issue-triage-post.mjs \
//     --project agent-workforce --issue 463 --lane design --owner dario \
//     --body-file /tmp/dispatch-463.md [--human-role architect-ratify]
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
import {
  LANES,
  LANE_LABEL_PREFIX,
  LANE_WORKER_SKILL,
  HUMAN_ROLES,
  HUMAN_ROLE_LABEL_PREFIX,
  OWNER_LABEL_PREFIX,
  PARKED_LABELS,
  applyHopCap,
  assertLane,
  assertHumanRole,
  hopMarker,
  humanRoleLabel,
  laneLabel,
  ownerLabel,
  parseHops,
} from "./issue-lanes.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");

const LANE_LABEL_META = {
  implement: { color: "1d76db", description: `Dispatched: ${LANES.implement}` },
  design: { color: "5319e7", description: `Dispatched: ${LANES.design}` },
  operator: { color: "b60205", description: `Dispatched: ${LANES.operator}` },
};
const OWNER_LABEL_META = { color: "d4c5f9", description: "Assigned workforce persona (a slug, not a GitHub account — ML-012)." };
const HUMAN_LABEL_META = (role) => ({ color: "e99695", description: `Operator lane: ${HUMAN_ROLES[role]}` });

/** Labels to remove when applying `lane` (owned by `owner`) to an issue
 *  currently carrying `current`:
 *    - every OTHER lane label (one lane per issue);
 *    - every hand-back / legacy parked label — posting a lane IS the router's
 *      answer to the park, so there is no "parked AND laned" state to preserve
 *      (adr-0038; this is what retired the old `--requeue` flag, which existed
 *      only to decide whether to clear them);
 *    - any stale `wf:human:*` role when the issue is leaving the operator lane;
 *    - every OTHER `wf:owner:*` label — an issue has exactly one owner, same
 *      invariant as the lane label above (#762: a re-lane that changes the
 *      owner left both the old and the new owner label on the issue, because
 *      this function never checked `OWNER_LABEL_PREFIX` even though it was
 *      exported from issue-lanes.mjs for exactly this).
 *  Pure + exported: the "exactly one lane" invariant is unit-tested. */
export function labelsToRemove(current = [], lane, { humanRole = null, owner = null } = {}) {
  assertLane(lane);
  const keep = laneLabel(lane);
  const keepRole = lane === "operator" && humanRole ? humanRoleLabel(humanRole) : null;
  const keepOwner = owner ? ownerLabel(owner) : null;
  return current
    .map((l) => String(l || ""))
    .filter((l) => {
      const lc = l.toLowerCase();
      if (lc.startsWith(LANE_LABEL_PREFIX) && l !== keep) return true;
      if (PARKED_LABELS.includes(lc)) return true;
      if (lc.startsWith(HUMAN_ROLE_LABEL_PREFIX) && l !== keepRole) return true;
      if (lc.startsWith(OWNER_LABEL_PREFIX) && l !== keepOwner) return true;
      return false;
    });
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

async function main() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const projectId = arg("project");
  const issue = arg("issue");
  const requestedLane = arg("lane");
  const owner = arg("owner");
  const bodyFile = arg("body-file");
  const requestedRole = arg("human-role");
  let repo = arg("repo");

  if (!token) return die(2, "GITHUB_TOKEN (or GH_TOKEN) env is required");
  if (!issue || !/^\d+$/.test(issue)) return die(1, "--issue <number> is required (positive integer)");
  if (!bodyFile) return die(1, "--body-file <path> is required — a dispatch with no stated reason is not a dispatch");
  try {
    assertLane(requestedLane);
  } catch (e) {
    return die(1, e instanceof Error ? e.message : String(e));
  }
  if (requestedRole !== undefined) {
    try {
      assertHumanRole(requestedRole);
    } catch (e) {
      return die(1, e instanceof Error ? e.message : String(e));
    }
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

  // How many times has this issue already been routed? The markers live in the
  // dispatch comments, the same place the PR half keeps its remediation count.
  let priorHops = 0;
  try {
    const bodies = [];
    for (let page = 1; page <= 5; page++) {
      const r = await gh("GET", `/repos/${repo}/issues/${issue}/comments?per_page=100&page=${page}`);
      if (r.status !== 200 || !Array.isArray(r.json)) break;
      bodies.push(...r.json.map((c) => c?.body));
      if (r.json.length < 100) break;
    }
    priorHops = parseHops(bodies);
  } catch (e) {
    // Fail soft on the COUNT only: an unreadable comment list must not block a
    // dispatch, but it must not silently read as "zero hops" either.
    console.error(`issue-triage-post: WARN could not read hop history (${e?.msg || e?.message || String(e)}) — treating as ${priorHops}`);
  }

  const capped = applyHopCap(requestedLane, priorHops);
  const lane = capped.lane;
  // A capped issue lands on the operator lane; if the router did not name a
  // role for it (it was routing somewhere else), the cap itself is the reason.
  const humanRole = lane === "operator" ? (requestedRole ?? (capped.capped ? "product" : null)) : null;
  if (lane === "operator" && !humanRole) {
    return die(
      1,
      "--human-role <role> is required on the operator lane — " +
        `"a human" is not an answer to "who owns this". One of: ${Object.keys(HUMAN_ROLES).join(", ")}`,
    );
  }
  if (capped.capped) {
    console.error(`issue-triage-post: #${issue} ${capped.why} — forcing lane "operator" over requested "${requestedLane}"`);
    body =
      `${body.trimEnd()}\n\n> **Hop cap reached (${capped.hops - 1}/${capped.hops - 1}).** This issue has been routed ` +
      `${capped.hops - 1} times without resolving, so it is held on the operator lane rather than routed a ${capped.hops}th ` +
      `time. That is a finding about the lane vocabulary or the issue's scope, not a verdict on the issue (adr-0038).\n`;
  }
  body = `${body.trimEnd()}\n\n${hopMarker(capped.hops)}\n`;

  const c = await gh("POST", `/repos/${repo}/issues/${issue}/comments`, { body });
  if (c.status !== 201) return die(c.status < 500 ? 2 : 3, `POST comment -> HTTP ${c.status}`);

  const ensure = [
    [laneLabel(lane), LANE_LABEL_META[lane]],
    [ownerLbl, OWNER_LABEL_META],
  ];
  if (humanRole) ensure.push([humanRoleLabel(humanRole), HUMAN_LABEL_META(humanRole)]);
  for (const [name, m] of ensure) {
    const cr = await gh("POST", `/repos/${repo}/labels`, { name, color: m.color, description: m.description });
    if (cr.status !== 201 && cr.status !== 422) console.error(`issue-triage-post: WARN ensure label "${name}" -> HTTP ${cr.status}`);
  }
  const l = await gh("POST", `/repos/${repo}/issues/${issue}/labels`, { labels: ensure.map(([name]) => name) });
  if (l.status !== 200) console.error(`issue-triage-post: WARN could not label #${issue} -> HTTP ${l.status}`);

  for (const name of labelsToRemove(current, lane, { humanRole, owner })) {
    const d = await gh("DELETE", `/repos/${repo}/issues/${issue}/labels/${encodeURIComponent(name)}`);
    if (d.status !== 200 && d.status !== 404) console.error(`issue-triage-post: WARN could not clear "${name}" -> HTTP ${d.status}`);
  }

  console.error(
    `issue-triage-post: #${issue} -> lane "${lane}", owner "${owner}"${humanRole ? `, human "${humanRole}"` : ""} (hop ${capped.hops})`,
  );

  // adr-0038 — the hand-off is an event (adr-0025's mechanism, intake side).
  // The lane label above is the load-bearing write; this only decides whether
  // the worker starts in seconds or at its next cron. Best-effort by
  // construction: `requestDispatch` never throws and its result is not
  // consulted. The operator lane has no cadence to wake.
  const workerSkill = LANE_WORKER_SKILL[lane];
  if (workerSkill && projectId) {
    const { requestDispatch } = await import("../../scripts/lib/request-dispatch.mjs");
    await requestDispatch({
      skill: workerSkill,
      project_id: projectId,
      reason: `issue #${issue} dispatched to lane ${lane} on ${repo} — work it at cycle N+1`,
    }).catch((e) => console.error(`issue-triage-post: WARN worker dispatch failed (${e?.message || e})`));
  } else if (workerSkill && !projectId) {
    console.error(`issue-triage-post: --project not given — ${workerSkill} will start on its own cron, not now`);
  }

  return 0;
}

function die(code, msg) {
  console.error(`issue-triage-post: ${msg}`);
  return code;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(await main().catch((e) => die(3, e instanceof Error ? e.message : String(e))));
}
