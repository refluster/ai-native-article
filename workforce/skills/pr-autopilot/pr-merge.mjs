#!/usr/bin/env node
// pr-autopilot/pr-merge.mjs — the shared, deterministic **consensus merge engine**
// for the workforce's R-N10 delegated-external-merge lane (widened by adr-0010,
// 2026-06-17, superseding the original Dependabot-only safe-class predicate).
//
// The merge predicate is now: a PR is mergeable iff it touches **no L0/L1 path**
// of the TARGET repo's own governance (read from that repo's docs/governance.md),
// is open + mergeable (state "clean" OR "draft" — adr-0014), has **all required
// checks green**, carries **no human CHANGES_REQUESTED**, and the routing
// persona's nominated reviewers — **at least MIN_REVIEWERS (3) distinct
// personas** (operator directive 2026-06-29) — have each posted their lens
// review (the unanimous-green consensus). A panel of fewer than 3 green
// reviewers is refused. L0/L1-touching PRs are never merged — they
// escalate to a human (the operator's final call). A **draft** that clears the
// predicate is a first-class merge target: applyDecisions marks it Ready for
// Review (GraphQL) immediately before the merge PUT, since GitHub refuses to
// merge a draft directly (adr-0014).
//
// R-N10 (workforce/docs/governance.md) clause 2: this engine RE-VERIFIES the
// predicate SERVER-SIDE and FAILS CLOSED. A decision marked action:"merge" is
// honoured only if, at apply time, every predicate clause re-passes against the
// live PR. Anything it cannot positively confirm — including an unreadable /
// marker-less target governance doc (so the L0/L1 set is unknown) — is a REFUSAL,
// never a merge. Escalations (issue filing) are unconditional.
//
// Source of truth for "what is L0/L1": the TARGET repo's own statute, per the
// operator direction (adr-0010). The engine fetches `docs/governance.md`
// (override: env GOVERNANCE_PATH) and extracts the path globs declared between
//   <!-- autopilot:l0l1-paths -->  …  <!-- /autopilot:l0l1-paths -->
// (one `- <glob>` per line). If that block is absent or empty, the L0/L1 set is
// UNKNOWN and every merge fails closed (route/review/verdict still run; the
// verdict hands off). This keeps the delegation in the maintainer's repo, never
// self-asserted by the workforce (R-N10 clause 1).
//
// CLI usage (both callers invoke this exact surface):
//   TOKEN=<github.token> node .../pr-merge.mjs \
//     --repo <owner>/<repo> --decisions /tmp/decisions.json [--skill-version x.y.z]
//
// Decisions file shape:
//   { "decisions": [
//       { "pr": 553, "action": "merge",
//         "comment": "<verdict / advisory-cited merge comment>",
//         "squash_subject": "feat: … (#553)",
//         "squash_body": "Unanimous reviewer sign-off (dario, ren, mateo). No L0/L1 surface.",
//         "reviewers": ["dario", "ren", "mateo"] },   // ≥3 distinct (MIN_REVIEWERS)
//       { "pr": 506, "action": "escalate",
//         "issue_title": "Hold #506: touches L0/L1",
//         "issue_body": "<why held + next step>",
//         "issue_labels": ["governance"] }   // ESCALATION_LABEL is always added
//   ] }
//
// Every escalation issue (and, via pr-autopilot-post.mjs --label, every PR
// handed off to a human) is stamped with ESCALATION_LABEL ("autopilot:needs-
// human") so the operator can list the whole human-decision queue at once.
//
// Exit codes: 0 all applied · 1 bad args/file · 2 a decision refused or a GitHub
// write rejected · 3 network/unexpected.

import "../../../scripts/lib/proxy-bootstrap.mjs";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assertReasonCode, isAuthorLaneCode, reasonLabel, reasonMarker, refusalReasonCode } from "./escalation-reasons.mjs";

const GOVERNANCE_PATH = process.env["GOVERNANCE_PATH"] || "docs/governance.md";
const L0L1_OPEN = "<!-- autopilot:l0l1-paths -->";
const L0L1_CLOSE = "<!-- /autopilot:l0l1-paths -->";

