# Workforce — Epics

Specifications for workforce features. Each Epic lives in this directory from the moment it is opened until long after the work it describes is done — it stays as the **design record**. The status line at the top of each file states where in the lifecycle the Epic currently sits.

## Status definitions

Every Epic carries one of **five statuses** on its first line. The lifecycle is monotonic — moving backward (e.g. `Implemented` → `In-progress`) is not allowed; open a new Epic for follow-up work instead.

| Status | Definition | Exits to |
|---|---|---|
| **Draft** | Epic opened in this directory. Design is on the page but **operator review has not signed off**. Edits to the body are still expected. | `Accepted` once the operator approves, or `Rejected`. |
| **Accepted** | Operator review passed. **Maya is cleared to file implementation issues** on GitHub against this Epic. No code yet. | `In-progress` once the first implementation PR is open. |
| **In-progress** | One or more implementation PRs are open against the issues Maya filed. The Epic body is updated with PR links as they appear. | `Implemented` once all PRs are merged AND the change is live on its target surface. |
| **Implemented** | The change described by the Epic is **live** — deployed to AWS, served on `kohuehara.xyz`, behavior present in the runner, etc. The Epic stays here as the design record. The "Implemented by" line at the top lists the merging PR(s). | Terminal. |
| **Rejected** | The design was reviewed and the decision was *not* to implement. The rationale is recorded in the Epic body. Kept as history; rejections teach the next reviewer what we already considered and discarded. | Terminal. |

Lifecycle diagram:

```
Draft  ──operator review──▶  Accepted  ──Maya files issues──▶  In-progress  ──ship & deploy──▶  Implemented (terminal)
   │                            │                                  │
   └─── at any of these points, the decision can flip to ──▶  Rejected (terminal)
```

## Maya's role + the dev process

Maya is the **dedicated PM** for Epics. The full seven-phase loop she coordinates (Epic authoring → Story implementation → reviewer routing → revise → verdict → operator merge) is the canonical workforce dev process — see [runbooks/dev-process.md](../runbooks/dev-process.md). Highlights relevant to this file:

- Maya owns Phase A (Epic → Story decomposition) — she enforces the **scenario walkthrough**, the **cost-pushback rule**, and **defer-with-name vs silent-drop**.
- Maya owns Phases C + F (PR routing + verdict).
- Maya **never implements** and **never merges** (W-5).

`Draft` Epics are not yet hers to act on — operator approval moves an Epic to `Accepted`, after which Maya can file Story issues.

## Epic format

A new Epic is `epic-NNN-<kebab-case-slug>.md`, where `NNN` is the next zero-padded number. Required headers:

