# Workforce — RFCs

Specifications for workforce features that have been **proposed but not yet broken down into implementation tickets**. Each RFC lives until the work it describes is done, then is marked `Implemented` (link back to the merging PR) and kept here as the design record.

## Lifecycle

```
Proposed   → an RFC is opened (the .md file lands in this dir)
           ↓  Maya reads it during her biweekly run
Triaged    → Maya files one-or-more GitHub Issues that reference the RFC.
              Issue title format: "[RFC-NNN] <task>". Issue body lists
              the acceptance criteria the RFC named.
           ↓  Claude Code routine on GHA picks an issue (operator-managed)
In progress → A draft PR is open against an issue. RFC body updated with
              the PR link.
           ↓  ship-pr graduates the PR; operator merges
Implemented → RFC's "Status" line flipped, "Implemented by" links added.
              File stays in this dir as history. No deletion.
Rejected   → If review finds the RFC unsound, mark Rejected with rationale.
              Don't delete; rejections teach.
```

Maya is the **dedicated PM** for RFCs. Her [`agent.json:skills`](../../agents/maya/agent.json) includes `plan-write` and (forthcoming) `rfc-to-issue`. On each scheduled run she:

1. Lists RFCs with `Status: Proposed` or `Status: Triaged-pending` here.
2. For each, generates a small set of GitHub Issues with `[RFC-NNN]` prefix and the explicit acceptance criteria.
3. Writes a DDB `DELIV#{ulid}` row of `type=plan` linking the RFC, the issues, and (when ready) the PR.

The actual implementation loop — Claude Code routine on GHA reading the issue, writing code, opening a draft PR, applying [ship-pr](../../../../.claude/skills/ship-pr/SKILL.md) — is operator-managed. The agents do not start that loop themselves in v1.

## RFC format

A new RFC is `rfc-NNN-<kebab-case-slug>.md`, where `NNN` is the next zero-padded number. Required headers:

```
# RFC-NNN — <title>

- **Status**: Proposed | Triaged | In-progress | Implemented | Rejected
- **Owner**: <agent slug or operator name>
- **Created**: <YYYY-MM-DD>
- **Implemented by**: <PR link(s) once merged>

## Problem

## Proposed solution

## Behaviour at N = 100+ agents

## Acceptance criteria

## Open questions

## Out of scope
```

**The "Behaviour at N = 100+ agents" section is mandatory** for any RFC that touches the agent set — search, profile, org chart, skill catalog, scheduling, budgets, etc. Workforce growth is the planned axis of change; no RFC ships without thinking it through.

## Current RFCs

| # | Title | Status | Owner |
|---|---|---|---|
| [001](rfc-001-agent-search.md) | Agent search | Proposed | Maya |
| [002](rfc-002-agent-profile.md) | Agent profile page (LinkedIn-style) | Proposed | Maya |
| [003](rfc-003-org-chart.md) | Org chart (MS Teams-style) | Proposed | Maya |
| [004](rfc-004-skill-catalog.md) | Skill catalog + utilization | Proposed | Maya |
| [005](rfc-005-agent-authored-article-pipeline.md) | Agent-authored L0→L1 article pipeline | Proposed | Maya |
| [006](rfc-006-scalability.md) | Workforce scalability to 100+ agents | Proposed | Maya |

## Why RFCs, not just issues

Agents at this scale are an *organisation*, and an organisation changes shape under pressure. An issue describes one piece of work. An RFC describes the **decision** that the work expresses — what problem we noticed, what alternatives we considered, what we expect to be true after it ships, and what would tell us we were wrong.

Skipping the RFC step means the next reviewer (or the next agent generation) sees a merged PR with no decision context. The RFC is what survives migrations of personnel, models, and providers.
