#!/usr/bin/env node
// issue-triage/issue-stage-scan.mjs — the lifecycle's one READ-ONLY scan
// (adr-0046 §2). Two queues, one script:
//
//   --queue reconcile   what the backlog reconcile owes: every Proposed issue,
//                       plus Verified/Assigned issues untouched for
//                       --stale-days (default 30) and not held by an open PR.
//   --queue route       what the router owes: every Verified issue, plus every
//                       Assigned issue whose owner no executor serves on this
//                       project (the #760 shape).
//
// Candidates come back OLDEST-ACTIVITY FIRST and capped at --max; the daily
// cadence works the backlog down, not a single fire. The payload also carries
// what a decision needs that the candidate alone does not say:
//   - `index`             every open non-incident issue, title-level, so a
//                         duplicate outside the batch is still visible;
//   - `recent_merged_prs` the last 30 days, each with the issues it cites, so
//                         "a PR already did this" is checkable;
//   - `roster`            the slugs bound to issue-execute on this project
//                         (live agents-api, ADR-0007: the manifest is intent,
//                         the roster is fact) — the only owners the router may
//                         name besides `operator`;
//   - per candidate, the open PRs that reference it and its last comment
//                         (a hand-back is a Verified issue whose last comment
//                         says why the previous owner declined).
//
// Never writes to GitHub. Exit: 0 ok (0 candidates included) · 1 bad args ·
// 3 network.
//
// Usage:
//   GITHUB_TOKEN=… node workforce/skills/issue-triage/issue-stage-scan.mjs \
//     --project asp-cloud --queue reconcile [--max 15] [--stale-days 30] \
//     [--out /tmp/issue-stage-candidates.json] [--json]

import { ensureProxyAwareEntry } from "../../../scripts/lib/proxy-bootstrap.mjs";
ensureProxyAwareEntry(import.meta.url);

import { writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { projectRepo } from "../pr-autopilot/pr-autopilot-scan.mjs";
import { makeGh } from "../pr-autopilot/pr-merge.mjs";
import { DEFAULT_API_BASE } from "../../scripts/lib/request-dispatch.mjs";
import {
  DEFAULT_STALE_DAYS,
  EXECUTOR_SKILL,
  isIncident,
  issueRefsOfPr,
  ownerOf,
  reconcileAction,
  retiredLabelsIn,
  rosterFromAgents,
  routeAction,
  stageOf,
} from "./issue-stages.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");

export const QUEUES = Object.freeze(["reconcile", "route"]);
export const DEFAULT_MAX = 15;
export const MERGED_LOOKBACK_DAYS = 30;
/** Bodies are truncated in the candidate file — the cadence reads the issue on
 *  GitHub for anything longer. */
export const BODY_CHARS = 4000;
export const COMMENT_CHARS = 1500;

export const labelsOf = (i) => (Array.isArray(i?.labels) ? i.labels.map((l) => (typeof l === "string" ? l : l?.name)).filter(Boolean) : []);

/** Issue number → the open PR numbers that claim it. Throws on a failed read:
 *  a claim check against a partial PR list would release issues a live PR
 *  still holds. */
export async function collectOpenPrRefs(gh, repo) {
  const byIssue = new Map();
  for (let page = 1; page <= 5; page++) {
    const r = await gh("GET", `/repos/${repo}/pulls?state=open&per_page=100&page=${page}`);
    if (r.status !== 200 || !Array.isArray(r.json)) throw new Error(`GET open pulls -> HTTP ${r.status}`);
    for (const pr of r.json) {
      for (const n of issueRefsOfPr({ body: pr?.body, headRef: pr?.head?.ref })) {
        if (!byIssue.has(n)) byIssue.set(n, []);
        byIssue.get(n).push(pr.number);
      }
    }
    if (r.json.length < 100) break;
  }
  return byIssue;
}

/** The slugs bound to issue-execute on `projectId`, from `GET /agents`. A
 *  non-200 throws: a scan that silently reads an empty roster would route
 *  everything to the operator. */
