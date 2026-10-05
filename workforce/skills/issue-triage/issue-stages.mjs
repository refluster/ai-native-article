#!/usr/bin/env node
// issue-triage/issue-stages.mjs — the issue lifecycle's vocabulary and pure
// decisions (adr-0046). Prose twin: workforce/docs/runbooks/issue-to-merge-flow.md;
// the project-side twin on PSVL/asp-cloud is docs/runbooks/issue_lifecycle.md.
//
//   Proposed ──reconcile──▶ Verified ──route──▶ Assigned ──owner──▶ Closed
//      │                        ▲                  │
//      └──── done / dup / stale ─┼──── hand-back ───┘
//                                └──▶ Closed
//
// Four stages, two label families. `stage:<stage>` is the stage; an open issue
// with no stage label is Proposed. `owner:<slug>` exists iff the stage is
// Assigned, and there is exactly one. `owner:operator` is the human; every
// other owner must be a member whose `issue-execute` binding is live on the
// project (the roster is read from the agents-api, never assumed).
//
// This module replaced issue-lanes.mjs: lanes, `wf:handback`, `wf:human:*`,
// claim labels and hop markers are gone (adr-0046 §2). The guards that remain
// are the ones that answer "can somebody actually act on this?":
//   - an owner must be bound (or be the operator);
//   - an issue an open PR references is held — nobody re-stages it;
//   - a close needs evidence; closes are budgeted per run;
//   - routing terminates: the fourth assignment is the operator.
//
// Dependency-free and pure so the scan, the set script and the tests share one
// vocabulary. Fail loud (C-4): an unknown stage throws rather than becoming a
// label nobody consumes.

export const STAGE_LABEL_PREFIX = "stage:";
export const OWNER_LABEL_PREFIX = "owner:";
export const STAGES = Object.freeze(["proposed", "verified", "assigned"]);
/** The human. Valid on every project; the only owner with no binding. */
export const OPERATOR = "operator";
/** Issues in this label follow their own flow (incident response) and carry
 *  no stage. Every scan skips them; the set script refuses them. */
export const INCIDENT_LABEL = "incident";
/** The executor skill an owner must be bound to (adr-0046 §3). */
export const EXECUTOR_SKILL = "issue-execute";

// The stage scale darkens as an issue moves forward (same palette as
// PSVL/asp-cloud's labels.yml, so one issue reads the same on both repos).
export const STAGE_LABEL_META = Object.freeze({
  proposed: { color: "d4e5f7", description: "Filed, not yet checked by the backlog reconcile (adr-0046)" },
  verified: { color: "7fb2e5", description: "Checked and labelled; waiting for the router to assign an owner (adr-0046)" },
  assigned: { color: "1f6fb2", description: "Exactly one owner:* is responsible; only that owner acts on it (adr-0046)" },
});
export const OWNER_LABEL_META = Object.freeze({
  color: "f9d0c4",
  description: "The one member (or the operator) responsible for closing this issue. A persona slug, not a GitHub account (ML-012).",
});

/** Labels of the retired vocabularies (adr-0022/adr-0038, and the per-worker
 *  parks before them). Read only to be removed; never written again. */
export const RETIRED_LABEL_PREFIXES = Object.freeze([
  "wf:lane:",
  "wf:owner:",
  "wf:human:",
  "wf:closed:",
  "issue-implement:",
  "issue-design:",
]);
export const RETIRED_LABELS = Object.freeze(["wf:handback", "wf:in-progress", "wf:ready", "in-progress"]);

const SLUG_RE = /^[a-z]+$/;
const lc = (l) => String(typeof l === "string" ? l : l?.name ?? "").toLowerCase();

export function assertStage(stage) {
  if (!STAGES.includes(stage)) {
    throw new Error(`unknown stage "${stage}" — must be one of: ${STAGES.join(", ")} (adr-0046; C-4: never invent a stage)`);
  }
  return stage;
}

