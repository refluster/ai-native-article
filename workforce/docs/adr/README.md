# Workforce — Architecture Decision Records (ADRs)

An ADR captures **one technical decision**: the context that forced it, the
option we chose, the alternatives we rejected, and the consequences we
accept. It is the *engineering* counterpart to an [Epic](../epics/README.md) —
where an Epic records a **user/business outcome** and its lifecycle, an ADR
records a **structural choice** and its rationale.

This is the **workforce** ADR tree. The root/article tree lives at
[`docs/adr/`](../../../docs/adr/README.md); **the two trees share numbering
but not identity** (this tree's adr-0004 = API custom domain; the root tree's
ADR-0004 = governance consolidation). When citing across trees, qualify the
path: `workforce/adr-NNNN` vs `docs/adr-NNNN`.

## Epic vs ADR — which goes where

| | Epic | ADR |
|---|---|---|
| Answers | *What outcome, for whom, and is it done?* | *Why is the system built this way?* |
| Lifecycle | Draft → Accepted → In-progress → Implemented | Proposed → Accepted → (Superseded / Deprecated) |
| Decomposes into | GitHub Story issues | nothing — an ADR is atomic |
| Owned by | Maya (PM) | the deciding agent(s) / operator |
| Changes when | scope or progress changes | a decision is **reversed** (new ADR supersedes the old one — never edit a decided ADR's Decision in place) |
| Relationship | M:N — an Epic links the ADRs that justify its design | M:N — an ADR may underpin several Epics |

Rule of thumb: if a reviewer would ask *"why didn't you just use X instead?"*,
the answer belongs in an ADR. If they'd ask *"what are we shipping and when?"*,
that's the Epic.

## Format

A new ADR is `adr-NNNN-<kebab-case-slug>.md`, where `NNNN` is the next
zero-padded number (4 digits — decisions accrue faster than Epics). Required
headers:

```
# ADR-NNNN — <title>

- **Status**: Proposed | Accepted | Superseded by ADR-MMMM | Deprecated
- **Date**: <YYYY-MM-DD>
- **Deciders**: <agent slug(s) / operator>
- **Epics**: <epic-NNN link(s) this decision serves>

## Context
## Decision
## Alternatives considered
## Consequences
## Related
```

### Status semantics

- **Proposed** — written, not yet ratified. The operator (or the relevant
  Epic's review) has not signed off.
- **Accepted** — ratified. The decision is in force; code may rely on it.
- **Superseded by ADR-MMMM** — a later ADR reversed this one. The body stays
  as history; the header points forward. **Never** silently rewrite a
  decided ADR — supersede it so the audit trail survives.
- **Deprecated** — the decision no longer applies but nothing replaced it
  (the feature it governed was removed).

The append-only / supersede-don't-edit discipline is the whole point: an ADR
is worthless if "what we decided" can be quietly changed to match "what we
did." (Same spirit as W-4 / C-4 — the record fails loud, not silent.)

## Index

| # | Title | Status | Epics |
|---|---|---|---|
| [0001](adr-0001-record-family-separation.md) | Two record families: activity ledger vs experience memory | Accepted | [012](../epics/epic-012-agent-experience.md) |
| [0002](adr-0002-no-dedicated-vector-store.md) | Semantic recall without a dedicated vector store | Accepted | [010](../epics/epic-010-project-trust-boundary.md), [012](../epics/epic-012-agent-experience.md) |
| [0003](adr-0003-experience-storage-split.md) | Experience storage split: narrative in S3, index in DynamoDB | Accepted | [012](../epics/epic-012-agent-experience.md) |
| [0004](adr-0004-workforce-api-custom-domain.md) | Workforce API served from a custom domain (`workforce-api.kohuehara.xyz`) | Accepted | [007](../epics/epic-007-agent-management-api.md), [012](../epics/epic-012-agent-experience.md) |
| [0005](adr-0005-single-execution-model-ccr.md) | Single execution model: every (project × agent × skill) task runs as a CCR task | Accepted | [010](../epics/epic-010-project-trust-boundary.md), [011](../epics/epic-011-agent-feed.md), [012](../epics/epic-012-agent-experience.md) |
| [0006](adr-0006-realtime-messaging-reply.md) | Real-time talent replies run on a dedicated async Lambda, not the CCR batch runner | Accepted | [013](../epics/epic-013-talent-messaging.md) |
| [0007](adr-0007-agent-config-single-source.md) | Agent identity/config is single-sourced from DynamoDB; git definition files retire | Accepted | [006](../epics/epic-006-scalability.md), [007](../epics/epic-007-agent-management-api.md) |
| [0008](adr-0008-skill-config-single-source.md) | Skill judgment-config is single-sourced from DynamoDB; the console reads DDB live | Accepted — §Decision-5 superseded by [0018](adr-0018-skill-body-version-gated-sync.md) | [008](../epics/epic-008-skill-repository.md) |
| [0009](adr-0009-scoped-capability-tokens.md) | Scoped capability tokens: one minter, scope-claimed short-lived tokens, retiring per-service static bearers | Proposed | [010](../epics/epic-010-project-trust-boundary.md), [011](../epics/epic-011-agent-feed.md) |
| [0010](adr-0010-autopilot-merge-consensus-widening.md) | Autopilot merge widens to "non-L0/L1 + unanimous reviewer consensus" | Accepted | [010](../epics/epic-010-project-trust-boundary.md) |
| [0011](adr-0011-own-repo-autopilot-merge.md) | Own-repo autopilot merge: retire the self-repo carve-out; the L0/L1 boundary is the single line | Accepted | [010](../epics/epic-010-project-trust-boundary.md) |
| [0012](adr-0012-decouple-binding-from-ownership.md) | Binding is decoupled from skill ownership: any agent may bind any skill | Proposed | [008](../epics/epic-008-skill-repository.md) |
| [0013](adr-0013-event-driven-pr-autopilot.md) | pr-autopilot fires on PR-open via a CCR-native `github_event` trigger (within adr-0005) | Proposed | — (cadence; adr-0005/0010/0011) |
| [0014](adr-0014-drafts-are-merge-eligible.md) | Drafts are merge-eligible: the engine marks a green, non-L0/L1 draft Ready for Review, then merges | Accepted | [010](../epics/epic-010-project-trust-boundary.md) |
| [0015](adr-0015-skill-bodies-not-l0l1.md) | Skill bodies (`SKILL.md`) are removed from the L0/L1 autopilot off-limits set | Proposed | [010](../epics/epic-010-project-trust-boundary.md) |
| [0016](adr-0016-podcast-production-surface.md) | Podcast production & distribution execution surface (deterministic `wf-podcast` Lambda + Polly/public-RSS egress, within R-N1) | Proposed | [017](../epics/epic-017-podcast-spotify-distribution.md) |
| [0017](adr-0017-skill-lifecycle-api.md) | Skill lifecycle API: display-name/slug split, archive soft-delete, API-first creation, per-skill run ledger | Proposed | [008](../epics/epic-008-skill-repository.md) |
| [0018](adr-0018-skill-body-version-gated-sync.md) | Skill judgment-config syncs from git on a version gate (supersedes ADR-0008 §Decision-5's create-only seed) + a PR-time drift guard | Accepted | [008](../epics/epic-008-skill-repository.md) |
| [0019](adr-0019-agent-semantic-memory.md) | Agent semantic memory: curated MEMORY.md on the META row, injected at every fire (layer 3.5) | Accepted | [018](../epics/epic-018-semantic-memory-curation.md) |
| [0020](adr-0020-delegated-memory-curation.md) | Delegated memory curation: bounded token write for the memory profile block (POST /agents/{slug}/memory + shrink guard) | Superseded by [0021](adr-0021-dynamic-memory-write-token.md) | [018](../epics/epic-018-semantic-memory-curation.md) |
| [0021](adr-0021-dynamic-memory-write-token.md) | Dynamic memory-write token: ADR-0009's minted-token pattern replaces the static secret | Accepted | [018](../epics/epic-018-semantic-memory-curation.md) |
| [0022](adr-0022-issue-to-merge-flow.md) | The issue→merge flow: a dispatcher at intake (issue lanes) + an agent-owned author lane on PRs (pr-remediate) | Proposed | [019](../epics/epic-019-autonomous-finalization-rate.md) |
| [0023](adr-0023-red-verdict-author-loop.md) | A 🔴 verdict returns to the author with a machine-checked remediation brief; the human gate moves to the cycle cap | Proposed | [019](../epics/epic-019-autonomous-finalization-rate.md) |
| [0024](adr-0024-panel-mode-not-a-merge-condition.md) | Panel provenance mode is not a merge condition: an inline panel is a wording discount, never a hold | Proposed | [019](../epics/epic-019-autonomous-finalization-rate.md) |
| [0025](adr-0025-event-driven-lane-handoff.md) | A hand-off is an event: the author lane dispatches its worker via `POST /dispatch`; cron + the 36h sweep stay as the floors | Accepted (2026-08-11) | [019](../epics/epic-019-autonomous-finalization-rate.md) |
| [0026](adr-0026-knowledge-backup-ingest-pipeline.md) | Knowledge backup is a deterministic GHA pipeline, not a Cadence: Discord/Notion ingest into a dedicated knowledge-store repo | Proposed | — |
| [0027](adr-0027-project-tools-surface.md) | Interactive project tools: a project-scoped Tools surface, a synchronous `tools-api`, and a declarative tool registry | Accepted (2026-09-02) | [025](../epics/epic-025-project-tools-migration.md) |
| [0028](adr-0028-per-project-knowledge-backup.md) | The knowledge backup is scoped per Project, not per workforce: each project declares its own store repo, sources and derived secrets (refines 0026) | Proposed | — |
| [0029](adr-0029-project-config-write-surface.md) | Project config is edited in the console: `PATCH /projects/{id}` widened past name/status, validated + audited; supersedes the Epic-010 §10 minimal write surface | Proposed | [010](../epics/epic-010-project-trust-boundary.md) |

Keep this table in sync when an ADR is added or its Status flips — it is the
canonical status view, same convention as [epics/README.md](../epics/README.md).

> **Index reconciliation (2026-08-03, Nadia — `backlog-reconcile`).** Index-only
> correction; **no ADR status was decided here.** A full sweep comparing every
> `adr-*.md` header against this table found two cells that had drifted from
> decisions already recorded in the ADR files themselves:
>
> - **0008** — the file has read `Accepted — §Decision-5 superseded by ADR-0018`
>   since 0018 landed; the table still said `Proposed`.
> - **0018** — the file was flipped `Proposed → Accepted` on 2026-07-30 by the
>   `backlog-reconcile` pass in [#521](https://github.com/refluster/ai-native-article/pull/521)
>   (ratified by its merged implementation, per that ADR's own status rule,
>   ⚠ operator sign-off still requested there); the table was not updated in the
>   same pass.
>
> Both edits make the table agree with the ADR of record — they encode no new
> ratification. **Deliberately not touched:** the six ADRs that genuinely read
> `Proposed` in their own files (0009, 0012, 0013, 0015, 0016, 0017) and the two
> whose implementations merged this window (**0022** #518, **0023** #530).
> Neither 0022 nor 0023 carries a self-ratification clause of the kind 0018 has,
> so flipping them is an operator decision, not a reconciliation — the same skip
> reason #521 recorded. Verified not-a-mismatch: 0021 reads `Accepted` in both.
