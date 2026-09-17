# ADR-0038 — Narrow the "no cost figures" invariant on `GET /stats`, reaffirm it on `GET /public/workforce-summary`

- **Status**: Proposed
- **Date**: 2026-09-17
- **Deciders**: operator (ratifies by merge) — drafted by `wf:dario` (`issue-design`) for review
- **Epics**: none (a standing test-encoded invariant, not epic-scoped work)
- **Related**: [#683](https://github.com/refluster/ai-native-article/issues/683) (this decision), [#661](https://github.com/refluster/ai-native-article/issues/661) (the original zero-ledger problem this invariant answered), [#678](https://github.com/refluster/ai-native-article/pull/678) (modelled per-fire cost), [#682](https://github.com/refluster/ai-native-article/pull/682) (surfaced it on `GET /performance`), `workforce/lambdas/agents-api/handler-tests.ts` (the two tests this ADR resolves)

## Context

`handler-tests.ts` carries an identical assertion on two routes, both titled
`"reports NO cost or token figures (C-1: no fabricated truth)"`:

```ts
const blob = JSON.stringify(body);
expect(blob).not.toMatch(/cost/i);
expect(blob).not.toMatch(/token/i);
expect(blob).not.toMatch(/usd/i);
```

- `GET /stats` (line 1936) — the console dashboard, operator-only.
- `GET /public/workforce-summary` (line 2141) — public, unauthenticated.

The test was written when any cost figure either route could produce would
have been **fabricated**: the `BUDGET#` ledger read zero while agents were
demonstrably working (#661). Omitting the figure was the honest choice —
better to show nothing than a false zero, the same C-1 instinct behind every
other "say nothing rather than lie" gate in this codebase.

#678 made the number real: `readBudgetBlock()` / `summariseBudgetRows()` model
spend per fire from each skill's declared `cost_class`, rolled up from the
`BUDGET#{yyyy-mm}`/`AGENT#{slug}` ledger — a modelled figure, never a metered
one, but no longer a fabricated zero either. #682 then surfaced that modelled
figure on `GET /performance` (its own docstring: *"Until this existed, the
modelled spend the orchestrator writes on every dispatch was readable only by
querying DynamoDB by hand — an honest gauge nobody could see... 「誰も読まない
数字は、間違っているのではなく、ただ役に立っていない」"* — sana, 2026-09).
`/performance` is operator-only, same as `/stats`, and its test suite does
**not** carry the no-cost-figures assertion — the modelled, labelled figure is
already live and accepted on that route today.

That creates the inconsistency #683 names: the *same* modelled column
(`cost_this_month_usd`/`compute_seconds`-derived spend) is acceptable on one
operator-only route and forbidden on another, purely because of which handler
the operator happens to call. The invariant's original reasoning — "we would
be fabricating a number" — no longer applies to either route; what's left is
two separable questions the issue itself distinguishes:

1. **Is a labelled, modelled figure honest enough for the console?** Yes,
   per #682's own precedent, already shipped and unchallenged.
2. **Should the *public* summary disclose spend at all?** A different
   question — publication, not honesty. C-3 (single-operator scale) gives no
   affirmative reason to publish spend, and nothing about #678's modelling
   changes that calculus.

## Decision

**Narrow the invariant on `GET /stats` to match `GET /performance`'s already-
accepted precedent; reaffirm it unchanged on `GET /public/workforce-summary`.**

- **`GET /stats` (console, operator-only).** The route may surface the same
  modelled, labelled cost figure `GET /performance` already exposes
  (`cost_this_month_usd` from `summariseBudgetRows()`, carrying `updated_at`
  so a stale/frozen ledger stays visible — never a raw, unlabelled, or
  differently-derived number). The invariant is not deleted, it is narrowed:
  the test at line 1936 changes from "no cost figures, ever" to "any cost
  figure present is the same modelled column `/performance` already serves,
  never a bespoke or unlabelled one" — a **consistency** check replacing an
  **absence** check. This is the "console screenshot" counter-argument's own
  answer: the screenshot risk is identical on `/performance` today, so
  keeping `/stats` blind does not reduce that risk — it only makes the
  operator open a second dashboard to see the same number.
- **`GET /public/workforce-summary` (public, unauthenticated).** No change.
  The test at line 2141 is reaffirmed as-is, with its comment rewritten to
  name the case explicitly considered and rejected: *"a modelled, labelled
  figure is honest enough for an operator dashboard (see `/stats`,
  ADR-0038) but this route is public, and C-3's single-operator posture
  gives no reason to disclose spend to an unauthenticated caller — reaffirmed
  independently of whether the figure is fabricated or modelled."* This is
  the reasoning #683 itself anticipated ("this half stays as-is regardless
  of how part 1 lands — but it should be decided, not inherited").

## Alternatives considered

- **Reaffirm both routes unchanged**, adding only a comment naming the
  modelled-number case. Rejected: it leaves the `/stats` vs `/performance`
  inconsistency exactly as #683 found it — the same operator, the same
  number, arbitrarily visible on one route and not the other. A reaffirmed
  invariant should have a reason that survives contact with `/performance`,
  and "we already show this exact number elsewhere" is not that reason.
- **Narrow both routes** (allow the modelled figure on the public summary
  too). Rejected: publication and honesty are different questions, and
  nothing in #678's modelling touches C-3's "no reason to publish spend"
  argument. Widening the public route was never blocked on fabrication in
  the first place, so #678 doesn't unblock it.
- **Delete the invariant entirely** (let each route decide independently,
  no shared test). Rejected: the two routes should stay coupled to one
  documented decision, not two independently-drifting judgment calls — the
  exact "meets the test, not the reasoning" failure #683 itself warns about
  for the *next* person who touches either route.

## Consequences

- **What becomes buildable.** `GET /stats` may add the same
  `cost_this_month_usd` display `/performance` already has, once a follow-up
  implementation PR (Authority A, `issue-implement`) updates the handler and
  the two affected tests (line 1936's assertions, and any snapshot of the
  `/stats` response shape) to the narrowed contract this ADR states. **This
  PR does not implement that change** — see Implementation below.
- **What doesn't change.** `GET /public/workforce-summary` ships nothing new;
  its test only gains a comment.
- **A precedent for future cost surfaces.** Any new operator-facing route
  wanting a spend figure reuses `/performance`'s modelled column rather than
  re-deriving one — the same "no synthetic agent slug, no parallel registry"
  discipline ADR-0032 applies to budget rows now applies to how *this* number
  is displayed.
- **Reversal.** Supersede this ADR; until then, reverting `/stats` to
  cost-blind is a one-line test revert (the absence assertion this ADR
  narrows), and the public route's stance is untouched either way.
- **What would tell us it was wrong.** If a modelled figure on `/stats`, once
  shipped, gets quoted or forwarded as a *metered* spend total (the exact
  "the qualifier falls off in transit" risk #683's own text raised) — that
  is a signal the console needs a stronger visual label, not that the figure
  should be hidden again; if it recurs after a labelling fix, that is
  evidence for reaffirming the absence rule after all, via a superseding ADR.

## Out of scope

- **Implementing the `/stats` handler change or updating its test's
  assertions.** Tracked as a new follow-up issue (filed alongside this PR)
  for `issue-implement` once this ADR is Accepted — a decision and its
  implementation are two reviews with two different bars (`issue-design`'s
  own operating rule).
- **Any change to `GET /performance`** — already shipped (#682), unaffected.
- **Whether the *public* route should ever disclose anything else about
  cost or scale** — out of scope; this ADR only reaffirms the status quo
  there.
