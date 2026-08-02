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
// (2026-06-17 Autopilot widening, adr-0010). The discovery filters are the
// recency window, "already routed AND not revised since" (a 🟡 PR the author
// has pushed a revision to comes back at cycle N+1 — see nextRoutingCycle),
// and the terminal-state exclusion (isTerminal: an escalated or paused PR is
// the human's, and a push must not pull it back out).
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
//       [--max 5] [--since-days 7] [--cycle-cap 7]
//       [--out /tmp/pr-autopilot-candidates.json]
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

import { ensureProxyAwareEntry } from "../../../scripts/lib/proxy-bootstrap.mjs";
ensureProxyAwareEntry(import.meta.url);

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { ESCALATION_LABEL, MIN_REVIEWERS, W4_CYCLE_CAP } from "./pr-merge.mjs";
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
 *  pr-autopilot-post writes via the SKILL.md comment template.
 *
 *  Kept as the single-cycle predicate the seat/telemetry callers want ("has
 *  this persona ever routed here?"). **Discovery no longer uses it** — see
 *  nextRoutingCycle below for why. */
export function alreadyRouted(comments, personaSlug) {
  return routingState(comments, personaSlug).cycle > 0;
}

/** The persona's routing history on one PR: the highest cycle number it has
 *  opened, and when its most recent routing comment landed.
 *
 *  Only the *routing* comment matches — the verdict comment's header
 *  ("**Nadia — verdict, cycle 1 of ≤ 3.**") does not, because the cycle token
 *  is not adjacent to the persona name. That is deliberate: a cycle is opened
 *  once, by the routing comment. */
export function routingState(comments, personaSlug) {
  const personaName = personaSlug.charAt(0).toUpperCase() + personaSlug.slice(1);
  const marker = new RegExp(`^\\*\\*${personaName} — cycle (\\d+) of `, "m");
  let cycle = 0;
  let lastRoutedAt = null;
  for (const c of comments ?? []) {
    const m = marker.exec(String(c?.body ?? ""));
    if (!m) continue;
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n >= 1 && n > cycle) cycle = n;
    const at = Date.parse(c?.created_at ?? "");
    if (Number.isFinite(at) && (lastRoutedAt === null || at > lastRoutedAt)) lastRoutedAt = at;
  }
  return { cycle, lastRoutedAt };
}

/**
 * Which cycle this PR should be routed at, or `null` when it should be
 * skipped. This is the discovery gate.
 *
 * The bug this replaces: discovery used to skip any PR carrying a routing
 * comment with ANY cycle number, while SKILL.md Step 5 promises a 🟡 verdict
 * means "the author is expected to revise; next tick re-routes (cycle += 1)".
 * The comment said "already routed *this cycle*"; the regex implemented
 * "already routed *ever*". So a 🟡 PR could never reach cycle 2 on the cron
 * path — the author would push a revision and the cadence would never look at
 * it again, leaving the daily sweep to escalate it as `stale-routed` two days
 * later. (Observed on #507, 2026-07-27: cycle-2 revision pushed at 14:48Z,
 * three subsequent ticks all skipped it.)
 *
 * The fix is to ask the question the comment always claimed to ask: has the
 * author revised **since** the last routing comment?
 *
 * Conservative in both directions:
 *  - No routing comment           → cycle 1 (unchanged behaviour).
 *  - Cycle ≥ cap                  → null. The W-4 hard cap is a process-
 *                                   breakdown signal, not a retry budget;
 *                                   pr-merge's verifyMergeable refuses past it
 *                                   and the sweep escalates. Never loop.
 *                                   The `>=` here is NOT an off-by-one against
 *                                   verifyMergeable's `cycle > W4_CYCLE_CAP`
 *                                   (pr-merge.mjs:333) — the two bound
 *                                   different things. This bounds the cycle
 *                                   *opened* (so the highest reachable is
 *                                   exactly the cap); that one bounds the cycle
 *                                   *observed*. Discovery can therefore never
 *                                   manufacture a state the merge engine will
 *                                   reject.
 *  - Head unchanged since routing → null. No revision, nothing new to review.
 *  - Cannot determine either time → null. An unknown never triggers a re-route,
 *                                   so a missing/garbled timestamp degrades to
 *                                   today's (silent) behaviour rather than
 *                                   spamming a PR every tick.
 *
 * @param {object}   args
 * @param {Array}    args.comments         issue comments (need `body` + `created_at`)
 * @param {string}   args.persona          the routing persona slug
 * @param {?string}  args.headCommittedAt  ISO date of the PR head commit
 * @param {number}   args.cycleCap         hard cap (default W4_CYCLE_CAP)
 * @returns {?number} the cycle to route at, or null to skip
 */
