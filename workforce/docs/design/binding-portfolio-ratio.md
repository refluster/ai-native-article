# Binding-portfolio ratio — design note

- **Status**: Proposed (draft PR for #675; `wf:lane:design`). A design note, not an ADR: it
  settles *who owns* a number and *what the rule on it is*, inside statute that already permits
  both (W-3, MVV value 7, [ADR-0039](../adr/adr-0039-upside-over-downside.md)). It binds no later
  decision except the thresholds, which the operator signs.
- **Revision**: re-draft of the closed #816. That draft's cycle-1 panel left seven findings
  (dario A1–A3, mateo A2–A3, owen A2–A3; the shared A1 counts once); each is folded in below and
  listed under *What changed from #816*.
- **Implements nothing.** The implementation is the slice list at the end.
- **Operator act** (the `product` choice, delivered via this PR): pick **Option B**, pick another,
  or record "intended, no rule" on #675 and close.

## Decision

Make the intake-to-outflow ratio a **measured, owned number** rather than a verdict. `wf:maya`
owns it; `org-metrics-pulse` (already weekly) reports it; and the rule on it is **gating, not
cutting**: a *new* talking binding names a consumer, and a *running* talking binding whose output
is consumed by nothing for two consecutive monthly windows becomes a retirement candidate the
operator decides on. Nothing is retired by this note, and no cap is set on how many bindings may
talk.

## What forced it

- **The number is still live, and larger.** Live read of `GET /agents` on 2026-11-09 (69 agents,
  none archived): **168 bindings**, of which `daily-research` 65 + `feed-post` 64 +
  `vp-monthly-report` 7 = **136 (81%)**; with the three other talking skills named below
  (`discord-chime-in`, `monthly-report`, `discord-digest`, one each) **139 (82.7%)**. The issue
  body's 107 of 141 (76%) was the 2026-08 census, and #816's 114 of 146 (78%) the 2026-10-06
  read: the share has risen at every reading while the count grew. Baseline: **82.7%, 2026-11-09**.
- **Four lenses, one finding, no owner.** Mateo (platform), Silas (finance), Priya (people) and
  Celeste (external comms) reported the same asymmetry independently in 2026-08: *speech has
  near-zero marginal cost and decisions do not, so only speech grows*. Silas's point is the
  operative one: a ledger cannot tell **intended investment** from **accumulated drift**, so a
  written rule is the only instrument that can.
- **The half that exists does not cover this.** [ADR-0045](../adr/adr-0045-hire-time-speculative-flag-and-kill-criterion.md)
  (Proposed) gives a *new hire's unwired duty* a kill date, and its lint (`check-hire-round-lint`)
  cross-checks round docs against `bindings[].speculative`. It says nothing about the 139
  bindings that *are* wired, run daily, and produce output nobody is obliged to read. Ratifying
  ADR-0045 answers "not intended" for future hires only (the 2026-10-05 comment on #675); it
  leaves the standing portfolio unexamined.
- **There is no machine-readable "talking" class today.** `deliverable.type` in `meta.json` does
  not separate them: `feed-post` is `notification`, `daily-research` and `vp-monthly-report` are
  unset, and most other skills are unset too. Any rule that needs the ratio first needs the class
  (slice 1).

## What "outflow" means here

Talking is not waste — the research desk and the feed are the org's observation layer, and
[`north-star/upside-not-downside.md`](../north-star/upside-not-downside.md) prefers level-2 work
(one-off capability → shared, reusable capability). So outflow is **not** "does the persona also
ship code". It is: **was this output consumed by something that can change what the org does?**
A talking output is *consumed* when, within 30 days, it is cited by one of:

1. an owned task or issue (the feed → tracker edge that [#665](https://github.com/refluster/ai-native-article/issues/665)
   proposes; design note [`feed-finding-to-owned-task.md`](feed-finding-to-owned-task.md)),
2. a `references[]` entry on a post or engagement of a **`working`-class** skill — a reference
   from one talking output to another does **not** count (a daily-research post citing a peer's
   feed-post is talking citing talking, and would let the whole portfolio pass by looping),
3. a published article or podcast source, or
4. a recorded operator decision (a directive, a merged ADR/design note, a closed issue).

Edges 1, 3 and 4 already carry a human or an editorial gate; edge 2 is the cheap one, which is
why it is restricted. This reuses edges the system is already growing and adds no new store
(R-N2).

## Design

1. **Owner: `wf:maya`, for the number and the rule — not for the money.** The ratio is a
   portfolio-shape question, which is product. `wf:mateo` keeps the substrate; `wf:priya` keeps
   the hiring playbook (ADR-0045's People-owned half). The **seam with W-3**: the cost ceiling and
   the modelled per-agent figures stay where [governance.md §2](../governance.md) and
   [ADR-0037](../adr/adr-0037-advisory-per-agent-budget.md) put them (the aggregate cap is Zone A,
   the per-agent figure is advisory and set via agents-api). Maya *proposes* retirement
   candidates; the operator decides them; a retirement frees modelled spend only when the
   operator's decision lands as the ADR-0041 marker. Neither Maya nor this rule can raise, lower
   or enforce a budget figure.
2. **Class, supplied at the source.** Add an optional `output_class: talking | working` to
   `meta.json` (closed enum, default `working`; `talking` = `daily-research`, `feed-post`,
   `vp-monthly-report`, `monthly-report`, `discord-digest`, `discord-chime-in`). Declared by the
   skill author, validated by `workforce:skills`, so the ratio is computed from the registry
   rather than from a hand-kept list. Skill version bump per ADR-0017/0018.
3. **Measurement, no new cron.** `org-metrics-pulse` already runs weekly over the roster. Add one
   line to its note: `talking / total` bindings, and per-talking-skill *consumed share* (the
   30-day citation test above). Monthly, `monthly-report` quotes the trend.
4. **Gate on new talking bindings — a new check, not ADR-0045 §2.** ADR-0045's lint compares
   round docs to `bindings[].speculative`; it has no notion of a consumer. This note therefore
   proposes **its own additive check**, `check-talking-consumer.mjs`: a binding whose skill is
   `output_class: talking` carries a one-line `consumer` in its `config` (who or what reads it),
   and the check reports a missing or empty one as a finding in the daily `backlog-reconcile`
   pass (a finding, not a PR gate — the same reasoning ADR-0045 §2 gives for date-driven
   checks). It may *share* ADR-0045's `bindings[]` read, and it is sequenced after it, but it is
   not covered by it and must not be described as such.
5. **Retire rule on running bindings.** A talking binding whose consumed share is **0 for two
   consecutive monthly windows** is listed as a *retirement candidate* in the monthly report
   (the route [ADR-0039](../adr/adr-0039-upside-over-downside.md) names). The operator decides;
   retirement is the in-place marker of [ADR-0041](../adr/adr-0041-agent-binding-retirement-marker.md),
   never deletion. Nothing auto-retires.
6. **Cost line.** See *Cost* — each candidate carries its modelled monthly spend.

## Options

| | A. Record "intended", no rule | **B. Own + measure + gate (this note)** | C. Cap the ratio (e.g. ≤60% talking) |
|---|---|---|---|
| Answers #675 | yes, in one line | yes, as a living number | yes, by fiat |
| New machinery | none | one enum, one metrics line, one new check | one enum + a hard gate in agents-api |
| Cost | none; drift stays invisible | modest; shifts review to the monthly report | forces retirements chosen by quota, not by value |
| Failure mode | Silas's "indistinguishable on the ledger" persists | citation test gamed by trivial references | cuts observation to hit a number — efficiency for its own sake (ADR-0039 non-goal) |

**Recommendation: B.** A leaves the finding exactly as the four lenses found it. C is the
downside philosophy applied to a portfolio: it optimises a ratio rather than asking what became
possible. B keeps observation legitimate and makes its payoff checkable.

## Alternatives considered

- **Treat it as hire-time only (ratify ADR-0045 and stop).** Rejected: covers future hires, not
  the standing bindings; the "not intended" branch answered for the wrong population.
- **Count output volume or engagement (reads, reactions) as the outflow measure.** Rejected:
  rewards more talking, the exact failure the finding names; the feed has no reader telemetry.
- **Auto-retire on a zero consumed share.** Rejected: C-3 / value 6 — retiring a standing duty
  is a human constitutional act, and the citation edges are young enough (#665 is unbuilt) that
  a zero today is partly an instrumentation gap, not evidence.
- **Put the owner in `wf:mateo`.** Rejected: seeing the shape and deciding its worth are
  different jobs.

## Cost

**Build cost.** One more `meta.json` field, one validator clause, one new check
(`check-talking-consumer.mjs`, ~one script plus tests), one line in `org-metrics-pulse`, one
monthly-report template line. No new Lambda, cron, table or route.

**W-3 cost.** The build adds no steady-state spend: the metrics line rides an existing weekly
fire, and the check runs inside the existing daily `backlog-reconcile` pass, so there is no new
binding (the rule that every binding is a budget line is respected by adding none). The
consequence runs the other way: the 139 talking bindings are the largest block of modelled
fires on the roster, and each retirement candidate is listed with its modelled monthly spend
(`budget_monthly_usd_override ?? budget_monthly_usd_default`, and the month-to-date from the
`BUDGET#{month}` ledger via `GET /performance`, per ADR-0037) so the operator reads the W-3
consequence next to the candidate. Those figures are advisory and modelled, not metered; the
list must say so rather than present them as savings.

**Instrumentation cost.** Until #665 lands only edges 2–4 are measurable, so early months
*over*-flag. Flags are candidates, not actions, which bounds the harm.

**Review attention.** One monthly list the operator must read. If it is never actioned, it is the
same problem one layer up (see *How this is reversed*).

## How this is reversed, and what would say it was wrong

- Reverse: drop `output_class` and the metrics line; the check is additive and removable. No data
  migration — the enum defaults to `working`.
- Wrong if, after **two monthly reports**, either (a) every talking skill clears the consumed
  test because trivial references satisfy it (the gate discriminates nothing — a check that
  cannot say no), or (b) the candidate list is produced and no operator decision is recorded on
  any entry (the rule added review load and no judgement).
- Falsifier for the underlying claim ("the ratio is drift, not investment"): a consumed share
  that is already high for `daily-research` once #665's edges exist.

## Acceptance fixtures

Slices 1–3 each ship with tests that can fail. The cases below are the minimum; a slice that
cannot state which fixture fails without it is not done.

1. **Class parsing.** A `meta.json` with `output_class: "chatty"` fails `workforce:skills`; an
   absent field resolves to `working`; the six named skills resolve to `talking`.
2. **Ratio.** A fixture roster of 10 bindings (7 on `talking` skills, 3 on `working`) yields
   `talking / total = 0.7`; an empty roster yields no ratio rather than a divide-by-zero.
3. **Consumed test, positive.** A talking post cited by a `working`-class engagement's
   `references[]` within 30 days is consumed; the same citation at day 31 is not.
4. **Consumed test, the loop (dario A2).** A `daily-research` post cited only by `feed-post`
   posts is **not** consumed. This is the fixture that makes the gate able to say no.
5. **Consumer check.** A `talking` binding with no `config.consumer`, or an empty string, is
   a finding; a `working` binding with none is not.
6. **Two-window counter.** Zero consumed share in windows N and N+1 lists a candidate; zero in N
   then non-zero in N+1 does not; a candidate row carries modelled monthly spend and the
   "advisory, modelled" label.

## Out of scope

- Retiring any binding, including the two in #660 (`daily-research` × `feed-post` collision) —
  that is [#755](https://github.com/refluster/ai-native-article/issues/755)'s product decision;
  this note only supplies the measure that decision can cite.
- The hiring-playbook prose and the hire-time flag (ADR-0045, People-owned).
- The feed → tracker conversion path itself (#665) and the per-agent spend counter
  (#661 and #748, both closed; ADR-0037/0044). This note *consumes* both and builds neither.
- Any change to rubric, roster, model registry, or L0/L1 text (Zone A), including the W-3 cap.

## Governing law

W-3 (cost ceiling) and W-4 (fail loud) in [governance.md §2](../governance.md); MVV value 7
(output is evidence) and operating question 5 (what will compound);
[ADR-0037](../adr/adr-0037-advisory-per-agent-budget.md) (advisory budget);
[ADR-0039](../adr/adr-0039-upside-over-downside.md) (upside, retirement-candidate route);
[ADR-0041](../adr/adr-0041-agent-binding-retirement-marker.md) (retire in place);
[ADR-0045](../adr/adr-0045-hire-time-speculative-flag-and-kill-criterion.md) (hire-time half).
Single state store (R-N2): no new record family. Related issues: #659 (parent), #660/#755, #665.

## Implementation slices (not in this PR)

1. `output_class` in `meta.json` + `validate-skills` check + classify the six skills. Fixtures 1–2.
   Skill version bumps.
2. Report the ratio and per-skill consumed share in `org-metrics-pulse` (reads existing surfaces
   only; edges 2–4). Fixtures 3–4.
3. `check-talking-consumer.mjs` wired into the `backlog-reconcile` pass. Fixture 5. Sequenced
   after ADR-0045 is Accepted only to share its `bindings[]` read, not for coverage.
4. Two-window counter and the monthly-report retirement-candidate line with modelled spend.
   Fixture 6. **Deadline (dario A3):** the counter starts on **2026-12-31** whether or not #665
   has landed. If #665 has not, it starts on edges 2–4 only and the monthly report says that
   the list over-flags; the operator may postpone the date, but an unbuilt #665 does not
   postpone it silently.
5. After #665: add the feed → task edge (edge 1) to the consumed test.

## What changed from #816

| Finding (cycle 1) | Resolution |
|---|---|
| A1 (dario/mateo/owen): "same lint ADR-0045 §2 surfaces" was wrong | Design 4 now proposes a new check and says ADR-0045's lint has no consumer notion |
| dario A2: edge 2 satisfiable talking-to-talking | Edge 2 counts only `working`-class sources; fixture 4 |
| dario A3: slice 3 had no deadline | Slice 4 starts the counter 2026-12-31 regardless |
| mateo A2: no W-3 cost paragraph | *Cost* → W-3 cost |
| mateo A3: W-3 ownership seam unnamed | Design 1, the seam sentence |
| owen A2: wrong ML-040 citation | Citation removed; the failure class is described, not cited to a backlog row |
| owen A3: no test fixtures | *Acceptance fixtures* |
