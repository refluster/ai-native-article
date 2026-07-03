# Governance & Architecture Decision Records (ADRs)

An ADR captures **one decision**: the context that forced it, the option we
chose, the alternatives we rejected, and the consequences we accept. This
directory is the article/root-side ADR log (the workforce subsystem keeps its
own engineering ADRs under [`workforce/docs/adr/`](../../workforce/docs/adr/README.md)).

ADRs are **L1 framework laws** ([governance.md §3](../governance.md#3-l1--framework-laws)):
an ADR records *why the system is built this way*, and implementation must
follow the ADR in force. When you implement a mechanism that an ADR governs,
cite the ADR — the R-11 citation gate treats `docs/adr/*.md` as L1 docs.

## Format

A new ADR is `adr-NNNN-<kebab-case-slug>.md`, `NNNN` zero-padded. Required
headers:

```
# ADR-NNNN — <title>

- **Status**: Proposed | Accepted | Superseded by ADR-MMMM | Deprecated
- **Date**: <YYYY-MM-DD>
- **Deciders**: <operator / agent slug(s)>

## Context
## Decision
## Alternatives considered
## Consequences
## Related
```

### Status semantics

- **Proposed** — written, not yet ratified by the operator.
- **Accepted** — in force; code may rely on it.
- **Superseded by ADR-MMMM** — a later ADR reversed this one. The body stays
  as history; the header points forward. **Never** silently rewrite a decided
  ADR — supersede it so the audit trail survives (same spirit as C-4: the
  record fails loud, not silent).
- **Deprecated** — no longer applies and nothing replaced it.

## Index

| # | Title | Status |
|---|---|---|
| [0001](adr-0001-self-driving-governance-mechanisms.md) | Self-driving governance mechanisms (R-10…R-12 gates, the two engines, the registries) | Accepted |
| [0002](adr-0002-daily-use-reader-ia.md) | Daily-use reader IA: analysis-default, flat tags, operator split | Proposed |
| [0003](adr-0003-flat-tag-taxonomy.md) | Flat tag taxonomy (replacing the A–E hierarchy) | Proposed |
| [0004](adr-0004-governance-consolidation.md) | Governance consolidation: de-duplicated statute, R-11 full-law coverage, R-13 terminal-state sweep | Proposed |

Keep this table in sync when an ADR is added or its Status flips.
