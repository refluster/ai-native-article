# ADR-0032 — The `LESSON` partition schema, its closed cross-cutting vocabulary, and the daily distiller Lambda's cost/shape contract

- **Status**: Proposed
- **Date**: 2026-09-09
- **Deciders**: operator (refluster) — drafted by `wf:dario` (`issue-design`) for review
- **Epics**: [022](../epics/epic-022-org-learning-loop.md)
- **Related**: [adr-0019](adr-0019-agent-semantic-memory.md) (the per-agent semantic-memory layer this is deliberately *not* — see Alternatives), `data-model.md` §Lesson rows (the companion schema diff this ADR's Decision explains — same PR), `docs/memory-lint-backlog.md` (the ratchet this stream feeds, per the `lintable` field), [#459](https://github.com/refluster/ai-native-article/issues/459) (this story)

## Context

Epic-022 (Accepted 2026-07-08, RFC-reviewed by the full VP+IC panel) already
decided the *shape* of the organisational learning loop: a daily Lambda
distiller (not a CCR session — "sana, decisively," Q3 resolved), a curation
gate routing all V1 activations through the weekly operator digest, and a
per-task injection read capped at ~1,500–2,000 chars. What Epic-022 left for
implementation to work out — and what `issue-implement` (`wf:ren`) twice
declined to guess at (2026-07-30, re-confirmed 2026-09-08) — is the concrete
schema and the mechanics the epic's prose only sketches:

1. **The `LESSON` partition's actual key/attribute shape.** The epic names
   the precedent (`FEED`/`PERF#{scope}` single-partition design) and the sort
   key form (`sk = LESSON#{scope}#{ulid}`) but not the full attribute set a
   writer (the distiller) and a reader (the future injection endpoint) both
   need to agree on before either can be built.
2. **What the "closed, registered cross-cutting vocabulary" actually is, and
   how a skill "subscribes… via `meta.json`"** — Epic-022 names the mechanism
   in one sentence without specifying the registry file, the initial set, or
   the schema field.
3. **What "a stated per-day token budget that throws on overrun (W-3
   call-site pattern)" means operationally** when the caller is a standalone
   Lambda with no owning persona — the existing `lambdas/shared/budget.ts`
   guard is keyed by `AGENT#{slug}`, and the distiller has no agent slug.

Per #459's own Authority line ("A (Lambda), B for the `data-model.md` Zone A
diff + any new schedule enable"), only (1)+(2) above are actually B-authority
blockers — the issue itself scopes the Lambda's *implementation* as Authority
A once the schema exists. This ADR is therefore narrower than a full
"should we build this" decision (Epic-022 already made that call): it
resolves the concrete shape questions that (1)-(3) name, so that a future
`issue-implement` fire has an approved schema to build against instead of
inventing one mid-PR — the same reasoning `wf:ren`'s two park comments gave.

