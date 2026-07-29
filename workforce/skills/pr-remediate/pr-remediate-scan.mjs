#!/usr/bin/env node
// pr-remediate/pr-remediate-scan.mjs — deterministic discovery for the AUTHOR
// lane (adr-0022).
//
// pr-autopilot ends every PR it touches in one of two terminal states, and
// hands the agent-fixable middle to the author lane (`autopilot:needs-author`).
// This script is that lane's read-only scanner: it lists every PR sitting in it,
// classifies WHAT is wrong (conflict / behind / failing checks / open review
// findings), counts how many remediation attempts the PR has already spent, and
// writes the whole candidate — diff-relevant PR fields, the hand-off reasons,
// the reviewer findings — to a JSON file the session then works from.
//
// Read-only by construction: GET only. Every write in this cadence goes through
// git (the head branch, per R-N9 — never the default branch) or through
// pr-remediate-post.mjs. Nothing here approves, merges, or comments.
//
// Usage:
//   GITHUB_TOKEN=<credentials['github.token'].token> \
//     node workforce/skills/pr-remediate/pr-remediate-scan.mjs \
//       --project agent-workforce [--repo owner/repo] \
//       [--max 3] [--out /tmp/pr-remediate-candidates.json] [--json]
//
// Exit codes: 0 ok (including "0 candidates" — a cheap, normal outcome)
//             1 bad args · 3 network / unexpected.

import { writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { projectRepo } from "../pr-autopilot/pr-autopilot-scan.mjs";
import {
  AUTHOR_LABEL,
  ESCALATION_LABEL,
  REMEDIATION_CAP,
  countRemediationAttempts,
  makeGh,
} from "../pr-autopilot/pr-merge.mjs";
import { findReasonMarkers } from "../pr-autopilot/escalation-reasons.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");
const AUTOPILOT_OFF_LABEL = "autopilot:off";

export const DEFAULT_MAX = 3;

/**
 * The pure decision: given one PR's state, what (if anything) should the
 * remediation cadence do about it?
 *
 * Ordering is load-bearing, not cosmetic:
 *   1. `not-in-lane` / `terminal` — never touch a PR that isn't ours. The human
 *      lane wins over the author lane whenever both labels are somehow present:
 *      a PR a human owns is not one an agent may keep pushing to.
 *   2. `cap-exceeded` — the bound comes before the work. A PR that has spent its
 *      attempts is escalated, never given "just one more" try.
 *   3. `merge-conflict` — before everything else fixable, because until the
 *      branch merges the base cleanly, no check result and no review finding on
 *      it can be trusted: they describe a tree that will not exist after the
 *      resolution.
 *   4. `branch-behind` — same reasoning, weaker form.
 *   5. `review-findings` before `checks-failing` — a lens finding is a stated
 *      defect with a named fix; a red check is a symptom, and fixing the stated
 *      defect frequently clears it.
 *   6. `unclear` — parked in the lane with no recognisable cause. NOT a no-op:
 *      the caller escalates it (`remediation-blocked`), because a PR nobody can
 *      classify is exactly what the lane must not silently accumulate (C-4).
 */
export function classifyRemediation({
  labels = [],
  mergeable,
  mergeableState = "",
  reasons = [],
  attempts = 0,
  cap = REMEDIATION_CAP,
} = {}) {
  const names = labels.map((l) => String(l || "").toLowerCase());
  const state = String(mergeableState || "").toLowerCase();
  const codes = new Set(reasons);

  if (names.includes(AUTOPILOT_OFF_LABEL)) return { kind: "not-in-lane", actionable: false, why: "autopilot:off — maintainer pause" };
  if (names.includes(ESCALATION_LABEL)) return { kind: "terminal", actionable: false, why: `${ESCALATION_LABEL} — a human owns this PR` };
  if (!names.includes(AUTHOR_LABEL)) return { kind: "not-in-lane", actionable: false, why: `no ${AUTHOR_LABEL} label` };

  if (attempts >= cap) {
    return {
      kind: "cap-exceeded",
      actionable: false,
      escalate: "remediation-cap-exceeded",
      why: `${attempts} of ${cap} remediation attempts spent — the lane is exhausted, escalate to a human`,
    };
  }

  if (state === "dirty" || mergeable === false) {
    return { kind: "merge-conflict", actionable: true, why: `head conflicts with the base (mergeable=${mergeable}, state=${state || "?"})` };
  }
  if (state === "behind") {
    return { kind: "branch-behind", actionable: true, why: "head is out of date with the base branch" };
  }
  if (codes.has("review-findings-open")) {
    return { kind: "review-findings", actionable: true, why: "one or more lens reviews left an open blocking finding" };
  }
  if (codes.has("checks-failing")) {
    return { kind: "checks-failing", actionable: true, why: "a required check completed non-green" };
  }
  return {
    kind: "unclear",
    actionable: false,
    escalate: "remediation-blocked",
    why: `parked in the author lane with no recognisable fixable cause (state=${state || "?"}, reasons=[${[...codes].join(", ") || "none"}])`,
  };
}

