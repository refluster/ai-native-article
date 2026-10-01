#!/usr/bin/env node
// issue-triage/issue-triage-settle.mjs — the router's second write surface:
// the answer for an issue nobody should WORK (issue-lanes.mjs, "Settling an
// issue").
//
//   duplicate    fold it into the canonical open issue (a consolidation comment
//                on the canonical carrying whatever this one added), then close
//                it `not_planned` with GitHub's `Duplicate of #N` marker;
//   completed    a merged PR delivered it — close `completed`, citing the PR;
//   obsolete     a later decision/change made it moot — close `not_planned`,
//                naming what superseded it;
//   still-valid  a long-idle laned issue was reviewed and still stands — a
//                short recorded note, left open in its lane (the comment also
//                restarts its review clock, so it is not re-reviewed tomorrow).
//
// Every close stamps `wf:closed:<verdict>`, so the router's closes are one
// search and a human REOPEN is recognisable (settleRefusal refuses to close a
// reopened issue again). Never edits a body, never opens a PR, never touches an
// issue an open PR references, never closes an L0/L1 or tracker issue.
//
// The close budget is MECHANICAL, not a prose promise: before closing, the
// script counts the router's own closes (`wf:closed:*`, closed inside the last
// `--window-hours`) on GitHub and refuses past `--max-closes`. Counting on the
// tracker rather than in a caller-held file means no caller can forget it.
//
// Order of writes: consolidation note → settle comment → CLOSE → label. The
// close lands before the label because a label on an issue that is still open
// reads, to every later run, as "a human reopened a router close" — a failed
// close after the label would strand a live issue in that state.
//
// Usage:
//   GITHUB_TOKEN=… node workforce/skills/issue-triage/issue-triage-settle.mjs \
//     --project agent-workforce --issue 512 --verdict duplicate --of 498 \
//     --body-file /tmp/settle-512.md --carry-file /tmp/carry-512.md \
//     [--max-closes 5] [--window-hours 20]
//   … --verdict completed --pr 726 --body-file …
//   … --verdict obsolete --superseded-by "adr-0038" --body-file …
//   … --verdict still-valid --body-file …
//
// Exit codes: 0 settled · 1 bad args / refused guard · 2 endpoint rejected · 3 network.

import { ensureProxyAwareEntry } from "../../../scripts/lib/proxy-bootstrap.mjs"
ensureProxyAwareEntry(import.meta.url)

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { projectRepo } from "../pr-autopilot/pr-autopilot-scan.mjs";
import { makeGh } from "../pr-autopilot/pr-merge.mjs";
import { findRawMentions } from "../pr-autopilot/pr-autopilot-post.mjs";
import { collectOpenPrRefs } from "./issue-triage-scan.mjs";
import {
  CLOSE_STATE_REASON,
  CLOSE_VERDICTS,
  CLOSED_LABEL_PREFIX,
  SETTLE_VERDICTS,
  assertSettleVerdict,
  closedLabel,
  settleRefusal,
} from "./issue-lanes.mjs";

/** Default close budget per fire, and the window it is counted over. The
 *  window is shorter than a day so a daily fire never counts yesterday's. */
export const DEFAULT_MAX_CLOSES = 5;
export const DEFAULT_CLOSE_WINDOW_HOURS = 20;

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");

const CLOSED_LABEL_META = (verdict) => ({ color: "cfd3d7", description: `Closed by issue-triage: ${SETTLE_VERDICTS[verdict]}` });

/** The comment posted on the settled issue. Pure + exported (unit-tested):
 *  the `Duplicate of #N` line is what makes GitHub mark the issue a duplicate,
 *  and the marker is what a later reader greps for. */
export function settleComment(body, { verdict, of = null, pr = null, supersededBy = "" }) {
  const lines = [String(body || "").trimEnd(), ""];
  if (verdict === "duplicate") lines.push(`Duplicate of #${of}`);
  if (verdict === "completed") lines.push(`Completed by #${pr}.`);
  if (verdict === "obsolete") lines.push(`Superseded by ${String(supersededBy).trim()}.`);
  if (CLOSE_VERDICTS.includes(verdict)) {
    lines.push("", "_Closed by `issue-triage`. If this is wrong, reopen it — the router will not close a reopened issue again._");
  }
  lines.push("", `<!-- wf:settled:${verdict} -->`, "");
  return lines.join("\n");
}

/** How many closes the budget still allows, given the `closed_at` of the
 *  router's closes already on the tracker. Pure + exported (unit-tested). */
export function closeBudgetRemaining(closedAts = [], { now = Date.now(), windowHours = DEFAULT_CLOSE_WINDOW_HOURS, max = DEFAULT_MAX_CLOSES } = {}) {
  const since = now - windowHours * 3600_000;
  const used = closedAts.filter((t) => {
    const ms = Date.parse(t ?? "");
    return !Number.isNaN(ms) && ms >= since;
  }).length;
  return Math.max(0, max - used);
}

