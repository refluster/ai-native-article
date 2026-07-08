#!/usr/bin/env node
// Deterministic pr-autopilot SCAN script — GET-only discovery for the CCR
// cron-poll routing leg (ADR-0005). The CCR session runs this first to
// learn WHICH open PRs in the bound project's repo still need a cycle-1
// routing comment; it then applies the persona's nomination_rules (its
// judgment) and posts each routing comment via pr-autopilot-post.mjs.
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
// Discovery includes BOTH draft and non-draft PRs, and BOTH human- and
// bot-authored (Dependabot) PRs — every open PR in the window is routable
// (2026-06-17 Autopilot widening, adr-0010). The only discovery filters are
// the recency window and "already routed this cycle".
//
// NOMINATION LOAD CAP (Epic-019 Story 2b — fairness + W-3). Auto-nomination
// must not degenerate into "the same 3 reviewers on everything": a persona
// may hold at most NOMINATION_SEAT_CAP concurrent OPEN lens-review seats,
// computed mechanically from the `wf:<slug>` nomination markers in routing
// comments on open, non-terminal PRs. The scan emits `open_seat_counts` (and
// `capped_personas`) in its output; the routing persona runs its candidate
// panel through applyNominationCap() and seats only the eligible remainder.
// When the cap leaves no seatable ≥3 panel, the PR escalates with reason
// `cannot-seat-panel` (taxonomy v1 — an existing code, new emission site).
//
// Usage:
//   GITHUB_TOKEN=<credentials['github.token'].token> \
//     node workforce/skills/pr-autopilot/pr-autopilot-scan.mjs \
//       --project asp-cloud --persona nadia \
//       [--max 5] [--since-days 7] [--out /tmp/pr-autopilot-candidates.json]
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
import { ESCALATION_LABEL, MIN_REVIEWERS } from "./pr-merge.mjs";
import { assertReasonCode } from "./escalation-reasons.mjs";

const GH_API = "https://api.github.com";
const MAX_DIFF_CHARS = 48_000; // ~12K tokens; protects the CCR context budget
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", ".."); // workforce/skills/pr-autopilot → repo root

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
    throw new Error(`pr-autopilot-scan: project.json not found for "${projectId}" at ${path}`);
  }
  if (!json.github || !json.github.owner || !json.github.repo) {
    throw new Error(
      `pr-autopilot-scan: project "${projectId}" declares no github.{owner,repo} — pr-autopilot needs an external project repo`,
    );
  }
  return { owner: json.github.owner, repo: json.github.repo };
}

/** A PR has already been routed (this cycle leg) if a comment from this
 *  persona opens with the router-comment marker. Mirrors the marker that
 *  pr-autopilot-post writes via the SKILL.md comment template. */
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

// ── Nomination load cap (Epic-019 Story 2b) ─────────────────────────────────

/** Max concurrent open lens-review seats one persona may hold. Operator knob:
 *  raising it widens per-persona load; the panel floor (MIN_REVIEWERS) is the
 *  merge engine's, never this. */
export const NOMINATION_SEAT_CAP = 5;

// A nomination SEAT is the routing-comment bullet from the SKILL.md Step 2
// template: `- **`wf:<persona>`** — <rationale>`. Skip-lines ("Skipping
// `wf:x` — …"), review sign-offs, and green markers never match.
const NOMINATION_BULLET_RE = /^\s*[-*]\s+\*\*`wf:([a-z][a-z0-9-]*)`\*\*/gmu;

/** Pure seat counter. Given every OPEN PR's { labels, bodies } (issue-comment
 *  bodies — routing comments live there), return { slug → open seat count }.
 *  A persona holds ONE seat per open PR that nominates it (a cycle-2 re-route
 *  is the same seat, not a second one). Terminal/paused PRs release their
 *  seats: `autopilot:needs-human` (escalated — the human's queue now) and
 *  `autopilot:off` (maintainer pause) are skipped; merged/closed PRs are not
 *  in the open list at all. */
export function countOpenSeats(openPrs) {
  const counts = {};
  for (const pr of openPrs ?? []) {
    const names = (pr.labels ?? []).map((l) => String(l || "").toLowerCase());
    if (names.includes(ESCALATION_LABEL) || names.includes("autopilot:off")) continue;
    const seated = new Set();
    for (const b of pr.bodies ?? []) {
      const re = new RegExp(NOMINATION_BULLET_RE.source, "gmu");
      let m;
      while ((m = re.exec(String(b ?? ""))) !== null) seated.add(m[1].toLowerCase());
    }
    for (const slug of seated) counts[slug] = (counts[slug] ?? 0) + 1;
  }
  return counts;
}

