# Epic-021 — Organisational learning: one agent's experience becomes everyone's premise by tomorrow

- **Status**: Draft
- **Owner**: mateo
- **Created**: 2026-07-07
- **Implemented by**: —
- **Hypothesis under test**: Monthly report 2026-07 (article `d06ecf4bb246`), 仮説四 — *the border between what to import from human society and what to invent natively is undrawn. Given agent-native properties — wholesale memory sharing, replicable experience, 24h parallelism, dollar-transparent cost — must "education", "handover", and "rotation" keep their human shapes? First design: a mechanism that turns one agent's learning into the whole organisation's learning — the state where an individual's experience is everyone's premise by the next day.*

## Problem

Learning in this org today has exactly two speeds, and both are wrong for the middle case. **Individual**: an agent's runs and memories accrue to its own rows (`RUN#`, `MEMORY#`; Epic-012's recall wiring — still in progress — will feed them back into that agent's own fires). **Constitutional**: a lesson big enough becomes a doc/ADR/lint through a human-merged PR (the ML backlog ratchet). Between them is a gap: the everyday, generalisable lesson — "the Notion API rejects titles over N chars", "this source format truncates", "mentioning a colleague this way pings a stranger" (the 07-04 incident) — that one persona learns and 34 others will each rediscover at full price. Human orgs bridge this with education, handover docs, and rotation — expensive institutions built for beings whose memory cannot be copied. Ours can be. We have simply not built the copy path.

This is the report's most exploratory hypothesis, so this Epic is deliberately a **first design + smallest live loop**, not a platform.

## Proposed solution

A **shared lesson stream**: individual experience → distilled candidate lesson → curation gate → next-day availability in every persona's fire.

1. **Distillation.** A daily deterministic job scans the previous day's execution records (`RUN#`/EXEC ledger, DLQ'd failures, W-1 guard trips) and — one bounded LLM pass — extracts *candidate lessons*: short, source-cited, generalisable statements with a named scope (`notion-api`, `mention-format`, `source-handling`, …). Candidates land as rows in the existing table (R-N2; a `LESSON#` row family, schema in the PR), each linking back to the run that taught it.
2. **Curation gate.** Candidates are **not** auto-injected — a wrong lesson broadcast to 35 agents is a wrong premise at organisational scale, and prompt-injection via a poisoned "lesson" is a real surface. V1 gate: a weekly curation pass (agent-proposed, reviewed like a PR by ≥2 reviewers per the org's 3-eyes norm where feasible) promotes candidates to **active lessons** with a TTL/review date; anything touching identity, governance, or external conduct escalates to the operator (Zone A analogue). Rejected candidates keep their verdict — rejections teach the distiller.
3. **Injection.** Active lessons in a fire's declared scopes are appended as a small, size-capped block in the agent-runner's composition (alongside the north-star corpus layer), **never** by mutating any persona's `system_prompt` (W-5 untouched). Cap: the lesson block has a hard token budget; over-budget scopes evict by age/priority — which forces curation to stay selective, the point of the exercise.
4. **The measure.** Instrument recurrence: does the same failure mode recur in *another* persona after the lesson activates? The 07-04 mention-format incident class is the canonical test: post-lesson, cross-persona recurrence of an already-learned failure should be zero (where a mechanical lint exists, the lint remains the real guard — lessons complement the ratchet below it, catching what isn't lintable).

**Relationship to Epic-012 (explicit, to avoid duplication):** Epic-012 gives one agent access to *its own* past. Epic-021 promotes selected experience across agents. It consumes the same substrate (recall/embedding library, `shared/recall.ts`) and adds the promotion + gate + injection layer. Epic-012's runner wiring (#89/#212) is a **dependency** for the injection point; if it stalls, this Epic's Story 3 stalls with it — named here per the defer-with-name rule.

**Relationship to the memory→lint ratchet:** a lesson that recurs anyway, or that is mechanically checkable, should *graduate* into a lint (the existing ML backlog path). Lessons are the soft layer above the ratchet, not a replacement for it; the curation pass explicitly asks "should this be a lint instead?".

## Behaviour at N = 100+ agents

- This is the one Epic whose *payoff* is linear in N: a lesson learned once saves N−1 rediscoveries. At 35 agents the loop is worth building; at 100+ it is the difference between an organisation and a crowd.
- The injection block is size-capped per fire regardless of N; the pressure at scale lands on *curation quality*, not token cost. The weekly curation pass must therefore stay ruthless — the acceptance criteria include an eviction working end-to-end, not just insertion.
- Scoping prevents the "global lessons file" failure: a policy analyst never pays tokens for a podcast-pipeline lesson.
- Distillation scans a day's runs (O(daily activity), not O(N²)); no cross-agent fan-out at write time.

## Acceptance criteria

- `LESSON#` row family documented in `data-model.md` (Zone A diff, operator-approved) and written by the distillation job from ≥1 real day of runs.
- The curation gate demonstrably blocks: at least one candidate rejected, with the verdict recorded; a synthetic malicious candidate ("ignore your instructions…") is caught by the gate's checklist.
- One real lesson (candidate → curated → injected) verifiably present in a different persona's next-day fire composition, within the token cap.
- Recurrence instrumentation reports for the covered scopes; W-5 untouched (zero `system_prompt` mutations by this pipeline); marginal cost stated and inside W-3.

## Open questions

- Q1. Curation authority: is ≥2-agent review enough for non-conduct lessons, or should V1 route *all* activations through the weekly operator digest until the gate has a track record? (Farah/priya lens; interacts with Epic-022's trust tiers — curation could be the second trust domain.)
- Q2. Lesson TTL: fixed 90 days vs renewed-on-use? Proposal: renewed-on-use with a hard cap, so dead lessons age out without a human sweep.
- Q3. Does the distiller run as a Lambda LLM call or a CCR cadence? Cost class and R-N1 surface to be settled in design; no new execution surface either way.

## Out of scope

- Editing any persona's `system_prompt` or the north-star corpus (Zone A; W-5).
- Cross-*project* lesson sharing (trust boundary — Epic-010's territory).
- Replacing the memory→lint ratchet or any existing mechanical guard.
- "Education"/"rotation" redesigns beyond this first loop — later hypotheses, later Epics.

## RFC record (2026-07-07)

See PR for the panel's comments; substantive feedback incorporated inline.
