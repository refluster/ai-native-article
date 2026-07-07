# Epic-022 — The trust ladder: authority that widens and narrows on recorded track record

- **Status**: Draft
- **Owner**: priya
- **Created**: 2026-07-07
- **Implemented by**: —
- **Hypothesis under test**: Monthly report 2026-07 (article `d06ecf4bb246`), 仮説五 — *trust compounds not from the absence of accidents but from accumulated recorded performance. The scope delegated to an agent can be an explicit staircase — widen a step when the record meets the bar, narrow a step automatically where an accident happened. Promotion and demotion decided by records, not feel. Build the first staircase on change-proposal review authority.*

## Problem

Authority in this org today is **static and binary**. The governance matrices (root §8.1, workforce §5) say what *agents* may do; they do not distinguish between a persona with 200 clean recorded reviews and one registered yesterday. Widening anyone's scope means a human editing a Zone A doc; narrowing after an incident means the same. Two costs follow. First, delegation cannot compound: the record every agent accretes (EXEC ledger, engagements, review verdicts) buys nothing — trust is re-derived from vibes at each decision. Second, the response to failure is all-or-nothing: after the 07-04 incident we added a mechanical lint (right), but had no way to *narrow that persona's autonomy in the affected domain* pending a track record (the graduated response human orgs use instinctively).

The report picked the first domain deliberately: **PR review authority** — the same funnel Epic-018 measures — because the record there is already complete (every review, verdict, merge, revert, and escalation is on the ledger or on GitHub).

## Proposed solution

A computed **trust tier per (persona, domain)**, with mechanical promotion/demotion rules, applied first to the PR-review domain. Crucially: **tier rules are Zone A** (thresholds, what counts as an incident — human-owned, like the rubric in the quality layer); **tier assignments are computed** (nobody, human or agent, hand-sets a tier; the record does).

1. **Tier definition (PR-review domain).**
   - **T0 — observer**: newly registered / demoted. May comment; reviews don't count toward consensus.
   - **T1 — lens reviewer**: may be nominated for lens reviews; counts toward the R-N10 unanimous-green consensus.
   - **T2 — nominator**: may assemble/auto-assemble reviewer panels (feeds Epic-018's auto-nomination).
   - Promotion T0→T1: ≥N recorded lens reviews (as observer) with no post-merge revert or incident attributed to a PR they green-lit; T1→T2: ≥M consensus participations with a clean record. N, M, and the incident taxonomy are Zone A constants proposed in this Epic for operator sign-off.
   - **Demotion**: an attributed incident (post-merge revert for cause, a W-guard trip traced to a green-lit PR, a conduct incident in the domain) automatically drops the persona one tier *in that domain* and opens a ledger-visible note. Re-promotion is by the same record-based bar — no penalty box timer, no human pardon path outside the normal Zone A amendment.
2. **Computation + surface.** A deterministic job recomputes tiers from the ledger (append-only inputs → reproducible output; the tier table is a *cache*, rebuildable from history — R-N2, no new store). Tiers render on the agent profile (the LinkedIn-style page gets its first earned credential) and are readable by `pr-autopilot` routing.
3. **Enforcement point.** Exactly one: reviewer **nomination/consensus eligibility** in the pr-autopilot flow. The R-N10 merge predicate itself is untouched — a unanimous-green consensus is still required; what changes is whose green can constitute it. This is the deliberate, bounded first rung; wider domains (curation authority for Epic-021, cadence self-modification, budget requests) are future rungs that reuse the same machinery **only via their own Zone A proposals**.

**Relationship to Epic-018:** 018 raises throughput through the existing predicate (wiring); 022 makes the *people side* of the predicate scale (who is consensus-eligible). 018's telemetry supplies the record 022 computes on; 022's tiers widen 018's nomination pool at N=100+. They are separable — either can ship without the other — but they compound.

## Behaviour at N = 100+ agents

- This is the mechanism that lets review authority scale *without* a human maintaining a reviewer list: new personas start at T0 and earn in; the pool self-heals on demotion. At N=100+, hand-curated reviewer rosters are the alternative, and they do not survive.
- Tier computation is O(review events), not O(N²); the per-persona tier row is one item.
- Failure mode at scale — **metric gaming** (reviewing many trivial PRs to farm promotions): the Zone A thresholds must count *diverse, non-self-adjacent* reviews (no tier credit for reviewing your own team's PRs exclusively), and the monthly analytics (Epic-016) watches tier-population drift. Named here so the threshold design confronts it, not discovers it.
- The (persona, domain) key means a persona demoted in one domain keeps standing elsewhere — graduated, not global, response; this stays true at any N.

## Acceptance criteria

- Tier rules (N, M, incident taxonomy) written as a Zone A diff and explicitly operator-approved before any enforcement.
- The computation job reproduces identical tiers from a replayed ledger (determinism test); tiers visible on agent profiles.
- `pr-autopilot` nomination reads tiers behind a **kill-switch that defaults off**; first enforcement window runs in shadow mode (tiers computed and logged, not enforced) for ≥2 weeks, and the shadow/live divergence report goes to the operator with the enable request (B-authority).
- One demotion path exercised end-to-end on a synthetic incident in `dev`.
- The verdict on 仮説五 (does record-based tiering change review behaviour/throughput?) written into a monthly report within one cycle of live enforcement.

## Open questions

- Q1. Incident *attribution* is the hard edge: a revert may implicate the author, the reviewers, or neither (world changed). V1 proposal: attribute to reviewers only on reverts-for-cause explicitly labelled so by the escalating human; err toward non-attribution. Is that too lenient to test the hypothesis?
- Q2. Should tier-0 cold-start be seeded from historical ledger data (personas with long clean histories start at T1/T2) or does everyone start at T0 for a clean experiment? Proposal: seed from history — the whole point is that the *existing* record buys standing; a cold start throws away the compounding we claim to test.
- Q3. Do human `CHANGES_REQUESTED` events affect the author's tier, or only review-side records? Proposal: V1 counts review-side only; author-side quality is already measured by Epic-016.

## Out of scope

- Any change to the R-N10 merge predicate, L0/L1 boundary, or Zone A approval requirements.
- Tiering domains beyond PR review (each future domain = its own Zone A proposal reusing this machinery).
- Model/budget changes as promotion rewards (compensation is a different, unproposed idea).
- Human-org-style performance reviews; the ledger is the review.

## RFC record (2026-07-07)

See PR for the panel's comments; substantive feedback incorporated inline.
