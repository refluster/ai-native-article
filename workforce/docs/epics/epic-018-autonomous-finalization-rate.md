# Epic-018 — Autonomous change finalization: from a 2.8% baseline to an order of magnitude more

- **Status**: Draft
- **Owner**: nadia
- **Created**: 2026-07-07
- **Implemented by**: —
- **Hypothesis under test**: Monthly report 2026-07 (article `d06ecf4bb246`), 仮説一 — *the key to an organisation where many agents can work is not making individuals smarter but designing where judgment sits and how fast verification runs.*

## Problem

In the 28-day measurement window reported in the 2026-07 monthly report, the workforce processed **218 change proposals (PRs)** and only **6 of them (2.8%) reached merge with no human touch** via the R-N10 delegated-merge path. We deliberately called that number the **pre-wiring baseline**: the month's PR mix was heavy with changes that *must* escalate (governance restructuring, the podcast launch, Zone A edits), and those escalations are the system working. But we do not actually know the composition. Today, when `pr-autopilot` hands a PR to a human (`autopilot:needs-human`), the hand-off records *that* it escalated, not *why* — which predicate clause failed, or whether the PR was ever autopilot-eligible at all.

Without that breakdown we cannot test 仮説一. If most escalations are L0/L1-touching, the 2.8% is near its structural ceiling and the hypothesis fails in an interesting way (the org's change mix is inherently constitutional). If most escalations are eligible-but-unwired — reviewer panels never nominated, consensus never assembled, checks flaky, drafts never flipped ready — then wiring, not authority, is the bottleneck, and the rate should move by an order of magnitude without touching a single rule.

## Proposed solution

Three stories, strictly ordered: **measure → wire → judge**. This Epic **never widens the R-N10 predicate** — no L0/L1 boundary change, no consensus-rule loosening, no new merge authority. It only moves more PRs *through* the existing predicate, faster.

1. **Escalation-reason telemetry.** Every `autopilot:needs-human` hand-off (including the daily terminal-state sweep's force-escalations) records a machine-readable reason code: `l0l1-path`, `human-changes-requested`, `checks-failing`, `checks-pending-aged`, `no-reviewer-consensus`, `not-mergeable`, `kill-switch-off`, `sweep-forced`. Reason codes land on the PR label/comment and in the EXEC ledger row the fire already writes (R-N2: no new store). Weekly aggregation rides the Epic-016 analytics surface.
2. **Wire the top eligible-but-escalated classes.** Expected candidates (to be confirmed by Story 1 data, not assumed): auto-nomination of a 3-reviewer panel on every agent-authored non-L0/L1 PR at open time rather than on Nadia's manual routing pass; bounded auto-rerun of known-flaky checks; draft→ready flip when the author cadence marked the work complete (ADR-0014 already makes drafts merge-eligible — the gap is the ready signal); re-verdict after the last nominee's lens review instead of on the next daily tick (ADR-0013's event-driven path, completed).
3. **Judge the hypothesis.** After Story 2 has been live for a full 28-day window, publish the funnel: share of PRs autonomous, share escalated by reason. **Success**: autonomous count moves by an order of magnitude (6 → ≥30–60 per 28d) or autonomous share of *eligible* (non-L0/L1) PRs reaches ≥20%. **Falsified**: if after the wiring the overall autonomous share still sits in single digits *and* the reason data shows the residual is concentrated in `no-reviewer-consensus`, we conclude — as the monthly report pre-committed — that the bottleneck is **review-organisation design**, and open a successor Epic that redesigns reviewer rostering (that redesign is explicitly out of scope here; see also Epic-022, which changes *who* is consensus-eligible).

## Behaviour at N = 100+ agents

- Reason codes are O(1) per PR, stored on rows that already exist; no per-agent state.
- Auto-nomination must not degenerate into "the same 3 reviewers on everything" as PR volume grows: the nomination pool is derived from the roster by function match, and Epic-022's trust tiers (if accepted) become the eligibility filter — at N=100+ the panel pool widens automatically instead of bottlenecking on named individuals.
- The daily sweep and the funnel aggregation scan PRs, not agents; volume tracks change-proposal flow, which scales with active work, not headcount.

## Acceptance criteria

- 100% of `autopilot:needs-human` hand-offs in a sample week carry a reason code; the weekly funnel renders from ledger data with zero manual counting.
- The Story-2 wiring changes are merged, each individually reversible, none touching `docs/governance.md`, ADRs, or the R-N10 predicate text.
- One full 28-day post-wiring window is measured and the verdict (success / falsified / inconclusive) is written back into this Epic and the next monthly report.
- W-3 unchanged: the added fires (event-driven re-verdicts, auto-nominated lens reviews) fit inside the current $250/mo envelope; the funnel report states the marginal token cost.

## Open questions

- Q1. Should the order-of-magnitude target be measured on *count* (6 → 60) or on *eligible share* (≥20%)? Count is what the report promised ("桁で増やす"); share is robust to a slow PR month. Proposal: report both, gate the verdict on share.
- Q2. Auto-rerun of flaky checks risks masking real regressions (C-4 fail-loud). Proposal: max 1 rerun, only for checks on an allowlist with a recorded flake history, and the rerun is itself logged as a reason-code event.
- Q3. Does auto-nomination at open time double-fire with Nadia's existing routing pass? Needs a single owner: the event-driven path nominates; the daily pass becomes the sweep/backstop only.

## Out of scope

- Any change to the R-N10 predicate, the L0/L1 path set, unanimous-consensus rule, or kill-switch semantics (all Zone A).
- Reviewer-roster redesign (the falsification branch's successor Epic).
- Trust-tier computation (Epic-022).

## RFC record (2026-07-07)

See PR for the panel's comments; substantive feedback incorporated inline.