export function stageLabel(stage) {
  return `${STAGE_LABEL_PREFIX}${assertStage(stage)}`;
}

/** `owner:<slug>`. Slug-shaped like every agent reference — never an
 *  `@`-mention (ML-012). */
export function ownerLabel(slug) {
  const s = String(slug || "").toLowerCase();
  if (!SLUG_RE.test(s)) throw new Error(`owner must be an agent slug ([a-z]+) or "${OPERATOR}", got "${slug}"`);
  return `${OWNER_LABEL_PREFIX}${s}`;
}

export function isOperator(slug) {
  return String(slug || "").toLowerCase() === OPERATOR;
}

/** The stage an open issue is in. No label = Proposed (adr-0046 §1). Throws
 *  on a `stage:` label naming an unknown stage. */
export function stageOf(labels = []) {
  for (const l of labels) {
    const name = lc(l);
    if (name.startsWith(STAGE_LABEL_PREFIX)) return assertStage(name.slice(STAGE_LABEL_PREFIX.length));
  }
  return "proposed";
}

/** Every `owner:<slug>` an issue carries (rule 2 says there is at most one;
 *  the reconcile and the set script enforce it). */
export function ownersOf(labels = []) {
  return labels.map(lc).filter((n) => n.startsWith(OWNER_LABEL_PREFIX)).map((n) => n.slice(OWNER_LABEL_PREFIX.length));
}

/** The owner, or null. With more than one (a broken invariant) returns the
 *  first; `ownersOf` shows the rest. */
export function ownerOf(labels = []) {
  return ownersOf(labels)[0] ?? null;
}

export function isIncident(labels = []) {
  return labels.map(lc).includes(INCIDENT_LABEL);
}

export function retiredLabelsIn(labels = []) {
  return labels
    .map((l) => (typeof l === "string" ? l : l?.name ?? ""))
    .filter((l) => {
      const n = l.toLowerCase();
      return RETIRED_LABELS.includes(n) || RETIRED_LABEL_PREFIXES.some((p) => n.startsWith(p));
    });
}

// ── A claim is an open PR, nothing else ────────────────────────────────────
//
// `Closes #N`, `Fixes #N`, `Resolves #N` and `Refs #N` in a PR body, or an
// `issue-<N>` head branch. Same-repo references only. An issue an open PR
// references is held by whoever opened it; the scans skip it and the set
// script refuses to move it under that branch.
const ISSUE_REF_RE = /(?:^|[^\w/])(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs?)\b[:\s]+#(\d+)\b/gi;
const ISSUE_BRANCH_RE = /(?:^|\/)issue-(\d+)(?:-|$)/;

export function issueRefsOfPr({ body = "", headRef = "" } = {}) {
  const refs = new Set();
  for (const m of String(body || "").matchAll(ISSUE_REF_RE)) refs.add(Number(m[1]));
  const b = String(headRef || "").match(ISSUE_BRANCH_RE);
  if (b) refs.add(Number(b[1]));
  return refs;
}

/** The slugs bound to `skill` on `projectId`, from a `GET /agents` payload
 *  (`{items: [{slug, bindings: [{skill, project_id}]}]}` or a bare array). */
export function rosterFromAgents(agents, projectId, skill = EXECUTOR_SKILL) {
  const list = Array.isArray(agents) ? agents : (agents?.items ?? agents?.agents ?? []);
  const out = [];
  for (const a of list) {
    if (!a?.slug || a?.archived) continue;
    const bound = (a.bindings ?? []).some((b) => b?.skill === skill && b?.project_id === projectId);
    if (bound) out.push(String(a.slug).toLowerCase());
  }
  return out.sort();
}

/** True when `slug` may own an issue on a project whose executor roster is
 *  `roster`. `roster === null` means "unknown" and is NOT a pass: an owner
 *  that cannot be checked is refused, because an unserved owner is the
 *  failure this vocabulary exists to end (#760). */
