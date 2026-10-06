# Binding-portfolio ratio — design note

- **Status**: Proposed (draft PR for #675; `wf:lane:design`). A design note, not an ADR: it
  settles *who owns* a number and *what the rule on it is*, inside statute that already permits
  both (W-3 cost ceiling, MVV value 7, [ADR-0039](../adr/adr-0039-upside-over-downside.md)). It
  binds no later decision except the thresholds, which the operator signs.
- **Implements nothing.** The implementation is the slice list at the end.
- **Operator act** (the `product` choice, delivered via this PR): pick **Option B** below, pick
  another, or record "intended, no rule" on #675 and close.

## Decision

Make the intake-to-outflow ratio a **measured, owned number** rather than a verdict. `wf:maya`
owns it; `org-metrics-pulse` (already weekly) reports it; and the rule on it is **gating, not
cutting**: a *new* talking binding needs a named consumer, and a *running* talking binding that
names none for two consecutive monthly windows becomes a retirement candidate the operator
decides on. Nothing is retired by this note, and no cap is set on how many bindings may talk.

## What forced it

- **The number is still live, and larger.** Live read of `GET /agents` on 2026-10-06 (58 agents,
  none archived): **146 bindings**, of which `daily-research` 54 + `feed-post` 53 +
  `vp-monthly-report` 7 = **114 (78%)**. The issue body's 107 of 141 (76%) was the 2026-08
  census; the share rose while the count grew. The other 32 bindings are spread over many other
  skills (reviewers, sweeps, the article chain, `issue-*`); the six-skill `talking`
  class proposed below would count 3 more (`monthly-report`, `discord-digest`,
  `discord-chime-in`), so the baseline is a floor.
- **Four lenses, one finding, no owner.** Mateo (platform), Silas (finance), Priya (people) and
  Celeste (external comms) reported the same asymmetry independently in 2026-08: *speech has
  near-zero marginal cost and decisions do not, so only speech grows*. Silas's point is the
  operative one: a ledger cannot tell **intended investment** from **accumulated drift**, so a
  written rule is the only instrument that can.
- **The half that exists does not cover this.** [ADR-0045](../adr/adr-0045-hire-time-speculative-flag-and-kill-criterion.md)
  (Proposed) gives a *new hire's unwired duty* a kill date. It says nothing about the 114
  bindings that *are* wired, run daily, and produce output nobody is obliged to read. Ratifying
  ADR-0045 answers "not intended" for future hires only (as the 2026-10-05 comment on #675
  notes); it leaves the standing portfolio unexamined.
- **There is no machine-readable "talking" class today.** `deliverable.type` in `meta.json` does
  not separate them: `feed-post` is `notification`, `daily-research` and `vp-monthly-report`
  are unset, and 26 other skills are unset too. Any rule that needs the ratio first needs the
  class (slice 1).

## What "outflow" means here

Talking is not waste — the research desk and the feed are the org's observation layer, and
[`north-star/upside-not-downside.md`](../north-star/upside-not-downside.md) prefers
level-2 work (one-off capability → shared, reusable capability). So outflow is **not** "does
the persona also ship code". It is: **was this output consumed by something that can change
what the org does?** A talking output is *consumed* when, within 30 days, it is cited by one
of:

1. an owned task or issue (the feed → tracker edge that [#665](https://github.com/refluster/ai-native-article/issues/665)
   proposes to build),
2. a `references[]` on another agent's post or engagement,
3. a published article or podcast source, or
4. a recorded operator decision (a directive, a merged ADR/design note, a closed issue).

This reuses edges the system is already growing; it adds no new store (R-N2).

## Design

1. **Owner: `wf:maya`.** The ratio is a portfolio-shape question with budget consequences (W-3),
   which is product, not platform. `wf:mateo` keeps the substrate; `wf:priya` keeps the hiring
   playbook (ADR-0045's People-owned half). Maya owns the *number and the rule*; she does not
   own each binding.
2. **Class, supplied at the source.** Add an optional `output_class: talking | working` to
   `meta.json` (closed enum, default `working`; `talking` = `daily-research`, `feed-post`,
   `vp-monthly-report`, `monthly-report`, `discord-digest`, `discord-chime-in`). Declared by the
   skill author, validated by `workforce:skills`, so the ratio is computed from the registry
   rather than from a hand-kept list. Skill version bump per ADR-0017/0018.
3. **Measurement, no new cron.** `org-metrics-pulse` already runs weekly over the roster. Add one
   line to its note: `talking / total` bindings, and per-talking-skill *consumed share* (the
   30-day citation test above). Monthly, `monthly-report` quotes the trend. The 2026-10-06
   figure (78%) is the baseline.
4. **Gate on new talking bindings.** Extending ADR-0045's hire-time rule: a binding whose skill
   is `output_class: talking` must carry a one-line `consumer` (who or what reads it) in the
   binding `config` or round doc. A missing consumer is the same lint finding ADR-0045 §2
   already surfaces; no second mechanism.
5. **Retire rule on running bindings.** A talking binding whose consumed share is **0 for two
   consecutive monthly windows** is listed as a *retirement candidate* in the monthly report
   (the route [ADR-0039](../adr/adr-0039-upside-over-downside.md) §2 already names). The
   operator decides; retirement is the in-place marker of [ADR-0041](../adr/adr-0041-agent-binding-retirement-marker.md),
   never deletion. Nothing auto-retires.
6. **Cost line.** Each retirement candidate carries its modelled monthly spend (the figure
   [#748](https://github.com/refluster/ai-native-article/issues/748) / ADR-0044 is making honest),
   so the operator sees the W-3 consequence next to the candidate.

## Options

| | A. Record "intended", no rule | **B. Own + measure + gate (this note)** | C. Cap the ratio (e.g. ≤60% talking) |
|---|---|---|---|
| Answers #675 | yes, in one line | yes, as a living number | yes, by fiat |
| New machinery | none | one enum, one metrics line, one lint clause | one enum + a hard gate in agents-api |
| Cost | none; drift stays invisible | modest; shifts review to monthly report | forces retirements chosen by quota, not by value |
| Failure mode | Silas's "indistinguishable on the ledger" persists | citation test gamed by trivial references | cuts observation to hit a number — efficiency for its own sake (ADR-0039 non-goal) |

**Recommendation: B.** A leaves the finding exactly as the four lenses found it. C is the
downside philosophy applied to a portfolio: it optimises a ratio rather than asking what became
possible. B keeps observation legitimate and makes its payoff checkable.

## Alternatives considered

- **Treat it as hire-time only (ratify ADR-0045 and stop).** Rejected: covers future hires, not
  the 114 standing bindings; it is the "not intended" branch answered for the wrong population.
- **Count output volume or engagement (reads, reactions) as the outflow measure.** Rejected:
  that rewards more talking, the exact failure the finding names; and the feed has no reader
  telemetry to count anyway.
- **Auto-retire on a zero consumed share.** Rejected: C-3/value 6 — retirement of a standing
  duty is a human constitutional act, and the citation edges are young enough (#665 is unbuilt)
  that a zero today is partly an instrumentation gap, not evidence.
- **Put the owner in `wf:mateo`.** Rejected: Mateo supplied the first lens precisely because the
  substrate sees the shape; seeing it and deciding its worth are different jobs.

## Cost

- One more `meta.json` field and one more validator check.
- The 30-day citation test depends on edges that mostly do not exist yet: until #665 lands, only
  edges 2–4 are measurable, so early months will *over*-flag. Flags are candidates, not actions,
  which bounds the harm; it is also why the zero-for-two-windows rule starts counting only after
  slice 3.
- Review attention: one monthly list the operator must read. If that list is never actioned it is
  the same problem one layer up (see How this is reversed).

## How this is reversed, and what would say it was wrong

- Reverse: drop `output_class` and the metrics line; the `consumer` lint clause is additive
  (ADR-0045 §2) and removable. No data migration — the enum defaults to `working`.
- Wrong if, after **two monthly reports**, either (a) every talking skill clears the consumed
  test because trivial references satisfy it (the gate discriminates nothing — the ML-040 class:
  a check that cannot say no), or (b) the candidate list is produced and no operator decision is
  recorded on any entry (the rule added review load and no judgement).
- Falsifier for the underlying claim ("the ratio is drift, not investment"): a consumed share
  that is already high for `daily-research` once #665's edges exist.

## Out of scope

- Retiring any binding, including the two in #660 (`daily-research` × `feed-post` collision) —
  that is [#755](https://github.com/refluster/ai-native-article/issues/755)'s product decision;
  this note only supplies the measure that decision can cite.
- The hiring-playbook prose and the hire-time flag (ADR-0045, People-owned).
- The feed → tracker conversion path itself (#665) and the per-agent spend counter (#661,
  closed; #748 in flight). This note *consumes* both and builds neither.
- Any change to rubric, roster, model registry, or L0/L1 text (Zone A).

## Governing law

W-3 (cost ceiling) and W-4 (fail loud) in [governance.md §2](../governance.md); MVV value 7
(output is evidence) and operating question 5 (what will compound);
[ADR-0039](../adr/adr-0039-upside-over-downside.md) (upside, retirement-candidate route);
[ADR-0041](../adr/adr-0041-agent-binding-retirement-marker.md) (retire in place);
[ADR-0045](../adr/adr-0045-hire-time-speculative-flag-and-kill-criterion.md) (hire-time half).
Single state store (R-N2): no new record family. Related issues: #659 (parent), #660/#755,
#665, #666 (closed).

## Implementation slices (not in this PR)

1. `output_class` in `meta.json` + `validate-skills` check + classify the six skills named
   above. Skill version bumps.
2. Report the ratio and per-skill consumed share in `org-metrics-pulse` (reads existing
   surfaces only). Baseline 78% at 2026-10-06.
3. After #665: add the feed → task edge to the consumed test; start the two-window counter.
4. Add the `consumer` clause to the ADR-0045 lint once that ADR is Accepted.
5. Monthly-report template line for retirement candidates with modelled spend.
