#!/usr/bin/env node
// pr-remediate/pr-remediate-post.mjs — the AUTHOR lane's only write surface for
// GitHub metadata (adr-0022).
//
// The remediation cadence's real work lands as commits on the PR's HEAD branch
// (R-N9: never the default branch). This script writes the *record* of that
// work and moves the PR out of the lane, in exactly three shapes:
//
//   --claim      FIRST, before any work. Posts the attempt marker
//                `<!-- autopilot:remediation:<n> -->` and nothing else — the
//                lane's bound is counted from these, so the attempt must be
//                spent before it can fail. Without this ordering the cap is
//                enforced by the cadence it bounds (`wf:farah` F1 on #518): a
//                session that dies after pushing but before recording would
//                refresh the PR's updated_at — resetting the sweep's staleness
//                clock — while consuming no attempt, and could retry the same
//                failing resolution forever. Same once-ever-latch idiom as
//                flaky-rerun.mjs. Refuses to re-claim an attempt already
//                claimed, so a re-run of the same fire cannot double-spend.
//
//   --resolved   an attempt was made and pushed. Posts the outcome comment
//                (stamped with `<!-- autopilot:remediation:<n> -->`, the marker
//                the lane's bound is counted from), REMOVES
//                `autopilot:needs-author` and the author-lane reason labels, and
//                leaves the PR to pr-autopilot's next tick — whose scan sees a
//                head commit newer than the last routing comment and re-routes
//                it at cycle N+1. That re-route, not this script, is what
//                decides whether the fix was any good.
//
//   --blocked    the attempt cannot be made or cannot be finished. Posts the
//                hand-off (needs-human marker + reason marker + attempt marker),
//                stamps `autopilot:needs-human` + the reason label, and removes
//                the author label. The PR leaves the agent lane for the human
//                one; it is never left in both.
//
// It has no code path that approves, merges, or pushes — the same R-N9 / W-5
// posture as pr-autopilot-post.mjs, whose guards (raw @-mention refusal ML-012,
// the reason requirement) are imported rather than re-implemented so the two
// write surfaces cannot drift.
//
// Usage:
//   GITHUB_TOKEN=… node workforce/skills/pr-remediate/pr-remediate-post.mjs \
//     --project agent-workforce --pr 517 --attempt 1 \
//     --body-file /tmp/remediation-517.md \
//     ( --claim | --resolved | --blocked --reason remediation-blocked [--reason-text "…"] )
//
// --claim needs no --body-file (the marker IS the record); the other two do.
//
// Exit codes: 0 posted · 1 bad args / refused guard · 2 endpoint rejected ·
//             3 network / unexpected.

import { ensureProxyAwareEntry } from "../../../scripts/lib/proxy-bootstrap.mjs";
ensureProxyAwareEntry(import.meta.url);

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { projectRepo } from "../pr-autopilot/pr-autopilot-scan.mjs";
import {
  AUTHOR_LABEL,
  ESCALATION_LABEL,
  REMEDIATION_CAP,
  countRemediationAttempts,
  ensureLabels,
  makeGh,
  remediationMarker,
} from "../pr-autopilot/pr-merge.mjs";
import { findRawMentions, NEEDS_HUMAN_MARKER } from "../pr-autopilot/pr-autopilot-post.mjs";
import { AUTHOR_LANE_CODES, assertReasonCode, isAuthorLaneCode, reasonLabel, reasonMarker } from "../pr-autopilot/escalation-reasons.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");

/** Labels a resolved attempt clears from the PR. The author label itself, plus
 *  the author-lane reason labels — a stale `autopilot:reason:merge-conflict`
 *  sitting on a PR whose conflict is resolved is a lie the funnel would read as
 *  fact, and the next verdict re-stamps whatever is still true. Human-lane
 *  reason labels are never touched here: this script may not un-escalate. */
export function labelsToClearOnResolve(labels = []) {
  const authorReasonLabels = AUTHOR_LANE_CODES.map(reasonLabel);
  return labels
    .map((l) => String(l || ""))
    .filter((l) => l === AUTHOR_LABEL || authorReasonLabels.includes(l));
}

