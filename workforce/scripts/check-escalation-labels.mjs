#!/usr/bin/env node
// check-escalation-labels.mjs — the ML-009 guard, extended by #662 to also
// cover the escalation-REASON half of the same defect class.
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
// #662: the monthly-report letters (Mateo/Silas/Dario, 2026-07 through
// 2026-09, unchanged across three consecutive months: ~75% of hand-offs
// carry no recorded reason) found the SAME session-bypass shape on the
// escalation-REASON half of the Epic-019 contract. `pr-autopilot-post.mjs` /
// `pr-remediate-post.mjs` already REFUSE to post an un-reasoned hand-off
// (`resolveReasons` throws, C-4) — but exactly like the label above, a
// session that hands a PR to a human by posting the marker/label directly
// (the ML-009 bypass) skips that script entirely, so the reason can be
// missing even though the *label* is present and this file's original
// check reports clean. Nothing previously re-checked PR *state* for that
// narrower gap. `violatesEscalationReason` below closes it the same way:
// a state re-check, not a write-time gate this file can't add (it can't
// intercept a session's own GitHub API calls). Deliberately NOT a backfill —
// an existing hand-off found missing a reason is FLAGGED, never guessed at
// (a reconstructed reason is worse than a blank one — #662's own "what
// would close this" #2); a human or the escalating agent adds the correct
// `autopilot:reason:<code>` label to clear the violation.
//
// Single-sources the label name + marker from the pr-autopilot engine so a
// rename can't drift the guard out of agreement with the stamper.
//
// Usage:
//   GITHUB_TOKEN=... node workforce/scripts/check-escalation-labels.mjs \
//     --repo refluster/ai-native-article [--json]
//
// Exit codes: 0 clean · 1 bad args / no token · 2 violation(s) found · 3 network.

import { ensureProxyAwareEntry } from "../../scripts/lib/proxy-bootstrap.mjs";
ensureProxyAwareEntry(import.meta.url);

import { ESCALATION_LABEL, AUTHOR_LABEL } from "../skills/pr-autopilot/pr-merge.mjs";
import { NEEDS_HUMAN_MARKER } from "../skills/pr-autopilot/pr-autopilot-post.mjs";
import { REASON_LABEL_PREFIX } from "../skills/pr-autopilot/escalation-reasons.mjs";

/**
 * Pure predicate (unit-tested). A PR violates ML-009 when a human hand-off
 * marker is present in any comment/review body but the escalation label is
 * absent. Marker absent ⇒ not an escalation ⇒ never a violation.
 *
 * The author-lane exemption (adr-0022). A marker is immutable history: it
 * lives in a comment body and stays there forever. A label is current state.
 * So a PR that was escalated, then legitimately moved to the AUTHOR lane —
 * either by `pr-remediate-post.mjs --resolved`, or by the operator re-parking
 * it for the cadence — carries a permanent marker with no escalation label,
 * and read literally that is a violation on every future run. It is not one:
 * the invariant this guard protects is *"the operator's `is:open
 * label:autopilot:needs-human` queue is complete"*, and a PR in the author
 * lane is deliberately not in that queue.
 *
 * This narrows the population but does not weaken the invariant, because the
 * two lanes are mutually exclusive by construction — `pr-remediate-post.mjs`
 * clears one label whenever it sets the other, "so the PR is in exactly one
 * queue" (its SKILL.md Step 6). A PR carrying BOTH labels is a real defect and
 * still fails: the exemption requires the escalation label to be absent, which
 * is the state the ADR says the author lane has.
 *
 * Without this, the needs-human → needs-author transition adr-0022 explicitly
 * permits could not be performed without turning the whole repo's CI red —
 * this check scans every open PR, so one mislabelled PR fails everyone's build.
 * Observed 2026-08-06: five PRs re-parked into the author lane failed CI on
 * every open PR in the repo, including unrelated ones.
 */
