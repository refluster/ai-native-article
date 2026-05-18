# Workforce — RFCs

Specifications for workforce features. Each RFC lives in this directory from the moment it is opened until long after the work it describes is done — it stays as the **design record**. The status line at the top of each file states where in the lifecycle the RFC currently sits.

## Status definitions

Every RFC carries one of **five statuses** on its first line. The lifecycle is monotonic — moving backward (e.g. `Implemented` → `In-progress`) is not allowed; open a new RFC for follow-up work instead.

| Status | Definition | Exits to |
|---|---|---|
| **Draft** | RFC opened in this directory. Design is on the page but **operator review has not signed off**. Edits to the body are still expected. | `Accepted` once the operator approves, or `Rejected`. |
| **Accepted** | Operator review passed. **Maya is cleared to file implementation issues** on GitHub against this RFC. No code yet. | `In-progress` once the first implementation PR is open. |
| **In-progress** | One or more implementation PRs are open against the issues Maya filed. The RFC body is updated with PR links as they appear. | `Implemented` once all PRs are merged AND the change is live on its target surface. |
| **Implemented** | The change described by the RFC is **live** — deployed to AWS, served on `kohuehara.xyz`, behavior present in the runner, etc. The RFC stays here as the design record. The "Implemented by" line at the top lists the merging PR(s). | Terminal. |
| **Rejected** | The design was reviewed and the decision was *not* to implement. The rationale is recorded in the RFC body. Kept as history; rejections teach the next reviewer what we already considered and discarded. | Terminal. |

Lifecycle diagram:

```
Draft  ──operator review──▶  Accepted  ──Maya files issues──▶  In-progress  ──ship & deploy──▶  Implemented (terminal)
   │                            │                                  │
   └─── at any of these points, the decision can flip to ──▶  Rejected (terminal)
```

## Maya's role

Maya is the **dedicated PM** for RFCs. Her [`agent.json:skills`](../../agents/maya/agent.json) includes `plan-write` and (forthcoming) `rfc-to-issue`. On each scheduled run she:

1. Lists RFCs with `Status: Accepted`.
2. For each, generates one or more GitHub Issues titled `[RFC-NNN] <task>` with the explicit acceptance criteria from the RFC body.
3. Writes a DDB `DELIV#{ulid}` row of `type=plan` linking the RFC, the issues, and (when ready) the PRs.

`Draft` RFCs are not yet hers to act on — they're waiting on operator review.

The implementation loop — Claude Code routine on GHA reading the issue, writing code, opening a draft PR, applying [ship-pr](../../../../.claude/skills/ship-pr/SKILL.md) — is **operator-managed**. The agents do not start that loop themselves in v1.

## RFC format

A new RFC is `rfc-NNN-<kebab-case-slug>.md`, where `NNN` is the next zero-padded number. Required headers:

```
# RFC-NNN — <title>

- **Status**: Draft | Accepted | In-progress | Implemented | Rejected
- **Owner**: <agent slug or operator name>
- **Created**: <YYYY-MM-DD>
- **Implemented by**: <PR link(s) — only set when Status hits In-progress or later>

## Problem

## Proposed solution

## Behaviour at N = 100+ agents

## Acceptance criteria

## Open questions

## Out of scope
```

**The "Behaviour at N = 100+ agents" section is mandatory** for any RFC that touches the agent set — search, profile, org chart, skill catalog, scheduling, budgets, etc. Workforce growth is the planned axis of change; no RFC ships without thinking it through.

When the Status line flips, add a parenthetical date so the audit trail is one click away:

```
- **Status**: Implemented (2026-05-30)
- **Implemented by**: #34, #36
```

## Index

| # | Title | Status | Owner |
|---|---|---|---|
| [001](rfc-001-agent-search.md) | Agent search | Draft | Maya |
| [002](rfc-002-agent-profile.md) | Agent profile page (LinkedIn-style) | Draft | Maya |
| [003](rfc-003-org-chart.md) | Org chart (MS Teams-style) | Draft | Maya |
| [004](rfc-004-skill-catalog.md) | Skill catalog + utilization | Draft | Maya |
| [005](rfc-005-agent-authored-article-pipeline.md) | Agent-authored L0→L1 article pipeline | Draft | Maya |
| [006](rfc-006-scalability.md) | Workforce scalability to 100+ agents | Draft | Maya |
| [007](rfc-007-agent-management-api.md) | Agent management surface (DDB + CRUD API, SAM, nodejs24.x) | Draft | Maya |

The index is also the **canonical status view** — keep it in sync when a Status line in an individual RFC flips. A CI check that asserts table-vs-file consistency is on the backlog (see `workforce/scripts/validate-rfc-index.mjs`, forthcoming).

## Why RFCs, not just issues

Agents at this scale are an *organisation*, and an organisation changes shape under pressure. An issue describes one piece of work. An RFC describes the **decision** that the work expresses — what problem we noticed, what alternatives we considered, what we expect to be true after it ships, and what would tell us we were wrong.

Skipping the RFC step means the next reviewer (or the next agent generation) sees a merged PR with no decision context. The RFC is what survives migrations of personnel, models, and providers.