/** Pure cap filter — the mechanical half of the Step 2 routing contract.
 *  Given the persona's candidate reviewer slugs (preference-ordered), the
 *  open seat counts (countOpenSeats), and the cap, return:
 *    - eligible:   candidates still under the cap (order preserved, de-duped,
 *                  case-folded) — seat the panel from these;
 *    - overCap:    [{ slug, openSeats }] the cap excluded — the router picks
 *                  another eligible persona instead;
 *    - canSeatPanel: eligible.length >= MIN_REVIEWERS (the merge engine's
 *                  panel floor);
 *    - escalateWith: null, or "cannot-seat-panel" (taxonomy v1) when no ≥3
 *                  panel can be seated under the cap.
 *  Throws (C-4) on a non-positive/non-integer cap or a non-array candidate
 *  list — a misconfigured cap must never silently un-cap. */
export function applyNominationCap(candidates, openSeatCounts = {}, cap = NOMINATION_SEAT_CAP) {
  if (!Number.isInteger(cap) || cap < 1) {
    throw new Error(`applyNominationCap: cap must be a positive integer (got ${cap}) — a broken cap never silently un-caps (C-4)`);
  }
  if (!Array.isArray(candidates)) {
    throw new Error("applyNominationCap: candidates must be an array of persona slugs (C-4)");
  }
  const seen = new Set();
  const eligible = [];
  const overCap = [];
  for (const raw of candidates) {
    const slug = String(raw ?? "").trim().toLowerCase();
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    const openSeats = Number(openSeatCounts[slug] ?? 0);
    if (openSeats >= cap) overCap.push({ slug, openSeats });
    else eligible.push(slug);
  }
  const canSeatPanel = eligible.length >= MIN_REVIEWERS;
  return {
    eligible,
    overCap,
    canSeatPanel,
    escalateWith: canSeatPanel ? null : assertReasonCode("cannot-seat-panel"),
  };
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
  const max = Number(arg("max", "5"));
  const sinceDays = Number(arg("since-days", "7"));
  const out = arg("out", "/tmp/pr-autopilot-candidates.json");
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

  // List ALL open PRs (draft + non-draft, human + bot), most-recently-updated
  // first. Draft/bot are no longer discovery filters (adr-0010).
  let prs;
  try {
    prs = await ghGet(token, `/repos/${owner}/${repo}/pulls?state=open&sort=updated&direction=desc&per_page=50`);
  } catch (e) {
    die(e.httpStatus && e.httpStatus < 500 ? 2 : 3, e.message);
  }

  // Nomination load cap (Epic-019 Story 2b): seat counts span EVERY open PR's
  // routing comments, not just this tick's candidates — so fetch each open
  // PR's comments once, up front, and reuse them for the already-routed check.
  const commentsByPr = new Map();
  for (const pr of prs) {
    try {
      commentsByPr.set(pr.number, await ghGet(token, `/repos/${owner}/${repo}/issues/${pr.number}/comments?per_page=100`));
    } catch (e) {
      die(e.httpStatus && e.httpStatus < 500 ? 2 : 3, e.message);
    }
  }
  const openSeatCounts = countOpenSeats(
    prs.map((pr) => ({
      labels: Array.isArray(pr.labels) ? pr.labels.map((l) => l?.name) : [],
      bodies: (commentsByPr.get(pr.number) ?? []).map((c) => c.body),
    })),
  );
  const cappedPersonas = Object.entries(openSeatCounts)
    .filter(([, n]) => n >= NOMINATION_SEAT_CAP)
    .map(([slug]) => slug)
    .sort();

  const candidates = [];
  for (const pr of prs) {
    if (candidates.length >= max) break;
    // Draft and bot-authored PRs are IN scope (adr-0010): drafts get an early
    // review pass, and Dependabot PRs route through the same review→consensus
    // →merge path as human PRs (the dependabot-triage no-review lane retires).
    if (!withinWindow(pr.updated_at, sinceDays)) continue;
    const comments = commentsByPr.get(pr.number) ?? [];
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
      draft: pr.draft === true,
      is_bot: pr.user?.type === "Bot" || /\[bot\]$/.test(pr.user?.login ?? ""),
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

  writeFileSync(
    out,
    JSON.stringify(
      {
        project_id: projectId,
        owner,
        repo,
        persona,
        // Epic-019 Story 2b: the routing persona filters its panel through
        // applyNominationCap(candidates, open_seat_counts) — capped_personas
        // (seats >= nomination_cap) are not nominatable this tick.
        nomination_cap: NOMINATION_SEAT_CAP,
        open_seat_counts: openSeatCounts,
        capped_personas: cappedPersonas,
        candidates,
      },
      null,
      2,
    ),
  );
  console.log(
    `pr-autopilot-scan: ${owner}/${repo} — ${candidates.length} candidate PR(s) need cycle-1 routing (scanned ${prs.length} open, max ${max}, window ${sinceDays}d; ` +
      `seat cap ${NOMINATION_SEAT_CAP}, capped: ${cappedPersonas.length > 0 ? cappedPersonas.join(", ") : "none"}) → ${out}`,
  );
  process.exit(0);
}

function die(code, msg) {
  console.error(`pr-autopilot-scan: ${msg}`);
  process.exit(code);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => die(3, e instanceof Error ? e.message : String(e)));
}