export function violatesEscalationLabel({ bodies = [], labels = [] } = {}) {
  const handedOff = bodies.some((b) => String(b || "").includes(NEEDS_HUMAN_MARKER));
  if (!handedOff) return false;
  const has = (want) => labels.some((l) => String(l || "").toLowerCase() === want);
  if (has(ESCALATION_LABEL)) return false;
  // In the author lane ⇒ not awaiting a human ⇒ not owed the escalation label.
  if (has(AUTHOR_LABEL)) return false;
  return true;
}

/**
 * Pure predicate (unit-tested), #662's half of the ML-009 guard. A PR that
 * is currently in EITHER hand-off lane — `autopilot:needs-human` (the human
 * lane) or `autopilot:needs-author` (adr-0022's agent lane) — MUST carry at
 * least one `autopilot:reason:<code>` label, because both lanes are
 * "escalating" in Epic-019's sense and both write scripts already refuse to
 * post an un-reasoned hand-off. This is state, not code path: a session that
 * posts the lane label directly (the same bypass ML-009 already guards)
 * skips that refusal and can leave a PR labelled but reasonless.
 *
 * A PR with NEITHER lane label is never checked here — it isn't a hand-off,
 * so it isn't owed a reason (mirrors `violatesEscalationLabel`'s own
 * "marker absent ⇒ never a violation" shape, keyed on the label instead of
 * the marker since the reason is only ever recorded as a label, never a
 * body marker this check can see cheaply across every comment).
 */
export function violatesEscalationReason({ labels = [] } = {}) {
  const has = (want) => labels.some((l) => String(l || "").toLowerCase() === want);
  const inALane = has(ESCALATION_LABEL) || has(AUTHOR_LABEL);
  if (!inALane) return false;
  const hasReason = labels.some((l) => String(l || "").toLowerCase().startsWith(REASON_LABEL_PREFIX));
  return !hasReason;
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
      violations.push({ number: pr.number, title: pr.title, url: pr.html_url, kind: "missing-label" });
    }
    // #662: independent of the label check above — this needs only the PR's
    // current labels (the reason is only ever recorded as a label), so it
    // runs whether or not the label check above already flagged this PR.
    if (violatesEscalationReason({ labels })) {
      violations.push({ number: pr.number, title: pr.title, url: pr.html_url, kind: "missing-reason" });
    }
  }

  if (asJson) console.log(JSON.stringify({ repo, checked: prs.length, violations }, null, 2));
  if (violations.length === 0) {
    if (!asJson) console.error(`check-escalation-labels: OK — ${prs.length} open PR(s), every hand-off carries ${ESCALATION_LABEL} (or the author lane) + a reason`);
    return 0;
  }
  if (!asJson) {
    const missingLabel = violations.filter((v) => v.kind === "missing-label");
    const missingReason = violations.filter((v) => v.kind === "missing-reason");
    console.error(`check-escalation-labels: ${violations.length} violation(s) found:`);
    if (missingLabel.length > 0) {
      console.error(`  ${missingLabel.length} PR(s) handed off to a human WITHOUT the ${ESCALATION_LABEL} label (ML-009):`);
      for (const v of missingLabel) console.error(`    - #${v.number} ${v.title} — ${v.url}`);
      console.error(`  Fix: label them, e.g. via \`pr-autopilot-post.mjs --needs-human\`, so the operator's queue is complete.`);
    }
    if (missingReason.length > 0) {
      console.error(`  ${missingReason.length} PR(s) in a hand-off lane (${ESCALATION_LABEL} / ${AUTHOR_LABEL}) WITHOUT an ${REASON_LABEL_PREFIX}* label (#662):`);
      for (const v of missingReason) console.error(`    - #${v.number} ${v.title} — ${v.url}`);
      console.error(`  Fix: add the correct \`${REASON_LABEL_PREFIX}<code>\` label (taxonomy: workforce/docs/pr-escalation-reasons.md) — never guess/backfill a reason, name the real one.`);
    }
  }
  return 2;
}

// Run as a CLI only when invoked directly; importing (tests) has no side effect.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  process.exit(await main());
}
