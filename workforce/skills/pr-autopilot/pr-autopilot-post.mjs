#!/usr/bin/env node
// Deterministic pr-autopilot POST script — posts ONE routing/verdict comment to
// a PR's issue-comment thread, and (optionally) stamps escalation labels on the
// PR so a human can find the hand-off queue.
//
// R-N9 / W-5 by construction: it writes ONLY an issue comment
// (`POST /repos/{owner}/{repo}/issues/{n}/comments`) and, with --label, issue
// labels (`POST /repos/{owner}/{repo}/issues/{n}/labels`). There is no code path
// that approves, requests-changes, merges, pushes a branch, or opens a PR.
// The external git surface stays comment+label only — agents never gate merges.
//
// The repo (owner/repo) is read from the in-repo project.json; the
// github.token is injected per-fire via the (project × agent × skill)
// binding's project linkage and read here from GITHUB_TOKEN. The comment
// body is read from a FILE so multi-line / Unicode prose can't be mangled
// by shell quoting.
//
// Usage:
//   GITHUB_TOKEN=<credentials['github.token'].token> \
//     node workforce/skills/pr-autopilot/pr-autopilot-post.mjs \
//       --project asp-cloud --pr 42 --body-file /tmp/route-body-42.md \
//       [--needs-human] [--label <name>]   # see escalation rule below
//
// ESCALATION ALWAYS CARRIES THE LABEL (operator directive 2026-06-21). Any
// comment that hands a PR to a human — a 🟢 PR touching the target's governance
// L0/L1, a 🔴 verdict, a non-consensus PR, a no-delegation hand-off — MUST be
// stamped `autopilot:needs-human` so the operator finds the queue with
// `is:open label:autopilot:needs-human`. This script applies that label from
// EITHER signal, so a hand-off can never reach a human un-labelled even if one
// is forgotten:
//   - `--needs-human` flag, OR
//   - the hidden marker `<!-- autopilot:needs-human -->` embedded in the verdict
//     body (the SKILL.md escalation template carries it).
// The canonical label name is single-sourced from pr-merge.mjs (ESCALATION_LABEL),
// the same constant the engine stamps on escalation issues — one queue, one name.
//
// REVIEWED (merge-ready) hand-offs (operator directive 2026-06-23). When the
// hand-off is a 🟢 unanimous-green PR held back only by a human gate (the
// target's L0/L1 boundary, or a missing R-N10 delegation), it ALSO carries
// `autopilot:reviewed` — so the operator can tell "reviewed + merge-ready, my
// final call" apart from a 🔴 / cycle-capped / non-consensus escalation that
// still needs work. Stamped from EITHER `--reviewed` OR the hidden body marker
// `<!-- autopilot:reviewed -->`. A 🔴 / non-consensus escalation gets only
// `autopilot:needs-human`, never this.
//
// Extra `--label <name>` values (repeatable) are merged in. Routing comments
// (cycle 1) carry neither flag nor marker, so they stay unlabelled. Missing
// labels are auto-created (each with its own colour/description).
//
// Exit codes:
//   0  — comment created (HTTP 201); labels best-effort
//   1  — bad args / project.json missing / body-file unreadable
//   2  — endpoint rejected (auth/4xx)
//   3  — network / unexpected error

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { projectRepo } from "./pr-autopilot-scan.mjs";
import { ESCALATION_LABEL, REVIEWED_LABEL } from "./pr-merge.mjs";

const GH_API = "https://api.github.com";
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");

/** Per-label colour + description used when auto-creating a label the target
 *  repo lacks. Unknown labels (explicit --label values) fall back to the
 *  escalation colour. Single object so the two canonical labels never drift. */
const LABEL_META = {
  [ESCALATION_LABEL]: {
    color: "b60205", // red — "an autopilot decision needs a human"
    description: "Autopilot handed this off — a human's call (merge / governance L0/L1 / blocked).",
  },
  [REVIEWED_LABEL]: {
    color: "0e8a16", // green — "reviewed to 🟢 consensus, merge-ready"
    description: "Autopilot reviewed this to a 🟢 unanimous-green consensus; merge-ready, held only by a human gate (L0/L1 / delegation) — the operator merges.",
  },
};
const FALLBACK_LABEL_META = LABEL_META[ESCALATION_LABEL];

