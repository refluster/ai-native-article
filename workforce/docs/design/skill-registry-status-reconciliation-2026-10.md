# Skill registry — status vs usage reconciliation (2026-10-09)

- **Status**: Record (L3). It changes no `status`; every flip it names is a separate, operator-signed PR.
- **Issue**: #770 (`Refs`, not `Closes` — the standing-entry question below is the operator's).
- **Deadline**: the issue cites an external agent-registry cutover on 2026-10-17. Its only source is a persona letter (#666) and was marked unverified at routing, so treat the date as advisory.
- **Evidence read**: `GET /skills` (56 rows) and `GET /agents` (58 agents, every `bindings[]`) on 2026-10-09, plus `workforce/skills/*/meta.json` in the clone. Every count below is re-derivable: `node workforce/docs/design/skill-registry-status-reconciliation-2026-10.derive.mjs` reads the same two public endpoints and prints them (rows, agents, invoked-this-month, invoked-but-unbound, and the unbound-and-quiet list with owner counts). The API serves live data, so a later run moves; this record is a 2026-10-09 snapshot. Usage is `invocations_this_month` and `last_invoked_at` as served by the API (the #767 / PR #775 counter).

## Decision, in one line

No `status` changes today. 34 of the 56 rows were invoked this month and stay `active`; 19 rows are unbound with no invocation in the last 30 days (18 flip candidates plus `pdm-charter`, already `stale`); a few of those need a fact the API cannot show before anyone flips them (section D).

## What the inventory found

The issue says 43 skills. The live registry has **56 rows** (55 `active`, 1 `stale`). 43 have a bundle in `workforce/skills/`; **13 are DDB-only** (no bundle in git): `article-draft`, `dependabot-triage`, `discord-ping`, `feed-health`, `market-research`, `pdm-decompose`, `plan-write`, `podcast-cast`, `podcast-rss`, `podcast-shownotes`, `podcast-synthesize`, `pr-review`, `pr-route`. Under ADR-0008 the DDB row is the runtime body, so a missing bundle is not itself a defect; it does mean those 13 have no `meta.json` for the ADR-0017/0018 gate to bump, and the inventory the issue describes (a pass over `workforce/skills/*`) could never have reached them.

### A. In use — keep `active` (34 rows invoked this month)

32 are bound to an agent and invoked this month, for example `daily-research` (577), `feed-post` (430), `pr-autopilot` (80), `article-level2` and `article-level3` (32 each), `issue-implement` (22), `issue-triage` (13), `backlog-reconcile` (11). No action.

Two are invoked **without any binding**: `pr-review` (28 this month, last 2026-10-09) and `pr-route` (3, last 2026-10-05). The agent records carry no binding for either, and `workforce/skills/pr-autopilot/SKILL.md` (Scope paragraph) records that the former standalone `pr-review` skill was folded into `pr-autopilot`. (An earlier draft cited CLAUDE.md for this; it has no such statement. `pr-route` has no retirement record that I found, so its status is unknown, not retired.) The most likely source is engagements recorded by hand against those skill names (the outsource-to-workforce flow); that is an inference, not something the API shows. They are not `stale` by usage, and they are not honest `active` rows either. Open question for the operator, below.

### B. Bound, quiet — keep `active`

`legal-amendment-review-committee` is bound (`maya`) with 0 invocations this month and last run 2026-06-19. It is an event-driven committee, so a quiet month is its normal state. Keep.

### C. Unbound, no invocation in 30+ days — `stale` candidates (19 rows, 18 flips; see the check below for which are held)

Rule used: not named in any agent's `bindings[]`, and `last_invoked_at` either absent or before 2026-09-09. "Zero this month" alone is not used: the month is nine days old.

| Skill | Bundle in git | Last invoked | Note |
|---|---|---|---|
| `article-draft` | no | never | listed in `owners[]` of 21 agents (the registry's owners field, not a binding count); see D |
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
| `record-engagement` | yes | 2026-06-16 | counted in the 18; held pending D |
| `pdm-charter` | yes | never | already `stale`; no change |

### D. Needs a fact before any flip

- `article-draft`: DDB-only, never invoked, but 21 agents list it in `owners[]`. A quiet cadence could explain the missing binding rather than disuse, so it is held out of the first flip PR until `sana` (registry/skill ops, owner of `owners[]` accuracy) and `hana` (platform, bindings) say which. Not a flip candidate yet.
- `record-engagement`: the runner's step 8 now writes engagements through `POST /agents/{slug}/engagements`, which may make the skill redundant, or may be what the skill documents. Whoever owns `sana`'s registry should say which.
- `podcast-rss` and the other podcast rows: #385 and #673 mean the podcast surface is being rebuilt; flipping rows the new Cadence might reuse is premature.
- `regulatory-situation-report`: unbound today but PR #814 merged the wire script that binds it (`tessa`); it is **not** a candidate. Excluded from C.
- `research-study` (unbound, last 2026-09-20) is fired from sessions, not bindings. An unbound row is not evidence of disuse for them. Excluded from C.

### Per-candidate false-positive check (C)

The unbound-means-disuse rule already misfires for `research-study` (session-fired) and `regulatory-situation-report` (binding pending), so each C row was checked for evidence that something else drives it. Repo references (`grep` over `workforce/scripts`, `workforce/skills`, `.github`, `.claude`):

- **Wire scripts exist, binding not applied (or not yet visible in the API):** `budget-runway-review` (`wire-budget-runway-review-silas.mjs`), `hypothesis` (`wire-hypothesis-maya.mjs`), `performance-refresh` (`wire-performance-refresh-tomas.mjs`), `positioning-write` (`wire-positioning-write-yuki.mjs`). Same shape as `regulatory-situation-report`: not flip candidates until someone confirms the wire was or was not run. Held out of the flip PR.
- **Referenced by a live skill:** `pdm-decompose` (named in `pdm-charter/SKILL.md`), `dependabot-triage` (named in `pr-autopilot/SKILL.md` as folded in, so retirement evidence rather than use).
- **No repo reference found:** `podcast-cast`, `podcast-rss`, `podcast-shownotes`, `podcast-synthesize`, `market-research`, `feed-health`, `plan-write`, `discord-ping`, `discord-heartbeat`, `code-task-brief`. These stay candidates. This was a text search, not proof of disuse.

Net: of the 18 flips named in C, 4 are held by the wire-script finding and `article-draft` and `record-engagement` by D, leaving 12 for the first flip PR. `research-study` is not in C by the rule itself (last invoked 2026-09-20, inside the window), so the exclusion note under D is a belt-and-braces reminder, not a filter.

## Alternatives considered

- **Flip the 19 now.** Rejected: ADR-0041 (`retired_at` marker) and ADR-0042 (removal-date rule) are Proposed and unimplemented, so `stale` has no mechanical consequence yet and no removal date; a flip is a claim with nothing downstream, and a wrong one is harder to notice than a missing one.
- **Count by `invocations_this_month` only.** Rejected: nine days of data.
- **Inventory only the 43 bundles.** Rejected: it would skip the 13 rows most likely to be dead.

## What this costs and how it reverses

Nothing changes at runtime. Reversal is deleting this file. The cost is that the 19 rows stay `active` in the list until the operator signs the flip PR.

## For the operator (signatures, not investigation)

Three independent decisions; answer each separately, and each becomes its own follow-up issue/PR once ruled (this record opens none, since the author lane does not file them).

1. **Flip PR.** Sign a flip PR for the 12 rows cleared in the check above, after removing any you want to keep. The 6 held rows wait on D and the wire-script check.
2. **Standing or one-off.** Recommend a standing monthly check, but as a mechanical script, not an agent run: the derive script above does a deterministic `GET /skills` + `GET /agents` diff in two HTTP calls and no model tokens, so its cost is effectively zero against the W-3 ledger. It would make a wrong verdict reproducible rather than re-argued each month. The reason to make it standing is that the 13 DDB-only rows were invisible to a pass over `workforce/skills/*`.
3. **`pr-review` and `pr-route`.** Archive the rows (adr-0017 soft delete) or bind them. `pr-review` has retirement evidence (above); `pr-route` does not.

## Out of scope

`meta.json` / DDB status flips; archiving; the ADR-0041 and ADR-0042 implementations; any binding change.