export async function collectRoster(projectId, { apiBase = process.env.WF_AGENTS_API_BASE || DEFAULT_API_BASE, skill = EXECUTOR_SKILL } = {}) {
  const res = await fetch(`${String(apiBase).replace(/\/+$/, "")}/agents`);
  if (res.status !== 200) throw new Error(`GET /agents -> HTTP ${res.status}`);
  return rosterFromAgents(await res.json(), projectId, skill);
}

/** PRs merged in the last `days`, newest first, with the issues each cites.
 *  Fails soft to [] with a warning: losing it only weakens done-detection. */
export async function collectRecentMergedPrs(gh, repo, { days = MERGED_LOOKBACK_DAYS, now = Date.now() } = {}) {
  const since = now - days * 86400_000;
  const out = [];
  for (let page = 1; page <= 3; page++) {
    const r = await gh("GET", `/repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=100&page=${page}`);
    if (r.status !== 200 || !Array.isArray(r.json)) throw new Error(`GET closed pulls -> HTTP ${r.status}`);
    for (const pr of r.json) {
      if (!pr?.merged_at || Date.parse(pr.merged_at) < since) continue;
      out.push({ number: pr.number, title: pr.title, merged_at: pr.merged_at, refs: [...issueRefsOfPr({ body: pr?.body, headRef: pr?.head?.ref })] });
    }
    if (r.json.length < 100 || r.json.every((pr) => Date.parse(pr?.updated_at ?? 0) < since)) break;
  }
  return out.sort((a, b) => Date.parse(b.merged_at) - Date.parse(a.merged_at));
}

/** The pure decision per queue. Exported for tests. */
export function decide(queue, issue, { now, staleDays, openPrRefs, roster }) {
  const labels = labelsOf(issue);
  const base = { labels, updatedAt: issue.updated_at, number: issue.number };
  return queue === "reconcile"
    ? reconcileAction(base, { now, staleDays, openPrRefs })
    : routeAction(base, { roster, openPrRefs });
}