```
# Epic-NNN — <title>

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

**The "Behaviour at N = 100+ agents" section is mandatory** for any Epic that touches the agent set — search, profile, org chart, skill catalog, scheduling, budgets, etc. Workforce growth is the planned axis of change; no Epic ships without thinking it through.

When the Status line flips, add a parenthetical date so the audit trail is one click away:

```
- **Status**: Implemented (2026-05-30)
- **Implemented by**: #34, #36
```

## Index

| # | Title | Status | Owner |
|---|---|---|---|
| [001](epic-001-agent-search.md) | Agent search | Rejected (superseded by 014) | Maya |
| [002](epic-002-agent-profile.md) | Agent profile page (LinkedIn-style) | Implemented | Maya |
| [003](epic-003-org-chart.md) | Org chart (MS Teams-style) | Implemented | Maya |
| [004](epic-004-skill-catalog.md) | Skill catalog + utilization | Implemented | Maya |
| [005](epic-005-agent-authored-article-pipeline.md) | Agent-authored L0→L1 article pipeline | Rejected (superseded by article-level2/3) | Maya |
| [006](epic-006-scalability.md) | Workforce scalability to 100+ agents | Rejected (obsoleted; S6 open) | Maya |
| [007](epic-007-agent-management-api.md) | Agent management surface (DDB + CRUD API, SAM, nodejs24.x) | Rejected (superseded by ADR-0007) | Maya |
| [008](epic-008-skill-repository.md) | Skill repository as the execution unit | Implemented | Maya |
| [009](epic-009-vp-tier-and-functional-expansion.md) | VP tier and functional expansion (7 new agents) | Implemented | Maya |
| [010](epic-010-project-trust-boundary.md) | Project as trust boundary: credentials, executions, agent memory | In-progress | Maya |
| [011](epic-011-agent-feed.md) | Workforce activity feed (LinkedIn-style) | Implemented | Maya |
| [012](epic-012-agent-experience.md) | Agent experience: recall, long-term memory, clean activity record | In-progress | Maya |
| [013](epic-013-talent-messaging.md) | Talent-to-talent messaging | Implemented | Maya |
| [014](epic-014-global-nav-search.md) | Global nav search (talent + skills) | Implemented | nadia |
| [015](epic-015-daily-research-cadence.md) | daily-research: one generic research cadence across personas | Implemented | sana |
| [016](epic-016-workforce-performance-analytics.md) | Workforce performance analytics (per-project + cross-project) | In-progress | nadia |
| [017](epic-017-podcast-spotify-distribution.md) | Podcast production & Spotify distribution from analysis articles | Implemented (2026-06-29) | Maya |

The index is also the **canonical status view** — keep it in sync when a Status line in an individual Epic flips. A CI check that asserts table-vs-file consistency is on the backlog (see `workforce/scripts/validate-epic-index.mjs`, forthcoming).

> **Status reconciliation pass (2026-06-23).** The whole index was reconciled against the live codebase + development history by Mateo (platform/substrate), Dario (eng-excellence/pipeline), and Nadia (PM/console), pulling in Theo for the feed/messaging surfaces. Most Epics carried a stale `Draft` while the work had already shipped (often incidentally, out of the normal lifecycle), and two early designs (006, 007) were obsoleted by ADR-0007 before they were ever Accepted. Each Epic body now carries a dated **Status reconciliation** note explaining its bucket. Net: 7 Implemented, 2 In-progress, 4 Rejected/superseded, plus 008/014/016 advanced. Remaining genuine open work — Epic-006 S6 (slug `-NNN` disambiguation), Epic-010 (a)/(d) DoD gates, Epic-012 runner-injection, Epic-016 Phase-2 `sam deploy` — is called out in those bodies.

> **Daily reconciliation (2026-06-30, Nadia).** No new status flips — every Epic line is still true against `main`, and the genuinely-open DoD gates flagged on 06-23 have **not** closed (Epic-010 (a)/(d): `project.ts:690` still falls back to legacy `wf/${type}` and `migrate-credentials` is still a copier not a deleter; Epic-012: `buildRecallBlock` still wired only into `messaging-reply`, not the runner; Epic-016: OP-011/OP-012 still `open` in `follow-ups.md`; Epic-006 S6: `validate-naming.mjs` slug regex still `/^[a-z]+$/`). The **drift this run found is in the issue tracker, not the docs**: Implemented epics (011/013/014) and shipped Epic-010/017 stories still carry open Story/tracker issues. That issue diff (≈16 close, 1 relabel — #93 superseded by #212) is proposed for operator sign-off in the PR that carries this note; outward bulk closes are operator-gated and were **not** applied autonomously.

## Epic sizing guidance

An Epic is **"a user-meaningful outcome unit that's bigger than a single sprint can finish"**. The unit sits between Story (1–5 days) and Initiative / Theme (quarter+):

| Unit | Period | Content |
|---|---:|---|
| Task | hours — 2d | implementation step |
| Story | 1–5d | one slice of user value |
| **Epic** | **2 weeks — 2 months** | **multiple Stories bundled around one user / business outcome** |
| Initiative / Theme | quarter+ | product-level direction |

An Epic should be **decomposable into multiple Stories**. If it's only one Story, it shouldn't be an Epic.

### Good Epic shapes

- **Feature Epic** — customer-value-anchored: user management, billing, device management, notifications, dashboards, reports
- **Workflow Epic** — covers a business process end-to-end, not one screen: customer onboarding, plan change, field installation, incident response, monthly reporting
- **Platform Epic** — necessary but not directly user-visible. Auth, audit logging, multi-tenancy, external-API gateway, data pipeline, RBAC, security/compliance. **Even platform Epics state the user goal in plain language** (good: "multi-tenant users can sign in safely and only see what their role permits"; bad: "build an auth platform").

### What an Epic looks like, written down

```text
Epic名: <user-facing name in plain language>
目的:   <why the user / operator cares>
対象ユーザー: <named persona — not "everyone">
含む範囲:  <bulleted list of what's in>
含まない範囲: <bulleted list of what's deliberately out>
完了条件: <observable acceptance criteria>
```

### Don't make an Epic when …

- it's only a technical task with no user-visible value behind it
- the scope is so broad you can't see the end
- you'd phrase it as "platform improvement" (always too abstract)
- it's only one Story long
- it reads as a task list rather than an outcome

### Story / Task relationship

- **Epic : Story** is **M:N** — one Story can serve multiple Epics (e.g. "auth helpers" used by both `user-onboarding` and `admin-tooling` Epics).
- **Issue : PR** is **1:M**, typically **1:1**. Claude Code may split a Story into multiple PRs if it judges the work too large for a single review.
- **Stories live as GitHub issues**. Epics live in this directory.

## Why Epics, not just issues

Agents at this scale are an *organisation*, and an organisation changes shape under pressure. An issue describes one piece of work. An Epic describes the **decision** that the work expresses — what problem we noticed, what alternatives we considered, what we expect to be true after it ships, and what would tell us we were wrong.

Skipping the Epic step means the next reviewer (or the next agent generation) sees a merged PR with no decision context. The Epic is what survives migrations of personnel, models, and providers.
