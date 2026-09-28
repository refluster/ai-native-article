#!/usr/bin/env node
// issue-triage/issue-triage-scan.mjs — deterministic, read-only discovery of
// untriaged and stale-parked issues (adr-0022).
//
// Lists every open issue in the target repo, applies the pure `triageAction`
// decision, and writes the ones needing a router decision (`triage` /
// `requeue`) to a JSON file with each issue's labels, body, and a heuristic
// lane suggestion. The router (the session) reads the issue and decides; this
// script never writes to GitHub.
//
// Usage:
//   GITHUB_TOKEN=… node workforce/skills/issue-triage/issue-triage-scan.mjs \
//     --project agent-workforce [--repo owner/repo] [--max 10] \
//     [--requeue-days 14] [--out /tmp/issue-triage-candidates.json] [--json]
//
// Exit codes: 0 ok (0 candidates included) · 1 bad args · 3 network.

import { ensureProxyAwareEntry } from "../../../scripts/lib/proxy-bootstrap.mjs"
ensureProxyAwareEntry(import.meta.url)

import { writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { projectRepo } from "../pr-autopilot/pr-autopilot-scan.mjs";
import { makeGh } from "../pr-autopilot/pr-merge.mjs";
import { DEFAULT_API_BASE } from "../../scripts/lib/request-dispatch.mjs";
import {
  DEFAULT_REQUEUE_DAYS,
  LANE_WORKER_SKILL,
  issueRefsOfPr,
  laneOf,
  ownerOf,
  suggestLane,
  triageAction,
} from "./issue-lanes.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");

export const DEFAULT_MAX = 10;
/** Bodies are truncated in the candidate file — the router reads the issue on
 *  GitHub for anything longer. Keeps a 35-issue backlog inside one prompt. */
export const BODY_CHARS = 4000;

/**
 * Issue number → the open PR numbers that claim it (closing keyword, `Refs`,
 * or an `issue-<N>` head branch). This is what turns a claim label from an
 * assertion into a checkable fact (issue-lanes.mjs, "A claim is only as good
 * as the PR behind it"). Throws on a failed read: a claim check run against a
 * partial PR list would release issues a live PR still holds.
 */
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

/**
 * Lane → the agent slugs bound to that lane's worker skill on `projectId`,
 * read from the public agents-api (bindings are DDB config, ADR-0007 — the
 * git manifest is intent, the roster is fact). Only the slugs that actually
 * appear as owners are looked up. A 404 slug is bound to nothing; any other
 * non-200 throws, and both callers then skip the owner check rather than
 * guess.
 */
export async function collectWorkerOwners(slugs, projectId, { apiBase = process.env.WF_AGENTS_API_BASE || DEFAULT_API_BASE } = {}) {
  const lanes = Object.entries(LANE_WORKER_SKILL).filter(([, skill]) => skill);
  const out = Object.fromEntries(lanes.map(([lane]) => [lane, []]));
  for (const slug of new Set(slugs)) {
    const res = await fetch(`${String(apiBase).replace(/\/+$/, "")}/agents/${encodeURIComponent(slug)}`);
    if (res.status === 404) continue; // not an agent at all: bound to nothing
    if (res.status !== 200) throw new Error(`GET /agents/${slug} -> HTTP ${res.status}`);
    const agent = await res.json();
    for (const [lane, skill] of lanes) {
      const bound = (agent?.bindings ?? []).some((b) => b?.skill === skill && b?.project_id === projectId);
      if (bound) out[lane].push(slug);
    }
  }
  return out;
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

async function main() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const projectId = arg("project");
  const out = arg("out");
  const asJson = process.argv.includes("--json");
  const max = Number(arg("max", String(DEFAULT_MAX)));
  const requeueDays = Number(arg("requeue-days", String(DEFAULT_REQUEUE_DAYS)));
  let repo = arg("repo");

  if (!token) return die(1, "GITHUB_TOKEN (or GH_TOKEN) env is required");
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
  if (!Number.isFinite(requeueDays) || requeueDays <= 0) return die(1, `--requeue-days must be positive (got ${requeueDays})`);

  const gh = makeGh({ token, userAgent: "workforce-issue-triage" });

  const issues = [];
  try {
    for (let page = 1; page <= 5; page++) {
      const r = await gh("GET", `/repos/${repo}/issues?state=open&per_page=100&page=${page}&sort=created&direction=asc`);
      if (r.status !== 200 || !Array.isArray(r.json)) return die(3, `GET issues -> HTTP ${r.status}`);
      // The issues endpoint returns PRs too; a PR is not a tracker item.
      issues.push(...r.json.filter((i) => !i.pull_request));
      if (r.json.length < 100) break;
    }
  } catch (e) {
    return die(3, e?.msg || e?.message || String(e));
  }

  const labelsOf = (i) => (Array.isArray(i.labels) ? i.labels.map((l) => (typeof l === "string" ? l : l?.name)) : []);

  let prRefs;
  try {
    prRefs = await collectOpenPrRefs(gh, repo);
  } catch (e) {
    return die(3, e?.msg || e?.message || String(e));
  }
  const openPrRefs = new Set(prRefs.keys());

  // Owner check: fail SOFT. The roster read is what makes "owner has no worker
  // binding" visible; losing it must not stop the router from answering
  // hand-backs, so an unreachable API skips that one check and says so.
  let workerOwners;
  if (projectId) {
    const owners = issues
      .map((i) => labelsOf(i))
      .filter((ls) => LANE_WORKER_SKILL[laneOf(ls) ?? "operator"])
      .map((ls) => ownerOf(ls))
      .filter(Boolean);
    try {
      workerOwners = await collectWorkerOwners(owners, projectId);
    } catch (e) {
      console.error(`issue-triage-scan: WARN roster read failed (${e?.message || e}) — owner/worker check skipped this run`);
    }
  }

  const decided = issues.map((i) => {
    const labels = labelsOf(i);
    return {
      number: i.number,
      title: i.title,
      url: i.html_url,
      updated_at: i.updated_at,
      created_at: i.created_at,
      assignees: Array.isArray(i.assignees) ? i.assignees.map((a) => a?.login) : [],
      labels,
      open_prs: prRefs.get(i.number) ?? [],
      body: String(i.body || "").slice(0, BODY_CHARS),
      decision: triageAction(
        { labels, updatedAt: i.updated_at, number: i.number },
        { requeueDays, openPrRefs, workerOwners },
      ),
      lane_suggestion: suggestLane({ labels }),
    };
  });

  // Oldest first: the whole point is that the aged tail stopped being looked at.
  const candidates = decided
    .filter((d) => d.decision.action !== "skip")
    .sort((a, b) => Date.parse(a.updated_at) - Date.parse(b.updated_at))
    .slice(0, max);

  const payload = {
    repo,
    open_issues: decided.length,
    untriaged: decided.filter((d) => d.decision.action === "triage").length,
    requeue: decided.filter((d) => d.decision.action === "requeue").length,
    worker_owners: workerOwners ?? null,
    candidates,
  };
  if (out) {
    writeFileSync(out, JSON.stringify(payload, null, 2));
    console.error(`issue-triage-scan: ${payload.open_issues} open · ${payload.untriaged} untriaged · ${payload.requeue} to re-examine -> ${out} (capped at ${max})`);
  }
  if (asJson || !out) console.log(JSON.stringify(payload, null, 2));
  return 0;
}

function die(code, msg) {
  console.error(`issue-triage-scan: ${msg}`);
  return code;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(await main().catch((e) => die(3, e instanceof Error ? e.message : String(e))));
}
