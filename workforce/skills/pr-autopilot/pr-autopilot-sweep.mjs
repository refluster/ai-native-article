#!/usr/bin/env node
// pr-autopilot/pr-autopilot-sweep.mjs — the deterministic TERMINAL-STATE sweep.
//
// The pr-autopilot contract is two-outcome: every PR the cadence touches ends
// either **merged** or **escalated with the `autopilot:needs-human` label**.
// The cadence's judgment leg can fail to get there (a run that stalls after the
// routing comment, a 🟡 verdict whose author never revises, a session-driven
// hand-off that bypassed the label stamper — ML-009, or a pr-merge.mjs refusal
// nobody converted into a hand-off). This script closes every one of those gaps
// mechanically: it re-checks PR *state*, not the code path that produced it.
//
// Violation classes (pure, unit-tested in pr-autopilot-sweep-tests.ts):
//   - unlabelled-handoff  a comment/review carries `<!-- autopilot:needs-human -->`
//                         but the PR lacks the label (ML-009).
//   - stale-routed        a routing comment exists, but the PR reached no
//                         terminal state (not merged, not labelled) and has not
//                         been updated for --stale-hours (default 48).
//   - never-routed        no routing comment at all and the PR has fallen out of
//                         the scan's --window-days discovery window (default 7)
//                         — the cadence will never pick it up again on its own.
//
// Skipped (never violations): PRs labelled `autopilot:off` (maintainer pause)
// and PRs already labelled `autopilot:needs-human` (already terminal).
//
// Modes:
//   default   — report violations, exit 2 if any (CI / audit usage).
//   --apply   — enforce the contract: post the hand-off comment (hidden
//               needs-human marker + Epic-019 reason marker) and stamp
//               `autopilot:needs-human` + `autopilot:reason:<kind>` on every
//               violation, so the operator's `is:open
//               label:autopilot:needs-human` queue is complete and every
//               escalation carries its reason. Exit 0 when everything applied.
//
// Usage:
//   GITHUB_TOKEN=... node workforce/skills/pr-autopilot/pr-autopilot-sweep.mjs \
//     --repo <owner>/<repo> [--apply] [--stale-hours 48] [--window-days 7] [--json]
//   (or --project <id> to resolve the repo from workforce/projects/{id}/project.json)
//
// Exit codes: 0 clean / all applied · 1 bad args · 2 violations found (check
// mode) or an apply write failed · 3 network / unexpected.

import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { projectRepo } from "./pr-autopilot-scan.mjs";
import { ESCALATION_LABEL, countRouterCycles, ensureLabels, makeGh } from "./pr-merge.mjs";
import { NEEDS_HUMAN_MARKER } from "./pr-autopilot-post.mjs";
import { reasonLabel, reasonMarker } from "./escalation-reasons.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");
const AUTOPILOT_OFF_LABEL = "autopilot:off";

export const DEFAULT_STALE_HOURS = 48;
export const DEFAULT_WINDOW_DAYS = 7;

/**
 * Pure classifier. Given one open PR's state, return the violation class or
 * null. `bodies` is every issue-comment + review body on the PR.
 */
export function classifySweep(
  { createdAt, updatedAt, labels = [], bodies = [] },
  { now = Date.now(), staleHours = DEFAULT_STALE_HOURS, windowDays = DEFAULT_WINDOW_DAYS } = {},
) {
  const names = labels.map((l) => String(l || "").toLowerCase());
  if (names.includes(AUTOPILOT_OFF_LABEL)) return null; // maintainer pause
  if (names.includes(ESCALATION_LABEL)) return null; // already terminal (escalated)

  if (bodies.some((b) => String(b || "").includes(NEEDS_HUMAN_MARKER))) {
    return "unlabelled-handoff"; // ML-009: handed off, label dropped
  }

  const updated = Date.parse(updatedAt ?? "");
  const created = Date.parse(createdAt ?? updatedAt ?? "");
  if (Number.isNaN(updated)) return null; // unparseable → leave to the cadence

  const routed = countRouterCycles(bodies) > 0;
  if (routed) {
    return now - updated > staleHours * 3600_000 ? "stale-routed" : null;
  }
  // Never routed: only a violation once the PR has aged out of the scan's
  // recency window — inside the window the cadence still picks it up itself.
  const age = now - Math.max(updated, Number.isNaN(created) ? 0 : created);
  return age > windowDays * 86400_000 ? "never-routed" : null;
}

/** Hand-off comment for the three violation classes. Carries the hidden
 *  needs-human marker so the label logic (and the ML-009 guard) recognise it
 *  as an escalation, plus the Epic-019 reason marker — the sweep kind IS the
 *  reason code, reused verbatim (workforce/docs/pr-escalation-reasons.md v1). */
