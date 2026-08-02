#!/usr/bin/env node
// check-escalation-labels.mjs — the ML-009 guard.
//
// Every escalation of a PR to a human MUST carry the `autopilot:needs-human`
// label so the operator's `is:open label:autopilot:needs-human` queue is
// complete. pr-autopilot-post.mjs stamps it mechanically on the *script*
// write-path — but a SESSION-driven hand-off (a Claude Code / persona-in-session
// reviewer posting the verdict another way) bypasses that and drops the label
// (ML-009: #358, then #362 — two session-driven misses in one day, the
// ratchet's promotion trigger). This lint re-checks the PR *state*, not the code
// path: any open PR whose comment/review thread carries the hidden hand-off
// marker `<!-- autopilot:needs-human -->` but is missing the label is a
// violation — caught regardless of who escalated or how.
//
// Single-sources the label name + marker from the pr-autopilot engine so a
// rename can't drift the guard out of agreement with the stamper.
//
// Usage:
//   GITHUB_TOKEN=... node workforce/scripts/check-escalation-labels.mjs \
//     --repo refluster/ai-native-article [--json]
//
// Exit codes: 0 clean · 1 bad args / no token · 2 violation(s) found · 3 network.

import "../../scripts/lib/proxy-bootstrap.mjs";

import { ESCALATION_LABEL } from "../skills/pr-autopilot/pr-merge.mjs";
import { NEEDS_HUMAN_MARKER } from "../skills/pr-autopilot/pr-autopilot-post.mjs";

/**
 * Pure predicate (unit-tested). A PR violates ML-009 when a human hand-off
 * marker is present in any comment/review body but the escalation label is
 * absent. Marker absent ⇒ not an escalation ⇒ never a violation.
 */
export function violatesEscalationLabel({ bodies = [], labels = [] } = {}) {
  const handedOff = bodies.some((b) => String(b || "").includes(NEEDS_HUMAN_MARKER));
  if (!handedOff) return false;
  const labelled = labels.some((l) => String(l || "").toLowerCase() === ESCALATION_LABEL);
  return !labelled;
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

async function main() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const repo = arg("repo");
  const asJson = process.argv.includes("--json");
  if (!token) { console.error("check-escalation-labels: GITHUB_TOKEN (or GH_TOKEN) is required"); return 1; }
  if (!repo || !/^[^/]+\/[^/]+$/.test(repo)) { console.error("check-escalation-labels: --repo <owner>/<repo> is required"); return 1; }

  const api = process.env.GITHUB_API_URL || "https://api.github.com";
  const gh = async (path) => {
    const res = await fetch(`${api}${path}`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "workforce-escalation-lint",
      },
    });
    const text = await res.text().catch(() => "");
    let json; try { json = text ? JSON.parse(text) : []; } catch { json = []; }
    return { status: res.status, json };
  };

  let prs;
  try {
    const r = await gh(`/repos/${repo}/pulls?state=open&per_page=100`);
    if (r.status !== 200 || !Array.isArray(r.json)) { console.error(`check-escalation-labels: GET pulls -> HTTP ${r.status}`); return 3; }
    prs = r.json;
  } catch (e) { console.error(`check-escalation-labels: network error: ${e?.message || e}`); return 3; }

  const violations = [];
  for (const pr of prs) {
    const labels = Array.isArray(pr.labels) ? pr.labels.map((l) => l?.name) : [];
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
    } catch (e) { console.error(`check-escalation-labels: network error on #${pr.number}: ${e?.message || e}`); return 3; }
    if (violatesEscalationLabel({ bodies, labels })) {
      violations.push({ number: pr.number, title: pr.title, url: pr.html_url });
    }
  }

  if (asJson) console.log(JSON.stringify({ repo, checked: prs.length, violations }, null, 2));
  if (violations.length === 0) {
    if (!asJson) console.error(`check-escalation-labels: OK — ${prs.length} open PR(s), every human hand-off carries ${ESCALATION_LABEL}`);
    return 0;
  }
  if (!asJson) {
    console.error(`check-escalation-labels: ${violations.length} PR(s) handed off to a human WITHOUT the ${ESCALATION_LABEL} label (ML-009):`);
    for (const v of violations) console.error(`  - #${v.number} ${v.title} — ${v.url}`);
    console.error(`Fix: label them, e.g. via \`pr-autopilot-post.mjs --needs-human\`, so the operator's queue is complete.`);
  }
  return 2;
}

// Run as a CLI only when invoked directly; importing (tests) has no side effect.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  process.exit(await main());
}