**Precedent check (per this skill's own Step 2).** `memory-compactor`
(`wf-memory-compactor`, the Lambda Epic-022 itself cites as precedent) did
**not** get its own dedicated ADR — its shape is covered inside
[ADR-0019](adr-0019-agent-semantic-memory.md), which is primarily about the
`MEMORY.md` profile-block *data* decision, with the Lambda's "nightly,
standalone, no persona" posture as a supporting detail. `wf-podcast`, by
contrast, got its own dedicated [ADR-0016](adr-0016-podcast-production-surface.md)
because it introduced genuinely new authority questions (a new AWS service,
new public egress, a new team's authority placement). The distiller sits
closer to the podcast precedent than the compactor precedent on **one** axis
— it introduces a genuinely new *data* shape (a cross-agent-readable,
curated, TTL'd, promotable row family with no prior analogue) and a genuinely
new *budget* shape (system-scoped, not agent-scoped) — which is why this ADR
exists rather than folding the decision silently into the data-model.md diff
alone. It does **not** introduce new AWS services or external egress (stays
on the existing default Lambda / DDB surface, R-N1 unaffected), so it is
narrower in scope than ADR-0016.

## Decision

**Approve the `LESSON` partition schema in `data-model.md` §Lesson rows
(this PR's companion diff) as the Zone A artefact #459 requires, register a
closed cross-cutting scope vocabulary via a new schema file + an optional
`meta.json` field, and define — without implementing — the daily distiller's
system-scoped throwing token-budget contract.** The Lambda itself, once this
schema lands, is Authority A per the issue's own line and is not built here.

### 1. Schema — see `data-model.md` §Lesson rows (same PR)

Full attribute-level detail lives in the companion diff to avoid duplicating
a schema in two places that could drift; the key decisions worth stating here
explicitly, because they are the parts a reviewer would ask "why not
differently":

- **`pk = "LESSON"` (single global partition), `sk = "LESSON#{scope}#{ulid}"`**
  — taken verbatim from the issue's own Acceptance Criteria (and Epic-022's
  identical phrasing), not reinterpreted. The `LESSON#` sort-key prefix is
  redundant with the fixed partition key, but the redundancy is deliberate:
  every other single-shared-partition row family in this table (`FEED` via
  `gsi3pk`) still names its family in `pk`, and `sk` alone must remain
  self-describing when this table is browsed row-by-row (a real operational
  habit — see `peas-enterprise-blueprint-comparison.md`'s worked
  `aws dynamodb get-item` examples against `PERF#*`).
- **Scope grammar**: `skill:{skill_name}` / `project:{project_id}`
  (machine-derived from the source ledger row, never chosen by the LLM
  distillation pass) or one value from the closed cross-cutting vocabulary
  (§2). The distiller's LLM pass proposes a scope; a deterministic
  post-check rejects anything outside this closed grammar (schema
  enum + regex, not model trust) — the same "machine-derived, not
  free-form" discipline the epic itself insists on.
- **Provenance is mandatory, not advisory.** `source_refs[]` requires ≥1
  entry and each must resolve (the write boundary re-fetches the cited
  `RUN#`/`EXEC#` row and 400s the write if it 404s) — "no provenance, no
  candidacy" per Epic-022 §1 is enforced exactly where a poisoned-lesson
  injection attack would otherwise slip past a merely-advisory citation
  field.
- **`lintable` + `ml_backlog_ref` gate activation, not creation.** A
  candidate can exist and be curated without an ML-backlog row; only the
  `active` transition (the point where 34 other personas start reading it)
  is blocked until `lintable: yes` candidates have one. This mirrors the
  memory→lint ratchet's own two-strikes discipline (`docs/governance-mechanisms.md`)
  rather than inventing a new promotion gate shape.

### 2. Closed cross-cutting vocabulary — registration mechanism

- **Registry file**: `workforce/scripts/schemas/lesson-scope-vocabulary.json`
  (proposed, not created in this PR) — a flat JSON array of the closed set,
  parallel in spirit to `skill-meta.schema.json`'s enum-closed
  `deliverable.type`. **Initial set: `["org-wide", "external-conduct"]`**
  (Epic-022's own two named examples — the canonical 07-04 mention-format
  incident is `external-conduct`-shaped, per the epic's own worked example).
  Extending the set is a **Zone A schema amendment** — the identical
  discipline `deliverable.type`'s own docstring already states ("Adding any
  further type is a Zone A amendment"), reused rather than inventing a
  parallel extension process.
- **Subscription, not classification.** A skill's `meta.json` gains an
  **optional** `lesson_subscriptions: string[]` field (validated against the
  registry file by `validate-skills.mjs`, the same C1–C3 gate every
  `meta.json` field already passes through) — this is the *injection-time*
  opt-in ("do this skill's fires want cross-cutting lessons on top of their
  own `skill:`/`project:` scope"), **not** the distiller's classification
  mechanism. The distiller assigns scope at distillation time regardless of
  who has subscribed; a cross-cutting lesson with zero subscribers is simply
  never injected anywhere (dormant, not wasted — it's still visible to the
  weekly operator digest for curation). No skill subscribes by default.
- **Why `meta.json`, not a separate subscription API.** Skills already
  declare their operational contract in `meta.json` (`requires[]`,
  `cost_class`, `archetype`) and it is git-reviewed per Rule 11 — a
  cross-cutting lesson reaching a skill's fires is exactly the kind of
  contract change a PR reviewer should see in the same diff as the skill's
  other declared capabilities, not a separate runtime toggle invisible to
  code review.

### 3. Daily distiller token-budget contract (design only — not implemented)

- **New DDB shape**: `BUDGET#{yyyy-mm-dd}` / `SYSTEM#lesson-distiller` (see
  `data-model.md` §Budget rows, same PR) — a **daily**, **system-scoped**
  roll-up, distinct from the existing **monthly**, **agent-scoped**
  `BUDGET#{yyyy-mm}`/`AGENT#{slug}` row `lambdas/shared/budget.ts` already
  enforces W-3 against. The distiller has no `AGENT#{slug}` to charge — it is
  a standalone Lambda, the same "system maintenance, not agent output"
  posture `memory-compactor` already established (data-model.md's own words
  for that Lambda) — so riding the existing per-agent guard would either
  require inventing a fictional agent row (misrepresenting W-3's ledger) or
  skip budgeting entirely (violating the epic's own explicit AC). A parallel,
  explicitly-named system row is the honest shape.
- **The guard is the same *pattern*, not the same function signature**:
  pre-call, read the day's row, compute projected total, throw
  (`WfLessonDistillerBudgetExceeded`, DLQ per W-4) if it would exceed
  `cap_tokens` — structurally identical to `wouldBreachBudget`, parameterised
  on the daily row instead of the monthly one. `cap_tokens` itself (the
  actual number) is an implementation-time constant, not fixed by this ADR —
  Epic-022 §Cost only commits to "the daily distiller pass carries its own
  throwing budget," not a specific figure; picking one belongs with the
  implementation PR that can size it against a real day's `RUN#`/`EXEC#`
  volume, cited here only as "must exist and must throw, not silently
  truncate."
- **One bounded cheap-model pass** (Epic-022 §1): the distiller reads a
  day's cross-agent `RUN#`/`EXEC#`/DLQ rows via `scanPrefix` (bounded,
  single-day window — not an unbounded scan) and makes exactly one LLM call
  per day, not one per candidate-worthy run, to keep the token shape
  predictable against the daily cap. (Batch-summarise-then-extract, the same
  "one bounded pass" posture `memory-compactor`'s own docstring uses for its
  nightly sweep — "the one LLM call per compacting agent is a summariser,
  not a deliverable.")

## Alternatives considered

- **Fold the lesson stream into the existing per-agent semantic-memory layer
  (ADR-0019's `MEMORY.md` profile block)** instead of a new partition.
  Rejected: ADR-0019's memory is deliberately *per-agent*, curated by that
  agent's own experience, and injected unconditionally every fire; a lesson
  is *cross-agent*, scope-conditional, and TTL'd. Conflating them would mean
  one agent's curated self-knowledge gets silently diluted by lessons that
  originated elsewhere — the exact "digested back into episode soup" failure
  ADR-0019 itself rejected for a *different* reason (S3 chunk vs. profile
  block) but the same underlying principle: don't collapse two different
  lifecycles into one document.
- **A per-scope partition (`pk = LESSON#{scope}`) instead of a single global
  partition.** This is the shape `PERF#{scope}` actually uses (verified
  against `template.yaml` and the PR #692 body — `PERF#{scope}` really is a
  per-scope *partition key*, not a GSI projection like `FEED`). Considered,
  but the issue's own AC text — repeated identically across the issue body,
  Epic-022, and both `wf:ren`/`wf:nadia` comments — states `sk =
  LESSON#{scope}#{ulid}` under "`LESSON` single partition," which only
  parses as `pk="LESSON"` fixed. Deviating from a three-times-repeated,
  explicit AC without an operator ruling would be presumptuous; if a
  per-scope partition later proves necessary (e.g. one scope's write volume
  dominates), that is a Zone A schema amendment with its own migration note,
  not a silent reinterpretation now.
- **Reuse the monthly `BUDGET#{yyyy-mm}`/`AGENT#{slug}` row with a synthetic
  agent slug** (e.g. `AGENT#_lesson-distiller`) instead of a new daily/system
  row shape. Rejected: R-N8 (data-shape uniformity) exists specifically to
  forbid `if (agent === X)` branches and synthetic personas that aren't real
  registered agents (`GET /agents/_lesson-distiller` would 404, and the
  `AGENT#operator` precedent for a deliberate non-agent partition already
  established that such partitions are named for what they are, not
  disguised as a persona).
- **No closed-vocabulary registry file — let the distiller's prompt enumerate
  the allowed values inline.** Rejected: the enum then lives only in a
  prompt string, invisible to `validate-skills.mjs` and to a skill author
  deciding whether to subscribe; a registry file is the same "machine-checked,
  not prose-trusted" discipline every other closed enum in this codebase
  already uses.

## Consequences

**What becomes buildable.** Once this ADR is Accepted and the companion
`data-model.md` diff merges, the daily distiller Lambda (Authority A per
#459) is a normal implementation PR: `workforce/lambdas/lesson-distiller/`
(new directory, following the `memory-compactor` layout — standalone
handler, no skill/persona, `Makefile` + `handler.ts` + `handler-tests.ts`),
an EventBridge daily rule (**Authority B** — new-schedule-enable, per the
issue's own Authority line and governance.md §5's "add a new EventBridge
cron rule" row — lands `Enabled: false` until the operator flips it, same as
every other new cadence).

**Cost.** No new W-3 (per-agent) spend — the distiller's spend rides its own
new system-scoped daily cap, outside any persona's monthly ledger, exactly
as Epic-022 §Cost pre-committed ("the daily distiller pass carries its own
throwing budget"). The injection leg's cost (~1M input tokens/mo at Epic-022's
own stated arithmetic) is Story 3's concern, not this schema's — this ADR
adds zero recurring injection cost by itself, since nothing reads `LESSON`
rows until Story 3 ships.

**What stays undecided on purpose.** The actual `cap_tokens` daily figure,
the pre-filter's exact rule set (schema caps / citation-resolves /
instruction-pattern-reject / imperative-second-person-quarantine — Epic-022
names the categories, not the regexes), and the operator-digest UI are all
implementation-time decisions for the Lambda PR, not schema decisions this
ADR forecloses.

**Reversal.** Delete the `data-model.md` §Lesson rows section (or mark it
Deprecated), remove the `lesson-scope-vocabulary.json` file and the
`lesson_subscriptions` `meta.json` field from the schema, and — if the
Lambda was ever built — disable its EventBridge rule. No agent memory, no
Notion content, and no other row family reads or writes `LESSON#*`/`BUDGET#{yyyy-mm-dd}`
rows, so removal is fully additive-reversal: nothing else in the data model
depends on this partition existing.

**What would tell us it was wrong.** Per Epic-022's own fallback verdict
(pre-written before Accepted): "if the composition edit stalls, the 2026-08
report says 'design shipped, loop unproven' — not silence." At the schema
layer specifically: if the daily distiller, once built, cannot produce a
single real `active` lesson within its token budget from a real day's data
(the epic's own acceptance criterion), or if the closed-vocabulary mechanism
proves too rigid in practice (every real candidate needs a scope outside the
two-value initial set), either is a signal to revisit this ADR's shape —
via a superseding ADR, not a silent schema edit.

## Out of scope

- **Implementing the distiller Lambda, the pre-filter rules, the curation
  API route, or the injection endpoint.** All tracked on #459 (Lambda) and
  Epic-022 Story 2/3 (curation gate, injection) respectively — Authority A
  once this ADR + the data-model.md diff are Accepted.
- **Choosing `cap_tokens`'s actual value.** Implementation-time, sized
  against real data.
- **Any change to `AGENT#{slug}/MEMORY#INDEX`, ADR-0019, or the memory→lint
  ratchet's existing mechanics** — this ADR adds a new, separate stream; it
  amends nothing about how per-agent memory or the ML backlog currently work.
- **Cross-project lesson sharing** — explicitly out of scope per Epic-022
  itself (the trust boundary is Epic-010's territory).
