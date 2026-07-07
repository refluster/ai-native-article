# Epic-019 — Human leverage as a first-class metric: measuring the value of one human touch

- **Status**: Draft
- **Owner**: maya
- **Created**: 2026-07-07
- **Implemented by**: —
- **Hypothesis under test**: Monthly report 2026-07 (article `d06ecf4bb246`), 仮説二 — *human–agent co-prosperity is measurable, not sentimental: as leverage per single human intervention. A good organisation is not one with the fewest human touches, but one where each human touch is priced highest.*

## Problem

The monthly report claimed, qualitatively, that the human's position has moved from gatekeeper to auditor: one approval click now releases an entire podcast episode's production line; one weekly digest audits dozens of ledger mutations. But we published that claim without a number, and promised to "actually count it" next month. Today no surface counts human interventions at all — they are scattered across GitHub merge events, the podcast `script-ready → approved` transitions, the weekly `AUDIT#` config digests, W-3 cap decisions, and operator verdicts on escalated PRs. If we cannot enumerate the touches, we cannot test whether the org's design is raising or diluting their value, and the "human stays in the seams, not the loop" thesis stays rhetoric.

## Proposed solution

Define, compute, and publish a **human-leverage metric** from records that already exist. No new store (R-N2), no new AWS service; this extends the Epic-016 analytics surface.

1. **Touch taxonomy (the human side of the ledger).** Enumerate the countable human intervention types: PR merge/close by the operator, operator verdict on an `autopilot:needs-human` escalation, podcast approval-gate flip, weekly config-digest review, W-3 cap amendment, Epic status flip (`Draft → Accepted`), hire-round sign-off. Each type maps to an already-recorded event (GitHub API, Notion property history, `AUDIT#` trail, epics README) — the taxonomy doc states, per type, *where* it is mechanically readable and which types are estimated rather than counted.
2. **Leverage definition.** For each touch, leverage = the downstream work units it unblocked (e.g. one podcast approval → the episode's full 5-role line; one digest review → N audited mutations; one Epic acceptance → its Stories). V1 keeps the attribution rule simple and documented rather than clever: direct, first-order unblocking only, no transitive credit. Where attribution is genuinely ambiguous, the touch is reported with a count of `1` and flagged — under-claiming beats storytelling.
3. **Monthly publication.** A deterministic script aggregates the month's touches and leverage into a small table that the `monthly-report` cadence can cite: total human touches, touches by type, median/max leverage, and the trend vs the prior month. The number appears first in the 2026-08 monthly report, as promised.

**Falsifier.** If <80% of the taxonomy's touch types turn out to be mechanically countable from existing records, the metric as defined fails; we record which types resisted counting and what recording change (if any) is worth its cost — or conclude the hypothesis is unmeasurable in this form and say so publicly in the report.

## Behaviour at N = 100+ agents

- The metric counts *human* events, and there is one human; volume scales with organisational change flow, not headcount. If anything the metric becomes more interesting at N=100+ — it is the direct measure of whether the constitution scales.
- Leverage attribution reads per-event ledger rows; no per-agent scan is required.
- A risk at scale: the weekly digest becomes one "touch" covering hundreds of mutations, inflating leverage mechanically. The taxonomy therefore reports digest-type touches in their own class, never averaged with gate-type touches.

## Acceptance criteria

- The taxonomy doc exists under `workforce/docs/` with per-type source-of-record and countable/estimated marking.
- The aggregation script runs deterministically for the 2026-07 window and produces the table without manual counting for ≥80% of touch types.
- The 2026-08 monthly report cites the number (or honestly reports the falsifier outcome).
- Zero new credentials, stores, or services; marginal cost stated in the PR.

## Open questions

- Q1. Is a *lower-bound* metric acceptable for V1 (count only mechanically-readable touches, ignore ad-hoc chat decisions)? Proposal: yes, and say so — a conservative number we can defend beats a complete number we can't.
- Q2. Should leverage be denominated in work units, or in token-cost of the work unblocked (Silas's framing: price each touch in dollars)? Proposal: work units in V1, cost as a Phase-2 column once Epic-016's cost data is per-deliverable.
- Q3. Where does the taxonomy doc live — `workforce/docs/analytics/` (new dir) or as a section of the Epic-016 design? Panel input requested.

## Out of scope

- Any change to *which* actions require a human (that is governance, not measurement).
- Real-time dashboards; monthly batch is the V1 cadence.
- Counting agent-to-agent interventions (interesting, different metric, different Epic).

## RFC record (2026-07-07)

See PR for the panel's comments; substantive feedback incorporated inline.
