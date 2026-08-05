# Epic-020 — Human leverage as a first-class metric: measuring the value of one human touch

- **Status**: In-progress (2026-08-04)
- **Owner**: maya
- **Created**: 2026-07-07
- **Implemented by**: [#539](https://github.com/refluster/ai-native-article/pull/539) (Story 1 human-touch taxonomy v1 — [#452](https://github.com/refluster/ai-native-article/issues/452); **open, not merged**)
- **Hypothesis under test**: Monthly report 2026-07 (article `d06ecf4bb246`), 仮説二 — *human–agent co-prosperity is measurable, not sentimental: as leverage per single human intervention. A good organisation is not one with the fewest human touches, but one where each human touch is priced highest.*

> **Status reconciliation (2026-08-05, Nadia — backlog-reconcile). `Accepted (2026-07-08)` → `In-progress (2026-08-04)`.** Bucket: **incidentally done** at the lifecycle level. The epics-README lifecycle exits `Accepted` "once the first implementation PR is **open**" — and [#539](https://github.com/refluster/ai-native-article/pull/539) has been open against Story 1 ([#452](https://github.com/refluster/ai-native-article/issues/452), Maya-filed) since **2026-08-04T05:52:41Z**, declaring `Closes #452` and landing the seven-type human-touch taxonomy (T1–T7, each with source-of-record, counted/estimated marking, and gate/digest/one-time class) as a section of the Epic-016 design doc — exactly the shape this epic's own **Q3** resolved to ("a section of the Epic-016 design + the `PERF#workforce/HUMAN-TOUCH` item; no new directory"). So the trigger condition is met on the lifecycle's literal wording.
>
> **The evidence here is deliberately weaker than Epic-021's on the same day, and the difference is stated rather than smoothed over.** Epic-021 flips on *merged* code; this epic flips on an *open draft* carrying `autopilot:needs-author` / `autopilot:reason:review-findings-open`. The lifecycle's exit criterion is open-PR, not merge, so the flip reports the rule as written — but because the lifecycle is **monotonic**, it cannot be walked back if #539 is closed unmerged. **That asymmetry is the one thing in this pass worth an operator's scrutiny before merge.** The alternative — holding the row at `Accepted` — asserts "no code yet", which is already false: a PR exists, was reviewed, and is in the author lane.
>
> **Not `Implemented`.** Story 1 is unmerged; Story 2 ([#453](https://github.com/refluster/ai-native-article/issues/453) — fixture-tested aggregation → `PERF#workforce/HUMAN-TOUCH` via `/performance`) and Story 3 ([#454](https://github.com/refluster/ai-native-article/issues/454) — publish the number in the 2026-08 report + the one-week chat hand-tally) have no PR. Note also that Story 3's readout lands in the same 2026-08 report as Epic-019's 14-day interim funnel, whose comparability the 08-04 pass already flagged against ADR-0024.

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
