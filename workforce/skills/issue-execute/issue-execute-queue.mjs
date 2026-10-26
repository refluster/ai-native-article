#!/usr/bin/env node
// issue-execute/issue-execute-queue.mjs — the executor's selection rule as a
// pure function (adr-0046 §3), so "I work only what is assigned to me" is a
// checkable statement rather than prose (owen, #809 cycle 1).
//
//   is:issue is:open label:stage:assigned label:owner:<slug>
//   minus any issue an OPEN PR already references (that PR is the claim),
//   oldest activity first, at most `max`.
//
// Dependency-free. The caller supplies the open issues and the claim map it
// already read (the lifecycle's scan exposes both); this module never reaches
// the network.

export const STAGE_ASSIGNED = "stage:assigned";
export const OWNER_PREFIX = "owner:";
export const DEFAULT_MAX = 2;

const lc = (l) => String(typeof l === "string" ? l : l?.name ?? "").toLowerCase();

/** True when `issue` is open, Assigned, and owned by `slug`. */
export function isMine(issue, slug) {
  if (!issue || issue.state === "closed" || issue.pull_request) return false;
  const labels = (issue.labels ?? []).map(lc);
  const owner = `${OWNER_PREFIX}${String(slug || "").toLowerCase()}`;
  return labels.includes(STAGE_ASSIGNED) && labels.includes(owner);
}

/**
 * The issues this member works this fire. `openPrRefs` is a Set (or Map keyed
 * by issue number) of issues an open PR references; those are held and
 * skipped. Returns at most `max`, oldest `updated_at` first.
 */
export function executeQueue(issues = [], { slug, openPrRefs, max = DEFAULT_MAX } = {}) {
  if (!slug) throw new Error("executeQueue: slug is required — the queue is defined by owner:<slug>");
  const held = (n) => (openPrRefs instanceof Map ? openPrRefs.has(n) : openPrRefs instanceof Set ? openPrRefs.has(n) : false);
  return issues
    .filter((i) => isMine(i, slug) && !held(i.number))
    .sort((a, b) => Date.parse(a.updated_at ?? 0) - Date.parse(b.updated_at ?? 0))
    .slice(0, Math.max(0, Number(max) || 0));
}
