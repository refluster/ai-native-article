# PR escalation-reason taxonomy

- **Version**: v1 (2026-07-08)
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
| `checks-failing` | `pr-merge.mjs` refusal `check '<name>' = <conclusion>` | A required check completed non-green. (Story 2's bounded flaky-rerun escalates a rerun-that-still-fails as this code, never retried again.) |
| `checks-pending-aged` | `pr-merge.mjs` refusal `check '<name>' is <status>` | A required check had not completed at verdict time. |
| `no-reviewer-consensus` | `pr-merge.mjs` refusals `missing green marker(s) from …` and `only N distinct reviewer(s) signed off …`; 🔴 / non-consensus verdict hand-offs | The unanimous-green ≥3-reviewer consensus was not assembled. |
| `not-mergeable` | `pr-merge.mjs` refusal `not mergeable (mergeable=…, state=…)` | GitHub reports the PR dirty/blocked/behind/unstable (conflicts, branch protection). |
| `kill-switch-off` | `pr-merge.mjs` refusal `autopilot:off label set …`; a paused per-binding switch | A maintainer/operator kill-switch holds this PR out of the autonomous lane. |
| `no-r-n10-delegation` | `pr-merge.mjs` refusals from `resolveL0L1Paths` (governance doc unreadable / no `autopilot:l0l1-paths` block / empty block); SKILL.md verdict-table "🟢, no R-N10 delegation" | The target repo declares no readable R-N10 delegation — the L0/L1 set is unknown, so everything fails closed. |
| `cannot-seat-panel` | SKILL.md Step 2 hand-off via `pr-autopilot-post.mjs --reason` | The routing persona could not seat 3 distinct reviewer lenses with real surface. |
| `persona-escalation-trigger` | SKILL.md Step 4 hand-off via `pr-autopilot-post.mjs --reason` | A nominated reviewer's `escalation_triggers` matched — escalation posted instead of a lens review. |
| `cycle-cap-exceeded` | `pr-merge.mjs` refusal `… exceeding the W-4 hard cap …`; 🔴 cycle > `cycle_cap` verdicts | The review cycle exceeded its cap — a process breakdown, not a content verdict. |
| `merge-engine-refusal` | `pr-merge.mjs` refusals not tied to one predicate clause (PR closed, draft-flip failure, a rejected GitHub write); the session's re-post after an engine exit 2 | The engine refused for an operational reason outside the named clauses. Prefer the specific clause code when the engine has already stamped one. |
| `other` | any emitter — **mandatory free text** inside the marker (`--reason other --reason-text "…"`) | An unanticipated cause. The free text is the finding: recurring `other` texts are candidate v2 codes. A bare `other` throws, so the 100%-coverage criterion cannot be met by mislabeling (RFC: celeste). |

## Mechanics

- **Enforcement**: `pr-autopilot-post.mjs` refuses (exit 1) any `--needs-human` post that carries no reason (flag or embedded marker), an unknown code, or a bare `other` — so 100% reason coverage on hand-offs is mechanical, not aspirational. `pr-merge.mjs` maps each refusal `why` deterministically via `refusalReasonCode()` and stamps label + marker itself at refusal time.
- **Verdict-time L0/L1**: eligibility (non-L0/L1) is computed for **every** escalated PR at hand-off time (`pr-autopilot-post.mjs` → `prTouchesL0L1`), not just on the merge leg — fail-closed like the engine: an unreadable governance doc means *unknown*, logged, never guessed.
- **Aggregation**: PRs with several reason labels count in each bucket; a labelled hand-off missing its reason buckets as `unspecified` (the coverage gap stays visible). `eligible_escalations` counts escalations without `l0l1-path`.
- **Not touched**: the R-N10 merge predicate, the L0/L1 path set, the consensus rule, and the kill-switch semantics are unchanged — this taxonomy only *names* which existing clause fired.
