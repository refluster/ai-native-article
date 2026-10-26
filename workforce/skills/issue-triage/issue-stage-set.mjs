#!/usr/bin/env node
// issue-triage/issue-stage-set.mjs — the lifecycle's ONE write surface
// (adr-0046 §2). Every transition goes through here:
//
//   --to verified   the reconcile verifies a Proposed issue, OR an owner hands
//                   an Assigned issue back (the owner label is removed; the
//                   comment says what is needed). Dispatches issue-triage.
//   --to assigned   the router names exactly one owner (--owner <slug>, bound
//                   to issue-execute on this project, or `operator`).
//                   Dispatches that member's issue-execute.
//   --to closed     the reconcile closes with evidence (--reason completed
//                   --pr <merged> | --commit <sha>; --reason duplicate --of
//                   <open survivor>; --reason not_planned). For a duplicate the
//                   carry note is posted on the survivor FIRST.
//
// It posts the one comment, applies the label plan (one stage, one owner,
// every retired label stripped), and runs the guards from issue-stages.mjs:
// an incident is never staged; an issue an open PR references is held; an
// owner must be served; a close needs evidence; closes are budgeted per run
// (--max-closes, counted in --budget-file, default /tmp/issue-stage-closes.json);
// the fourth assignment is the operator. Label + comment + close only: it never
// edits a body and never opens a PR (R-N9).
//
// Dispatches are best-effort (adr-0025): the label is the load-bearing write.
//
// Usage:
//   GITHUB_TOKEN=… node workforce/skills/issue-triage/issue-stage-set.mjs \
//     --project asp-cloud --issue 866 --to assigned --owner ren \
//     --body-file /tmp/assign-866.md
//
// Exit codes: 0 applied · 1 bad args / refused guard · 2 endpoint rejected · 3 network.

import { ensureProxyAwareEntry } from "../../../scripts/lib/proxy-bootstrap.mjs";
ensureProxyAwareEntry(import.meta.url);

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { projectRepo } from "../pr-autopilot/pr-autopilot-scan.mjs";
import { makeGh } from "../pr-autopilot/pr-merge.mjs";
import { findRawMentions } from "../pr-autopilot/pr-autopilot-post.mjs";
import { collectOpenPrRefs, collectRoster, labelsOf } from "./issue-stage-scan.mjs";
import {
  ASSIGN_MARKER,
  CLOSE_MARKER,
  CLOSE_STATE_REASON,
  DEFAULT_MAX_CLOSES,
  EXECUTOR_SKILL,
  OWNER_LABEL_META,
  STAGE_LABEL_META,
  applyAssignCap,
  assertCloseReason,
  closeRefusal,
  countMarker,
  isOperator,
  labelPlan,
  ownerOf,
  stageLabel,
  stageOf,
  transitionRefusal,
} from "./issue-stages.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");
export const DEFAULT_BUDGET_FILE = "/tmp/issue-stage-closes.json";
export const BUDGET_WINDOW_HOURS = 20;

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

/** Closes recorded in the budget file inside the window. The file is per
 *  machine (a CCR session's /tmp), so the bound is per run — which is the
 *  bound the skill body states.
 *
 *  Fail loud (C-4): a budget file that cannot be parsed, or is not a list,
 *  throws — a corrupt file must not read as "0 closes so far". A row whose
 *  `at` is missing or unparseable is COUNTED (kept), never dropped: the
 *  direction of every uncertainty here is "spend the budget", because the
 *  budget exists to bound a wrong heuristic, not to be bounded by one. */
export function readCloseBudget(file, { now = Date.now(), windowHours = BUDGET_WINDOW_HOURS } = {}) {
  if (!existsSync(file)) return [];
  let rows;
  try {
    rows = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`close-budget file ${file} is not valid JSON (${e?.message || e}) — refusing to treat it as empty; fix or delete it`);
  }
  if (!Array.isArray(rows)) throw new Error(`close-budget file ${file} must hold a JSON array, got ${typeof rows}`);
  return rows.filter((r) => {
    const at = Date.parse(r?.at ?? "");
    if (Number.isNaN(at)) return true; // unreadable timestamp counts against the budget
    return now - at < windowHours * 3600_000;
  });
}

async function readAllComments(gh, repo, issue) {
  const bodies = [];
  for (let page = 1; page <= 5; page++) {
    const r = await gh("GET", `/repos/${repo}/issues/${issue}/comments?per_page=100&page=${page}`);
    if (r.status !== 200 || !Array.isArray(r.json)) throw new Error(`GET comments -> HTTP ${r.status}`);
    bodies.push(...r.json.map((c) => c?.body));
    if (r.json.length < 100) break;
  }
  return bodies;
}

async function ensureLabel(gh, repo, name, meta) {
  const r = await gh("POST", `/repos/${repo}/labels`, { name, color: meta.color, description: meta.description });
  if (r.status !== 201 && r.status !== 422) console.error(`issue-stage-set: WARN ensure label "${name}" -> HTTP ${r.status}`);
}

