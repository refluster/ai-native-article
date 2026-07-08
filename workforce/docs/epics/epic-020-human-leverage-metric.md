# Epic-020 — Human leverage as a first-class metric: measuring the value of one human touch

- **Status**: Accepted (2026-07-08)
- **Owner**: maya
- **Created**: 2026-07-07
- **Implemented by**: —
- **Hypothesis under test**: Monthly report 2026-07 (article `d06ecf4bb246`), 仮説二 — *human–agent co-prosperity is measurable, not sentimental: as leverage per single human intervention. A good organisation is not one with the fewest human touches, but one where each human touch is priced highest.*

## Problem

The monthly report claimed, qualitatively, that the human's position has moved from gatekeeper to auditor: one approval click now releases an entire podcast episode's production line; one weekly digest audits dozens of ledger mutations. But we published that claim without a number, and promised to "actually count it" next month. Today no surface counts human interventions at all — they are scattered across GitHub merge events, the podcast `script-ready → approved` transitions, the weekly `AUDIT#` config digests, W-3 cap decisions, and operator verdicts on escalated PRs. If we cannot enumerate the touches, we cannot test whether the org's design is raising or diluting their value, and the "human stays in the seams, not the loop" thesis stays rhetoric.

## Proposed solution

Define, compute, and publish a **human-leverage metric** from records that already exist. No new store (R-N2), no new AWS service; this extends the Epic-016 analytics surface.

1. **Touch taxonomy (the human side of the ledger).** Enumerate the countable human intervention types: PR merge/close by the operator, operator verdict on an `autopilot:needs-human` escalation, podcast approval-gate flip, weekly config-digest review, W-3 cap amendment, Epic status flip (`Draft → Accepted`), hire-round sign-off (mechanically readable from `hires/` PRs). Each type maps to an already-recorded event — the taxonomy doc states, per type, *where* it is mechanically readable and which types are **estimated** rather than counted, and each type's "work unit" is a **closed enumeration** (otherwise the acceptance criteria are unverifiable). Two known traps, named now: **Notion property history is not readable at transition granularity** (the API serves current state), so the podcast pipeline appends the gate-flip event as a row at write time and Notion-derived types are marked estimated from day one; and **R-N10 delegated merges go through the project-scoped PAT**, so `merged_by` can render as the operator's account — the operator-touch is therefore defined by terminal action on a labelled (`autopilot:needs-human`/reviewed) PR, with a hard dependency on Epic-019 Story 1's reason records to split human from delegated merges.
2. **Leverage definition.** For each touch, leverage = the downstream work units it unblocked, **direct first-order only, no transitive credit** — and the podcast example must be counted honestly under that rule: the `script-ready → approved` flip unblocks only the *back half* of the line (voice, synthesis, show notes, publish); Rhys's script and Idris's verdict precede the gate and take no credit from it. **One-time unlocks** (e.g. the 07-07 Spotify submission) are their own class, never averaged with recurring gates — same quarantine as digest-class touches. Where attribution is genuinely ambiguous, the touch is reported with a count of `1` and flagged — under-claiming beats storytelling.
3. **Monthly publication.** A deterministic, **fixture-tested** script (replay a known month → known table) aggregates the month's touches into per-class tables — gate-class, digest-class, one-time — written to a `PERF#workforce/HUMAN-TOUCH` item and served via the existing `/performance` surface (R-N2; this also answers Q3: no new directory — the taxonomy is a section of the Epic-016 design doc). **Never a blended average across classes.** The number appears first in the 2026-08 monthly report, as promised — with its definition attached: what we measure in V1 is **leverage (fan-out), not price**; the 仮説二 claim about touches being "highest-priced" is only fully testable when the Phase-2 dollar column lands (dated commitment below). Any external quotation of the figure carries the same caveats (puffery risk — Celeste).

**Goodhart clause (Tessa/priya).** The metric is **informational, never a target**. If leverage-per-touch became a goal, the org would be incentivised to bundle approvals into fewer, bigger gates — mechanically raising leverage while thinning oversight. The taxonomy doc carries this clause, and the metric is always published alongside Epic-019's escalation-correctness data, never alone.