/** `closed_at` of every issue the router closed inside the window, read from
 *  the tracker (one list per verdict label — the `labels` filter is AND). */
export async function collectRouterCloses(gh, repo, { now = Date.now(), windowHours = DEFAULT_CLOSE_WINDOW_HOURS } = {}) {
  const since = new Date(now - windowHours * 3600_000).toISOString();
  const out = [];
  for (const verdict of CLOSE_VERDICTS) {
    const label = encodeURIComponent(`${CLOSED_LABEL_PREFIX}${verdict}`);
    const r = await gh("GET", `/repos/${repo}/issues?state=closed&labels=${label}&since=${since}&per_page=100`);
    if (r.status !== 200 || !Array.isArray(r.json)) throw new Error(`GET closed ${verdict} issues -> HTTP ${r.status}`);
    out.push(...r.json.filter((i) => !i.pull_request).map((i) => i.closed_at));
  }
  return out;
}

/**
 * The settle, with GitHub injected — `main()` is only argument parsing around
 * this, so the whole write sequence is testable against a stubbed `gh`.
 * Returns `{ code, msg }` (exit code semantics as in the header).
 */
export async function runSettle(gh, repo, {
  issue,
  verdict,
  of = null,
  pr = null,
  supersededBy = "",
  body,
  carry = null,
  maxCloses = DEFAULT_MAX_CLOSES,
  windowHours = DEFAULT_CLOSE_WINDOW_HOURS,
  now = Date.now(),
}) {
  const n = Number(issue);
  let target;
  let canonical = null;
  let mergedPr = null;
  let heldBy = [];
  try {
    const r = await gh("GET", `/repos/${repo}/issues/${n}`);
    if (r.status !== 200) return { code: 3, msg: `GET issue ${n} -> HTTP ${r.status}` };
    target = r.json;
    if (verdict === "duplicate" && of) {
      const c = await gh("GET", `/repos/${repo}/issues/${of}`);
      if (c.status === 200) canonical = c.json;
      else if (c.status !== 404) return { code: 3, msg: `GET issue ${of} -> HTTP ${c.status}` };
    }
    if (verdict === "completed" && pr) {
      const p = await gh("GET", `/repos/${repo}/pulls/${pr}`);
      if (p.status === 404) return { code: 1, msg: `#${pr} is not a pull request on ${repo}` };
      if (p.status !== 200) return { code: 3, msg: `GET pull ${pr} -> HTTP ${p.status}` };
      mergedPr = p.json;
    }
    heldBy = (await collectOpenPrRefs(gh, repo)).get(n) ?? [];
  } catch (e) {
    return { code: 3, msg: e?.msg || e?.message || String(e) };
  }
  if (target?.pull_request) return { code: 1, msg: `#${n} is a pull request — settle issues only` };
  if (target?.state !== "open") return { code: 1, msg: `#${n} is already ${target?.state}` };

  const labels = Array.isArray(target?.labels) ? target.labels.map((l) => (typeof l === "string" ? l : l?.name)) : [];
  const refusal = settleRefusal({ verdict, issue: n, labels, heldBy, of, canonical, mergedPr, supersededBy });
  if (refusal) return { code: 1, msg: refusal };

  const closing = CLOSE_VERDICTS.includes(verdict);
  if (closing) {
    let closedAts;
    try {
      closedAts = await collectRouterCloses(gh, repo, { now, windowHours });
    } catch (e) {
      // Fail CLOSED: an uncountable budget is not a budget.
      return { code: 3, msg: `could not count this run's closes (${e?.message || e}) — not closing` };
    }
    if (closeBudgetRemaining(closedAts, { now, windowHours, max: maxCloses }) === 0) {
      return {
        code: 1,
        msg: `close budget spent: ${closedAts.length} router close(s) in the last ${windowHours}h (max ${maxCloses}) — leave #${n} for the next fire and name it in the report`,
      };
    }
  }

  // Consolidate FIRST: if the canonical never hears about the duplicate, the
  // close below would lose whatever the duplicate added.
  if (verdict === "duplicate") {
    const note = `**Consolidated #${n} into this issue** (\`issue-triage\`).\n\n${String(carry).trimEnd()}\n\n<!-- wf:consolidated-from:${n} -->\n`;
    const c = await gh("POST", `/repos/${repo}/issues/${of}/comments`, { body: note });
    if (c.status !== 201) return { code: c.status < 500 ? 2 : 3, msg: `POST consolidation comment on #${of} -> HTTP ${c.status}` };
  }

  const c = await gh("POST", `/repos/${repo}/issues/${n}/comments`, {
    body: settleComment(body, { verdict, of, pr, supersededBy }),
  });
  if (c.status !== 201) return { code: c.status < 500 ? 2 : 3, msg: `POST comment -> HTTP ${c.status}` };

  if (!closing) return { code: 0, msg: `#${n} reviewed — still valid, left open` };

  // Close BEFORE labelling (see header): a failed close leaves an unlabelled
  // open issue, which the next run simply settles again.
  const p = await gh("PATCH", `/repos/${repo}/issues/${n}`, { state: "closed", state_reason: CLOSE_STATE_REASON[verdict] });
  if (p.status !== 200) return { code: p.status < 500 ? 2 : 3, msg: `PATCH close #${n} -> HTTP ${p.status}` };

  const name = closedLabel(verdict);
  const m = CLOSED_LABEL_META(verdict);
  const cr = await gh("POST", `/repos/${repo}/labels`, { name, color: m.color, description: m.description });
  if (cr.status !== 201 && cr.status !== 422) console.error(`issue-triage-settle: WARN ensure label "${name}" -> HTTP ${cr.status}`);
  const l = await gh("POST", `/repos/${repo}/issues/${n}/labels`, { labels: [name] });
  // The issue IS closed; a missing label only weakens reopen detection and the
  // budget count, so it is reported loudly rather than failing the settle.
  if (l.status !== 200) console.error(`issue-triage-settle: WARN #${n} closed but could not be labelled ${name} (HTTP ${l.status}) — add it by hand`);

  const why = verdict === "duplicate" ? `duplicate of #${of}` : verdict === "completed" ? `completed by #${pr}` : `superseded by ${supersededBy}`;
  return { code: 0, msg: `#${n} closed — ${why}` };
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

function readBody(path, what) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new Error(`${what} unreadable: ${path}`);
  }
  if (text.trim().length === 0) throw new Error(`${what} is empty — refusing to post an empty comment (W-4)`);
  const mentions = findRawMentions(text);
  if (mentions.length > 0) throw new Error(`${what} contains raw GitHub @-mention(s): ${mentions.join(", ")} — reference agents as \`wf:<slug>\` (ML-012)`);
  return text;
}

