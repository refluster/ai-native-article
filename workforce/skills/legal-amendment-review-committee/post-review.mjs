#!/usr/bin/env node
// Deterministic legal-amendment-review-committee WRITE script — the ONLY write
// this skill performs. It posts ONE `event: COMMENT` pull-request review to a
// target PR, carrying the committee's verdict (APPROVE/REJECT recommendation +
// follow-ups).
//
// W-5 / R-N9 by construction: the single fetch below targets
// `POST /repos/{owner}/{repo}/pulls/{n}/reviews` with `event: "COMMENT"`,
// HARD-CODED. There is no code path that sends APPROVE / REQUEST_CHANGES, that
// merges, pushes a branch, or opens a PR. The committee recommends; humans gate.
//
// The repo (owner/repo) is read from the in-repo project.json; the github.token
// is injected per-fire from the active project's credential bag and read here
// from GITHUB_TOKEN. The verdict body is read from a FILE so multi-line /
// Unicode prose can't be mangled by shell quoting.
//
// Usage:
//   GITHUB_TOKEN=<credentials['github.token'].token> \
//     node workforce/skills/legal-amendment-review-committee/post-review.mjs \
//       --project asp-cloud --pr 42 --body-file /tmp/larc-verdict-42.md
//
// Exit codes:
//   0  — review created (HTTP 200)
//   1  — bad args / project.json missing / body-file unreadable or empty
//   2  — endpoint rejected (auth / 4xx)
//   3  — network / unexpected error

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const GH_API = "https://api.github.com";
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

// Resolve { owner, repo } from workforce/projects/{id}/project.json:github.
function projectRepo(repoRoot, projectId) {
  const path = join(repoRoot, "workforce", "projects", projectId, "project.json");
  let json;
  try {
    json = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`project.json unreadable for project "${projectId}" at ${path}`);
  }
  const gh = json.github;
  if (!gh || typeof gh.owner !== "string" || typeof gh.repo !== "string") {
    throw new Error(`project "${projectId}" has no github.{owner,repo} — not an external git project`);
  }
  return { owner: gh.owner, repo: gh.repo };
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
  if (body.trim().length === 0) {
    die(1, "body-file is empty — refusing to post an empty committee verdict (W-4)");
  }

  let res;
  try {
    res = await fetch(`${GH_API}/repos/${owner}/${repo}/pulls/${prNumber}/reviews`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "kohuehara-workforce",
      },
      // event is COMMENT, hard-coded: a recommendation, never a merge-gating verdict.
      body: JSON.stringify({ body, event: "COMMENT" }),
    });
  } catch (e) {
    die(3, `network error: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (res.status === 200) {
    const json = await res.json().catch(() => ({}));
    console.log(`larc-post: committee verdict posted to ${owner}/${repo}#${prNumber} (review ${json.id ?? "?"})`);
    process.exit(0);
  }
  const text = await res.text().catch(() => "");
  die(res.status < 500 ? 2 : 3, `POST review → ${res.status}: ${text.slice(0, 300)}`);
}

function die(code, msg) {
  console.error(`larc-post: ${msg}`);
  process.exit(code);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => die(3, e instanceof Error ? e.message : String(e)));
}

export { projectRepo };