**Falsifier.** If <80% of the taxonomy's *countable-designated* touch types (estimated types are excluded from the denominator — otherwise the falsifier is gameable) turn out to be mechanically countable from existing records, the metric as defined fails; we record which types resisted counting and what recording change (if any) is worth its cost — or conclude the hypothesis is unmeasurable in this form and say so publicly in the report. To size what the lower bound hides, one sample week's ad-hoc chat decisions are hand-tallied once and reported next to the mechanical count.

## Behaviour at N = 100+ agents

- The metric counts *human* events, and there is one human; volume scales with organisational change flow, not headcount. If anything the metric becomes more interesting at N=100+ — it is the direct measure of whether the constitution scales.
- Leverage attribution reads per-event ledger rows; no per-agent scan is required.
- A risk at scale: the weekly digest becomes one "touch" covering hundreds of mutations, inflating leverage mechanically. The taxonomy therefore reports digest-type touches in their own class, never averaged with gate-type touches.

## Acceptance criteria

- The taxonomy exists as a section of the Epic-016 design doc, with per-type source-of-record, countable/estimated marking, closed work-unit enumerations, and the Goodhart clause.
- The aggregation script is fixture-tested, runs deterministically for the 2026-07 window, and produces the per-class tables (gate / digest / one-time — never blended) without manual counting for ≥80% of countable-designated touch types; output lands in `PERF#workforce/HUMAN-TOUCH`.
- The 2026-08 monthly report cites the number **with its leverage-not-price definition attached** (or honestly reports the falsifier outcome), alongside Epic-019's escalation-correctness data.
- The Phase-2 dollar-column commitment is dated and tied to Epic-016 per-deliverable cost data.
- Zero new credentials, stores, or services; marginal cost stated in the PR (deterministic computation — rounds to zero).

## Open questions (resolved by RFC 2026-07-07)

- ~~Q1 (lower bound acceptable?)~~ → **Resolved: yes** (priya, silas, farah concur) — a defensible undercount beats a story; plus the one-week hand-tally to size the gap (elena).
- ~~Q2 (work units vs dollars)~~ → **Resolved**: work units in V1 is acceptable **only with a dated Phase-2 commitment to the dollar column** (silas), and the V1 metric is labelled ordinal/leverage-not-price wherever published (elena).
- ~~Q3 (where does the taxonomy live?)~~ → **Resolved**: a section of the Epic-016 design + the `PERF#workforce/HUMAN-TOUCH` item; no new directory (mateo).

## Out of scope

- Any change to *which* actions require a human (that is governance, not measurement).
- Real-time dashboards; monthly batch is the V1 cadence.
- Counting agent-to-agent interventions (interesting, different metric, different Epic).

## RFC record (2026-07-07)

Panel: all VPs + ICs nadia, farah, corinne. Verdicts: **SUPPORT / SUPPORT-WITH-CHANGES; no blocks.** Load-bearing findings incorporated: **elena** — the V1 metric measures leverage, not the hypothesis's 値付け; the published number must say so, per-class distributions only, hand-tally one week of chat decisions. **tessa/priya** — the Goodhart clause: informational, never a target; publish only alongside 018's escalation-correctness data. **mateo** — Notion property history is not transition-readable (append gate-flip events at write time); output substrate = `PERF#workforce/HUMAN-TOUCH` via `/performance`. **nadia** — the `merged_by`-PAT trap; operator-touch defined by labels + 018 Story-1 dependency. **celeste** — the approval gate unblocks only the back half of the podcast line (first-order rule applied to the Epic's own example); one-time unlocks quarantined; caveats travel with external quotes. **silas/dario** — work-units V1 accepted with a dated dollar-column commitment; closed work-unit enumerations; fixture-tested aggregation. **corinne** — publish the table at a stable citable location (the PERF item) so her investor letter and Maya's report reconcile to one source.