export function nextRoutingCycle({
  comments = [],
  persona,
  headCommittedAt = null,
  cycleCap = W4_CYCLE_CAP,
} = {}) {
  const { cycle, lastRoutedAt } = routingState(comments, persona);
  if (cycle === 0) return 1;
  if (cycle >= cycleCap) return null;
  if (lastRoutedAt === null) return null;
  const revisedAt = Date.parse(headCommittedAt ?? "");
  if (!Number.isFinite(revisedAt)) return null;
  return revisedAt > lastRoutedAt ? cycle + 1 : null;
}

/** Terminal / paused PRs are out of discovery scope entirely.
 *
 *  `countOpenSeats` has always stated this rule ("escalated — the human's
 *  queue now") and enforced it for seat accounting, but the candidate loop
 *  never carried it: an escalated PR always has a routing comment, so the old
 *  has-ever-routed gate excluded it as a side effect. Once discovery learned
 *  to re-route a revised PR, that accident stopped protecting anything — an
 *  escalated PR whose author pushed one more commit would have been pulled
 *  back out of a terminal state with no human involved, and `autopilot:off`
 *  (the maintainer's explicit pause) would have been defeated by a push.
 *  So the rule now lives where its own doc comment always said it belonged.
 *
 *  Accepts either GitHub's label objects or plain name strings. */
export function isTerminal(labels) {
  const names = (labels ?? []).map((l) => String(l?.name ?? l ?? "").toLowerCase());
  return names.includes(ESCALATION_LABEL) || names.includes("autopilot:off");
}

/** Pick the head commit's date. Committer date first, author date as the
 *  fallback: a rebase rewrites the committer date and leaves the author date
 *  at the original authoring time — and a rebase IS a revision, so reading
 *  `author.date` would silently stop re-routing rebased branches. */
export function headCommitDate(commitJson) {
  return commitJson?.commit?.committer?.date ?? commitJson?.commit?.author?.date ?? null;
}

/**
 * The whole discovery decision, as one pure function: which open PRs are
 * candidates this tick, and at which cycle.
 *
 * Extracted from `main()` so every branch is drivable from a test. The
 * preceding cycle-1 review (`wf:owen` O1) made the case: both the #498/#503
 * defects and this skill's own re-route bug lived in what a caller handed a
 * predicate, never in the predicate — so a corpus that only exercises
 * `nextRoutingCycle` cannot see the decisions that actually break production.
 * `main()` keeps only the I/O: fetch the comment threads, fetch the head-commit
 * dates for the PRs this function could re-route, then fetch diffs for what it
 * returns.
 *
 * @param {object} args
 * @param {Array}  args.prs             open PRs, most-recently-updated first
 * @param {Map}    args.commentsByPr    pr.number → issue comments
 * @param {Map}    args.headDatesByPr   pr.number → ISO head-commit date (absent = unknown)
 * @param {string} args.persona         routing persona slug
 * @param {number} args.sinceDays       recency window
 * @param {number} args.cycleCap        hard cycle cap
 * @param {number} args.max             cap on candidates returned
 * @param {number} [args.now]           injectable clock (defaults to Date.now())
 * @returns {Array<{pr: object, cycle: number}>}
 */