/** The claim comment. Deliberately minimal: it exists to spend the attempt
 *  before the work, so it must not depend on anything the work produces. */
export function claimBody(attempt, cap = REMEDIATION_CAP) {
  return [
    `**Remediation attempt ${attempt} of ≤ ${cap} — claimed.**`,
    "",
    "Starting work on this PR's author-lane blocker. This attempt is spent from here on: " +
      "if this run dies before recording an outcome, the attempt still counts (adr-0022 / `wf:farah` F1 — " +
      "a cap the bounded cadence increments only on success is not a cap). The outcome comment follows.",
    "",
    "— pr-remediate (see workforce/skills/pr-remediate/SKILL.md)",
    "",
    remediationMarker(attempt),
  ].join("\n");
}

/** A `--blocked` hand-off leaves the agent lane, so its reason must be one no
 *  agent is expected to clear. Refusing an author-lane code here is what stops
 *  the loop "escalate → re-park → escalate" from forming. */
export function assertBlockedReason(code) {
  assertReasonCode(code);
  if (isAuthorLaneCode(code)) {
    throw new Error(
      `--blocked cannot carry the author-lane reason "${code}" — that code means "an agent can fix this", ` +
        `which is the state we are leaving. Use remediation-blocked (a resolution only a human should make), ` +
        `remediation-cap-exceeded (attempts spent), or the specific human-lane clause (adr-0022).`,
    );
  }
  return code;
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}
const flag = (name) => process.argv.includes(`--${name}`);

