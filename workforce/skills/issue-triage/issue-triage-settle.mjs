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
// Usage:
//   GITHUB_TOKEN=… node workforce/skills/issue-triage/issue-triage-settle.mjs \
//     --project agent-workforce --issue 512 --verdict duplicate --of 498 \
//     --body-file /tmp/settle-512.md --carry-file /tmp/carry-512.md
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
  SETTLE_VERDICTS,
  assertSettleVerdict,
  closedLabel,
  settleRefusal,
} from "./issue-lanes.mjs";

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
  const of = ofArg === undefined ? null : Number(ofArg);

  let target;
  let canonical = null;
  let mergedPr = null;
  let heldBy = [];
  try {
    const r = await gh("GET", `/repos/${repo}/issues/${issue}`);
    if (r.status !== 200) return die(3, `GET issue ${issue} -> HTTP ${r.status}`);
    target = r.json;
    if (verdict === "duplicate" && of) {
      const c = await gh("GET", `/repos/${repo}/issues/${of}`);
      if (c.status === 200) canonical = c.json;
      else if (c.status !== 404) return die(3, `GET issue ${of} -> HTTP ${c.status}`);
    }
    if (verdict === "completed" && prArg) {
      const p = await gh("GET", `/repos/${repo}/pulls/${prArg}`);
      if (p.status === 200) mergedPr = p.json;
      else if (p.status !== 404) return die(3, `GET pull ${prArg} -> HTTP ${p.status}`);
      else return die(1, `#${prArg} is not a pull request on ${repo}`);
    }
    heldBy = (await collectOpenPrRefs(gh, repo)).get(Number(issue)) ?? [];
  } catch (e) {
    return die(3, e?.msg || e?.message || String(e));
  }
  if (target?.pull_request) return die(1, `#${issue} is a pull request — settle issues only`);
  if (target?.state !== "open") return die(1, `#${issue} is already ${target?.state}`);

  const labels = Array.isArray(target?.labels) ? target.labels.map((l) => (typeof l === "string" ? l : l?.name)) : [];
  const refusal = settleRefusal({ verdict, issue: Number(issue), labels, heldBy, of, canonical, mergedPr, supersededBy });
  if (refusal) return die(1, refusal);

  // Consolidate FIRST: if the canonical never hears about the duplicate, the
  // close below would lose whatever the duplicate added.
  if (verdict === "duplicate") {
    const note =
      `**Consolidated #${issue} into this issue** (\`issue-triage\`).\n\n${carry.trimEnd()}\n\n<!-- wf:consolidated-from:${issue} -->\n`;
    const c = await gh("POST", `/repos/${repo}/issues/${of}/comments`, { body: note });
    if (c.status !== 201) return die(c.status < 500 ? 2 : 3, `POST consolidation comment on #${of} -> HTTP ${c.status}`);
  }

  const c = await gh("POST", `/repos/${repo}/issues/${issue}/comments`, {
    body: settleComment(body, { verdict, of, pr: prArg, supersededBy }),
  });
  if (c.status !== 201) return die(c.status < 500 ? 2 : 3, `POST comment -> HTTP ${c.status}`);

  if (!CLOSE_VERDICTS.includes(verdict)) {
    console.error(`issue-triage-settle: #${issue} reviewed — still valid, left open`);
    return 0;
  }

  const name = closedLabel(verdict);
  const m = CLOSED_LABEL_META(verdict);
  const cr = await gh("POST", `/repos/${repo}/labels`, { name, color: m.color, description: m.description });
  if (cr.status !== 201 && cr.status !== 422) console.error(`issue-triage-settle: WARN ensure label "${name}" -> HTTP ${cr.status}`);
  const l = await gh("POST", `/repos/${repo}/issues/${issue}/labels`, { labels: [name] });
  // The label is what makes a later reopen recognisable; closing without it
  // would let the router close the same issue again after a human reopened it.
  if (l.status !== 200) return die(l.status < 500 ? 2 : 3, `could not label #${issue} ${name} -> HTTP ${l.status} — not closing`);

  const p = await gh("PATCH", `/repos/${repo}/issues/${issue}`, { state: "closed", state_reason: CLOSE_STATE_REASON[verdict] });
  if (p.status !== 200) return die(p.status < 500 ? 2 : 3, `PATCH close #${issue} -> HTTP ${p.status}`);

  const why = verdict === "duplicate" ? `duplicate of #${of}` : verdict === "completed" ? `completed by #${prArg}` : `superseded by ${supersededBy}`;
  console.error(`issue-triage-settle: #${issue} closed — ${why}`);
  return 0;
}

function die(code, msg) {
  console.error(`issue-triage-settle: ${msg}`);
  return code;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(await main().catch((e) => die(3, e instanceof Error ? e.message : String(e))));
}
