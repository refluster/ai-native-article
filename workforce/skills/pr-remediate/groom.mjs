// The groom lane's pure decisions (adr-0030).
//
// `pr-remediate`'s author lane fixes what a PR *argues* — findings, red checks —
// and treats `autopilot:needs-human` as terminal, because a PR a human owns is
// not one an agent may keep pushing to. The groom lane is strictly weaker: it
// keeps an escalated PR *applicable to a moved base* and touches nothing else.
// The operator's decision is untouched; only the decay around it is removed.
//
// Everything here is pure and exported so the lane's three load-bearing rules —
// what is actionable, when an attempt is spent, and which conflicts may be
// resolved — are unit-tested rather than asserted in prose.

// R-14: this module is pure and never a process entry point, but it reaches the
// network-touching population transitively by importing the lane label from
// pr-merge.mjs — and duplicating that constant to dodge the gate is exactly the
// drift the shared import exists to prevent. The call is a no-op unless this
// file IS the entry point, so it is safe here and in the tests that import it.
import { ensureProxyAwareEntry } from "../../../scripts/lib/proxy-bootstrap.mjs";
ensureProxyAwareEntry(import.meta.url);

import { ESCALATION_LABEL } from "../pr-autopilot/pr-merge.mjs";

const AUTOPILOT_OFF_LABEL = "autopilot:off";

/** Consecutive blocked outcomes (across DISTINCT base SHAs) after which the
 *  lane stops touching a PR. Not a per-PR-ever cap: a PR legitimately needs
 *  grooming again every time the base moves. What must be bounded is repeatedly
 *  failing the same way, which this counts. */
export const GROOM_BLOCK_CAP = 3;

const GROOM_MARKER_RE = /<!--\s*autopilot:groom:([0-9a-f]{7,40}):(claimed|pushed|blocked)\s*-->/g;

/** The marker for one groom attempt at one base commit.
 *
 *  Keyed by base SHA, not by an attempt counter, because that is what actually
 *  changed: a PR groomed against base `abc1234` and still open is not owed
 *  another attempt until the base moves. Claimed before any work, so a run that
 *  dies mid-resolution costs the attempt (the same inversion the author lane's
 *  `remediationMarker` uses) instead of retrying forever. */
export function groomMarker(baseSha, outcome = "claimed") {
  const sha = String(baseSha ?? "").toLowerCase();
  if (!/^[0-9a-f]{7,40}$/.test(sha)) {
    throw new Error(`groom marker needs a base commit SHA (7-40 hex chars), got ${JSON.stringify(baseSha)}`);
  }
  if (!["claimed", "pushed", "blocked"].includes(outcome)) {
    throw new Error(`groom outcome must be claimed|pushed|blocked, got ${JSON.stringify(outcome)}`);
  }
  return `<!-- autopilot:groom:${sha.slice(0, 7)}:${outcome} -->`;
}

/** Every groom marker across the PR's comment bodies, oldest→newest, as
 *  `{ sha, outcome }`. Pure so the skip rule below is testable without GitHub. */
export function groomHistory(bodies = []) {
  const out = [];
  for (const b of bodies) {
    const re = new RegExp(GROOM_MARKER_RE.source, "g");
    let m;
    while ((m = re.exec(String(b ?? ""))) !== null) out.push({ sha: m[1].slice(0, 7), outcome: m[2] });
  }
  return out;
}

/** Blocked outcomes at the END of the history, counted once per distinct base
 *  SHA. A `pushed` anywhere later resets it: the lane got somewhere, so the
 *  next failure is a new streak, not a continuation. */
export function consecutiveBlocked(history = []) {
  const shas = new Set();
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (h.outcome === "blocked") shas.add(h.sha);
    else if (h.outcome === "pushed") break;
  }
  return shas.size;
}

/**
 * The pure decision: given one escalated PR's state, should the groom lane
 * touch it, and for what?
 *
 * Ordering is load-bearing:
 *   1. `not-in-lane` — `autopilot:off` is a maintainer pause and outranks
 *      everything; so does the absence of the escalation label. The author lane
 *      also wins: a PR carrying BOTH labels is `pr-remediate`'s author-lane
 *      business, and two lanes pushing to one head branch is the race this
 *      ordering exists to prevent.
 *   2. `already-groomed` — a marker for the CURRENT base SHA means nothing has
 *      changed since the last attempt (including an attempt that died). Skipping
 *      is the whole reason the marker is base-keyed.
 *   3. `groom-blocked` — the streak cap. Reported once, then silent, never
 *      retried at the same base.
 *   4. `conflict` / `behind` — the only two actionable kinds. Note what is NOT
 *      here: findings and failing checks are never groomed. They are why the PR
 *      is in the human lane, and fixing them would be deciding.
 *   5. `decision-ready` — mergeable, current, nothing to do. A first-class,
 *      cheap outcome: the queue being clean is the goal, not a miss.
 */
