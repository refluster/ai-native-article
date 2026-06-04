# Workforce — Architecture Decision Records (ADRs)

An ADR captures **one technical decision**: the context that forced it, the
option we chose, the alternatives we rejected, and the consequences we
accept. It is the *engineering* counterpart to an [Epic](epics/README.md) —
where an Epic records a **user/business outcome** and its lifecycle, an ADR
records a **structural choice** and its rationale.

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
| [0001](adr-0001-record-family-separation.md) | Two record families: activity ledger vs experience memory | Accepted | [012](epics/epic-012-agent-experience.md) |
| [0002](adr-0002-no-dedicated-vector-store.md) | Semantic recall without a dedicated vector store | Accepted | [010](epics/epic-010-project-trust-boundary.md), [012](epics/epic-012-agent-experience.md) |
| [0003](adr-0003-experience-storage-split.md) | Experience storage split: narrative in S3, index in DynamoDB | Accepted | [012](epics/epic-012-agent-experience.md) |
| [0004](adr-0004-workforce-api-custom-domain.md) | Workforce API served from a custom domain (`workforce-api.kohuehara.xyz`) | Accepted | [007](epics/epic-007-agent-management-api.md), [012](epics/epic-012-agent-experience.md) |

Keep this table in sync when an ADR is added or its Status flips — it is the
canonical status view, same convention as [epics/README.md](epics/README.md).