/** Hidden marker the SKILL.md hand-off/escalation verdict template embeds. Its
 *  presence in the comment body forces ESCALATION_LABEL even if --needs-human
 *  was omitted — the mechanical half of "escalation ALWAYS carries the label". */
export const NEEDS_HUMAN_MARKER = "<!-- autopilot:needs-human -->";

/** Hidden marker for a 🟢 merge-ready hand-off. Its presence (or --reviewed)
 *  adds REVIEWED_LABEL alongside ESCALATION_LABEL — the mechanical half of
 *  "a green, human-gated PR is flagged reviewed even if the flag is dropped". */
export const REVIEWED_MARKER = "<!-- autopilot:reviewed -->";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

function flag(name) {
  return process.argv.includes(`--${name}`);
}

/** All values passed via repeated --label flags. */
function labelArgs() {
  const out = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === "--label" && process.argv[i + 1]) out.push(process.argv[i + 1]);
  }
  return [...new Set(out)];
}

/** The label set to stamp. Exported + pure so the invariants are unit-tested,
 *  not merely documented:
 *   - any hand-off to a human carries ESCALATION_LABEL — added whenever the
 *     verdict escalates (the --needs-human flag OR the hidden body marker);
 *   - a 🟢 merge-ready hand-off ALSO carries REVIEWED_LABEL (the --reviewed
 *     flag OR the hidden reviewed marker) — and reviewed never implies escalated
 *     and vice versa; each is its own signal, on top of any explicit --label. */
export function resolveLabels(rawLabels, { needsHuman = false, reviewed = false, body = "" } = {}) {
  const out = [...rawLabels];
  if (needsHuman || body.includes(NEEDS_HUMAN_MARKER)) out.push(ESCALATION_LABEL);
  if (reviewed || body.includes(REVIEWED_MARKER)) out.push(REVIEWED_LABEL);
  return [...new Set(out)];
}

async function gh(token, method, path, body) {
  return fetch(`${GH_API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "kohuehara-workforce",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
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
    console.log(`pr-autopilot-post: posted to ${owner}/${repo}#${prNumber} (comment ${json.id ?? "?"})`);
    // Stamp escalation labels (best-effort: a label problem must not fail a
    // comment that already landed). Auto-create any label the repo lacks.
    // resolveLabels guarantees ESCALATION_LABEL whenever this comment hands the
    // PR to a human (--needs-human flag or the body marker).
    const labels = resolveLabels(labelArgs(), {
      needsHuman: flag("needs-human"),
      reviewed: flag("reviewed"),
      body,
    });
    if (labels.length > 0) {
      for (const name of labels) {
        const meta = LABEL_META[name] ?? FALLBACK_LABEL_META;
        const cr = await gh(token, "POST", `/repos/${owner}/${repo}/labels`, {
          name, color: meta.color, description: meta.description,
        }).catch(() => ({ status: 0 }));
        if (cr.status !== 201 && cr.status !== 422) {
          console.error(`pr-autopilot-post: WARN ensure label "${name}" → HTTP ${cr.status}`);
        }
      }
      const lr = await gh(token, "POST", `/repos/${owner}/${repo}/issues/${prNumber}/labels`, { labels }).catch(() => ({ status: 0 }));
      if (lr.status === 200) console.log(`pr-autopilot-post: labelled #${prNumber} [${labels.join(", ")}]`);
      else console.error(`pr-autopilot-post: WARN could not label #${prNumber} → HTTP ${lr.status}`);
    }
    process.exit(0);
  }
  const text = await res.text().catch(() => "");
  die(res.status < 500 ? 2 : 3, `POST comment → ${res.status}: ${text.slice(0, 300)}`);
}

function die(code, msg) {
  console.error(`pr-autopilot-post: ${msg}`);
  process.exit(code);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => die(3, e instanceof Error ? e.message : String(e)));
}