export function sweepHandoffBody(kind, { staleHours, windowDays }) {
  const reason =
    kind === "unlabelled-handoff"
      ? "handed off (a comment carries the hidden needs-human marker) but the label was dropped (ML-009)"
      : kind === "stale-routed"
        ? `routed for review but reached no terminal state (merged / hand-off) within ${staleHours}h`
        : `never picked up by the routing cadence within its ${windowDays}-day discovery window`;
  return [
    "**Autopilot sweep — terminal-state enforcement.**",
    "",
    `This PR was ${reason}. Escalating so the two-outcome contract holds: every PR in autopilot scope ends **merged** or **escalated to a human**.`,
    "",
    "Next step: the operator (or the next cadence run) re-drives the review cycle, or closes the PR.",
    "",
    "— pr-autopilot sweep (deterministic; see workforce/skills/pr-autopilot/SKILL.md)",
    "",
    NEEDS_HUMAN_MARKER,
    reasonMarker(kind),
  ].join("\n");
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

async function main() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const apply = process.argv.includes("--apply");
  const asJson = process.argv.includes("--json");
  const staleHours = Number(arg("stale-hours", String(DEFAULT_STALE_HOURS)));
  const windowDays = Number(arg("window-days", String(DEFAULT_WINDOW_DAYS)));
  let repo = arg("repo");
  const projectId = arg("project");

  if (!token) return die(1, "GITHUB_TOKEN (or GH_TOKEN) env is required");
  if (!repo && projectId) {
    try {
      const r = projectRepo(REPO_ROOT, projectId);
      repo = `${r.owner}/${r.repo}`;
    } catch (e) {
      return die(1, e.message);
    }
  }
  if (!repo || !/^[^/]+\/[^/]+$/.test(repo)) return die(1, "--repo <owner>/<repo> (or --project <id>) is required");
  if (!Number.isFinite(staleHours) || staleHours <= 0) return die(1, `--stale-hours must be positive (got ${staleHours})`);
  if (!Number.isFinite(windowDays) || windowDays <= 0) return die(1, `--window-days must be positive (got ${windowDays})`);

  const gh = makeGh({ token, userAgent: "workforce-pr-autopilot-sweep" });

  let prs;
  try {
    const r = await gh("GET", `/repos/${repo}/pulls?state=open&per_page=100`);
    if (r.status !== 200 || !Array.isArray(r.json)) return die(3, `GET pulls → HTTP ${r.status}`);
    prs = r.json;
  } catch (e) {
    return die(3, e?.msg || e?.message || String(e));
  }

  const violations = [];
  for (const pr of prs) {
    let bodies = [];
    try {
      const [c, rv] = await Promise.all([
        gh("GET", `/repos/${repo}/issues/${pr.number}/comments?per_page=100`),
        gh("GET", `/repos/${repo}/pulls/${pr.number}/reviews?per_page=100`),
      ]);
      bodies = [
        ...(Array.isArray(c.json) ? c.json.map((x) => x.body) : []),
        ...(Array.isArray(rv.json) ? rv.json.map((x) => x.body) : []),
      ];
    } catch (e) {
      return die(3, `#${pr.number}: ${e?.msg || e?.message || String(e)}`);
    }
    const kind = classifySweep(
      {
        createdAt: pr.created_at,
        updatedAt: pr.updated_at,
        labels: Array.isArray(pr.labels) ? pr.labels.map((l) => l?.name) : [],
        bodies,
      },
      { staleHours, windowDays },
    );
    if (kind) violations.push({ number: pr.number, title: pr.title, url: pr.html_url, kind });
  }

  let failedApplies = 0;
  if (apply && violations.length > 0) {
    await ensureLabels(gh, repo, [ESCALATION_LABEL, ...new Set(violations.map((v) => reasonLabel(v.kind)))]);
    for (const v of violations) {
      // Every class gets the hand-off comment: it carries the hidden
      // needs-human marker plus the Epic-019 reason marker. An
      // unlabelled-handoff already has a hand-off comment, but not necessarily
      // a reason — the sweep's comment closes that telemetry gap too.
      const c = await gh("POST", `/repos/${repo}/issues/${v.number}/comments`, {
        body: sweepHandoffBody(v.kind, { staleHours, windowDays }),
      });
      if (c.status !== 201) {
        failedApplies++;
        console.error(`pr-autopilot-sweep: FAILED comment on #${v.number} → HTTP ${c.status}`);
        continue;
      }
      const l = await gh("POST", `/repos/${repo}/issues/${v.number}/labels`, { labels: [ESCALATION_LABEL, reasonLabel(v.kind)] });
      if (l.status === 200) console.error(`pr-autopilot-sweep: escalated #${v.number} (${v.kind})`);
      else {
        failedApplies++;
        console.error(`pr-autopilot-sweep: FAILED label on #${v.number} → HTTP ${l.status}`);
      }
    }
  }

  if (asJson) console.log(JSON.stringify({ repo, checked: prs.length, applied: apply, violations }, null, 2));
  if (violations.length === 0) {
    if (!asJson) console.error(`pr-autopilot-sweep: OK — ${prs.length} open PR(s), every one is terminal or in-cycle`);
    return 0;
  }
  if (!asJson) {
    console.error(
      `pr-autopilot-sweep: ${violations.length} PR(s) in a non-terminal state${apply ? " (escalated now)" : " (run with --apply to escalate)"}:`,
    );
    for (const v of violations) console.error(`  - #${v.number} [${v.kind}] ${v.title} — ${v.url}`);
  }
  if (apply) return failedApplies > 0 ? 2 : 0;
  return 2;
}

function die(code, msg) {
  console.error(`pr-autopilot-sweep: ${msg}`);
  return code;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(await main());
}