/** Oldest-activity first, capped. Pure + exported. */
export function selectCandidates(decided = [], { max = DEFAULT_MAX } = {}) {
  return decided
    .filter((d) => d.decision.action !== "skip")
    .sort((a, b) => Date.parse(a.updated_at) - Date.parse(b.updated_at))
    .slice(0, max);
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

async function main() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const projectId = arg("project");
  const queue = arg("queue");
  const out = arg("out");
  const asJson = process.argv.includes("--json");
  const max = Number(arg("max", String(DEFAULT_MAX)));
  const staleDays = Number(arg("stale-days", String(DEFAULT_STALE_DAYS)));
  let repo = arg("repo");

  if (!token) return die(1, "GITHUB_TOKEN (or GH_TOKEN) env is required");
  if (!QUEUES.includes(queue)) return die(1, `--queue must be one of: ${QUEUES.join(", ")}`);
  if (!repo && projectId) {
    try {
      const r = projectRepo(REPO_ROOT, projectId);
      repo = `${r.owner}/${r.repo}`;
    } catch (e) {
      return die(1, e.message);
    }
  }
  if (!repo || !/^[^/]+\/[^/]+$/.test(repo)) return die(1, "--repo <owner>/<repo> (or --project <id>) is required");
  if (!Number.isFinite(max) || max <= 0) return die(1, `--max must be positive (got ${max})`);
  if (!Number.isFinite(staleDays) || staleDays <= 0) return die(1, `--stale-days must be positive (got ${staleDays})`);

  const gh = makeGh({ token, userAgent: "workforce-issue-stage-scan" });
  const now = Date.now();

  const issues = [];
  try {
    for (let page = 1; page <= 5; page++) {
      const r = await gh("GET", `/repos/${repo}/issues?state=open&per_page=100&page=${page}&sort=created&direction=asc`);
      if (r.status !== 200 || !Array.isArray(r.json)) return die(3, `GET issues -> HTTP ${r.status}`);
      issues.push(...r.json.filter((i) => !i.pull_request)); // the endpoint returns PRs too
      if (r.json.length < 100) break;
    }
  } catch (e) {
    return die(3, e?.msg || e?.message || String(e));
  }

  let openPrRefs;
  try {
    openPrRefs = await collectOpenPrRefs(gh, repo);
  } catch (e) {
    return die(3, `could not read open PRs: ${e?.msg || e?.message || String(e)}`);
  }
  const heldSet = new Set(openPrRefs.keys());

  let roster = null;
  if (projectId) {
    try {
      roster = await collectRoster(projectId);
    } catch (e) {
      if (queue === "route") return die(3, `could not read the roster: ${e?.message || e}`);
      console.error(`issue-stage-scan: WARN roster read failed (${e?.message || e})`);
    }
  } else if (queue === "route") {
    return die(1, "--project <id> is required for --queue route (the roster is read per project)");
  }

  let recentMerged = [];
  try {
    recentMerged = await collectRecentMergedPrs(gh, repo, { now });
  } catch (e) {
    console.error(`issue-stage-scan: WARN could not read merged PRs (${e?.msg || e?.message || String(e)})`);
  }

  const decided = issues.map((i) => ({ ...i, decision: decide(queue, i, { now, staleDays, openPrRefs: heldSet, roster }) }));
  const picked = selectCandidates(decided, { max });

  const candidates = [];
  for (const i of picked) {
    const labels = labelsOf(i);
    let lastComment = null;
    if (i.comments > 0) {
      try {
        const page = Math.max(1, Math.ceil(i.comments / 100));
        const c = await gh("GET", `/repos/${repo}/issues/${i.number}/comments?per_page=100&page=${page}`);
        const last = Array.isArray(c.json) && c.json.length ? c.json[c.json.length - 1] : null;
        if (last) lastComment = { author: last.user?.login ?? null, created_at: last.created_at, body: String(last.body ?? "").slice(0, COMMENT_CHARS) };
      } catch {
        /* a missing last comment weakens the hand-back read only */
      }
    }
    candidates.push({
      number: i.number,
      title: i.title,
      html_url: i.html_url,
      created_at: i.created_at,
      updated_at: i.updated_at,
      labels,
      stage: stageOf(labels),
      owner: ownerOf(labels),
      retired_labels: retiredLabelsIn(labels),
      comments: i.comments,
      body: String(i.body ?? "").slice(0, BODY_CHARS),
      body_truncated: String(i.body ?? "").length > BODY_CHARS,
      open_prs: openPrRefs.get(i.number) ?? [],
      last_comment: lastComment,
      decision: i.decision,
    });
  }

  const index = issues
    .filter((i) => !isIncident(labelsOf(i)))
    .map((i) => ({ number: i.number, title: i.title, stage: stageOf(labelsOf(i)), owner: ownerOf(labelsOf(i)), updated_at: i.updated_at, held_by: openPrRefs.get(i.number) ?? [] }));

  const counts = { proposed: 0, verified: 0, assigned: 0, incident: 0 };
  for (const i of issues) {
    const l = labelsOf(i);
    if (isIncident(l)) counts.incident++;
    else counts[stageOf(l)]++;
  }

  const payload = {
    repo,
    project_id: projectId ?? null,
    queue,
    generated_at: new Date(now).toISOString(),
    open_issues: issues.length,
    counts,
    roster,
    executor_skill: EXECUTOR_SKILL,
    candidates,
    index,
    recent_merged_prs: recentMerged,
  };

  if (out) writeFileSync(out, JSON.stringify(payload, null, 2));
  if (asJson || !out) console.log(JSON.stringify(payload, null, 2));
  console.error(
    `issue-stage-scan: ${repo} ${queue} — ${issues.length} open (${counts.proposed} proposed, ${counts.verified} verified, ${counts.assigned} assigned, ${counts.incident} incident); ` +
      `${candidates.length} candidate(s)${roster ? `; roster: ${roster.join(", ") || "(nobody)"}` : ""}${out ? ` -> ${out}` : ""}`,
  );
  return 0;
}

function die(code, msg) {
  console.error(`issue-stage-scan: ${msg}`);
  return code;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(await main().catch((e) => die(3, e instanceof Error ? e.message : String(e))));
}