export function classifyGroom({
  labels = [],
  mergeable,
  mergeableState = "",
  baseSha = "",
  bodies = [],
  authorLaneLabel = "autopilot:needs-author",
} = {}) {
  const names = labels.map((l) => String(l || "").toLowerCase());
  const state = String(mergeableState || "").toLowerCase();

  if (names.includes(AUTOPILOT_OFF_LABEL)) {
    return { kind: "not-in-lane", actionable: false, why: "autopilot:off — maintainer pause" };
  }
  if (!names.includes(ESCALATION_LABEL)) {
    return { kind: "not-in-lane", actionable: false, why: `no ${ESCALATION_LABEL} label` };
  }
  if (names.includes(authorLaneLabel)) {
    return {
      kind: "not-in-lane",
      actionable: false,
      why: `also carries ${authorLaneLabel} — the author lane owns this head branch, two lanes must not push to one branch`,
    };
  }

  const history = groomHistory(bodies);
  const sha7 = String(baseSha || "").toLowerCase().slice(0, 7);

  if (sha7 && history.some((h) => h.sha === sha7)) {
    return {
      kind: "already-groomed",
      actionable: false,
      why: `a groom attempt is already recorded at base ${sha7} — nothing has moved since, a retry would be a loop`,
    };
  }

  const blocked = consecutiveBlocked(history);
  if (blocked >= GROOM_BLOCK_CAP) {
    return {
      kind: "groom-blocked",
      actionable: false,
      escalate: "groom-blocked",
      why: `${blocked} consecutive blocked groom attempts across distinct bases — the lane stops touching this PR (adr-0030)`,
    };
  }

  if (state === "dirty" || mergeable === false) {
    return { kind: "conflict", actionable: true, why: `head conflicts with the base (mergeable=${mergeable}, state=${state || "?"})` };
  }
  if (state === "behind") {
    return { kind: "behind", actionable: true, why: "head is out of date with the base branch" };
  }

  return {
    kind: "decision-ready",
    actionable: false,
    why: "mergeable against the current base — the PR is waiting only on the operator's decision",
  };
}

// ── the collision guard (adr-0030) ───────────────────────────────────────────
//
// G2 lets the lane resolve a conflict when both sides only ADD lines. The trap
// this guard exists for: a textually additive conflict can still be a SEMANTIC
// collision. Both instances are from the 2026-09-07 session that motivated the
// ADR — `main` and PR #602 each added a table row claiming `R-16`; `main` and
// PR #546 each added one claiming `ML-020`. Keeping both rows yields a
// well-formed file asserting two meanings for one identifier, and every
// registry check passes on it. Renumbering is an allocation decision with
// citation fan-out (ML-035 needed four call sites updated), so it escalates.

const REGISTRY_ID_RE = /\b(?:R-N?\d{1,3}|ML-\d{1,4}|FU-\d{1,4}|OP-\d{1,4}|ADR-\d{3,4})\b/g;

/** Registry identifiers introduced by one side of a conflict, as a Set. */
export function registryIds(lines = []) {
  const out = new Set();
  for (const line of lines) {
    const re = new RegExp(REGISTRY_ID_RE.source, "g");
    let m;
    while ((m = re.exec(String(line ?? ""))) !== null) out.add(m[0]);
  }
  return out;
}

/**
 * May the groom lane resolve this conflict hunk itself?
 *
 * `ours` / `theirs` are the two sides' lines at one conflict point. Additive
 * means: both sides contribute lines, and NEITHER side's lines are a
 * modification of the other's — approximated, deliberately conservatively, as
 * "the two sides share no line in common". A shared line means one side edited
 * around text the other also touched, which is a rewrite, not an append.
 *
 * Returns `{ additive, reason, collisions }`. `additive: false` is the safe
 * answer and every uncertain case takes it.
 */
export function classifyConflictHunk({ ours = [], theirs = [] } = {}) {
  const norm = (ls) => ls.map((l) => String(l ?? "").trim()).filter((l) => l.length > 0);
  const a = norm(ours);
  const b = norm(theirs);

  if (a.length === 0 || b.length === 0) {
    return {
      additive: false,
      collisions: [],
      reason: "one side is empty — a deletion against an edit is a rewrite, not an append",
    };
  }

  const shared = a.filter((l) => b.includes(l));
  if (shared.length > 0) {
    return {
      additive: false,
      collisions: [],
      reason: `both sides carry ${shared.length} identical line(s) — one side rewrote text the other also touched`,
    };
  }

  const idsA = registryIds(a);
  const idsB = registryIds(b);
  const collisions = [...idsA].filter((id) => idsB.has(id)).sort();
  if (collisions.length > 0) {
    return {
      additive: false,
      collisions,
      reason:
        `both sides allocate ${collisions.join(", ")} — textually additive but a registry-id collision (ML-027). ` +
        `Renumbering is an allocation decision with citation fan-out; it is the operator's, not the groomer's.`,
    };
  }

  return { additive: true, collisions: [], reason: "both sides only add lines and allocate no shared identifier" };
}

/** Whole-conflict verdict: every hunk must be additive, or the file escalates.
 *  One bad hunk taints the file — a partial resolution pushed to someone else's
 *  branch is worse than an unresolved conflict (C-4). */
export function classifyConflictFile(hunks = []) {
  if (hunks.length === 0) return { additive: false, reason: "no conflict hunks supplied", blocked: [] };
  const verdicts = hunks.map((h, i) => ({ index: i, ...classifyConflictHunk(h) }));
  const blocked = verdicts.filter((v) => !v.additive);
  if (blocked.length > 0) {
    return {
      additive: false,
      blocked,
      reason: `${blocked.length} of ${hunks.length} hunk(s) are not additive: ${blocked.map((v) => `#${v.index} (${v.reason})`).join("; ")}`,
    };
  }
  return { additive: true, blocked: [], reason: `all ${hunks.length} hunk(s) are additive on both sides` };
}