export function ownerIsServed(slug, roster) {
  if (isOperator(slug)) return true;
  return Array.isArray(roster) && roster.includes(String(slug || "").toLowerCase());
}

// ── Reconcile: Proposed → Verified | Closed, and the 30-day re-check ────────
export const DEFAULT_STALE_DAYS = 30;

/**
 * What the backlog reconcile owes one open issue.
 *   check       — Proposed: decide done / duplicate / stale / valid.
 *   stale-check — Verified or Assigned, untouched for `staleDays`, not held by
 *                 an open PR: apply the same three closing rows; a still-valid
 *                 issue keeps its stage and owner.
 *   skip        — an incident, a held issue, or a live Verified/Assigned one.
 */
export function reconcileAction({ labels = [], updatedAt, number } = {}, { now = Date.now(), staleDays = DEFAULT_STALE_DAYS, openPrRefs } = {}) {
  if (isIncident(labels)) return { action: "skip", why: "incident — follows incident response, carries no stage", stage: null };
  const stage = stageOf(labels);
  if (openPrRefs instanceof Set && Number.isInteger(number) && openPrRefs.has(number)) {
    return { action: "skip", why: `an open PR references #${number} — its owner holds it`, stage };
  }
  if (stage === "proposed") return { action: "check", why: "proposed — not yet checked", stage };
  const updated = Date.parse(updatedAt ?? "");
  if (!Number.isNaN(updated) && now - updated > staleDays * 86400_000) {
    return { action: "stale-check", why: `${stage} and untouched for >${staleDays}d — re-check that it is still worth doing`, stage };
  }
  return { action: "skip", why: `${stage}, live`, stage };
}

// ── Route: Verified → Assigned ─────────────────────────────────────────────

/**
 * What the router owes one open issue.
 *   route    — Verified: choose exactly one owner.
 *   reassign — Assigned, but the owner is missing or no executor serves it on
 *              this project (the #760 shape). Not re-examined while an open PR
 *              holds the issue.
 *   skip     — Proposed (the reconcile goes first), an incident, or Assigned to
 *              a served owner.
 * `roster` is the live list of slugs bound to issue-execute here; null =
 * unknown, which skips the served check rather than guessing.
 */
export function routeAction({ labels = [], number } = {}, { roster = null, openPrRefs } = {}) {
  if (isIncident(labels)) return { action: "skip", why: "incident", stage: null, owner: null };
  const stage = stageOf(labels);
  const owners = ownersOf(labels);
  const owner = owners[0] ?? null;
  if (stage === "verified") return { action: "route", why: "verified — needs an owner", stage, owner: null };
  if (stage === "proposed") return { action: "skip", why: "proposed — the reconcile verifies it first", stage, owner: null };
  if (openPrRefs instanceof Set && Number.isInteger(number) && openPrRefs.has(number)) {
    return { action: "skip", why: `assigned and an open PR references #${number}`, stage, owner };
  }
  if (!owner) return { action: "reassign", why: "assigned but carries no owner:* label (rule 2)", stage, owner: null };
  if (owners.length > 1) return { action: "reassign", why: `assigned with ${owners.length} owner labels (${owners.join(", ")}) — exactly one is allowed`, stage, owner };
  if (Array.isArray(roster) && !ownerIsServed(owner, roster)) {
    return {
      action: "reassign",
      why: `assigned to owner:${owner}, but ${EXECUTOR_SKILL} on this project is bound to ${roster.length ? roster.join(", ") : "nobody"} — no worker will take it`,
      stage,
      owner,
    };
  }
  return { action: "skip", why: `assigned to owner:${owner}`, stage, owner };
}