async function main() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const projectId = arg("project");
  const issue = arg("issue");
  const verdict = arg("verdict");
  const ofArg = arg("of");
  const prArg = arg("pr");
  const supersededBy = arg("superseded-by") ?? "";
  const bodyFile = arg("body-file");
  const carryFile = arg("carry-file");
  const maxCloses = Number(arg("max-closes") ?? DEFAULT_MAX_CLOSES);
  const windowHours = Number(arg("window-hours") ?? DEFAULT_CLOSE_WINDOW_HOURS);
  let repo = arg("repo");

  if (!token) return die(2, "GITHUB_TOKEN (or GH_TOKEN) env is required");
  if (!issue || !/^\d+$/.test(issue)) return die(1, "--issue <number> is required (positive integer)");
  try {
    assertSettleVerdict(verdict);
  } catch (e) {
    return die(1, e instanceof Error ? e.message : String(e));
  }
  if (!bodyFile) return die(1, "--body-file <path> is required — a settle with no stated reason is not a verdict");
  if (ofArg !== undefined && !/^\d+$/.test(ofArg)) return die(1, "--of must be an issue number");
  if (prArg !== undefined && !/^\d+$/.test(prArg)) return die(1, "--pr must be a PR number");
  if (!Number.isInteger(maxCloses) || maxCloses < 0) return die(1, `--max-closes must be a non-negative integer (got ${maxCloses})`);
  if (!Number.isFinite(windowHours) || windowHours <= 0) return die(1, `--window-hours must be positive (got ${windowHours})`);
  if (verdict === "duplicate" && !carryFile) {
    return die(1, "--carry-file <path> is required for duplicate — say what this issue adds to the canonical (or that it adds nothing), so consolidating loses nothing");
  }
  if (findRawMentions(supersededBy).length > 0) return die(1, "--superseded-by contains a raw @-mention (ML-012)");
  if (!repo && projectId) {
    try {
      const r = projectRepo(REPO_ROOT, projectId);
      repo = `${r.owner}/${r.repo}`;
    } catch (e) {
      return die(1, e.message);
    }
  }
  if (!repo || !/^[^/]+\/[^/]+$/.test(repo)) return die(1, "--repo <owner>/<repo> (or --project <id>) is required");

  let body;
  let carry = null;
  try {
    body = readBody(bodyFile, "body-file");
    if (verdict === "duplicate") carry = readBody(carryFile, "carry-file");
  } catch (e) {
    return die(1, e.message);
  }

  const gh = makeGh({ token, userAgent: "workforce-issue-triage" });
  const { code, msg } = await runSettle(gh, repo, {
    issue,
    verdict,
    of: ofArg === undefined ? null : Number(ofArg),
    pr: prArg === undefined ? null : Number(prArg),
    supersededBy,
    body,
    carry,
    maxCloses,
    windowHours,
  });
  return code === 0 ? (console.error(`issue-triage-settle: ${msg}`), 0) : die(code, msg);
}

function die(code, msg) {
  console.error(`issue-triage-settle: ${msg}`);
  return code;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(await main().catch((e) => die(3, e instanceof Error ? e.message : String(e))));
}
