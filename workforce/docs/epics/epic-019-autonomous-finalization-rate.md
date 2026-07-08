# Epic-019 — Autonomous change finalization: from a 2.8% baseline to an order of magnitude more

- **Status**: Accepted (2026-07-08)
- **Owner**: nadia
- **Created**: 2026-07-07
- **Implemented by**: —
- **Hypothesis under test**: Monthly report 2026-07 (article `d06ecf4bb246`), 仮説一 — *the key to an organisation where many agents can work is not making individuals smarter but designing where judgment sits and how fast verification runs.*

## Problem

In the 28-day measurement window reported in the 2026-07 monthly report, the workforce processed **218 change proposals (PRs)** and only **6 of them (2.8%) reached merge with no human touch** via the R-N10 delegated-merge path. We deliberately called that number the **pre-wiring baseline**: the month's PR mix was heavy with changes that *must* escalate (governance restructuring, the podcast launch, Zone A edits), and those escalations are the system working. But we do not actually know the composition. Today, when `pr-autopilot` hands a PR to a human (`autopilot:needs-human`), the hand-off records *that* it escalated, not *why* — which predicate clause failed, or whether the PR was ever autopilot-eligible at all.

Without that breakdown we cannot test 仮説一. If most escalations are L0/L1-touching, the 2.8% is near its structural ceiling and the hypothesis fails in an interesting way (the org's change mix is inherently constitutional). If most escalations are eligible-but-unwired — reviewer panels never nominated, consensus never assembled, checks flaky, drafts never flipped ready — then wiring, not authority, is the bottleneck, and the rate should move by an order of magnitude without touching a single rule.

## Proposed solution

Three stories, strictly ordered: **measure → wire → judge**. This Epic **never widens the R-N10 predicate** — no L0/L1 boundary change, no consensus-rule loosening, no new merge authority. It only moves more PRs *through* the existing predicate, faster.

1. **Escalation-reason telemetry — extending, not minting.** The machinery already emits reasons in three places: `pr-merge.mjs` refusal `why` strings (sub-3 panel, missing green marker, cycle cap, mergeability), the terminal-state sweep's three kinds (`unlabelled-handoff` / `stale-routed` / `never-routed` — reused verbatim, never flattened), and the SKILL.md verdict table. Story 1 maps a versioned taxonomy 1:1 onto those and adds the causes Nadia has actually escalated: `l0l1-path`, `human-changes-requested`, `checks-failing`, `checks-pending-aged`, `no-reviewer-consensus`, `not-mergeable`, `kill-switch-off`, `no-r-n10-delegation`, `cannot-seat-panel`, `persona-escalation-trigger`, `cycle-cap-exceeded`, `merge-engine-refusal`, plus a mandatory-free-text `other` (the codes we didn't anticipate are the finding). Per-PR reasons land as a machine-readable GitHub comment marker + an `autopilot:reason:*` label family, extending the existing `<!-- autopilot:… -->` convention — **not** on EXEC rows, which are fire-grained, not PR-grained. Aggregation extends `build-pr-metrics-github.mjs` into the existing `PERF#{scope}/PR` item (R-N2: no new store). Two corrections this forces: L0/L1 eligibility must be computed at **verdict time for every escalated PR** (today it is only computed on the merge leg), or Story 3's eligible-share is uncomputable; and the taxonomy doc must state these codes measure *wiring*, not reviewer performance — they are inadmissible as Epic-023 "incidents".
2. **Wire the genuinely-missing machinery — which is less than first drafted.** RFC fact-check against the shipped code: the draft→ready flip already ships (`pr-merge.mjs` flips a green draft Ready and merges, adr-0014); open-time auto-nomination is already ADR-0013's design (status **Proposed**, runtime wiring open as OP-009 — an operator runbook step, not new Epic machinery; its `pull_request.synchronize` trigger already covers the 🟡-awaiting-revision wait state); and the routing double-fire question dissolves because the cron scan is idempotent — ADR-0013 pins **event = latency floor, cron = backstop sweep**. What Story 2 actually builds is therefore: **(a)** completing OP-009, **(b)** a load-balance cap on concurrent nominations per persona (fairness + W-3), and **(c)** the one genuinely new mechanism — **bounded auto-rerun of known-flaky checks**, under Farah's discipline: the flake allowlist is a reviewed repo file where every entry cites flake evidence and carries an expiry date (no evergreen exemptions); max 1 rerun; a rerun-then-pass is a recorded PR event + reason-code, never a silent green; a rerun that still fails escalates as `checks-failing` (never retried); a per-check rerun-pass rate above threshold means the check is racy, not flaky — auto-evict from the allowlist and open an issue; R-10/W-1-class editorial gates are **categorically rerun-ineligible**.
3. **Judge the hypothesis.** After Story 2 has been live for a full 28-day window, publish the funnel: overall autonomous share, autonomous share of *eligible* (non-L0/L1) PRs, and escalations by reason. **The verdict gates on eligible share ≥20%**, but the count-vs-baseline line (6 → ≥60 per 28d is the true 桁; ≥30 is only 5× and is reported as such, honestly) appears in the letter regardless — Nadia said "桁で増やす" publicly and the published number is the overall one, so both are pre-committed to the report with a "low PR month" caveat if count alone fails. Timing honesty: Story-1 sample week + Story-2 + OP-009 push the formal 28-day verdict past the 2026-08 report — so the **08 letter carries a mandated interim 14-day funnel snapshot**, final verdict in the 09 letter. **Falsified**: if after the wiring the eligible-share still sits in single digits *and* the reason data concentrates in `no-reviewer-consensus` / `cannot-seat-panel`, we conclude — as the monthly report pre-committed — that the bottleneck is **review-organisation design**, and open a successor Epic that redesigns reviewer rostering (out of scope here; see Epic-023, which changes *who* is consensus-eligible).

