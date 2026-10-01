# ADR-0035 — Cadences write internal (non-published) documents to a second, non-exported Notion database

- **Status**: Proposed
- **Date**: 2026-09-12
- **Deciders**: operator (proposed by `dario`, workforce `issue-design`)
- **Epics**: [021](../epics/epic-021-finance-ir-activation.md)

## Context

Epic-021 §A.3 (issue [#457](https://github.com/refluster/ai-native-article/issues/457)) asks `delphine` for a fundraising decision-frame: *"a one-time-then-maintained document… pure paper; no investor contact."* On 2026-08-01, `wf:ren` worked the implementation issue and stopped at Step 3 with a blocker this org had never actually decided: **where does a Cadence write an internal, non-published document?**

Ren's own survey of every write surface a Cadence can legally use today (`workforce/docs/routines/agent-runner.md` step 5) found each one wrong for this shape, for a different reason:

| Surface | Precedent | Why it doesn't fit |
|---|---|---|
| Notion unified Articles DB | `monthly-report`, `article-level2/3` | `newsletter/pipeline/fetchers/notion.mjs` applies **no `Status` filter** — every row is exported to `kohuehara.xyz`. `Status=draft` is not a privacy boundary there; a decision-frame written to this DB goes live. |
| `POST /feed` | `attention-ledger`, `red-team-audit` | 2,000-char hard cap, W-1-validated as a micro-post. A decision-frame with criteria and trigger metrics is an order of magnitude past it. |
| Repo file via GitHub contents API | `weekly-project-report` (writes to a different project's repo) | This project's target **is** this repo, where direct commits to `main` are forbidden (root `CLAUDE.md` action-authority: PR-only). |

The gap is not particular to this one document. It applies identically to Epic-021 §A.1 (the monthly investor letter, issue #455 — still open per the Epic's 2026-09-06 status note) and to §A.4's yara template-maintenance artefacts, so Ren asked to answer it once rather than three times, and declined to pick an option himself because *"it sets the shape for every future internal-document Cadence, which is squarely the operator's call."*

**What happened next is itself evidence the gap is real, not hypothetical.** Sibling Story 2 (#456, the `budget-runway-review` Cadence) shipped on 2026-08-05 via [#531](https://github.com/refluster/ai-native-article/pull/531) by using the `POST /feed` route — the surface Ren had already ruled out here as too small for this document class. That precedent resolves the surface question for a *short* internal artefact; it does not resolve it for a decision-frame with criteria and trigger metrics, and #457 sat blocked at `issue-implement:needs-human` for 39 days (2026-08-01 → 2026-09-09) until `issue-triage` re-laned it to this `design` lane specifically to draft this decision (Nadia, 2026-09-09: *"the actual blocking surface"*).

Root invariants this decision must not violate: **C-2** (Notion is the source of truth for the published article corpus — but that corpus is what `fetch-notion.mjs` exports, not "every Notion page anywhere") and **W-2** (no double source of truth — Notion owns article bodies, DDB+S3 own workforce state). Epic-021 §A.1 already worked through the W-2 question for the sibling investor-letter Cadence and recorded the resolution this ADR reuses: *"the letter is an artefact (like an article), not workforce state."*

## Decision

**A Cadence whose deliverable is an internal (non-published), one-time-then-maintained document writes it to a second, non-exported Notion database — a non-secret `INTERNAL_DOCS_DB_ID` script constant, seeded once, shared with the existing `notion.integration_token` the same way `UNIFIED_DB_ID` is today.**

Concretely:

1. Create one Notion database, `Internal Documents`, under the same Notion workspace the unified Articles DB lives in. Share the existing workforce Notion integration with it (no new credential type — `agent-workforce`'s `project.json` already lists `notion.integration_token` under `credential_types`).
2. Record its id as a second non-secret constant next to `UNIFIED_DB_ID` in the calling scripts (mirroring `workforce/skills/article-level2/publish-notion.mjs`'s existing pattern) — e.g. `INTERNAL_DOCS_DB_ID`.
3. `newsletter/pipeline/fetchers/notion.mjs` is **not touched** by this decision — it continues to read only the unified Articles DB it already reads. The privacy boundary is *which database the write targets*, not a `Status` filter inside a database that is exported wholesale.
4. A Cadence in this class creates the page once, then updates the same page on later maintenance fires (`retrieve` + `update`, not `create` each time) — matching the "one-time-then-maintained" shape the Epic-021 stories actually ask for, and avoiding an ever-growing set of near-duplicate pages.
5. This is an **artefact**, not workforce state (W-2): it carries no row the operator needs to query structurally, and it cites Epic-016/W-3 figures and other DDB-sourced numbers with source links rather than duplicating them, the same discipline Epic-021 §A.1 already committed the investor letter to.

## Alternatives considered

- **Teach `notion.mjs` a `Status` filter, making `Status=draft` (or similar) a real privacy boundary inside the existing unified Articles DB.** Rejected as the day-one move: it changes publication semantics for **every existing row** in the DB the live site already serves from, which Ren correctly flagged as needing the operator's explicit yes on its own — a much larger blast radius than three Cadences need answered today. Kept as a future option if a strong reason emerges to unify all Notion content behind one export gate instead of a second database.
- **The draft-PR write-back exception** (`workforce/docs/routines/agent-runner.md`: *"A skill whose deliverable is a repo artefact… may instead use a draft-PR write-back — but that's the exception, declared in that skill's SKILL.md, not the default."*). Viable and PR-reviewable, but every maintenance fire becomes a PR — heavier than "one-time-then-maintained" calls for, and a poor fit for a *document*, as opposed to a *repo artefact*, that nobody intends to ship as code. Recorded here as the fallback if a future internal-document Cadence needs the review-before-write guarantee a PR gives and a Notion page does not (e.g. anything closer to L1/L0-shaped than "pure paper" fundraising criteria).
- **Do nothing; let each Cadence re-derive its own answer.** Rejected on the evidence in Context: the same blocker would recur at §A.1 and §A.4, and it already recurred once in miniature when #456 reached for `POST /feed` out of expedience rather than fit.

## Consequences

**Good.** #457 (and #455, and §A.4's template-maintenance half) unblock against one decided surface instead of three separate ad-hoc calls. The distinction between "published corpus" (C-2, exported wholesale) and "internal document" (this ADR, never exported) becomes structural — a second database — rather than a filter someone has to remember to apply correctly on the shared one.

**What it costs.** One more Notion database to seed, share, and remember exists — a small, permanent addition to the org's Notion footprint, and a second `*_DB_ID` constant every future internal-document Cadence's script must reuse rather than reinvent. Nothing here is exported to `kohuehara.xyz`, so it also creates a Notion surface with no reader-facing verification path — if a Cadence's write script targets the wrong DB id by mistake, it will not be caught by anything the live-site smoke checks already run (R-17 does not reach this database, by design).

**How it would be reversed.** A future ADR that decides the two-database split was the wrong shape — e.g. because the `Status`-filter alternative above turns out cheaper once several other Notion-export decisions land — would supersede this one and specify the migration of any pages already written under it. Until then this ADR's `Internal Documents` DB is additive; nothing that already writes to the unified Articles DB or to `POST /feed` needs to move.

**What would tell us this was wrong.** If a second internal-document Cadence (§A.1's investor letter, or a future one) finds the one-page-per-document, retrieve-then-update shape doesn't fit its own cadence (e.g. it wants dated history per revision, which a single updated page discards) — that is evidence for the draft-PR alternative instead, and should come back as a superseding ADR rather than a silent per-skill workaround.

**Explicitly out of scope.** This ADR decides the write *surface* only. It does not draft, judge, or implement any of the three Epic-021 Cadences themselves (§A.1 investor letter, §A.3 fundraising decision-frame, §A.4 template-maintenance) — those remain their own Story PRs, now unblocked to proceed against this decision. It does not change `newsletter/pipeline/fetchers/notion.mjs` or any publication semantics of the existing Articles DB. It does not address how the `speculative`/kill-criterion scheduling named in Epic-021 §B.2 (tracked separately at [#566](https://github.com/refluster/ai-native-article/issues/566)) is recorded — that is an unrelated open gate on the same Epic.

## Related

- [Epic-021 — finance & IR activation](../epics/epic-021-finance-ir-activation.md), §A.1, §A.3, §A.4
- [issue #457](https://github.com/refluster/ai-native-article/issues/457) — the blocker this ADR resolves (`wf:ren`, 2026-08-01; re-laned to `design` by Nadia, 2026-09-09)
- [issue #455](https://github.com/refluster/ai-native-article/issues/455) — Story 1 (investor letter), the sibling Cadence this decision also unblocks
- [issue #456](https://github.com/refluster/ai-native-article/issues/456) / [PR #531](https://github.com/refluster/ai-native-article/pull/531) — Story 2, the `POST /feed` precedent that resolved the surface question for short artefacts only
- [`workforce/docs/routines/agent-runner.md`](../routines/agent-runner.md) — the write-back contract (step 5) this decision extends with a second Notion-write pattern, and the source of the draft-PR exception clause
- [`workforce/skills/article-level2/publish-notion.mjs`](../../skills/article-level2/publish-notion.mjs) — the existing `UNIFIED_DB_ID`-constant pattern this ADR's `INTERNAL_DOCS_DB_ID` mirrors
- Root [`docs/governance.md`](../../../docs/governance.md) C-2 / [`workforce/docs/governance.md`](../governance.md) W-2 — the invariants this decision is scoped to satisfy, not amend

---
Authored by an LLM persona (workforce `issue-design`, R-N1(a)). This proposes a decision; it does not make one. Verify before merging.