// ── Routing terminates ─────────────────────────────────────────────────────
//
// The router's own assignment comments are the count: a hidden marker in each
// one, counted on the next decision. At the cap the owner is the operator —
// an issue assigned three times without closing has a scope or vocabulary
// problem, and naming that is a human's call (adr-0038 §6 kept this bound;
// adr-0046 dropped the separate hop marker in favour of counting the
// comments that already exist).
export const ASSIGN_CAP = 3;
export const ASSIGN_MARKER = "<!-- stage:assigned -->";
/** Written into every closing comment, so a reopen is recognisable: an open
 *  issue whose comments carry it was closed by the reconcile and reopened by
 *  a human, who has overruled it. */
export const CLOSE_MARKER = "<!-- stage:closed -->";

export function countMarker(commentBodies = [], marker) {
  let n = 0;
  for (const body of commentBodies) {
    if (String(body || "").includes(marker)) n++;
  }
  return n;
}

/** The owner the router may actually apply, given how often it has assigned
 *  this issue before. */
export function applyAssignCap(owner, priorAssignments = 0, { cap = ASSIGN_CAP } = {}) {
  const n = Number(priorAssignments) + 1;
  if (n > cap && !isOperator(owner)) {
    return {
      owner: OPERATOR,
      assignments: n,
      capped: true,
      why: `assignment cap reached — assigned ${priorAssignments}× already (cap ${cap}); the issue's scope or the roster is the problem, and naming that is the operator's call`,
    };
  }
  return { owner: String(owner).toLowerCase(), assignments: n, capped: false, why: `assignment ${n}/${cap}` };
}

// ── The label plan for a transition (pure; the set script applies it) ──────

/**
 * Labels to add and remove when moving an issue to `stage` (owned by `owner`
 * when Assigned). Enforces rules 1 and 2 and strips every retired label.
 */
export function labelPlan(current = [], { stage, owner = null } = {}) {
  assertStage(stage);
  if (stage === "assigned" && !owner) throw new Error("an assigned issue needs an owner (rule 2)");
  if (stage !== "assigned" && owner) throw new Error(`only stage "assigned" carries an owner (rule 2), got owner "${owner}" for "${stage}"`);
  const keepStage = stageLabel(stage);
  const keepOwner = owner ? ownerLabel(owner) : null;
  const names = current.map((l) => (typeof l === "string" ? l : l?.name ?? ""));
  const remove = [];
  for (const l of names) {
    const n = l.toLowerCase();
    if (n.startsWith(STAGE_LABEL_PREFIX) && n !== keepStage) remove.push(l);
    else if (n.startsWith(OWNER_LABEL_PREFIX) && n !== keepOwner) remove.push(l);
  }
  remove.push(...retiredLabelsIn(names));
  const have = new Set(names.map((l) => l.toLowerCase()));
  const add = [];
  if (!have.has(keepStage)) add.push(keepStage);
  if (keepOwner && !have.has(keepOwner)) add.push(keepOwner);
  return { add, remove: [...new Set(remove)] };
}

/**
 * The guard a verify / assign transition must pass. `null` = may be applied,
 * else the refusal reason.
 *   - an incident is never staged;
 *   - an issue an open PR references is held — neither a re-assignment nor a
 *     hand-back happens under a live branch (close or merge the PR first);
 *   - an owner must be served: bound to issue-execute here, or the operator.
 */
export function transitionRefusal({ to, labels = [], owner = null, heldBy = [], roster = null, issue }) {
  assertStage(to);
  if (isIncident(labels)) return `#${issue} is an incident — it follows incident response and carries no stage`;
  if (to === "proposed") return `"proposed" is the filing state — an issue is proposed by having no stage label; use verified / assigned / closed`;
  if (heldBy.length > 0) {
    return `#${issue} is held by open PR ${heldBy.map((n) => `#${n}`).join(", ")} — move it only after that PR merges or closes`;
  }
  if (to === "assigned") {
    if (!owner) return "--owner <slug> is required for assigned (rule 2)";
    if (!ownerIsServed(owner, roster)) {
      return (
        `owner "${owner}" refused: ${EXECUTOR_SKILL} on this project is bound to ` +
        `${Array.isArray(roster) ? (roster.length ? roster.join(", ") : "nobody") : "(roster unreadable)"} — ` +
        `assign a bound member or "${OPERATOR}"; an unserved owner just waits forever (#760)`
      );
    }
  }
  return null;
}

