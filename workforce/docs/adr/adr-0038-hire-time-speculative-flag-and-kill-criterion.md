# ADR-0038 — Hire-time speculative-duty flag, round-doc lint, and mechanically-scheduled kill-criterion

- **Status**: Proposed
- **Date**: 2026-09-16
- **Deciders**: dario (drafted, `issue-design`); operator ratifies (Authority **B** per the source issue's own line — see Context)
- **Epics**: [021](../epics/epic-021-finance-ir-activation.md)

## Context

Epic-021 (Accepted 2026-07-08) §B, "The idle-talent discipline," splits into two
halves. §B.1 — the detector — shipped in [#524](https://github.com/refluster/ai-native-article/pull/524)
(merged 2026-08-04) and is `Implemented`. §B.2 — the hire-time rule — is
still open. The epic's own text (§B.2):

> Hire-time rule (People-owned; operator sign-off stays). Reshaped per
> priya/theo from a bare governance diff into: a hiring-playbook amendment +
> a machine-readable `speculative: true|until:<date>` field in the seed
> bundle + a round-doc lint that checks declared-vs-actually-wired within
> the window. Theo's evidence: both recent rounds already named intended
> cadences — naming was never the gap, wiring was; the rule must bind the
> wiring date, or it is paperwork theatre.

Issue #458 named this AC explicitly and marked it **Authority: B (playbook
amendment sign-off)** — never self-merged. PR #524 (the detector) and PR #565
(the digest-render half, merged 2026-09-07) both deliberately left it out for
the same reason, in #524's own words: *"the playbook is People-owned;
proposing it inside an engineering diff would be exactly the self-merge the
AC forbids."* #565 split the remainder into **#566** (opened 2026-08-10),
which is this ADR's source issue and, as of this fire, the oldest-activity
item in the repo's `wf:lane:design` queue (37 days untouched).

Three concrete gaps, verified in this checkout:

1. **No machine-readable field exists.** `grep -rn speculative workforce/seed/
   workforce/lambdas/` returns nothing — the epic's own §A.4 already declared
   yara's visit-prep half "speculative-with-a-date," but that declaration
   lives only as prose in `epic-021-finance-ir-activation.md`, unreadable by
   any script.
2. **No round-doc lint exists.** `workforce/scripts/validate-*.mjs` covers
   naming, projects, skills, and tools — none reads
   `workforce/docs/hires/*.md` at all.
3. **No binding timestamp exists to hang a kill date off.** PR #524 flagged
   this directly: *"populating N needs a `bound_at` on the binding, which is
   a schema change and its own PR."* `workforce/docs/data-model.md`'s
   `AgentBinding` shape (row 24) still has no `bound_at`.

There is also no single canonical "hiring playbook" file anywhere in git.
Every round doc under `workforce/docs/hires/*.md` carries its own "Playbook
delta" section addressed to Theo (People Ops), who is described as folding
deltas into "the onboarding playbook" — but that playbook is distributed,
oral precedent, not a document this ADR can amend. That gap is real but is
explicitly **not** this ADR's decision to make (see Out of scope).

## Decision

Adopt the **mechanical** half of §B.2 only — the schema field, the lint, and
the scheduling — leaving the playbook's prose to a separate, People-owned
follow-up:

1. **Schema.** Add two optional fields to the `AgentBinding` shape documented
   in `workforce/docs/data-model.md` (row 24, sibling to the existing
   `config`): `speculative?: { until: string /* ISO date */ }` and
   `bound_at: string` (ISO timestamp, written by agents-api at bind time on
   every binding, not only speculative ones — this is the same gap PR #524
   flagged and is needed regardless of this ADR to compute "N days pending").
   No new row family: this reuses `AGENT#{slug}/META.bindings[]`, the
   existing single state store (R-N2).
2. **Round-doc lint.** A new check, `workforce/scripts/check-hire-round-lint.mjs`
   (wired into `ci.yml` next to the existing `workforce:*` checks, following
   the `validate-*.mjs` pattern), walks every `workforce/docs/hires/*-hire-round.md`
   file, extracts any duty the doc marks with an explicit, machine-parseable
   convention this ADR proposes — a line reading
   `**Speculative — kill by <ISO date>**` directly under the duty it
   qualifies — and cross-checks (via agents-api) that the named agent's live
   `bindings[]` carries a matching `speculative.until`. A mismatch (declared
   in the round doc but never bound within a grace window, or bound with no
   matching declaration) is surfaced as a finding in the daily
   `backlog-reconcile` pass, not a new PR gate: a kill date lapsing is a
   property of time, not of a diff, the same reasoning behind this repo's
   date-driven checks (root R-15/R-17, and this tree's own ADR-0007's
   registry-trigger pattern) — a PR gate cannot see a date pass with no PR
   attached to it.
3. **Kill-criterion scheduling.** No new cron. When agents-api binds a
   binding carrying `speculative.until`, that date is written verbatim (no
   derived computation) and the existing weekly digest walk — the same one
   §B.1/§B.2's own detector already rides, per the epic's "no new cron, one
   idleness definition" precedent — reads `bindings[].speculative.until` and
   flags any past-due speculative duty, attributed to the **hiring lead**
   (reusing the idle detector's existing `pending: design|enable|output`
   attribution vocabulary rather than inventing a second one). The epics
   index note in `workforce/docs/epics/README.md` records the schedule the
   same way every other dated reconciliation note in that file already does.

## Alternatives considered

- **Leave `speculative` as narrative-only (status quo).** Rejected: yara's
  case has sat un-mechanized since 2026-07-08 with nothing to check it, and
  the epic's own promise ("kill date is mechanically scheduled," cited by
  Dario in the epic's own review panel as a C-4 concern) is unmet.
- **A new `SPECULATIVE#` DDB row family, separate from `AgentBinding`.**
  Rejected on R-N2 (single state store) and R-N8 (data-shape uniformity): the
  fact being tracked — a duty with a kill date — is exactly a binding's own
  trigger metadata. A parallel row family would need its own reconciliation
  against `bindings[]` and could drift from it, the anti-reinvention
  reasoning this tree's own ADR-0001/ADR-0007 (root) already apply to
  registries.
- **A PR-time CI gate instead of a daily `backlog-reconcile` finding.**
  Rejected: no PR necessarily touches the round doc or the binding on the day
  a kill date lapses, so a PR gate structurally cannot catch it — the same
  reasoning root R-15/R-17/R-19 already establish for date-driven checks in
  this repo.
- **Writing the hiring-playbook document itself in this PR.** Rejected: the
  source issue's own "Authority" line marks this clause **B** — People-owned,
  explicit operator/Theo accept-reject — and #524 already named the failure
  mode directly: drafting People-doctrine prose inside an engineering-owned
  ADR would be exactly the self-merge-by-proxy the acceptance criterion
  forbids.

## Consequences

- **Harder:** every future hire round that declares a speculative duty must
  use the `**Speculative — kill by <date>**` marker convention for the lint
  to see it; agents-api's bind-time write path gains two more optional/
  additive fields to validate.
- **Forecloses:** a future scheduling mechanism that is not binding-keyed —
  such a change would need to supersede this ADR, since the lint and the
  digest reader both key off `bindings[].speculative.until`.
- **Costs:** two additive schema fields (no migration — bindings are read
  fresh from `AGENT#{slug}/META` on every fire, so nothing needs backfilling
  to stay valid), one new mechanical check, and a digest-rendering
  follow-up PR (Zone B, not shipped here).
- **Reversal:** a superseding ADR retiring `speculative`/`bound_at` from the
  binding shape and `check-hire-round-lint.mjs`; both fields are additive, so
  removal breaks nothing already written.
- **What would tell us it was wrong:** the lint producing enough false
  positives/negatives that hiring leads route around the marker convention
  rather than use it — the same falsifiability bar Elena's review already set
  for the sibling idle detector ("supervised runs don't score; a stalled
  enable-gate is reported as a stalled gate, not silence").

## Out of scope

- The hiring-playbook document's own prose and its canonical location —
  People-owned, Theo's domain per the epic's explicit split; this ADR fixes
  only the machine-checkable half (the wiring date), matching Theo's own
  evidence in the epic text ("naming was never the gap, wiring was").
- Backfilling `speculative`/`bound_at` on any existing binding, including
  yara's already-declared case — a follow-up data-migration PR once this ADR
  is Accepted.
- The digest-rendering change itself (reading `bindings[].speculative.until`
  into the weekly digest output) — Zone B implementation, tracked as
  follow-up `issue-implement` work once Accepted.
- Re-deciding §B.1, the already-merged, already-`Implemented` idle detector —
  untouched by this ADR.

## Related

- [Epic-021 §B](../epics/epic-021-finance-ir-activation.md) — the idle-talent
  discipline this ADR completes the second half of.
- #458 (Story 4, parent AC), #524 (merged, §B.1 detector), #565 (merged,
  digest-render half — split this issue out), #566 (this ADR's source issue).
- [ADR-0007](adr-0007-agent-config-single-source.md) — the `AGENT#{slug}/META`
  single-source-of-truth this amends.
- [ADR-0018](adr-0018-skill-body-version-gated-sync.md) — the version-gated
  sync convention this ADR's registry-style check loosely follows.
- `workforce/docs/data-model.md` (row 24, `AgentBinding`) — the schema this
  amends.
- `workforce/docs/governance.md` §4 (R-N2 single state store, R-N8 data-shape
  uniformity) — cited in Alternatives.