// The canonical, searchable label stamped on every PR/issue this skill hands
// off to a human (a 🔴 verdict, a non-consensus PR, a tracking issue, or — the
// common one — a 🟢 PR that touches the target repo's governance L0/L1). The
// operator finds the full human-decision queue with `is:open label:<this>`.
// pr-autopilot-post.mjs stamps it on hand-off PRs; this engine stamps it on
// every escalation issue it files.
export const ESCALATION_LABEL = "autopilot:needs-human";
const ESCALATION_LABEL_COLOR = "b60205"; // red — "an autopilot decision needs a human"

// The companion "this was reviewed" marker, stamped *alongside* ESCALATION_LABEL
// only on a 🟢 unanimous-green hand-off — a PR that reached reviewer consensus
// and is merge-ready, held back from an autonomous merge solely by a human gate
// (the target repo's L0/L1 boundary, or a missing R-N10 delegation). It lets the
// operator separate "reviewed + merge-ready, just my final call" from a 🔴 /
// cycle-capped / non-consensus escalation that still needs work — both carry
// ESCALATION_LABEL, only the former carries this. It is NOT put on the engine's
// refused-decision tracking issues (those never reached green). Single-sourced
// here; pr-autopilot-post.mjs imports it (and a --reviewed flag) to stamp it.
export const REVIEWED_LABEL = "autopilot:reviewed";

// The AUTHOR lane (adr-0022). Stamped instead of ESCALATION_LABEL when the
// hand-off's cause is agent-fixable — a merge conflict, an out-of-date branch,
// or open blocking lens findings. It is the `pr-remediate` cadence's work
// queue (`is:open label:autopilot:needs-author`), not the operator's.
//
// It is an INTERIM state, and bounded like every other one: a PR that sits here
// without its head moving past the sweep's --author-stale-hours is escalated to
// the human lane by pr-autopilot-sweep.mjs (`author-stale`), as is one that
// exhausts the remediation attempt cap. The two-outcome contract is unchanged —
// merged or escalated remain the only terminal states; this names who works the
// PR while it is in neither.
export const AUTHOR_LABEL = "autopilot:needs-author";

// The author lane's hidden marker — the same mechanical pairing the human lane
// has (`<!-- autopilot:needs-human -->` ↔ `autopilot:needs-human`), so a body
// carrying it stamps the label even when the flag is forgotten, and the sweep
// can recognise the lane from PR state alone. Defined here, next to the label,
// because pr-autopilot-post.mjs imports this module (not the other way round —
// that would be a cycle).
export const AUTHOR_MARKER = "<!-- autopilot:needs-author -->";

// Attempt-counter marker for the author lane: `<!-- autopilot:remediation:<n> -->`.
// The lane is bounded by counting these — REMEDIATION_CAP attempts, then the PR
// escalates to the human lane with `remediation-cap-exceeded`.
//
// **The marker is CLAIMED BEFORE the attempt, never written after it**
// (`pr-remediate-post.mjs --claim`), which is the same once-ever-latch idiom
// flaky-rerun.mjs uses for its bounded rerun. The reason is `wf:farah`'s F1 on
// #518: a counter the bounded thing writes on success is enforced by the thing
// it bounds. Written afterwards, a cadence that dies mid-attempt — after pushing
// to the head branch, before recording — would refresh the PR's `updated_at`
// (resetting the sweep's staleness clock) while consuming no attempt, and could
// retry the same failing resolution forever. Claiming first inverts that: a
// death costs an attempt. Over-counting a crashed run is the safe direction;
// under-counting an infinite one is not.
//
// Kept next to the lane's other constants so the counter, the marker and the cap
// cannot drift apart.
export const REMEDIATION_CAP = 3;
const REMEDIATION_MARKER_RE = /<!--\s*autopilot:remediation:(\d+)\s*-->/g;

/** Highest remediation-attempt number recorded across the PR's comment bodies
 *  (0 = never attempted). Pure + exported so the bound is unit-tested. */
export function countRemediationAttempts(bodies = []) {
  let max = 0;
  for (const b of bodies) {
    const re = new RegExp(REMEDIATION_MARKER_RE.source, "g");
    let m;
    while ((m = re.exec(String(b ?? ""))) !== null) max = Math.max(max, Number(m[1]) || 0);
  }
  return max;
}

/** The marker for attempt `n`. Throws past the cap — an unbounded retry loop is
 *  exactly what this lane must not become (C-4). */
