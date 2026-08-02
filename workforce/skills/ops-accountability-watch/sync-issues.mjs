#!/usr/bin/env node
// ops-accountability-watch/sync-issues.mjs — Step 2 of the Cadence pipeline.
// Idempotent open-or-update against the persistent ledger (a GitHub Issue
// per finding): searches open issues by exact title, comments on a match,
// opens a new issue otherwise, and creates any missing label first. This
// script — not the LLM session — owns the write (the I3 Cadence invariant).
//
// Usage:
//   GITHUB_TOKEN=<credentials['github.token'].token> \
//     node sync-issues.mjs --repo refluster/ai-native-article --findings-file /tmp/findings.json
//
// Prints a JSON array of IssueLink to stdout.
// Exit codes: 0 done (see JSON per-item for created/updated), 1 bad args/env,
// 2 GitHub API rejected a request, 3 network error.

import "../../../scripts/lib/proxy-bootstrap.mjs";

import { readFileSync } from "node:fs";
import { buildIssueSpec } from "./payload.mjs";

const GITHUB_API = process.env.GITHUB_API_URL ?? "https://api.github.com";

// Fallback label defaults — primary source of truth is .github/labels.json +
// scripts/sync-labels.mjs; this is only a first-run safety net so a fresh
// repo (or one where sync-labels hasn't run yet) doesn't 422 on issue create.
const LABEL_DEFAULTS = {
  "type:ops": { color: "006B75", description: "Operational: post-deploy verification, observation window, Status flip." },
  "layer:L3": { color: "2EA043", description: "Operational: runbook, skill SKILL.md, post-deploy verification, scripts/." },
  "project:workforce": { color: "5319E7", description: "Workforce subsystem (workforce.kohuehara.xyz). Mandatory project axis." },
  "project:article": { color: "1D76DB", description: "Article pipeline (kohuehara.xyz blog). Mandatory project axis." },
};
// owner:<slug> labels all share one hue (an identity marker, not a severity
// gradient) — see docs/issue-labeling.md's owner: family entry.
const OWNER_LABEL_COLOR = "C2185B";
const OWNER_LABEL_DESC = (slug) =>
  `Accountable owner for an ops-accountability-watch finding: ${slug}. Machine-created; format owner:<slug>.`;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--repo") args.repo = argv[++i];
    else if (a === "--findings-file") args.findingsFile = argv[++i];
  }
  return args;
}

function fail(code, message) {
  console.error(`sync-issues.mjs: ${message}`);
  process.exit(code);
}

function authHeaders(token) {
  return {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "content-type": "application/json",
  };
}

async function ghFetch(url, token, init) {
  const res = await fetch(url, { ...init, headers: { ...authHeaders(token), ...(init?.headers ?? {}) } });
  return res;
}

async function ensureLabelExists(repo, token, label) {
  const check = await ghFetch(`${GITHUB_API}/repos/${repo}/labels/${encodeURIComponent(label)}`, token);
  if (check.status === 200) return;
  if (check.status !== 404) {
    throw new Error(`label lookup for "${label}" failed: HTTP ${check.status}`);
  }
  const isOwnerLabel = label.startsWith("owner:");
  const meta = isOwnerLabel
    ? { color: OWNER_LABEL_COLOR, description: OWNER_LABEL_DESC(label.slice("owner:".length)) }
    : (LABEL_DEFAULTS[label] ?? { color: "EEEEEE", description: "Auto-created by ops-accountability-watch." });
  const create = await ghFetch(`${GITHUB_API}/repos/${repo}/labels`, token, {
    method: "POST",
    body: JSON.stringify({ name: label, color: meta.color, description: meta.description }),
  });
  if (create.status !== 201 && create.status !== 422) {
    // 422 here means a race created it between our GET and POST — fine, not a failure.
    throw new Error(`label create for "${label}" failed: HTTP ${create.status}`);
  }
}

async function findOpenIssueByTitle(repo, token, title) {
  // Client-side exact-title match over open issues, rather than the search
  // API — avoids query-escaping edge cases for titles with `"`/`[`/`]`, and
  // this Cadence's issue volume is small enough that a full open-issue scan
  // is cheap.
  let page = 1;
  while (page <= 5) {
    const res = await ghFetch(`${GITHUB_API}/repos/${repo}/issues?state=open&per_page=100&page=${page}`, token);
    if (!res.ok) throw new Error(`list open issues failed: HTTP ${res.status}`);
    const issues = await res.json();
    const match = issues.find((i) => !i.pull_request && i.title === title);
    if (match) return match;
    if (issues.length < 100) return null;
    page++;
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.repo) fail(1, "--repo owner/name is required");
  if (!args.findingsFile) fail(1, "--findings-file is required");
  const token = process.env.GITHUB_TOKEN;
  if (!token) fail(1, "GITHUB_TOKEN env var is required");

  let findings;
  try {
    const parsed = JSON.parse(readFileSync(args.findingsFile, "utf8"));
    findings = parsed.findings ?? parsed; // accept either the full collect.mjs envelope or a bare array
  } catch (err) {
    fail(1, `could not read/parse --findings-file: ${err.message}`);
  }

  const links = [];
  try {
    for (const finding of findings) {
      const spec = buildIssueSpec(finding);
      for (const label of spec.labels) {
        await ensureLabelExists(args.repo, token, label);
      }
      const existing = await findOpenIssueByTitle(args.repo, token, spec.title);
      if (existing) {
        const commentRes = await ghFetch(`${GITHUB_API}/repos/${args.repo}/issues/${existing.number}/comments`, token, {
          method: "POST",
          body: JSON.stringify({
            body: `**Updated by ops-accountability-watch — ${new Date().toISOString()}**\n\n${spec.body}`,
          }),
        });
        if (!commentRes.ok) throw new Error(`comment on #${existing.number} failed: HTTP ${commentRes.status}`);
        const mergedLabels = Array.from(new Set([...(existing.labels ?? []).map((l) => l.name ?? l), ...spec.labels]));
        const relabelRes = await ghFetch(`${GITHUB_API}/repos/${args.repo}/issues/${existing.number}`, token, {
          method: "PATCH",
          body: JSON.stringify({ labels: mergedLabels }),
        });
        if (!relabelRes.ok) throw new Error(`relabel #${existing.number} failed: HTTP ${relabelRes.status}`);
        links.push({ key: spec.key, url: existing.html_url, action: "updated", owner: spec.owner, title: spec.title });
      } else {
        const createRes = await ghFetch(`${GITHUB_API}/repos/${args.repo}/issues`, token, {
          method: "POST",
          body: JSON.stringify({ title: spec.title, body: spec.body, labels: spec.labels }),
        });
        if (!createRes.ok) throw new Error(`create issue failed: HTTP ${createRes.status}`);
        const created = await createRes.json();
        links.push({ key: spec.key, url: created.html_url, action: "created", owner: spec.owner, title: spec.title });
      }
    }
  } catch (err) {
    console.error(`sync-issues.mjs: ${err.message}`);
    process.exit(err.message?.includes("HTTP 4") || err.message?.includes("HTTP 5") ? 2 : 3);
  }

  console.log(JSON.stringify(links, null, 2));
  process.exit(0);
}

main();