async function applyPlan(gh, repo, issue, plan) {
  for (const name of plan.add) {
    const meta = name.startsWith("stage:") ? STAGE_LABEL_META[name.slice("stage:".length)] : OWNER_LABEL_META;
    await ensureLabel(gh, repo, name, meta);
  }
  if (plan.add.length) {
    const l = await gh("POST", `/repos/${repo}/issues/${issue}/labels`, { labels: plan.add });
    if (l.status !== 200) console.error(`issue-stage-set: WARN could not add ${plan.add.join(", ")} -> HTTP ${l.status}`);
  }
  for (const name of plan.remove) {
    const d = await gh("DELETE", `/repos/${repo}/issues/${issue}/labels/${encodeURIComponent(name)}`);
    if (d.status !== 200 && d.status !== 404) console.error(`issue-stage-set: WARN could not remove "${name}" -> HTTP ${d.status}`);
  }
}

async function dispatch(skill, projectId, reason, agent_slug) {
  if (!projectId || process.argv.includes("--no-dispatch")) return;
  const { requestDispatch } = await import("../../scripts/lib/request-dispatch.mjs");
  await requestDispatch({ skill, project_id: projectId, reason, agent_slug }).catch((e) =>
    console.error(`issue-stage-set: WARN dispatch of ${skill} failed (${e?.message || e})`),
  );
}

