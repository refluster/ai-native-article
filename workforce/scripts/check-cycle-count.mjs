#!/usr/bin/env node
// check-cycle-count.mjs — the FU-004 guard (W-4 hard cycle cap).
//
// Every open PR in the bound repo is scanned for routing-comment cycle
// numbers. A PR that has reached cycle > W4_CYCLE_CAP (> 7, i.e. cycle 8+)
// signals a process breakdown (dev-process.md §"cycle counter") — the review
// loop has run too long without a 🟢 verdict; operator intervention is needed.
//
// The merge engine (pr-merge.mjs verifyMergeable) already refuses a merge at
// this cap. This lint makes the cap *observable in CI* — it fires BEFORE the
// agent tries to merge, so the operator learns about a stuck PR via a build
// failure rather than via a refused merge comment.
//
// Single-sources W4_CYCLE_CAP + countRouterCycles from the pr-merge engine so
// the lint and the merge predicate are always in agreement.
//
// Usage:
//   GITHUB_TOKEN=... node workforce/scripts/check-cycle-count.mjs \
//     --repo refluster/ai-native-article [--cap 7] [--json]
//
// Exit codes: 0 clean · 1 bad args / no token · 2 violation(s) found · 3 network.

import { W4_CYCLE_CAP, countRouterCycles } from "../skills/pr-autopilot/pr-merge.mjs";

/**
 * Pure predicate (unit-tested). A PR violates the cycle cap when the max
 * routing-comment cycle number found in its bodies exceeds the cap.
 * Default cap is W4_CYCLE_CAP (7); violation = cycle > cap (i.e. ≥ cap+1).
 */
export function violatesCycleCap({ bodies = [], cap = W4_CYCLE_CAP } = {}) {
  return countRouterCycles(bodies) > cap;
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

async function main() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const repo = arg("repo");
  const capArg = arg("cap");
  const cap = capArg !== undefined ? parseInt(capArg, 10) : W4_CYCLE_CAP;
  const asJson = process.argv.includes("--json");

  if (!token) {
    console.error("check-cycle-count: GITHUB_TOKEN (or GH_TOKEN) is required");
    return 1;
  }
  if (!repo || !/^[^/]+\/[^/]+$/.test(repo)) {
    console.error("check-cycle-count: --repo <owner>/<repo> is required");
    return 1;
  }
  if (isNaN(cap) || cap < 1) {
    console.error(`check-cycle-count: --cap must be a positive integer, got: ${capArg}`);
    return 1;
  }

  const api = process.env.GITHUB_API_URL || "https://api.github.com";
  const gh = async (path) => {
    const res = await fetch(`${api}${path}`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "workforce-cycle-count-lint",
      },
    });
    const text = await res.text().catch(() => "");
    let json;
    try { json = text ? JSON.parse(text) : []; } catch { json = []; }
    return { status: res.status, json };
  };

  let prs;
  try {
    const r = await gh(`/repos/${repo}/pulls?state=open&per_page=100`);
    if (r.status !== 200 || !Array.isArray(r.json)) {
      console.error(`check-cycle-count: GET pulls -> HTTP ${r.status}`);
      return 3;
    }
    prs = r.json;
  } catch (e) {
    console.error(`check-cycle-count: network error: ${e?.message || e}`);
    return 3;
  }

  const violations = [];
  for (const pr of prs) {
    let bodies = [];
    try {
      const [c, rv] = await Promise.all([
        gh(`/repos/${repo}/issues/${pr.number}/comments?per_page=100`),
        gh(`/repos/${repo}/pulls/${pr.number}/reviews?per_page=100`),
      ]);
      bodies = [
        ...(Array.isArray(c.json) ? c.json.map((x) => x.body) : []),
        ...(Array.isArray(rv.json) ? rv.json.map((x) => x.body) : []),
      ];
    } catch (e) {
      console.error(`check-cycle-count: network error on #${pr.number}: ${e?.message || e}`);
      return 3;
    }
    const cycle = countRouterCycles(bodies);
    if (cycle > cap) {
      violations.push({ number: pr.number, title: pr.title, url: pr.html_url, cycle });
    }
  }

  if (asJson) console.log(JSON.stringify({ repo, cap, checked: prs.length, violations }, null, 2));
  if (violations.length === 0) {
    if (!asJson)
      console.error(
        `check-cycle-count: OK — ${prs.length} open PR(s), none exceeded the W-4 cycle cap of ${cap}`,
      );
    return 0;
  }
  if (!asJson) {
    console.error(
      `check-cycle-count: ${violations.length} PR(s) exceeded the W-4 cycle cap of ${cap} (FU-004):`,
    );
    for (const v of violations)
      console.error(`  - #${v.number} (cycle ${v.cycle}) ${v.title} — ${v.url}`);
    console.error(
      `Fix: post a 🔴 verdict comment (operator escalation) and label with autopilot:needs-human.`,
    );
  }
  return 2;
}

// Run as CLI only when invoked directly; importing (tests) has no side effect.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  process.exit(await main());
}
