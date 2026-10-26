# Editorial desk concentration — design note

- **Status**: Proposed (draft PR for #674; `wf:lane:design`). A design note, not an ADR: it
  recommends how to answer a management question inside existing statute (W-1, W-4, W-3) and
  binds no later work except the two thresholds in "How it would be reversed", which the
  operator signs.
- **Implements nothing.** The product decision itself (keep or split) is the operator's; this
  note puts the options, costs, a recommendation and a kill criterion in front of them so that
  deciding is one signature.

## Decision

**Keep one editorial desk (`ingrid` holds `article-level2` and `article-level3`) for now, and
treat the real risk — an undetected stall, not the single byline — with a detector rather than
a second persona.** Measure voice convergence per skill-bundle version first (Kai's cheap
metric). Revisit a split only if one of the two kill criteria below fires.

## What forced it

- #674: 57 of 58 externally published articles passed through one persona (Maya, 2026-09 §7).
  She has deferred the call and names deferral itself as accumulating risk.
- **The failure mode has already happened, and its cause was not the persona.** The
  2026-07-26 → 2026-08-02 outage ran 7 days / 28 dispatches because `pick-l1-source.mjs` bypassed
  the CCR proxy (ML-017); `feed-post` and `daily-research` on other hosts kept working
  (ML-019). A second editor persona bound to the same `article-level2` skill, runner and
  `api.notion.com` egress would have failed identically. The fault was a common-mode path, not a
  missing colleague.
- **Live bindings (agents-api, 2026-10-06):** `ingrid` binds `article-level2`
  (`cron(0 0/6 ? * * *)`, medium) and `article-level3` (`cron(30 3/6 ? * * *)`, large); `rhys`
  binds `podcast-script` and `celeste` `podcast-publish`, one each. The podcast supply is the
  same shape one level down: one upstream feeding one script.
- **The countervailing evidence is real.** Elena (2026-07→08) found three independent
  articles landing on nearly the same claim; Kai located the cause in the worked examples inside
  each skill bundle, not the brand guide. Splitting personas while they share those examples
  would add a second byline over the same house style.
- **A second desk is mechanically non-trivial today.** `pick-l1-source.mjs` (`article-level2` 0.4.0,
  lines ~245-261) returns the oldest *coverable* uncovered L1 row — it steps past fetch
  failures and blocks a row after `MAX_ATTEMPTS` (ML-018) — but holds no claim or lock. Two
  desks firing in the same window would race to the same row and produce duplicates unless the
  picker gains a claim mechanism — a code change, not a binding edit.

## Options

| | Option | Availability | Consistency / diversity | Cost |
|---|---|---|---|---|
| A | **Keep single desk + machine detector** (recommended) | Stall detected in ≤ 18 h once the outcome ledger exists (≈ 5 days via R-15 alone until then); recovery is a human or a re-fire | Unchanged; measured per bundle version | Low, not zero: #664's counter (unmerged) plus the unbuilt per-fire outcome ledger (ML-019), which must be costed as its own slice |
| B | Same persona, second staggered binding | Helps only for per-fire flakiness, not for common-mode faults like ML-017 | Unchanged | +1 binding per level on the W-3 ledger (≈ medium 0.20 / large 0.60 USD per fire) |
| C | Split: second editor persona, own examples | Independent persona does not make the runner, Notion token or egress independent | Possible divergence — or merely a second copy of the same house style | New persona + 2 bindings + picker claim logic + per-persona examples to write |
| D | Split by desk (L2 vs L3 owners) | Partial: one level can survive the other's stall | Splits the voice by function, not by viewpoint | As C, smaller |

## Why A, and why not the others

- **B rejected**: ML-017 is the observed failure, and it is common-mode; a second binding of the
  same skill adds cost without addressing it.
- **C rejected for now**: it buys diversity only if the examples that cause convergence are also
  replaced, and we cannot yet show convergence is a persona property rather than an examples
  property. Kai's measure answers exactly that, cheaply, before we pay for a persona.
- **D rejected**: moves the concentration rather than removing it, and leaves L2→L3 coupling.
- **A's honest weakness**: it detects the outage, it does not prevent the silence. A documented
  fallback (below) bounds how long that silence lasts.

## Design

1. **Detector first.** The falsifier #674 already states — "the next single-path stall is caught
   by a machine within hours, not by a reader after six days" — needs a data source that does
   not exist today. ML-019 records that the per-fire outcome ledger (produced / skipped-with-
   reason / failed, written by the agent-runner routine) is unbuilt, and #664's repeat-failure
   counter is not yet merged. So:
   - **Hard prerequisite:** the outcome ledger (ML-019, shared with ML-013) and #664's counter.
     Owner: the workforce platform lane that owns the agent-runner routine. Tracking: the
     counter half is #664 (slice 1 landed in #795); the outcome-ledger half (ML-019) has no
     issue yet and is filed as a follow-up when #674 is decided — it does not gate this note.
   - **Interim signal until then:** R-15 (`corpus-freshness.yml`) is the *only* detector. It is a
     daily, 5-day freshness gate, so the interim detection latency is up to ~5 days — no better
     than the 2026-07/08 outage. The "within hours" claim holds only after the prerequisite ships.
   - **Requirement once the prerequisite exists:** an *N consecutive zero-deliverable fires*
     streak on `article-level2` or `article-level3` opens an issue routed to the operator, with
     **N = 3**. At the 6-hourly cadence the third consecutive empty fire lands 12-18 h after
     onset, so the detection-latency budget is ≤ 18 h, inside the 24 h kill-criterion line.
     "Unflagged" below means no issue opened within that budget.
   - **Acceptance test (owned by the detector slice):** 3 consecutive zero-deliverable fires
     open an issue; 2 do not; a produced or skipped-with-reason fire resets the streak.
2. **Documented fallback.** Owner: the operator (runbook line in
   `workforce/docs/runbooks/`; W-5 audit via agents-api). Budget: it *moves* the existing
   `article-level2` line (≈ 0.20 USD per medium fire, 4 fires/day) to the temporary persona while
   `ingrid`'s binding is paused, so there is no net W-3 change; ceiling: the temporary binding is
   removed at the earlier of root-cause fix or 7 days. If the desk stalls and the cause is not
   fixable same-day, the operator may bind `article-level2` to a second persona *temporarily* (one `PATCH` via
   agents-api, W-5 audited), accepting the picker-race caveat by pausing `ingrid`'s binding in
   the same edit. This is a runbook line, not standing infrastructure.
3. **Measure before splitting.** Adopt Kai's cheaper metric: the rate of the tell-tale phrasings
   per skill-bundle version (`systemPromptVersion` is already in article frontmatter, GROWTH.md
   §2). Swap the examples in one bundle and see whether the rate moves. The judge-rubric
   dimension for style convergence is a Zone A diff and is a separate proposal.
4. **Test Celeste's structural hypothesis alongside**: agents receive only their own past posts
   as material and drift to the same conclusion. Cheapest probe: feed one cadence run a recall
   packet that includes a peer's relevant work and compare conclusions.

## What it costs

- A stall still silences the external voice until the detector fires and someone acts; the
  recommendation accepts hours, not zero.
- Convergence stays unmeasured until step 3 ships; the homogenisation risk persists meanwhile.
- The detector depends on #664 slices that are not yet merged *and* on the unbuilt outcome ledger
  (ML-019); until both ship, detection latency is R-15's ~5 days.

## How it would be reversed

Choose C (or D) instead if **either**:

1. **Detector fails its job** (once the prerequisite ships): a single-path stall of ≥ 24 h goes
   unflagged by the machine again (no issue opened within the ≤ 18 h budget),
   or two detected stalls in 90 days each lasted > 48 h to recover; or
2. **Examples swap does not move the phrasing rate** in the step 3 test within one bundle
   revision, which would show convergence is the persona/process and not the examples. Proposed
   operator-signed values: phrase set = Kai's tell-tale list, frozen in the measurement slice
   before the swap; baseline = per-version rate over the preceding bundle revision; sample ≥ 12
   articles per arm; "moves" = ≥ 25 % relative reduction versus baseline.

Review date: the first of the two events, or 2026-12-06 if neither occurs.

## Out of scope

- The judge-rubric / `JUDGE_ROSTER` change (Zone A; separate proposal).
- Podcast supply redundancy (`rhys`/`celeste`), beyond noting it shares the shape.
- Writing the replacement examples, picking a second persona, or any binding edit.
- Implementing the counter (#664) or the outcome ledger (ML-019).

## Governance consulted

`docs/governance.md` (C-1, C-4), `workforce/docs/governance.md` (W-1, W-3, W-4, W-5),
`docs/memory-lint-backlog.md` (ML-017, ML-019), `newsletter/docs/GROWTH.md` §2,
`workforce/docs/design/repeat-failure-counter.md`, `workforce/docs/mvv.md`.
