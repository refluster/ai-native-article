# PR escalation-reason taxonomy

- **Version**: v3 (2026-08-02 — [adr-0023](adr/adr-0023-red-verdict-author-loop.md) adds `review-findings-blocking`: a 🔴 verdict whose veto is a diff-local defect goes to the author lane with a machine-checked remediation brief instead of to a human; the human gate on that class moves to the cycle cap. v2: 2026-07-29 — [adr-0022](adr/adr-0022-issue-to-merge-flow.md) adds the **author lane**: six codes, `merge-conflict` / `branch-behind` / `review-findings-open` (agent-fixable causes), `remediation-cap-exceeded` / `remediation-blocked` (its exits to the human lane) and the `author-stale` sweep kind; the engine's `not mergeable` refusal now splits by `mergeable_state`. v1.1: 2026-07-08 — no new codes; Story 2 added emission sites to `cannot-seat-panel` (nomination load cap) and `checks-failing` (flaky-rerun engine). v1: 2026-07-08 initial taxonomy)
- **Governing record**: [Epic-019 Story 1](epics/epic-019-autonomous-finalization-rate.md) — escalation-reason telemetry (measure → wire → judge)
- **Code twin**: [`workforce/skills/pr-autopilot/escalation-reasons.mjs`](../skills/pr-autopilot/escalation-reasons.mjs) — `REASON_CODES` is the enforced list; every emitter validates against it and an unknown code **throws** (C-4), never becomes a quiet new bucket. A code added/renamed here is a version bump of this doc and a `REASON_CODES` change in the same PR.

Every `autopilot:needs-human` hand-off records **why** it escalated, on two carriers per PR:

1. **Label** — `autopilot:reason:<code>`. The aggregation source: `workforce/scripts/build-pr-metrics-github.mjs` buckets escalated PRs by this family into the existing `PERF#{scope}/PR` roll-up (`pr_summary.escalation_reasons` + `pr_summary.eligible_escalations`; R-N2 — no new store), so the weekly funnel renders with zero manual counting.
2. **Hidden comment marker** — `<!-- autopilot:reason:<code> -->` (for `other`: `<!-- autopilot:reason:other <mandatory free text> -->`). The per-PR audit trail, extending the existing `<!-- autopilot:… -->` marker convention (`needs-human`, `reviewed`, `review:{slug}:green`, `l0l1-paths`).

**These codes measure the autopilot's *wiring* — which predicate clause or process leg forced the hand-off — never reviewer performance.** A reason code names what the machinery could not finish (a panel never seated, a check never green, a structural L0/L1 boundary), not what a reviewer did badly. They are therefore **inadmissible as Epic-023 "incidents"** or as evidence in any reviewer-performance / trust-tier computation (Epic-019 RFC 2026-07-07, priya).

## Codes (v1) — 1:1 map to emission sites

| Code | Emitted by | Meaning |
|---|---|---|
| `unlabelled-handoff` | `pr-autopilot-sweep.mjs` (kind string reused **verbatim**) | A comment carries the hidden needs-human marker but the label was dropped (ML-009) — the sweep restores the label and stamps this code. |
| `stale-routed` | `pr-autopilot-sweep.mjs` (verbatim) | Routed for review but reached no terminal state within `--stale-hours` (default 48) — a stalled run or an abandoned 🟡. |
| `never-routed` | `pr-autopilot-sweep.mjs` (verbatim) | Never picked up and now older than the scan's `--window-days` discovery window (default 7). |
| `l0l1-path` | `pr-merge.mjs` refusal `touches L0/L1 path …`; `pr-autopilot-post.mjs` verdict-time L0/L1 check on every escalation; SKILL.md verdict-table "🟢 touches the target's L0/L1 paths" | The PR touches the target repo's declared L0/L1 path set — structurally human-gated, the system working as designed. |
| `human-changes-requested` | `pr-merge.mjs` refusal `a reviewer has CHANGES_REQUESTED …` | A (human) GitHub review stands at CHANGES_REQUESTED. |
| `checks-failing` | `pr-merge.mjs` refusal `check '<name>' = <conclusion>`; `flaky-rerun.mjs` (invoked by `pr-autopilot-post.mjs --reason checks-failing`) when the bounded rerun is refused — a non-allowlisted / expired / editorial-class failing check, an already-used rerun, or an ambiguous check state | A required check completed non-green. Story 2c's bounded flaky-rerun runs BEFORE this escalation posts: only an all-allowlisted, never-rerun PR gets its one rerun (which defers the escalation); a rerun-that-still-fails escalates as this code, never retried again. |
| `checks-pending-aged` | `pr-merge.mjs` refusal `check '<name>' is <status>` | A required check had not completed at verdict time. |
| `no-reviewer-consensus` | `pr-merge.mjs` refusals `missing green marker(s) from …` and `only N distinct reviewer(s) signed off …`; a verdict hand-off where the lenses **contradict each other** and no honest synthesis exists | The unanimous-green ≥3-reviewer consensus could not be **assembled**. Post-adr-0023 this no longer covers a plain 🔴: a veto naming a diff-local defect routes `--needs-author` (`review-findings-blocking`), and a spent cycle budget is `cycle-cap-exceeded`. Using this code for "not unanimous green" strands the PR in `isTerminal()` — see the note under SKILL.md's verdict table. |
| `not-mergeable` | `pr-merge.mjs` refusal `not mergeable (mergeable=…, state=…)` | GitHub reports the PR dirty/blocked/behind/unstable (conflicts, branch protection). |
| `kill-switch-off` | `pr-merge.mjs` refusal `autopilot:off label set …`; a paused per-binding switch | A maintainer/operator kill-switch holds this PR out of the autonomous lane. |
| `no-r-n10-delegation` | `pr-merge.mjs` refusals from `resolveL0L1Paths` (governance doc unreadable / no `autopilot:l0l1-paths` block / empty block); SKILL.md verdict-table "🟢, no R-N10 delegation" | The target repo declares no readable R-N10 delegation — the L0/L1 set is unknown, so everything fails closed. |
| `cannot-seat-panel` | SKILL.md Step 2 hand-off via `pr-autopilot-post.mjs --reason`; `applyNominationCap()` (`pr-autopilot-scan.mjs`) when the Story-2b nomination load cap leaves fewer than 3 eligible lenses | The routing persona could not seat 3 distinct reviewer lenses with real surface — including when the per-persona seat cap (`NOMINATION_SEAT_CAP`, default 5 concurrent open seats) excludes too many candidates. |
| `persona-escalation-trigger` | SKILL.md Step 4 hand-off via `pr-autopilot-post.mjs --reason` | A nominated reviewer's `escalation_triggers` matched — escalation posted instead of a lens review. |
| `cycle-cap-exceeded` | `pr-merge.mjs` refusal `… exceeding the W-4 hard cap …`; 🔴 cycle > `cycle_cap` verdicts | The review cycle exceeded its cap — a process breakdown, not a content verdict. |
| `merge-engine-refusal` | `pr-merge.mjs` refusals not tied to one predicate clause (PR closed, draft-flip failure, a rejected GitHub write); the session's re-post after an engine exit 2 | The engine refused for an operational reason outside the named clauses. Prefer the specific clause code when the engine has already stamped one. |
| `other` | any emitter — **mandatory free text** inside the marker (`--reason other --reason-text "…"`) | An unanticipated cause. The free text is the finding: recurring `other` texts are candidate new codes. A bare `other` throws, so the 100%-coverage criterion cannot be met by mislabeling (RFC: celeste). |

## The author lane (v2, adr-0022) — codes that do NOT mean "a human is needed"

A reason code now says **which lane** a PR was handed to as well as why. Three
codes name an *agent-fixable* cause: the PR carries `autopilot:needs-author`
instead of `autopilot:needs-human`, and the `pr-remediate` cadence — not the
operator — is its queue. Two more name that lane's **exits** back to the human one.

| Code | Lane | Emitted by | Meaning |
|---|---|---|---|
| `merge-conflict` | **author** | `pr-merge.mjs` refusal `not mergeable (…, state=dirty)`; SKILL.md Step 5 `--needs-author` | The head conflicts with the base — usually because another PR merged first. Agent-fixable: resolve and push to the head branch. |
| `branch-behind` | **author** | `pr-merge.mjs` refusal `not mergeable (…, state=behind)`; Step 5 | The head is out of date under a strict branch rule. Agent-fixable: update from the base. |
| `review-findings-open` | **author** | SKILL.md Step 5 on a 🟡 verdict | One or more lens reviews left an open blocking finding. Agent-fixable: address the finding (or rebut it by ID) and push. |
| `review-findings-blocking` | **author** | SKILL.md Step 5 on a 🔴 verdict whose veto names a diff-local defect ([adr-0023](adr/adr-0023-red-verdict-author-loop.md)) | A lens **vetoed**, and the router synthesised the blocking findings into an ordered remediation brief. Agent-fixable by construction: `pr-remediate` implements or rebuts each briefed item and pushes; the next tick re-reviews at cycle N+1. Carries two guards no other author-lane code has — the brief must parse (`remediation-brief.mjs`), and the post is refused when cycle + 1 exceeds the cycle cap (then it is `cycle-cap-exceeded`, human). |
| `remediation-cap-exceeded` | human | `pr-remediate-post.mjs --blocked`; `pr-autopilot-sweep.mjs` (kind, verbatim) | All `REMEDIATION_CAP` (3) attempts spent without reaching a terminal state. A PR that bounces three times has a structural problem no fourth attempt finds. |
| `remediation-blocked` | human | `pr-remediate-post.mjs --blocked` | Remediation was attempted and stopped on a judgment only a human should make — an intent-level conflict (both sides changed the same logic), an L0/L1 surface, or a check failing for a reason outside the diff. |
| `author-stale` | human | `pr-autopilot-sweep.mjs` (kind, verbatim) | Parked in the author lane but untouched past `--author-stale-hours` (36) — the remediation cadence is not coming (unbound, paused, failing). |

**Guards, all mechanical.** The lanes are mutually exclusive (`resolveLabels`
throws when a post carries both); `assertAuthorLaneReasons` refuses to park a PR
in the agent queue under a code no agent can clear (`l0l1-path`,
`no-r-n10-delegation`, `human-changes-requested`, `kill-switch-off`,
`cycle-cap-exceeded`, and the two exits above); `--needs-author` is **fail-closed
on L0/L1** — a PR touching the target's declared set, or whose set is unreadable,
is refused entry and must go to a human; and `assertBlockedReason` refuses to
escalate under an author-lane code, so "escalate → re-park → escalate" cannot form
a loop.

**`checks-failing` is deliberately NOT an author-lane code.** A red check can be
an author-side defect or a real product breakage, and the flaky-rerun latch already
owns the bounded retry. The router may route a red PR to the author lane
explicitly when the lens reviews located the defect in the diff — but the default
direction stays the loud one (C-4).

**Funnel impact: none by design.** `build-pr-metrics-github.mjs` searches
`label:autopilot:needs-human`, so an author-lane hand-off is never counted as an
escalation — which is the point: it is not one. A PR that later exits the lane to
a human enters the funnel then, under its exit code.

## Mechanics

- **Enforcement**: `pr-autopilot-post.mjs` refuses (exit 1) any hand-off post — `--needs-human` **or** `--needs-author` (v2) — that carries no reason (flag or embedded marker), an unknown code, or a bare `other` — so 100% reason coverage on hand-offs is mechanical, not aspirational. `pr-merge.mjs` maps each refusal `why` deterministically via `refusalReasonCode()` and stamps label + marker itself at refusal time.
- **Verdict-time L0/L1**: eligibility (non-L0/L1) is computed for **every** escalated PR at hand-off time (`pr-autopilot-post.mjs` → `prTouchesL0L1`), not just on the merge leg — fail-closed like the engine: an unreadable governance doc means *unknown*, logged, never guessed.
- **Aggregation**: PRs with several reason labels count in each bucket; a labelled hand-off missing its reason buckets as `unspecified` (the coverage gap stays visible). `eligible_escalations` counts escalations without `l0l1-path`.
- **Not touched**: the R-N10 merge predicate, the L0/L1 path set, the consensus rule, and the kill-switch semantics are unchanged — this taxonomy only *names* which existing clause fired.