async function main() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const projectId = arg("project");
  const prNumber = arg("pr");
  const bodyFile = arg("body-file");
  const attempt = Number(arg("attempt"));
  const claim = flag("claim");
  const resolved = flag("resolved");
  const blocked = flag("blocked");
  let repo = arg("repo");

  if (!token) return die(2, "GITHUB_TOKEN (or GH_TOKEN) env is required");
  if (!prNumber || !/^\d+$/.test(prNumber)) return die(1, "--pr <number> is required (positive integer)");
  const modes = [claim, resolved, blocked].filter(Boolean).length;
  if (modes !== 1) {
    return die(1, "pass exactly one of --claim / --resolved / --blocked — an attempt is claimed before the work, then recorded as one outcome");
  }
  if (!claim && !bodyFile) return die(1, "--body-file <path> is required for --resolved / --blocked");
  if (!repo && projectId) {
    try {
      const r = projectRepo(REPO_ROOT, projectId);
      repo = `${r.owner}/${r.repo}`;
    } catch (e) {
      return die(1, e.message);
    }
  }
  if (!repo || !/^[^/]+\/[^/]+$/.test(repo)) return die(1, "--repo <owner>/<repo> (or --project <id>) is required");

  let marker;
  try {
    marker = remediationMarker(attempt);
  } catch (e) {
    return die(1, `--attempt <n>: ${e instanceof Error ? e.message : String(e)}`);
  }

  let body;
  if (claim) {
    body = claimBody(attempt);
  } else {
    try {
      body = readFileSync(bodyFile, "utf8");
    } catch {
      return die(1, `body-file unreadable: ${bodyFile}`);
    }
    if (body.trim().length === 0) return die(1, "body-file is empty — refusing to post an empty remediation record (W-4)");
  }

  // ML-012, imported from the sibling write surface: persona slugs are not
  // GitHub accounts and a raw @ notifies the real user who owns that name.
  const mentions = findRawMentions(body);
  if (mentions.length > 0) {
    return die(1, `body contains raw GitHub @-mention(s): ${mentions.join(", ")} — reference agents as \`wf:<slug>\` (ML-012)`);
  }

  // The outcome comments carry the marker too — harmless (the counter reads the
  // MAXIMUM attempt number, not a tally), and it keeps each outcome legible
  // beside the attempt it belongs to.
  if (!body.includes(marker)) body = `${body.trimEnd()}\n\n${marker}\n`;

  const labelsToAdd = [];
  let reasonCode;
  if (blocked) {
    reasonCode = arg("reason");
    if (!reasonCode) return die(1, "--blocked requires --reason <code> (adr-0022 / Epic-019: every hand-off says why)");
    try {
      assertBlockedReason(reasonCode);
      const rm = reasonMarker(reasonCode, arg("reason-text") ?? "");
      if (!body.includes(`autopilot:reason:${reasonCode}`)) body = `${body.trimEnd()}\n\n${rm}\n`;
    } catch (e) {
      return die(1, e instanceof Error ? e.message : String(e));
    }
    if (!body.includes(NEEDS_HUMAN_MARKER)) body = `${body.trimEnd()}\n\n${NEEDS_HUMAN_MARKER}\n`;
    labelsToAdd.push(ESCALATION_LABEL, reasonLabel(reasonCode));
  }

  const gh = makeGh({ token, userAgent: "workforce-pr-remediate" });

  let current = [];
  let alreadyClaimed = 0;
  try {
    const [p, cs] = await Promise.all([
      gh("GET", `/repos/${repo}/pulls/${prNumber}`),
      gh("GET", `/repos/${repo}/issues/${prNumber}/comments?per_page=100`),
    ]);
    if (p.status !== 200) return die(3, `GET pull ${prNumber} -> HTTP ${p.status}`);
    current = Array.isArray(p.json?.labels) ? p.json.labels.map((l) => l?.name) : [];
    alreadyClaimed = countRemediationAttempts(Array.isArray(cs.json) ? cs.json.map((x) => x.body) : []);
  } catch (e) {
    return die(3, e?.msg || e?.message || String(e));
  }

  // A claim must be strictly the next attempt. Re-claiming one already spent
  // would let a re-run of the same fire double-spend the budget in the loose
  // direction (two claims, one increment); claiming past the cap is the lane's
  // exit, not another try. Both refuse rather than guess (C-4).
  if (claim) {
    if (alreadyClaimed >= REMEDIATION_CAP) {
      return die(1, `all ${REMEDIATION_CAP} attempts on #${prNumber} are already claimed — escalate with --blocked --reason remediation-cap-exceeded (adr-0022)`);
    }
    if (attempt !== alreadyClaimed + 1) {
      return die(1, `--attempt ${attempt} does not follow the ${alreadyClaimed} attempt(s) already claimed on #${prNumber} — claim attempt ${alreadyClaimed + 1}`);
    }
  }

  // Comment first: the record must exist before the labels move, so a failure
  // half-way leaves the PR in the lane WITH its evidence rather than out of the
  // lane with none (the direction that keeps the sweep able to catch it).
  let c;
  try {
    c = await gh("POST", `/repos/${repo}/issues/${prNumber}/comments`, { body });
  } catch (e) {
    return die(3, e?.msg || e?.message || String(e));
  }
  if (c.status !== 201) return die(c.status < 500 ? 2 : 3, `POST comment -> HTTP ${c.status}`);
  const mode = claim ? "claimed" : blocked ? "blocked" : "resolved";
  console.error(`pr-remediate-post: attempt ${attempt}/${REMEDIATION_CAP} on ${repo}#${prNumber} (${mode})`);

  // A claim only spends the attempt. The PR stays exactly where it is — in the
  // lane, with its labels — because the work has not happened yet and the sweep
  // must still be able to catch this run if it dies.
  if (claim) return 0;

  if (labelsToAdd.length > 0) {
    await ensureLabels(gh, repo, labelsToAdd);
    const l = await gh("POST", `/repos/${repo}/issues/${prNumber}/labels`, { labels: labelsToAdd });
    if (l.status !== 200) console.error(`pr-remediate-post: WARN could not label #${prNumber} -> HTTP ${l.status}`);
  }

  // Both shapes leave the author lane. Best-effort per label (404 = already
  // gone); a failure here is loud in the log but must not undo a landed record.
  for (const name of labelsToClearOnResolve(current)) {
    const d = await gh("DELETE", `/repos/${repo}/issues/${prNumber}/labels/${encodeURIComponent(name)}`);
    if (d.status !== 200 && d.status !== 404) console.error(`pr-remediate-post: WARN could not clear "${name}" -> HTTP ${d.status}`);
  }

  return 0;
}

function die(code, msg) {
  console.error(`pr-remediate-post: ${msg}`);
  return code;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(await main().catch((e) => die(3, e instanceof Error ? e.message : String(e))));
}