export function remediationMarker(n) {
  const attempt = Number(n);
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > REMEDIATION_CAP) {
    throw new Error(
      `remediation attempt ${n} is outside 1..${REMEDIATION_CAP} — a PR past the cap escalates to the human lane ` +
        `with reason "remediation-cap-exceeded" (adr-0022), it is never retried again.`,
    );
  }
  return `<!-- autopilot:remediation:${attempt} -->`;
}

// Minimum reviewer-panel size for an autonomous merge (operator directive
// 2026-06-29). A merge is honoured only when at least this many DISTINCT
// reviewer personas have each posted their `<!-- autopilot:review:{slug}:green
// -->` marker — a lone-reviewer (or two-reviewer) sign-off is no longer a
// consensus the engine will merge on. This TIGHTENS the R-N10 / adr-0010
// predicate (more reviewers required, never fewer); it does not widen what may
// merge. verifyMergeable() fails closed below this floor; the SKILL.md routing
// contract mirrors it by mandating a ≥3-persona panel at nomination time.
export const MIN_REVIEWERS = 3;

// Create labels if they do not already exist (idempotent: an existing label
// returns 422, which we ignore). Lets a target repo that has never seen the
// escalation label still receive it without a manual pre-create step.
export async function ensureLabels(gh, repo, names) {
  for (const name of names) {
    // The author lane is a different queue from the human one and must not be
    // created wearing the escalation label's red "a human's call" description —
    // an operator filtering by colour/description would read it as their work.
    const meta =
      name === AUTHOR_LABEL
        ? {
            color: "fbca04", // amber — in-flight, agent-owned
            description:
              "Autopilot found an agent-fixable defect (conflict / out-of-date branch / open review findings). The pr-remediate cadence owns it; bounded — it escalates to autopilot:needs-human if remediation stalls or caps out.",
          }
        : {
            color: ESCALATION_LABEL_COLOR,
            description: "Autopilot handed this off — a human's call (merge / governance L0/L1 / blocked).",
          };
    const { status } = await gh("POST", `/repos/${repo}/labels`, { name, ...meta });
    if (status !== 201 && status !== 422) {
      console.error(`pr-merge: WARN could not ensure label "${name}" (HTTP ${status}) — continuing`);
    }
  }
}

// W-1 editorial guard: a degraded body fails loud here, never lands on GitHub.
const ARTEFACTS = ["as an ai", "i apologize", "i'm sorry", "certainly!", "here is the", "here's the"];
export function w1(text, label) {
  const t = (text || "").trim();
  if (!t) throw { code: 2, msg: `${label} is empty (W-1)` };
  const head = t.slice(0, 50).toLowerCase();
  if (ARTEFACTS.some((a) => head.startsWith(a))) throw { code: 2, msg: `${label} opens with an LLM-failure artefact (W-1): "${head}"` };
  return t;
}

// Translate a leading-slash-free path glob (`**`, `*`, `?`) into an anchored
// RegExp. `**` matches across slashes; `*` matches within a path segment.
export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") { re += ".*"; i++; if (glob[i + 1] === "/") i++; }
      else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else if ("\\^$.|+()[]{}".includes(c)) re += "\\" + c;
    else re += c;
  }
  return new RegExp(`(^|/)${re}$`, "i");
}

// Fetch the TARGET repo's governance doc and extract the declared L0/L1 path
// globs. Returns { ok, patterns, why }. ok=false ⇒ the L0/L1 set is unknown ⇒
// the caller fails every merge closed (route/review still run).
export async function resolveL0L1Paths(gh, repo, ref) {
  const path = GOVERNANCE_PATH;
  const q = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const { status, json } = await gh("GET", `/repos/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}${q}`);
  if (status !== 200 || typeof json?.content !== "string") {
    return { ok: false, patterns: [], why: `cannot read target governance ${path} (HTTP ${status}) — L0/L1 set unknown, failing merge closed` };
  }
  const md = Buffer.from(json.content, json.encoding === "base64" ? "base64" : "utf8").toString("utf8");
  const start = md.indexOf(L0L1_OPEN);
  const end = md.indexOf(L0L1_CLOSE, start + 1);
  if (start === -1 || end === -1) {
    return { ok: false, patterns: [], why: `${path} declares no ${L0L1_OPEN} block — L0/L1 set unknown, failing merge closed` };
  }
  const block = md.slice(start + L0L1_OPEN.length, end);
  const globs = block
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- "))
    .map((l) => l.slice(2).trim())
    .filter(Boolean);
  if (globs.length === 0) {
    return { ok: false, patterns: [], why: `${path} L0/L1 block is empty — failing merge closed` };
  }
  return { ok: true, patterns: globs.map(globToRegExp), why: `${globs.length} L0/L1 glob(s) from ${path}` };
}