**Cost, stated before Accepted (Silas's gate).** The driving line is lens-review volume: ~218 PRs/28d × 3 reviewers ≈ 650 review passes/mo at full routing. Estimate to carry in the Story-2 PR: panels/mo × tokens/review × model rate, with a **trip condition** — if the observed run-rate implies a W-3 breach, auto-nomination pauses and escalates (never silently degrades). The tuning knob is panel size/routing selectivity, not the $250 cap.

## Behaviour at N = 100+ agents

- Reason codes are O(1) per PR, stored on rows that already exist; no per-agent state.
- Auto-nomination must not degenerate into "the same 3 reviewers on everything" as PR volume grows: the nomination pool is derived from the roster by function match, and Epic-023's trust tiers (if accepted) become the eligibility filter — at N=100+ the panel pool widens automatically instead of bottlenecking on named individuals.
- The daily sweep and the funnel aggregation scan PRs, not agents; volume tracks change-proposal flow, which scales with active work, not headcount.

## Acceptance criteria

- 100% of `autopilot:needs-human` hand-offs in a sample week carry a reason code (`other` requires free text); the weekly funnel renders from `PERF#{scope}/PR` data with zero manual counting.
- L0/L1 eligibility computed at verdict time for every escalated PR, not just the merge leg.
- The Story-2 wiring changes are merged, each individually reversible, none touching `docs/governance.md`, ADRs, or the R-N10 predicate text; the flake allowlist ships with evidence citations + expiry dates and the rerun-audit events verified.
- The interim 14-day funnel snapshot appears in the 2026-08 monthly report; the full 28-day verdict (success / falsified / inconclusive) is written back into this Epic and the 2026-09 report.
- The pre-Accepted cost estimate (panels/mo × tokens/review × rate) is in the Story-2 PR body; the W-3 trip condition on auto-nomination is implemented and tested.
- Dependencies named and tracked: Epic-016 OP-011 reducer redeploy (#436) and OP-012 daily PR-metrics refresh (#437) — Story 3's funnel is stale without both.

## Open questions (resolved by RFC 2026-07-07)

- ~~Q1 (count vs share)~~ → **Resolved**: verdict gates on eligible share ≥20%; count vs 6 reported regardless with an explicit caveat; ≥60 is the honest 桁 line.
- ~~Q2 (flaky rerun vs C-4)~~ → **Resolved**: Farah's discipline adopted in Story 2(c) — evidenced+expiring allowlist, max 1, audited, auto-evict racy checks, editorial gates ineligible.
- ~~Q3 (double-fire)~~ → **Dissolved**: the cron scan is idempotent; ADR-0013 already pins event = latency floor, cron = backstop. No ownership change needed.

## Out of scope

- Any change to the R-N10 predicate, the L0/L1 path set, unanimous-consensus rule, or kill-switch semantics (all Zone A).
- Reviewer-roster redesign (the falsification branch's successor Epic).
- Trust-tier computation (Epic-023).

## RFC record (2026-07-07)

Panel: all VPs (mateo, dario, priya, elena, tessa, silas, celeste) + ICs nadia (owner), farah. Verdicts: **SUPPORT-WITH-CHANGES across the board; nadia Accept-as-Owner conditional on 4 corrections** — all incorporated. The load-bearing findings: **nadia/dario** — the first draft's Story 2 re-proposed shipped machinery (adr-0014 draft-flip; ADR-0013 open-time nomination) and misstated ADR-0013 as completed; Story 2 was rewritten to the genuinely-missing set (OP-009, nomination load-cap, flaky-rerun) and Story 1 rebased onto the existing sweep/refusal reason strings. **mateo** — reason codes moved off EXEC rows (fire-grained, not PR-grained) onto GitHub markers + `PERF#{scope}/PR`; #436/#437 named as dependencies. **silas** — cost estimate + W-3 trip condition required before Accepted. **elena/tessa** — success gate honesty: both denominators pre-committed, arithmetic fixed (30 ≠ 桁), denominator chosen before measurement. **priya** — telemetry declared non-admissible as reviewer-performance/022-incident data; per-persona nomination cap. **farah** — the rerun discipline in Story 2(c) verbatim. **celeste** — `other` catch-all so the 100%-coverage criterion can't be met by mislabeling.