export function selectCandidates({
  prs = [],
  commentsByPr = new Map(),
  headDatesByPr = new Map(),
  persona,
  sinceDays,
  cycleCap = W4_CYCLE_CAP,
  max = 5,
  now = Date.now(),
} = {}) {
  const out = [];
  for (const pr of prs) {
    if (out.length >= max) break;
    // Draft and bot-authored PRs are IN scope (adr-0010): drafts get an early
    // review pass, and Dependabot PRs route through the same review→consensus
    // →merge path as human PRs (the dependabot-triage no-review lane retires).
    // Terminal/paused PRs are not.
    if (isTerminal(pr.labels)) continue;
    if (!withinWindow(pr.updated_at, sinceDays, now)) continue;
    const cycle = nextRoutingCycle({
      comments: commentsByPr.get(pr.number) ?? [],
      persona,
      headCommittedAt: headDatesByPr.get(pr.number) ?? null,
      cycleCap,
    });
    if (cycle === null) continue;
    out.push({ pr, cycle });
  }
  return out;
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
  // The HARD cap (W-4). The binding's softer `cycle_cap` (e.g. 3) is applied by
  // the routing persona at verdict time; discovery only refuses to loop past
  // the process-breakdown line.
  const cycleCap = Number(arg("cycle-cap", String(W4_CYCLE_CAP)));
  const token = process.env.GITHUB_TOKEN;

  if (!projectId) die(1, "--project <id> is required");
  if (!persona) die(1, "--persona <agent-slug> is required (the routing persona)");
  if (!token) die(2, "GITHUB_TOKEN env is required (from credentials['github.token'].token)");
  if (!Number.isInteger(max) || max < 1) die(1, `--max must be a positive integer (got ${max})`);
  if (!Number.isInteger(cycleCap) || cycleCap < 1) die(1, `--cycle-cap must be a positive integer (got ${cycleCap})`);

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

  // Head-commit dates for the re-route comparison. Fetched only for PRs the
  // gate could actually re-route (in-window, non-terminal, already routed), so
  // a first-pass PR costs no extra call. A read failure leaves the entry
  // absent, which selectCandidates treats as "cannot tell → do not re-route".
  const headDatesByPr = new Map();
  for (const pr of prs) {
    if (isTerminal(pr.labels)) continue;
    if (!withinWindow(pr.updated_at, sinceDays)) continue;
    if (!alreadyRouted(commentsByPr.get(pr.number) ?? [], persona)) continue;
    if (!pr.head?.sha) continue;
    try {
      const head = await ghGet(token, `/repos/${owner}/${repo}/commits/${pr.head.sha}`);
      headDatesByPr.set(pr.number, headCommitDate(head));
    } catch (e) {
      console.error(`pr-autopilot-scan: #${pr.number} head commit unreadable (${e.message}) — not re-routing`);
    }
  }

  const selected = selectCandidates({
    prs,
    commentsByPr,
    headDatesByPr,
    persona,
    sinceDays,
    cycleCap,
    max,
  });

  const candidates = [];
  for (const { pr, cycle } of selected) {
    const comments = commentsByPr.get(pr.number) ?? [];
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
      // The cycle this PR is being routed at — 1 for a first pass, N+1 for a
      // re-route after an author revision. The routing persona opens its
      // comment with this number ("**{Persona} — cycle {cycle} of ≤ {cap}**")
      // and applies its binding's own softer cycle_cap.
      cycle,
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
    `pr-autopilot-scan: ${owner}/${repo} — ${candidates.length} candidate PR(s) need routing ` +
      `(${candidates.filter((c) => c.cycle === 1).length} first-pass, ${candidates.filter((c) => c.cycle > 1).length} re-route after revision; ` +
      `scanned ${prs.length} open, max ${max}, window ${sinceDays}d, hard cycle cap ${cycleCap}; ` +
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
