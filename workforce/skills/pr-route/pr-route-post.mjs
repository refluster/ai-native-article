#!/usr/bin/env node
// Deterministic pr-route POST script — the ONLY write the pr-route skill
// performs. It posts ONE routing comment to a PR's issue-comment thread.
//
// R-N9 / W-5 by construction: the single fetch below targets
// `POST /repos/{owner}/{repo}/issues/{n}/comments`. There is no code path
// that approves, requests-changes, merges, pushes a branch, or opens a PR.
// The external git surface is comment-only — agents never gate merges.
//
// The repo (owner/repo) is read from the in-repo project.json; the
// github.token is injected per-fire via the (project × agent × skill)
// binding's project linkage and read here from GITHUB_TOKEN. The comment
// body is read from a FILE so multi-line / Unicode prose can't be mangled
// by shell quoting.
//
// Usage:
//   GITHUB_TOKEN=<credentials['github.token'].token> \
//     node workforce/skills/pr-route/pr-route-post.mjs \
//       --project asp-cloud --pr 42 --body-file /tmp/route-body-42.md
//
// Exit codes:
//   0  — comment created (HTTP 201)
//   1  — bad args / project.json missing / body-file unreadable
//   2  — endpoint rejected (auth/4xx)
//   3  — network / unexpected error

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { projectRepo } from "./pr-route-scan.mjs";

const GH_API = "https://api.github.com";
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

async function main() {
  const projectId = arg("project");
  const prNumber = arg("pr");
  const bodyFile = arg("body-file");
  const token = process.env.GITHUB_TOKEN;

  if (!projectId) die(1, "--project <id> is required");
  if (!prNumber || !/^\d+$/.test(prNumber)) die(1, "--pr <number> is required (positive integer)");
  if (!bodyFile) die(1, "--body-file <path> is required");
  if (!token) die(2, "GITHUB_TOKEN env is required (from credentials['github.token'].token)");

  let owner, repo, body;
  try {
    ({ owner, repo } = projectRepo(REPO_ROOT, projectId));
  } catch (e) {
    die(1, e.message);
  }
  try {
    body = readFileSync(bodyFile, "utf8");
  } catch {
    die(1, `body-file unreadable: ${bodyFile}`);
  }
  if (body.trim().length === 0) die(1, "body-file is empty — refusing to post an empty routing comment (W-4)");

  let res;
  try {
    res = await fetch(`${GH_API}/repos/${owner}/${repo}/issues/${prNumber}/comments`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "kohuehara-workforce",
      },
      body: JSON.stringify({ body }),
    });
  } catch (e) {
    die(3, `network error: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (res.status === 201) {
    const json = await res.json().catch(() => ({}));
    console.log(`pr-route-post: routed ${owner}/${repo}#${prNumber} (comment ${json.id ?? "?"})`);
    process.exit(0);
  }
  const text = await res.text().catch(() => "");
  die(res.status < 500 ? 2 : 3, `POST comment → ${res.status}: ${text.slice(0, 300)}`);
}

function die(code, msg) {
  console.error(`pr-route-post: ${msg}`);
  process.exit(code);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => die(3, e instanceof Error ? e.message : String(e)));
}
