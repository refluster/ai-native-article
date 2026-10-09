# Skill registry — status vs usage reconciliation (2026-10-09)

- **Status**: Record (L3). It changes no `status`; every flip it names is a separate, operator-signed PR.
- **Issue**: #770 (`Refs`, not `Closes` — the standing-entry question below is the operator's).
- **Deadline**: the issue cites an external agent-registry cutover on 2026-10-17. Its only source is a persona letter (#666) and was marked unverified at routing, so treat the date as advisory.
- **Evidence read**: `GET /skills` (56 rows) and `GET /agents` (58 agents, every `bindings[]`) on 2026-10-09, plus `workforce/skills/*/meta.json` in the clone. Usage is `invocations_this_month` and `last_invoked_at` as served by the API (the #767 / PR #775 counter).

## Decision, in one line

No `status` changes today. 34 of the 56 rows were invoked this month and stay `active`; 19 rows are unbound with no invocation in the last 30 days (18 flip candidates plus `pdm-charter`, already `stale`); a few of those need a fact the API cannot show before anyone flips them (section D).

## What the inventory found

The issue says 43 skills. The live registry has **56 rows** (55 `active`, 1 `stale`). 43 have a bundle in `workforce/skills/`; **13 are DDB-only** (no bundle in git): `article-draft`, `dependabot-triage`, `discord-ping`, `feed-health`, `market-research`, `pdm-decompose`, `plan-write`, `podcast-cast`, `podcast-rss`, `podcast-shownotes`, `podcast-synthesize`, `pr-review`, `pr-route`. Under ADR-0008 the DDB row is the runtime body, so a missing bundle is not itself a defect; it does mean those 13 have no `meta.json` for the ADR-0017/0018 gate to bump, and the inventory the issue describes (a pass over `workforce/skills/*`) could never have reached them.

### A. In use — keep `active` (34 rows invoked this month)

32 are bound to an agent and invoked this month, for example `daily-research` (577), `feed-post` (430), `pr-autopilot` (80), `article-level2` and `article-level3` (32 each), `issue-implement` (22), `issue-triage` (13), `backlog-reconcile` (11). No action.

Two are invoked **without any binding**: `pr-review` (28 this month, last 2026-10-09) and `pr-route` (3, last 2026-10-05). The agent records carry no binding for either, and CLAUDE.md records that the separate `pr-review` skill was retired into `pr-autopilot`. The most likely source is engagements recorded by hand against those skill names (the outsource-to-workforce flow); that is an inference, not something the API shows. They are not `stale` by usage, and they are not honest `active` rows either. Open question for the operator, below.

### B. Bound, quiet — keep `active`

`legal-amendment-review-committee` is bound (`maya`) with 0 invocations this month and last run 2026-06-19. It is an event-driven committee, so a quiet month is its normal state. Keep.

### C. Unbound, no invocation in 30+ days — `stale` candidates (19 rows, 18 flips)

Rule used: not named in any agent's `bindings[]`, and `last_invoked_at` either absent or before 2026-09-09. "Zero this month" alone is not used: the month is nine days old.

| Skill | Bundle in git | Last invoked | Note |
|---|---|---|---|
| `article-draft` | no | never | 21 listed owners, no binding |
| `budget-runway-review` | yes | never | owner `silas` |
| `code-task-brief` | yes | 2026-06-16 | superseded by `issue-implement` for code work |
| `dependabot-triage` | no | never | |
| `discord-heartbeat` | yes | 2026-07-04 | |
| `discord-ping` | no | 2026-06-06 | |
| `feed-health` | no | never | |
| `hypothesis` | yes | never | |
| `market-research` | no | never | |
| `pdm-decompose` | no | never | |
| `performance-refresh` | yes | never | a console workflow of the same name is failing (#798); the skill is not what runs |
| `plan-write` | no | never | |
| `podcast-cast` | no | never | |
| `podcast-rss` | no | never | #385 (RSS + Spotify) is open |
| `podcast-shownotes` | no | never | |
| `podcast-synthesize` | no | never | |
| `positioning-write` | yes | never | |
| `record-engagement` | yes | 2026-06-16 | see D |
| `pdm-charter` | yes | never | already `stale`; no change |

### D. Needs a fact before any flip

- `record-engagement`: the runner's step 8 now writes engagements through `POST /agents/{slug}/engagements`, which may make the skill redundant, or may be what the skill documents. Whoever owns `sana`'s registry should say which.
- `podcast-rss` and the other podcast rows: #385 and #673 mean the podcast surface is being rebuilt; flipping rows the new Cadence might reuse is premature.
- `regulatory-situation-report`: unbound today but PR #814 merged the wire script that binds it (`tessa`); it is **not** a candidate. Excluded from C.
- `research-study` (unbound, last 2026-09-20) is fired from sessions, not bindings. An unbound row is not evidence of disuse for them. Excluded from C.

## Alternatives considered

- **Flip the 19 now.** Rejected: ADR-0041 (`retired_at` marker) and ADR-0042 (removal-date rule) are Proposed and unimplemented, so `stale` has no mechanical consequence yet and no removal date; a flip is a claim with nothing downstream, and a wrong one is harder to notice than a missing one.
- **Count by `invocations_this_month` only.** Rejected: nine days of data.
- **Inventory only the 43 bundles.** Rejected: it would skip the 13 rows most likely to be dead.

## What this costs and how it reverses

Nothing changes at runtime. Reversal is deleting this file. The cost is that the 19 rows stay `active` in the list until the operator signs the flip PR.

## For the operator (signatures, not investigation)

1. Sign a flip PR for the C rows after removing any you want to keep (D lists the ones to check first), or say which are kept.
2. Decide whether this reconciliation becomes a standing entry (monthly, from `skill-maturity-report`) or stays one-off. This record recommends standing, because the 13 DDB-only rows were invisible to a pass over `workforce/skills/*`.
3. Decide what `pr-review` and `pr-route` are: archive the rows (adr-0017 soft delete) or bind them.

## Out of scope

`meta.json` / DDB status flips; archiving; the ADR-0041 and ADR-0042 implementations; any binding change.
