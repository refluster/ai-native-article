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
//   - author-stale        (adr-0022) labelled `autopilot:needs-author` — the
//                         agent-fixable lane worked by the pr-remediate cadence
//                         — but untouched for --author-stale-hours (default 36).
//                         The lane has a scheduled worker, so silence means the
//                         worker is not coming; a human takes it.
//   - remediation-cap-exceeded
//                         (adr-0022) in the author lane with all REMEDIATION_CAP
//                         attempts spent and still not terminal. No further
//                         automatic attempt is permitted — bounded by design.
//
// The author lane is why this sweep matters more, not less, after adr-0022: it
// is the mechanism that keeps a THIRD, agent-owned interim state from becoming
// a place PRs quietly go to die. Both author-lane kinds MOVE the PR (the amber
// label is cleared as the red one is stamped) so it is never in two queues.
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

// This entry point issues no `fetch()` of its own — every request goes through
// `makeGh` imported from pr-merge.mjs — so the R-14 gate, which looks for a
// literal global fetch() call in the file, never required the bootstrap here.
// The proxy is a property of the PROCESS, not of the module that happens to
// call fetch: an entry point that re-execs is the only way HTTPS_PROXY is
// honoured, and importing a helper that has the bootstrap does nothing, because
// ensureProxyAwareEntry is a no-op unless it runs in the entry module. Without
// this, the sweep's first GET returned HTTP 401 on every proxied fire while its
// three siblings (scan / post / merge) worked — the one script whose whole job
// is to enforce the two-outcome contract was the one that could not run.
import { ensureProxyAwareEntry } from "../../../scripts/lib/proxy-bootstrap.mjs";
ensureProxyAwareEntry(import.meta.url);

import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { projectRepo } from "./pr-autopilot-scan.mjs";
import { AUTHOR_LABEL, ESCALATION_LABEL, REMEDIATION_CAP, countRemediationAttempts, countRouterCycles, ensureLabels, makeGh } from "./pr-merge.mjs";
import { NEEDS_HUMAN_MARKER } from "./pr-autopilot-post.mjs";
import { reasonLabel, reasonMarker } from "./escalation-reasons.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");
const AUTOPILOT_OFF_LABEL = "autopilot:off";

export const DEFAULT_STALE_HOURS = 48;
export const DEFAULT_WINDOW_DAYS = 7;
// adr-0022: how long a PR may sit in the AUTHOR lane before the sweep decides
// the remediation cadence is not coming and escalates it to a human. Shorter
// than the routed-stale window because the author lane has a named, scheduled
// worker: one missed daily fire is tolerable, two is a stall.
export const DEFAULT_AUTHOR_STALE_HOURS = 36;

/** Violation kinds that mean "this PR was in the author lane and is leaving it"
 *  — the apply path clears `autopilot:needs-author` for these, so a PR is never
 *  in both queues. */
export const AUTHOR_LANE_SWEEP_KINDS = Object.freeze(["author-stale", "remediation-cap-exceeded"]);

/**
 * Pure classifier. Given one open PR's state, return the violation class or
 * null. `bodies` is every issue-comment + review body on the PR.
 */
export function classifySweep(
  { createdAt, updatedAt, labels = [], bodies = [] },
  {
    now = Date.now(),
    staleHours = DEFAULT_STALE_HOURS,
    windowDays = DEFAULT_WINDOW_DAYS,
    authorStaleHours = DEFAULT_AUTHOR_STALE_HOURS,
  } = {},
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

  // adr-0022 — the AUTHOR lane is an interim state with a worker, so it is
  // bounded exactly like a 🟡: escalate when the worker demonstrably did not
  // finish. Two ways that shows up, checked before the routed-stale rule
  // because the author label is the more specific signal:
  //   - the attempt cap is spent (pr-remediate tried REMEDIATION_CAP times and
  //     the PR is still parked) — no further attempt is permitted, so a human
  //     is the only remaining owner;
  //   - nothing has touched the PR for authorStaleHours — the cadence is not
  //     coming (unbound, paused, or failing), and a PR nobody works is exactly
  //     the "neither state" this sweep exists to forbid.
  // Inside the window with attempts left it is legitimately in flight → null.
  if (names.includes(AUTHOR_LABEL)) {
    if (countRemediationAttempts(bodies) >= REMEDIATION_CAP) return "remediation-cap-exceeded";
    return now - updated > authorStaleHours * 3600_000 ? "author-stale" : null;
  }

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
export function sweepHandoffBody(kind, { staleHours, windowDays, authorStaleHours = DEFAULT_AUTHOR_STALE_HOURS }) {
  const reason =
    kind === "unlabelled-handoff"
      ? "handed off (a comment carries the hidden needs-human marker) but the label was dropped (ML-009)"
      : kind === "stale-routed"
        ? `routed for review but reached no terminal state (merged / hand-off) within ${staleHours}h`
        : kind === "author-stale"
          ? `parked in the author lane (\`${AUTHOR_LABEL}\`) but untouched for ${authorStaleHours}h — the pr-remediate cadence did not pick it up (adr-0022)`
          : kind === "remediation-cap-exceeded"
            ? `parked in the author lane and has spent all ${REMEDIATION_CAP} remediation attempts without reaching a terminal state (adr-0022) — no further automatic attempt is permitted`
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
  const authorStaleHours = Number(arg("author-stale-hours", String(DEFAULT_AUTHOR_STALE_HOURS)));
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
  if (!Number.isFinite(authorStaleHours) || authorStaleHours <= 0) return die(1, `--author-stale-hours must be positive (got ${authorStaleHours})`);

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
      { staleHours, windowDays, authorStaleHours },
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
        body: sweepHandoffBody(v.kind, { staleHours, windowDays, authorStaleHours }),
      });
      if (c.status !== 201) {
        failedApplies++;
        console.error(`pr-autopilot-sweep: FAILED comment on #${v.number} → HTTP ${c.status}`);
        continue;
      }
      // adr-0022: escalating an author-lane PR MOVES it — the amber label comes
      // off as the red one goes on. Leaving both would show the PR in two
      // queues at once, and the one whose worker can no longer act on it is
      // precisely the misleading half. Best-effort (a 404 just means it was
      // already removed); the escalation itself is what must land.
      if (AUTHOR_LANE_SWEEP_KINDS.includes(v.kind)) {
        const d = await gh("DELETE", `/repos/${repo}/issues/${v.number}/labels/${encodeURIComponent(AUTHOR_LABEL)}`);
        if (d.status !== 200 && d.status !== 404) {
          console.error(`pr-autopilot-sweep: WARN could not clear "${AUTHOR_LABEL}" from #${v.number} → HTTP ${d.status}`);
        }
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