/** Reason codes carried by the PR's hand-off comments, de-duplicated, newest
 *  comment last. Unknown codes throw (C-4) via findReasonMarkers. */
export function reasonCodesFrom(bodies = []) {
  const codes = [];
  for (const b of bodies) for (const { code } of findReasonMarkers(b)) if (!codes.includes(code)) codes.push(code);
  return codes;
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
  let repo = arg("repo");

  if (!token) return die(1, "GITHUB_TOKEN (or GH_TOKEN) env is required (from credentials['github.token'].token)");
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

  const gh = makeGh({ token, userAgent: "workforce-pr-remediate" });

  // Search is the cheap filter: only PRs already in the lane are candidates.
  let numbers;
  try {
    const q = encodeURIComponent(`repo:${repo} is:pr is:open label:"${AUTHOR_LABEL}"`);
    const r = await gh("GET", `/search/issues?q=${q}&per_page=100`);
    if (r.status !== 200 || !Array.isArray(r.json?.items)) return die(3, `search -> HTTP ${r.status}`);
    numbers = r.json.items.map((it) => it.number);
  } catch (e) {
    return die(3, e?.msg || e?.message || String(e));
  }

  const candidates = [];
  for (const number of numbers) {
    if (candidates.length >= max) break;
    let pr, bodies, reviews, checks;
    try {
      // The PR detail is fetched singly (not from search) because `mergeable` /
      // `mergeable_state` are only computed on the individual-PR endpoint, and
      // they are the whole point of this scan.
      const [p, c, rv] = await Promise.all([
        gh("GET", `/repos/${repo}/pulls/${number}`),
        gh("GET", `/repos/${repo}/issues/${number}/comments?per_page=100`),
        gh("GET", `/repos/${repo}/pulls/${number}/reviews?per_page=100`),
      ]);
      if (p.status !== 200) return die(3, `GET pull ${number} -> HTTP ${p.status}`);
      pr = p.json;
      reviews = Array.isArray(rv.json) ? rv.json : [];
      bodies = [
        ...(Array.isArray(c.json) ? c.json.map((x) => x.body) : []),
        ...reviews.map((x) => x.body),
      ];
      const cr = await gh("GET", `/repos/${repo}/commits/${pr.head?.sha}/check-runs?per_page=100`);
      checks = Array.isArray(cr.json?.check_runs)
        ? cr.json.check_runs.map((x) => ({ name: x.name, status: x.status, conclusion: x.conclusion }))
        : [];
    } catch (e) {
      return die(3, `#${number}: ${e?.msg || e?.message || String(e)}`);
    }

    const labels = Array.isArray(pr.labels) ? pr.labels.map((l) => l?.name) : [];
    const attempts = countRemediationAttempts(bodies);
    const reasons = reasonCodesFrom(bodies);
    const verdict = classifyRemediation({
      labels,
      mergeable: pr.mergeable,
      mergeableState: pr.mergeable_state,
      reasons,
      attempts,
    });

    candidates.push({
      number,
      title: pr.title,
      url: pr.html_url,
      draft: pr.draft === true,
      head: { ref: pr.head?.ref, sha: pr.head?.sha },
      base: { ref: pr.base?.ref },
      mergeable: pr.mergeable,
      mergeable_state: pr.mergeable_state,
      labels,
      attempts,
      attempt_next: attempts + 1,
      attempts_left: Math.max(0, REMEDIATION_CAP - attempts),
      reasons,
      checks,
      failing_checks: checks.filter((c) => c.status === "completed" && c.conclusion !== "success" && c.conclusion !== "neutral" && c.conclusion !== "skipped"),
      // Verbatim, un-summarised: the session needs the reviewers' own words to
      // address a finding by its finding-ID, and a scanner's paraphrase is
      // exactly how a finding gets "addressed" without being fixed.
      review_bodies: reviews.map((r) => ({ state: r.state, body: r.body })),
      remediation: verdict,
    });
  }

  const payload = { repo, cap: REMEDIATION_CAP, scanned: numbers.length, candidates };
  if (out) {
    writeFileSync(out, JSON.stringify(payload, null, 2));
    console.error(`pr-remediate-scan: ${candidates.length} candidate(s) of ${numbers.length} in the lane -> ${out}`);
  }
  if (asJson || !out) console.log(JSON.stringify(payload, null, 2));
  for (const c of candidates) {
    console.error(`  - #${c.number} [${c.remediation.kind}] attempt ${c.attempt_next}/${REMEDIATION_CAP} — ${c.remediation.why}`);
  }
  return 0;
}

function die(code, msg) {
  console.error(`pr-remediate-scan: ${msg}`);
  return code;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(await main().catch((e) => die(3, e instanceof Error ? e.message : String(e))));
}
