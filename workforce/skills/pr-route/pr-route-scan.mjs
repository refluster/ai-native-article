#!/usr/bin/env node
// Deterministic pr-route SCAN script — GET-only discovery for the CCR
// cron-poll routing leg (ADR-0005). The CCR session runs this first to
// learn WHICH open PRs in the bound project's repo still need a cycle-1
// routing comment; it then applies the persona's nomination_rules (its
// judgment) and posts each routing comment via pr-route-post.mjs.
//
// This script performs NO writes — it only issues GitHub GETs:
//   - list open PRs in the project repo
//   - read each PR's issue comments (to skip already-routed PRs)
//   - read each candidate PR's unified diff
// The (project × agent × skill) binding supplies project_id; the
// project linkage supplies the github.token (injected as GITHUB_TOKEN).
// The repo (owner/repo) is read from the in-repo project.json — the CCR
// session runs inside the workforce checkout.
//
// Usage:
//   GITHUB_TOKEN=<credentials['github.token'].token> \
//     node workforce/skills/pr-route/pr-route-scan.mjs \
//       --project asp-cloud --persona nadia \
//       [--max 3] [--since-days 7] [--out /tmp/pr-route-candidates.json]
//
// Output: writes a JSON array of candidate PRs to --out and prints a
// one-line summary to stdout. Exit 0 even when zero candidates (a valid
// "nothing to route this tick" outcome — the session then does nothing).
//
// Exit codes:
//   0  — scan completed (candidates written; may be an empty array)
//   1  — bad args / project.json missing or has no github.{owner,repo}
//   2  — GitHub auth/4xx (token missing or lacks repo read)
//   3  — network / unexpected error

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const GH_API = "https://api.github.com";
const MAX_DIFF_CHARS = 48_000; // ~12K tokens; protects the CCR context budget
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", ".."); // workforce/skills/pr-route → repo root

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

/** Resolve the project's GitHub surface from the in-repo project.json. */
export function projectRepo(repoRoot, projectId) {
  const path = join(repoRoot, "workforce", "projects", projectId, "project.json");
  let json;
  try {
    json = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`pr-route-scan: project.json not found for "${projectId}" at ${path}`);
  }
  if (!json.github || !json.github.owner || !json.github.repo) {
    throw new Error(
      `pr-route-scan: project "${projectId}" declares no github.{owner,repo} — pr-route needs an external project repo`,
    );
  }
  return { owner: json.github.owner, repo: json.github.repo };
}

/** A PR has already been routed (this cycle leg) if a comment from this
 *  persona opens with the router-comment marker. Mirrors the marker that
 *  pr-route-post writes via the SKILL.md comment template. */
export function alreadyRouted(comments, personaSlug) {
  const personaName = personaSlug.charAt(0).toUpperCase() + personaSlug.slice(1);
  const marker = new RegExp(`^\\*\\*${personaName} — cycle \\d+ of `, "m");
  return comments.some((c) => marker.test(c.body ?? ""));
}

/** Recency gate: only route PRs updated within the window (avoids
 *  mass-commenting a stale backlog on first cron tick). */
export function withinWindow(updatedAt, sinceDays, now = Date.now()) {
  const t = Date.parse(updatedAt);
  if (Number.isNaN(t)) return false;
  return now - t <= sinceDays * 24 * 60 * 60 * 1000;
}

async function ghGet(token, path, accept) {
  const res = await fetch(`${GH_API}${path}`, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: accept ?? "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "kohuehara-workforce",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`GitHub GET ${path} → ${res.status}: ${body.slice(0, 300)}`);
    err.httpStatus = res.status;
    throw err;
  }
  return accept?.includes("vnd.github.v3.diff") ? res.text() : res.json();
}

async function main() {
  const projectId = arg("project");
  const persona = arg("persona");
  const max = Number(arg("max", "3"));
  const sinceDays = Number(arg("since-days", "7"));
  const out = arg("out", "/tmp/pr-route-candidates.json");
  const token = process.env.GITHUB_TOKEN;

  if (!projectId) die(1, "--project <id> is required");
  if (!persona) die(1, "--persona <agent-slug> is required (the routing persona)");
  if (!token) die(2, "GITHUB_TOKEN env is required (from credentials['github.token'].token)");
  if (!Number.isInteger(max) || max < 1) die(1, `--max must be a positive integer (got ${max})`);

  let owner, repo;
  try {
    ({ owner, repo } = projectRepo(REPO_ROOT, projectId));
  } catch (e) {
    die(1, e.message);
  }

  // List open, non-draft PRs, most-recently-updated first.
  let prs;
  try {
    prs = await ghGet(token, `/repos/${owner}/${repo}/pulls?state=open&sort=updated&direction=desc&per_page=50`);
  } catch (e) {
    die(e.httpStatus && e.httpStatus < 500 ? 2 : 3, e.message);
  }

  const candidates = [];
  for (const pr of prs) {
    if (candidates.length >= max) break;
    if (pr.draft) continue;
    if (!withinWindow(pr.updated_at, sinceDays)) continue;
    let comments;
    try {
      comments = await ghGet(token, `/repos/${owner}/${repo}/issues/${pr.number}/comments?per_page=100`);
    } catch (e) {
      die(e.httpStatus && e.httpStatus < 500 ? 2 : 3, e.message);
    }
    if (alreadyRouted(comments, persona)) continue;

    let diff;
    try {
      diff = await ghGet(token, `/repos/${owner}/${repo}/pulls/${pr.number}`, "application/vnd.github.v3.diff");
    } catch (e) {
      die(e.httpStatus && e.httpStatus < 500 ? 2 : 3, e.message);
    }
    if (diff.length > MAX_DIFF_CHARS) {
      diff = diff.slice(0, MAX_DIFF_CHARS) + `\n\n... [diff truncated at ${MAX_DIFF_CHARS} chars] ...\n`;
    }
    candidates.push({
      number: pr.number,
      title: pr.title,
      body: pr.body ?? "",
      author: pr.user?.login ?? "(unknown)",
      base: pr.base?.ref ?? "",
      head: pr.head?.ref ?? "",
      html_url: pr.html_url,
      updated_at: pr.updated_at,
      comments: comments
        .slice(0, 30)
        .map((c) => ({ author: c.user?.login ?? "(unknown)", body: (c.body ?? "").slice(0, 240).replace(/\n+/g, " ") })),
      diff,
    });
  }

  writeFileSync(out, JSON.stringify({ project_id: projectId, owner, repo, persona, candidates }, null, 2));
  console.log(
    `pr-route-scan: ${owner}/${repo} — ${candidates.length} candidate PR(s) need cycle-1 routing (scanned ${prs.length} open, max ${max}, window ${sinceDays}d) → ${out}`,
  );
  process.exit(0);
}

function die(code, msg) {
  console.error(`pr-route-scan: ${msg}`);
  process.exit(code);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => die(3, e instanceof Error ? e.message : String(e)));
}
