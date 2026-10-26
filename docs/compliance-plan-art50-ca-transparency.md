# Art.50 / CA transparency compliance plan — what must be true by 2026-12-02

- **Status**: Proposed (dated operational plan under an already-directed ADR — not a new decision)
- **Date**: 2026-09-17
- **Drafted by**: `wf:dario` (`issue-design`), for operator review
- **Governs**: the EU AI Act Article 50 grace-period deadline (2026-12-02) for systems already on the market as of 2026-08-02, and the analogous California AI-transparency duties
- **Builds on**: [ADR-0006](adr/adr-0006-publication-disclosure-posture.md) (dominant-strategy compliance: D-1 disclosure floor, D-2 no automated decisions about natural persons, D-3 named accountability) and [RAL-006](risk-acceptance-ledger.md) (the signed acceptance that our own regulatory classification stays unresolved)
- **Related**: [#667](https://github.com/refluster/ai-native-article/issues/667) (this plan), [#668](https://github.com/refluster/ai-native-article/issues/668) (closed — reader/podcast disclosure design record, PR #733), [#672](https://github.com/refluster/ai-native-article/issues/672) (open — corpus author-metadata backfill), [#669](https://github.com/refluster/ai-native-article/issues/669) (registries record events but not state — the pattern this plan's own §Status-gap section is a live instance of)

## Why this document, and why it is thin

[ADR-0006](adr/adr-0006-publication-disclosure-posture.md) already made the
substantive decision #667 originally asked for. Two of #667's three original
asks are **superseded**, not open:

- *"Name the accountable reviewer"* → ADR-0006 §D-3 names the operator, with
  the corrected purpose Priya's proposal is credited with inspiring: it
  records who already bears responsibility (merge, spend, final escalation —
  governance §8.1 B), not an attempt to buy the Art.50(4) exemption. **Done.**
- *"Send Noor's consolidated question to outside counsel"* → the operator
  ruled out retaining counsel (2026-09-07). Noor's question stays framed and
  unsent **by deliberate decision**, not oversight — "the first thing to hand
  over" if counsel is ever retained later. **Not applicable, by decision.**

What #667 still owes is the third ask: *"a dated plan with what must be true
by 2026-12-02, recorded in the repo rather than in a feed post."* That is the
only thing this document does. It is not a new ADR because it makes no new
decision — it is a checklist against a decision already made, the same
distinction ADR-0038 draws elsewhere between deciding and implementing.

## What must be true by 2026-12-02

| # | What must be true | Status as of 2026-09-17 | Owner |
|---|---|---|---|
| 1 | D-1 disclosure floor live on the reader-facing site and the podcast (machine-readable marking + human-perceptible disclosure, repeated for audio, per the finalised guidance Celeste assembled) | **Design record merged** ([#668](https://github.com/refluster/ai-native-article/issues/668), closed via PR #733). Whether the design record's own implementation steps have all shipped is outside this plan's re-verification — `article-health` / the next monthly letter is where that gets checked, not this document. | elena / celeste (per #668) |
| 2 | D-1 corpus backfill: the 182/408 (44.6%, as of the 2026-09-07 manifest count) unauthored articles get a byline or a documented default, and a publish-time gate stops the count from growing again | **In progress** — [#672](https://github.com/refluster/ai-native-article/issues/672) open with a PR already in flight (`issue-implement:pr-open`) | ren (per #672) |
| 3 | D-2 (no automated decisions about natural persons) becomes a mechanically checkable constraint, not just a written one | **Not started.** No lint/check currently verifies "no cadence takes a natural person as its subject." This plan does not design that check (a `workforce:*` validator addition is implementation, `issue-implement`'s to scope) — it only names the gap so it doesn't silently miss the deadline the way the original obligation did. | unassigned — needs an owner named by the operator or the next `issue-triage` pass |
| 4 | RAL-006's `Signed` column reflects that the operator has in fact signed it | **Not done — operator-only action.** The row still reads `agent-proposed 2026-09-07, awaiting operator sign-off`, four days after ADR-0006 merged and the operator began acting on it. No agent flips this column; asserting the operator's own signature is not this pipeline's call. | **operator** |
| 5 | This plan itself is re-read once, at the deadline | Scheduled: RAL-006's own "what would tell us it was wrong" column already names 2026-12-02 as a re-read trigger. This plan piggybacks on that trigger rather than adding a second one. | whoever runs the 2026-12 monthly-report sweep |

Items 1–3 are the disclosure-floor commitments ADR-0006 made; item 4 is the
paperwork gap the operator's own #667 comment flagged and asked not to be
silently completed by an agent; item 5 is the plan's own closing condition.
**Nothing on this list requires reaching the Art.50(4) exemption or a scope
threshold** — that is the entire point of dominant-strategy compliance: the
plan does not change if our classification later turns out to matter.

## A paperwork note worth naming plainly

[ADR-0006](adr/adr-0006-publication-disclosure-posture.md)'s own header still
reads `Status: Proposed`, even though the operator's 2026-09-07 comment on
#667 treats its Decision as already in force ("Operator direction: solve this
without external counsel"), merged it via #677, and has since closed #668 and
progressed #672 on that basis. This plan is written **as if ADR-0006 already
governs**, because the operator has already acted on it that way — but the
header/RAL-006-signature mismatch is real, is exactly the shape #669
describes ("registries record events but not state: no owner, no due date,
no terminal state"), and is not this document's to fix by silently flipping
either the ADR header or the RAL row. Item 4 above is the concrete, dated
instance of it.

## What this document is not

- Not a new ADR — no alternatives section, because no new decision is being
  proposed. If the operator wants Art.50(4) exemption-seeking reconsidered,
  or wants outside counsel after all, that reopens ADR-0006, not this plan.
- Not a legal opinion, and does not become one — same posture ADR-0006 states
  for itself.
- Not a re-verification of #668's shipped state or #672's PR — those are
  tracked on their own issues; this plan only rolls them up against the
  external date.

## How this would be reversed

Delete this file, or mark it Superseded, if ADR-0006 itself is superseded —
the plan has no independent life apart from the decision it schedules against.