// ── Closing ────────────────────────────────────────────────────────────────
export const CLOSE_REASONS = Object.freeze({
  completed: "a merged PR or a commit on the default branch delivered it (--pr <merged PR>)",
  duplicate: "another OPEN issue asks for the same deliverable — consolidated into it (--of <survivor>)",
  not_planned: "premise expired, superseded, or not worth doing at this scale (the comment says why)",
});
export const CLOSE_REASON_NAMES = Object.freeze(Object.keys(CLOSE_REASONS));
/** GitHub's state_reason for each. `duplicate` closes as not_planned with a
 *  leading `Duplicate of #N` line, which GitHub renders as the duplicate
 *  marker. */
export const CLOSE_STATE_REASON = Object.freeze({ completed: "completed", duplicate: "not_planned", not_planned: "not_planned" });
export const DEFAULT_MAX_CLOSES = 10;

export function assertCloseReason(r) {
  if (!CLOSE_REASON_NAMES.includes(r)) {
    throw new Error(`unknown close reason "${r}" — must be one of: ${CLOSE_REASON_NAMES.join(", ")} (C-4: never invent a verdict)`);
  }
  return r;
}

/**
 * The guard a close must pass. `null` = may be applied, else the refusal.
 *   - held by an open PR → close the other issue instead, or wait for the PR;
 *   - reopened by a human after a reconcile close → the human overruled it;
 *   - an incident closes through incident response;
 *   - duplicate: the survivor must be another OPEN issue (not a PR);
 *   - completed: the cited PR must be merged (or --commit named);
 *   - closes past the per-run budget are refused.
 */
export function closeRefusal({ reason, issue, labels = [], heldBy = [], of = null, canonical = null, mergedPr = null, commit = "", reopened = false, closesSoFar = 0, maxCloses = DEFAULT_MAX_CLOSES }) {
  assertCloseReason(reason);
  if (isIncident(labels)) return `#${issue} is an incident — it closes through incident response, not the reconcile`;
  if (heldBy.length > 0) {
    return `#${issue} is held by open PR ${heldBy.map((n) => `#${n}`).join(", ")} — do not close it under a live branch${reason === "duplicate" ? " (close the other issue into this one instead)" : ""}`;
  }
  if (reopened) return `#${issue} was closed by the reconcile before and reopened by a human — that overrules the reconcile; verify it instead of closing it again`;
  if (closesSoFar >= maxCloses) return `close budget spent (${closesSoFar}/${maxCloses} this run) — leave the rest for the next run and name them in the report`;
  if (reason === "duplicate") {
    if (!Number.isInteger(of) || of <= 0) return "--of <survivor issue number> is required for duplicate";
    if (of === Number(issue)) return "an issue cannot be a duplicate of itself";
    if (!canonical) return `survivor #${of} could not be read`;
    if (canonical.pull_request) return `#${of} is a pull request — a duplicate consolidates into an ISSUE; if that PR delivered this, the reason is "completed"`;
    if (canonical.state !== "open") return `survivor #${of} is ${canonical.state} — if it was done, this issue is "completed" (cite the PR); a duplicate needs a live issue to fold into`;
    return null;
  }
  if (reason === "completed") {
    if (mergedPr) {
      if (!mergedPr.merged_at) return `PR #${mergedPr.number} is not merged — "completed" needs a merged PR`;
      return null;
    }
    if (String(commit || "").trim()) return null;
    return "--pr <merged PR number> (or --commit <sha>) is required for completed — evidence or it didn't ship";
  }
  return null;
}