// Build a thin GitHub REST client bound to one token + repo.
export function makeGh({ token, api = process.env["GITHUB_API_URL"] || "https://api.github.com", userAgent = "workforce-pr-merge" }) {
  return async function gh(method, path, body) {
    let res;
    try {
      res = await fetch(`${api}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          "user-agent": userAgent,
          ...(body ? { "content-type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) { throw { code: 3, msg: `network error on ${method} ${path}: ${e?.message || e}` }; }
    const text = await res.text().catch(() => "");
    let json; try { json = text ? JSON.parse(text) : {}; } catch { json = { _raw: text }; }
    return { status: res.status, json };
  };
}

// W-4 hard cycle cap (FU-004 / dev-process.md §"cycle counter").
// The routing comment opening line is (SKILL.md §Step 2 template):
//   **<PersonaName> — cycle N of ≤ M.**   ("—" = U+2014, "≤" = U+2264)
// countRouterCycles() scans bodies for this pattern and returns the highest N.
// verifyMergeable() refuses a merge when that maximum exceeds W4_CYCLE_CAP
// (cycle > 7 == process breakdown; W-4: fail loud, escalate to human).
export const W4_CYCLE_CAP = 7;
const ROUTING_CYCLE_RE = /\*\*[\w ]+\s*—\s*cycle\s+(\d+)\s+of\s+≤\s*\d+/u;
export function countRouterCycles(bodies) {
  let max = 0;
  for (const b of bodies) {
    if (typeof b !== "string") continue;
    const m = ROUTING_CYCLE_RE.exec(b);
    if (m) { const n = parseInt(m[1], 10); if (n > max) max = n; }
  }
  return max;
}

// A reviewer persona's green sign-off has landed iff a review/comment body
// carries that persona's EXACT structured marker (adr-0010 / Sana B1 hardening,
// 2026-06-17): `<!-- autopilot:review:{slug}:green -->`. The routing persona
// embeds this token in each nominated reviewer's posted review when that lens is
// non-blocking. An exact hidden-comment match removes the two failure modes of
// the old byline regex: a differently-formatted sign-off no longer reads as
// "missing" by accident, and prose that merely names the persona can no longer
// read as a green vote. Absence of the marker fails closed (no merge).
export function reviewerGreenMarker(slug) {
  return `<!-- autopilot:review:${String(slug).toLowerCase()}:green -->`;
}
export function reviewerSignedOff(slug, reviewBodies) {
  const marker = reviewerGreenMarker(slug);
  return reviewBodies.some((b) => (b || "").toLowerCase().includes(marker));
}

// Epic-019 Story 1: verdict-time L0/L1 computation. The merge leg computes the
// L0/L1 clause inside verifyMergeable; ESCALATIONS need the same answer so the
// reason funnel can split eligible (non-L0/L1) hand-offs from structural ones.
// This helper replicates the two clauses read-only — same source of truth
// (resolveL0L1Paths, the TARGET repo's own statute) and same fail-closed
// semantics: an unreadable/markerless governance doc returns known:false (the
// L0/L1 set is UNKNOWN — callers escalate without guessing eligibility). It is
// deliberately NOT wired into verifyMergeable: the R-N10 predicate's decision
// flow stays byte-identical.
export async function prTouchesL0L1(gh, repo, prNumber, baseRef) {
  const l0l1 = await resolveL0L1Paths(gh, repo, baseRef);
  if (!l0l1.ok) return { known: false, touches: null, why: l0l1.why };
  const { status, json: files } = await gh("GET", `/repos/${repo}/pulls/${prNumber}/files?per_page=100`);
  if (status !== 200 || !Array.isArray(files)) {
    return { known: false, touches: null, why: `GET files -> HTTP ${status} — L0/L1 surface unknown` };
  }
  const hit = files.find((f) => l0l1.patterns.some((re) => re.test(f.filename)));
  return hit
    ? { known: true, touches: true, why: `touches L0/L1 path ${hit.filename}` }
    : { known: true, touches: false, why: `no L0/L1 surface` };
}

// Epic-019 Story 1: a refused merge is the engine's hand-off leg — record WHY
// on the PR itself (an `autopilot:reason:<code>` label + the hidden marker in
// a comment) so the escalation-reason funnel renders with zero manual
// counting. Pure telemetry: it runs strictly AFTER the refusal is decided
// (the R-N10 predicate is untouched), and its own GitHub-write failures are
// logged, not fatal — a telemetry hiccup must not mask a correct refusal.
// The code mapping itself stays C-4-loud: reasonLabel/reasonMarker throw on a
// code outside the taxonomy.
export async function emitRefusalReason(gh, repo, pr, why) {
  const code = refusalReasonCode(why);
  // adr-0022: a refusal whose cause is agent-fixable (a conflict with the base,
  // an out-of-date branch) is routed to the AUTHOR lane here, at the refusal
  // itself — that is where the cause is first known, so the PR joins
  // `pr-remediate`'s queue on the same tick instead of waiting for a session to
  // notice. The predicate is untouched: this still refuses the merge.
  const authorLane = isAuthorLaneCode(code);
  const labels = [reasonLabel(code), ...(authorLane ? [AUTHOR_LABEL] : [])];
  const body = [
    `**Autopilot merge engine — refusal reason \`${code}\`.** ${why}`,
    "",
    authorLane
      ? "Agent-fixable — handing to the **author lane** (`autopilot:needs-author`). The `pr-remediate` cadence picks this up, pushes the fix to the head branch, and the next autopilot tick re-verdicts. If it cannot (attempt cap, or a resolution only a human should make) it escalates to `autopilot:needs-human` with its own reason."
      : "(Epic-019 escalation-reason telemetry — wiring, not reviewer performance; see workforce/docs/pr-escalation-reasons.md.)",
    "",
    reasonMarker(code, code === "other" ? why : ""),
    ...(authorLane ? [AUTHOR_MARKER] : []),
  ].join("\n");
  await ensureLabels(gh, repo, labels);
  const l = await gh("POST", `/repos/${repo}/issues/${pr}/labels`, { labels });
  if (l.status !== 200) console.error(`pr-merge: WARN reason label(s) "${labels.join(", ")}" on #${pr} → HTTP ${l.status}`);
  const c = await gh("POST", `/repos/${repo}/issues/${pr}/comments`, { body });
  if (c.status !== 201) console.error(`pr-merge: WARN reason comment on #${pr} → HTTP ${c.status}`);
  return code;
}

// Server-side predicate re-check. Returns {ok, why, sha}.
export async function verifyMergeable(gh, repo, pr, decision) {
  const { status, json: p } = await gh("GET", `/repos/${repo}/pulls/${pr}`);
  if (status !== 200) return { ok: false, why: `GET pull ${pr} -> HTTP ${status}` };
  if (p.state !== "open") return { ok: false, why: `PR #${pr} is ${p.state}` };
  // No own-repo special case (adr-0011): the workforce's own repo is a normal
  // delegated target. The single boundary is the L0/L1 path set below — read
  // from the TARGET repo's own governance — so a governance/identity change
  // still escalates while a reviewed, non-L0/L1 PR merges, own repo or external.
  // Per-PR maintainer off-switch: an `autopilot:off` label pauses this PR
  // (fail-closed). The repo-wide off-switch is emptying the target's
  // autopilot:l0l1-paths block (→ unknown set → refuse, see resolveL0L1Paths).
  if (Array.isArray(p.labels) && p.labels.some((l) => (l?.name || "").toLowerCase() === "autopilot:off")) {
    return { ok: false, why: `autopilot:off label set — paused by maintainer` };
  }
  // adr-0014: a draft is a first-class merge target. GitHub reports a ready PR
  // as mergeable_state "clean" and a draft as "draft"; both are acceptable here
  // (a draft is auto-marked Ready for Review just before the merge PUT in
  // applyDecisions). Every OTHER state (dirty/blocked/behind/unstable) is still
  // refused, and `mergeable` must still be true — a draft with a real conflict
  // is out.
  if (p.mergeable !== true || !["clean", "draft"].includes(p.mergeable_state)) return { ok: false, why: `not mergeable (mergeable=${p.mergeable}, state=${p.mergeable_state})` };

  // L0/L1 guard — sourced from the TARGET repo's own governance (adr-0010).
  const l0l1 = await resolveL0L1Paths(gh, repo, p.base?.ref);
  if (!l0l1.ok) return { ok: false, why: l0l1.why };
  const { status: fs, json: files } = await gh("GET", `/repos/${repo}/pulls/${pr}/files?per_page=100`);
  if (fs !== 200 || !Array.isArray(files)) return { ok: false, why: `GET files -> HTTP ${fs}` };
  for (const f of files) {
    if (l0l1.patterns.some((re) => re.test(f.filename))) {
      return { ok: false, why: `touches L0/L1 path ${f.filename} — escalate to human (operator's final call)` };
    }
  }

  // All required checks green.
  const { status: cs, json: checks } = await gh("GET", `/repos/${repo}/commits/${p.head.sha}/check-runs?per_page=100`);
  if (cs !== 200) return { ok: false, why: `GET check-runs -> HTTP ${cs}` };
  for (const c of checks.check_runs || []) {
    if (c.status !== "completed") return { ok: false, why: `check '${c.name}' is ${c.status}` };
    if (!["success", "neutral", "skipped"].includes(c.conclusion)) return { ok: false, why: `check '${c.name}' = ${c.conclusion}` };
  }

  // Unanimous-green consensus: no human CHANGES_REQUESTED, and every nominated
  // reviewer has posted their lens review.
  const { status: rs, json: reviews } = await gh("GET", `/repos/${repo}/pulls/${pr}/reviews?per_page=100`);
  if (rs !== 200 || !Array.isArray(reviews)) return { ok: false, why: `GET reviews -> HTTP ${rs}` };
  if (reviews.some((r) => r.state === "CHANGES_REQUESTED")) return { ok: false, why: `a reviewer has CHANGES_REQUESTED — not consensus-green` };
  // Distinct reviewer slugs (case-folded, de-duped) — listing the same persona
  // three times is one reviewer, not a panel of three.
  const reviewers = Array.isArray(decision?.reviewers)
    ? [...new Set(decision.reviewers.filter((s) => typeof s === "string" && s).map((s) => s.trim().toLowerCase()).filter(Boolean))]
    : [];
  const { status: ics, json: comments } = await gh("GET", `/repos/${repo}/issues/${pr}/comments?per_page=100`);
  const bodies = [
    ...reviews.map((r) => r.body),
    ...(ics === 200 && Array.isArray(comments) ? comments.map((c) => c.body) : []),
  ];
  // FU-004: W-4 hard cycle cap — a PR that has reached cycle > W4_CYCLE_CAP is
  // a process breakdown; refuse the merge and hand off to a human.
  const cycle = countRouterCycles(bodies);
  if (cycle > W4_CYCLE_CAP) {
    return { ok: false, why: `review reached cycle ${cycle}, exceeding the W-4 hard cap of ${W4_CYCLE_CAP} — process breakdown, escalate to human` };
  }
  const missing = reviewers.filter((slug) => !reviewerSignedOff(slug, bodies));
  if (missing.length > 0) return { ok: false, why: `missing green marker(s) from ${missing.join(", ")} (expected ${reviewerGreenMarker(missing[0])}) — consensus not reached` };
  // Minimum-panel floor (operator directive 2026-06-29): a merge requires at
  // least MIN_REVIEWERS distinct unanimous-green reviewers. Checked last so a
  // more specific reason (L0/L1, CHANGES_REQUESTED, a missing marker) surfaces
  // first; an empty or under-sized green panel falls through to here.
  if (reviewers.length < MIN_REVIEWERS) return { ok: false, why: `only ${reviewers.length} distinct reviewer(s) signed off — a merge requires a panel of at least ${MIN_REVIEWERS} unanimous-green reviewers (operator directive 2026-06-29); under-reviewed merge refused` };

  // `draft` + `nodeId` let applyDecisions flip a green draft Ready for Review
  // before the merge PUT (adr-0014 — GitHub refuses to merge a draft directly).
  return { ok: true, why: `consensus-green, no L0/L1 surface (${reviewers.join(", ")})`, sha: p.head.sha, draft: p.draft === true, nodeId: p.node_id };
}

// Apply one decisions payload. Returns { merged, escalated, refused }.
export async function applyDecisions(gh, repo, decisions) {
  let refused = 0, merged = 0, escalated = 0;

  for (const d of decisions) {
    const pr = d.pr;
    if (d.action === "escalate") {
      const title = w1(d.issue_title, `#${pr} issue_title`);
      let body = w1(d.issue_body, `#${pr} issue_body`);
      // Always stamp the canonical escalation label so the operator can find
      // every human-decision item with one search, in addition to any
      // PR-specific labels the caller supplied.
      const labels = [...new Set([...(Array.isArray(d.issue_labels) ? d.issue_labels : []), ESCALATION_LABEL])];
      // Epic-019: an escalation may declare its reason code (`reason_code`, plus
      // `reason_text` — mandatory for "other"). Validated loud (C-4: an unknown
      // code throws via assertReasonCode) and carried as label + hidden marker.
      if (d.reason_code) {
        assertReasonCode(d.reason_code);
        labels.push(reasonLabel(d.reason_code));
        body = `${body.trimEnd()}\n\n${reasonMarker(d.reason_code, d.reason_text || "")}`;
      }
      await ensureLabels(gh, repo, labels);
      const { status, json } = await gh("POST", `/repos/${repo}/issues`, { title, body, labels });
      if (status === 201) { escalated++; console.error(`pr-merge: escalated #${pr} -> issue ${json.html_url}`); }
      else { refused++; console.error(`pr-merge: FAILED to file issue for #${pr}: HTTP ${status} ${JSON.stringify(json).slice(0, 300)}`); }
      continue;
    }
    if (d.action !== "merge") { refused++; console.error(`pr-merge: #${pr} unknown action "${d.action}"`); continue; }

    // ── R-N10 fail-closed gate (adr-0010 widened predicate) ─────────────────
    const comment = w1(d.comment, `#${pr} comment`);
    const subject = w1(d.squash_subject, `#${pr} squash_subject`);
    const verdict = await verifyMergeable(gh, repo, pr, d);
    if (!verdict.ok) {
      refused++; console.error(`pr-merge: REFUSE merge #${pr}: ${verdict.why}`);
      // Epic-019: stamp the refusal's reason code on the PR (label + marker).
      // Best-effort — a network failure here must not mask the refusal itself.
      try { await emitRefusalReason(gh, repo, pr, verdict.why); }
      catch (e) { console.error(`pr-merge: WARN could not emit refusal reason for #${pr}: ${e?.msg || e?.message || e}`); }
      continue;
    }

    // adr-0014: drafts are merge-eligible. GitHub refuses to merge a draft, so
    // flip it Ready for Review first (GraphQL — there is no REST endpoint). Do
    // this BEFORE any merge-intent side effect (comment/approve) so a failure to
    // un-draft leaves no misleading "merging" trail. Fail closed: if the PR is
    // still a draft after the mutation, do not merge.
    if (verdict.draft) {
      if (!verdict.nodeId) { refused++; console.error(`pr-merge: REFUSE merge #${pr}: draft PR but no node id to mark Ready`); continue; }
      const rd = await gh("POST", `/graphql`, {
        query: "mutation($id:ID!){markPullRequestReadyForReview(input:{pullRequestId:$id}){pullRequest{isDraft}}}",
        variables: { id: verdict.nodeId },
      });
      const stillDraft = rd?.json?.data?.markPullRequestReadyForReview?.pullRequest?.isDraft;
      if (rd.status !== 200 || rd?.json?.errors || stillDraft !== false) {
        refused++; console.error(`pr-merge: REFUSE merge #${pr}: could not mark draft Ready for Review (HTTP ${rd.status} ${JSON.stringify(rd.json).slice(0, 200)})`); continue;
      }
      console.error(`pr-merge: #${pr} was a draft — marked Ready for Review (adr-0014), proceeding to merge`);
    }

    const c = await gh("POST", `/repos/${repo}/issues/${pr}/comments`, { body: comment });
    if (c.status !== 201) { refused++; console.error(`pr-merge: REFUSE merge #${pr}: comment failed HTTP ${c.status}`); continue; }
    // The native GitHub APPROVE is a courtesy/visibility step and the
    // branch-protection satisfier for PRs authored by a DIFFERENT identity
    // (Dependabot, external contributors). It is NOT the workforce's consensus
    // gate: verifyMergeable() already re-verified the green-marker consensus +
    // checks + L0/L1 server-side, and the merge PUT below re-enforces branch
    // protection authoritatively. The workforce authors most PRs under the SAME
    // identity it merges with, where GitHub forbids a self-approve (422 "Can not
    // approve your own pull request") — treating that as fatal stalled every
    // green own-identity PR at the approve step (#361). So approve is
    // best-effort: log a non-200 and proceed. The merge PUT is the real gate and
    // fails loud if an approving review were genuinely required by protection.
    const rv = await gh("POST", `/repos/${repo}/pulls/${pr}/reviews`, { event: "APPROVE", body: "Autopilot consensus-green merge (R-N10 / adr-0010): unanimous reviewer sign-off, no L0/L1 surface." });
    if (rv.status !== 200) {
      const selfApprove = rv.status === 422 && JSON.stringify(rv.json).toLowerCase().includes("can not approve your own pull request");
      console.error(
        selfApprove
          ? `pr-merge: #${pr} self-approve not possible (own-identity PR) — consensus is the verified green markers; proceeding to merge`
          : `pr-merge: #${pr} WARN approve returned HTTP ${rv.status} ${JSON.stringify(rv.json).slice(0, 200)} — approve is advisory; proceeding (the merge PUT is the gate)`,
      );
    }
    const mg = await gh("PUT", `/repos/${repo}/pulls/${pr}/merge`, { merge_method: "squash", sha: verdict.sha, commit_title: subject, commit_message: d.squash_body || "" });
    if (mg.status === 200) { merged++; console.error(`pr-merge: MERGED #${pr} (${verdict.why})`); }
    else {
      refused++; console.error(`pr-merge: merge #${pr} REJECTED HTTP ${mg.status}: ${JSON.stringify(mg.json).slice(0, 300)}`);
      // Epic-019: a rejected merge PUT is also a refusal exit — record it.
      try { await emitRefusalReason(gh, repo, pr, `merge PUT rejected HTTP ${mg.status}`); }
      catch (e) { console.error(`pr-merge: WARN could not emit refusal reason for #${pr}: ${e?.msg || e?.message || e}`); }
    }
  }
  return { repo, merged, escalated, refused };
}

function arg(argv, n) { const i = argv.indexOf(`--${n}`); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined; }

// Shared CLI entry. Returns a process exit code (does not call process.exit so
// callers can wrap it). TOKEN or GITHUB_TOKEN env supplies the credential.
export async function main(argv, env) {
  const token = env["TOKEN"] || env["GITHUB_TOKEN"];
  const repo = arg(argv, "repo");
  const decisionsFile = arg(argv, "decisions");
  if (!token) { console.error("pr-merge: TOKEN (or GITHUB_TOKEN) env var is required (from credentials['github.token'])"); return 1; }
  if (!repo || !/^[^/]+\/[^/]+$/.test(repo)) { console.error("pr-merge: --repo <owner>/<repo> is required"); return 1; }
  if (!decisionsFile) { console.error("pr-merge: --decisions <file> is required"); return 1; }

  let payload;
  try { payload = JSON.parse(readFileSync(decisionsFile, "utf8")); }
  catch (e) { console.error(`pr-merge: cannot read/parse --decisions "${decisionsFile}": ${e?.message || e}`); return 1; }
  const decisions = Array.isArray(payload?.decisions) ? payload.decisions : null;
  if (!decisions) { console.error("pr-merge: decisions file must be { decisions: [...] }"); return 1; }

  const gh = makeGh({ token, userAgent: "workforce-pr-merge" });
  let result;
  try { result = await applyDecisions(gh, repo, decisions); }
  catch (e) { console.error(`pr-merge: ${e?.msg || e?.message || e}`); return e?.code || 3; }
  console.log(JSON.stringify(result));
  return result.refused > 0 ? 2 : 0;
}

// Run as a CLI when invoked directly (pr-autopilot verdict mode calls this path).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(await main(process.argv, process.env));
}