async function main() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const projectId = arg("project");
  const issue = arg("issue");
  const to = arg("to");
  const owner = arg("owner") ? String(arg("owner")).toLowerCase() : null;
  const reason = arg("reason");
  const of = arg("of") ? Number(arg("of")) : null;
  const prArg = arg("pr") ? Number(arg("pr")) : null;
  const commit = arg("commit") ?? "";
  const bodyFile = arg("body-file");
  const maxCloses = Number(arg("max-closes") ?? DEFAULT_MAX_CLOSES);
  const budgetFile = arg("budget-file") ?? DEFAULT_BUDGET_FILE;
  let repo = arg("repo");

  if (!token) return die(2, "GITHUB_TOKEN (or GH_TOKEN) env is required");
  if (!issue || !/^\d+$/.test(issue)) return die(1, "--issue <number> is required (positive integer)");
  if (!["verified", "assigned", "closed"].includes(to)) return die(1, "--to must be one of: verified, assigned, closed");
  if (!bodyFile) return die(1, "--body-file <path> is required — a transition with no stated reason is not a transition");
  if (to === "closed") {
    try {
      assertCloseReason(reason);
    } catch (e) {
      return die(1, e instanceof Error ? e.message : String(e));
    }
  } else if (reason) return die(1, "--reason is only for --to closed");
  if (to !== "assigned" && owner) return die(1, "--owner is only for --to assigned (rule 2)");
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
  try {
    body = readFileSync(bodyFile, "utf8");
  } catch {
    return die(1, `body-file unreadable: ${bodyFile}`);
  }
  if (body.trim().length === 0) return die(1, "body-file is empty — refusing to post an empty comment (W-4)");
  const mentions = findRawMentions(body);
  if (mentions.length > 0) return die(1, `body contains raw GitHub @-mention(s): ${mentions.join(", ")} — reference members as \`owner:<slug>\` (ML-012)`);

  const gh = makeGh({ token, userAgent: "workforce-issue-stage-set" });

  let current;
  try {
    const r = await gh("GET", `/repos/${repo}/issues/${issue}`);
    if (r.status !== 200) return die(3, `GET issue ${issue} -> HTTP ${r.status}`);
    current = r.json;
  } catch (e) {
    return die(3, e?.msg || e?.message || String(e));
  }
  if (current.pull_request) return die(1, `#${issue} is a pull request — the PR lane is autopilot:*, not stage:*`);
  if (current.state !== "open") return die(1, `#${issue} is ${current.state} — only an open issue moves`);
  const labels = labelsOf(current);
  const fromStage = stageOf(labels);
  const fromOwner = ownerOf(labels);

  let heldBy = [];
  try {
    heldBy = (await collectOpenPrRefs(gh, repo)).get(Number(issue)) ?? [];
  } catch (e) {
    return die(3, `could not verify whether an open PR holds #${issue}: ${e?.msg || e?.message || String(e)}`);
  }

  let comments = [];
  try {
    comments = await readAllComments(gh, repo, issue);
  } catch (e) {
    // The counts below (assignments, a prior close) must not silently read as
    // zero: refuse rather than guess.
    return die(3, `could not read #${issue}'s comments: ${e?.message || e}`);
  }

  // ── closed ────────────────────────────────────────────────────────────────
  if (to === "closed") {
    let canonical = null;
    let mergedPr = null;
    if (reason === "duplicate" && Number.isInteger(of) && of > 0) {
      const r = await gh("GET", `/repos/${repo}/issues/${of}`);
      if (r.status === 200) canonical = r.json;
    }
    if (reason === "completed" && Number.isInteger(prArg) && prArg > 0) {
      const r = await gh("GET", `/repos/${repo}/pulls/${prArg}`);
      if (r.status === 200) mergedPr = r.json;
      else return die(3, `GET pull ${prArg} -> HTTP ${r.status}`);
    }
    let spent;
    try {
      spent = readCloseBudget(budgetFile);
    } catch (e) {
      return die(1, e instanceof Error ? e.message : String(e));
    }
    const refusal = closeRefusal({
      reason,
      issue: Number(issue),
      labels,
      heldBy,
      of,
      canonical,
      mergedPr,
      commit,
      reopened: countMarker(comments, CLOSE_MARKER) > 0,
      closesSoFar: spent.length,
      maxCloses,
    });
    if (refusal) return die(1, refusal);

    if (reason === "duplicate") {
      const carry =
        `**Consolidated from #${issue}** (closed as a duplicate of this issue by the backlog reconcile, adr-0046).\n\n${body.trim()}\n`;
      const c = await gh("POST", `/repos/${repo}/issues/${of}/comments`, { body: carry });
      if (c.status !== 201) return die(c.status < 500 ? 2 : 3, `POST carry note on #${of} -> HTTP ${c.status}`);
      body = `Duplicate of #${of}\n\n${body.trim()}`;
    }
    const c = await gh("POST", `/repos/${repo}/issues/${issue}/comments`, { body: `${body.trimEnd()}\n\n${CLOSE_MARKER}\n` });
    if (c.status !== 201) return die(c.status < 500 ? 2 : 3, `POST comment -> HTTP ${c.status}`);
    const p = await gh("PATCH", `/repos/${repo}/issues/${issue}`, { state: "closed", state_reason: CLOSE_STATE_REASON[reason] });
    if (p.status !== 200) return die(p.status < 500 ? 2 : 3, `close #${issue} -> HTTP ${p.status}`);
    try {
      writeFileSync(budgetFile, JSON.stringify([...spent, { issue: Number(issue), reason, at: new Date().toISOString() }]));
    } catch (e) {
      console.error(`issue-stage-set: WARN could not record the close in ${budgetFile} (${e?.message || e})`);
    }
    console.error(`issue-stage-set: #${issue} closed (${reason}${of ? ` of #${of}` : ""}${prArg ? ` via PR #${prArg}` : ""}) — ${spent.length + 1}/${maxCloses} this run`);
    return 0;
  }

  // ── verified / assigned ───────────────────────────────────────────────────
  let roster = null;
  if (to === "assigned" && !isOperator(owner)) {
    if (!projectId) return die(1, "--project <id> is required to assign a member (the roster is read per project)");
    try {
      roster = await collectRoster(projectId);
    } catch (e) {
      return die(3, `could not read the roster: ${e?.message || e}`);
    }
  }
  let finalOwner = owner;
  let capped = null;
  if (to === "assigned") {
    capped = applyAssignCap(owner, countMarker(comments, ASSIGN_MARKER));
    finalOwner = capped.owner;
  }
  const refusal = transitionRefusal({ to, labels, owner: finalOwner, heldBy, roster, issue: Number(issue) });
  if (refusal) return die(1, refusal);

  if (capped?.capped) {
    console.error(`issue-stage-set: #${issue} ${capped.why} — assigning "operator" over requested "${owner}"`);
    body =
      `${body.trimEnd()}\n\n> **Assignment cap reached.** This issue has been assigned ${capped.assignments - 1} times without closing, ` +
      `so it goes to \`owner:operator\` rather than to a member a ${capped.assignments}th time. That is a finding about its scope or the roster, not a verdict on the issue (adr-0046).\n`;
  }
  const marker = to === "assigned" ? ASSIGN_MARKER : "";
  const c = await gh("POST", `/repos/${repo}/issues/${issue}/comments`, { body: `${body.trimEnd()}\n${marker ? `\n${marker}\n` : ""}` });
  if (c.status !== 201) return die(c.status < 500 ? 2 : 3, `POST comment -> HTTP ${c.status}`);

  const plan = labelPlan(labels, { stage: to, owner: to === "assigned" ? finalOwner : null });
  await applyPlan(gh, repo, issue, plan);

  const handBack = to === "verified" && fromStage === "assigned";
  console.error(
    `issue-stage-set: #${issue} ${fromStage}${fromOwner ? ` (owner:${fromOwner})` : ""} -> ${to}${finalOwner ? ` (owner:${finalOwner})` : ""}` +
      `${handBack ? " [hand-back]" : ""}; +${plan.add.join(",") || "-"} -${plan.remove.join(",") || "-"}`,
  );

  // adr-0025 — the hand-off is an event; the label above is the load-bearing write.
  if (to === "verified") {
    await dispatch("issue-triage", projectId, `issue #${issue} ${handBack ? "handed back" : "verified"} on ${repo} — route it`);
  } else if (!isOperator(finalOwner)) {
    await dispatch(EXECUTOR_SKILL, projectId, `issue #${issue} assigned to owner:${finalOwner} on ${repo} — work it`, finalOwner);
  }
  return 0;
}

function die(code, msg) {
  console.error(`issue-stage-set: ${msg}`);
  return code;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(await main().catch((e) => die(3, e instanceof Error ? e.message : String(e))));
}
