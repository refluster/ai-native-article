# Epic-004 — Skill catalog + utilization

- **Status**: Implemented (2026-06-23)
- **Owner**: Maya
- **Created**: 2026-05-18
- **Implemented by**: present at repo import (`65d7848`); #332 (live `GET /skills`, ADR-0008). Live surface: `workforce/app/src/pages/SkillDirectory.tsx` + `SkillProfile.tsx`.

> **Status reconciliation (2026-06-23, Nadia).** Flipped Draft → Implemented: the skill catalog index and per-skill detail read live from `GET /skills` / `GET /skills/{name}` with status filters, owner chips, and search. The only not-fully-live piece is invocation-history counts, which the Epic itself scoped as "populated once the runner lands."

## Problem

Skills (`workforce/skills/{name}/SKILL.md`) are the reusable instructions that drive agent behaviour. As the catalog grows from ~7 v1 skills (`market-research`, `article-draft`, `notion-publish`, …) to dozens, there is no surface for:

- **Browsing** what skills exist and what they do.
- **Discovering** which agents own which skills (and conversely, which agents are *not yet equipped* with a skill that would help them).
- **Monitoring utilization** — is a skill actually called, or is it dead weight in `agent.json:skills`?

Without this, skills rot. A skill that never fires teaches no one anything, and a skill that fires constantly but is never reviewed accumulates bad habits.

## Proposed solution

Two routes on the existing SPA:

### `/workforce/skills` — catalog index

A grid of cards, one per skill. Each card:

- Skill name + one-line description (pulled from the SKILL.md frontmatter).
- Owner agents (list of avatars + names with links to Epic-002 profiles).
- Last 30 days: invocation count, success/throw counts.
- Created date / Last bumped date (the SKILL.md prompt-version-bump history).

Filters in the toolbar:

- By owner agent.
- By stream (`internal` / `client` / `editorial` — derived from owner agents).
- By status (`active` / `stale` / `deprecated`).

### `/workforce/skills/{name}` — skill detail

For a single skill:

- The full SKILL.md body, rendered.
- Invocation timeline (DDB query: `DELIV#…` rows whose underlying RUN used this skill).
- Owner agents.
- Last 5 invocations: agent, task, status, link.
- "Bump history" — links to PRs that have ever changed the SKILL.md prompt body.

## Behaviour at N = 100+ agents (and N_skills = 50+)

- The catalog index at N_skills = 50+ wants a search input — but search across `workforce/skills/` is a small filter on a build-time JSON manifest, no separate index needed.
- The "owner agents" chip list per skill grows linearly. At N = 100 agents and 50% skill-overlap, ~50 chips per popular skill = visual clutter; clamp to first 5 with "+ N more".
- Invocation count requires DDB queries; pre-compute a daily roll-up row (`SKILL#{name}/DAILY#{yyyy-mm-dd}`) so the index doesn't fan out to thousands of `DELIV#…` reads per page.
- A `status` field on the SKILL.md frontmatter (`active` / `stale` / `deprecated`) lets operators retire skills without deleting them. Stale skills hide by default; clicking the filter chip reveals them.

## Acceptance criteria

- `/workforce/skills` lists all skills in `workforce/skills/`.
- Each card's "owner agents" matches the union of `agent.json:skills` references across all agents.
- A skill that no agent owns appears in a separate "Unassigned" section so operators notice.
- `/workforce/skills/{name}` renders the SKILL.md body and the invocation timeline (empty initially, populated once the runner lands).
- The skill catalog is searchable from the global agent search (Epic-001) by skill name.

## Open questions

- Q1. Should the SKILL.md frontmatter gain a `status` field now, or wait until the first skill goes stale? Default: add it now with default `active`, no migration cost.
- Q2. Should an agent's `agent.json:skills` list be a strict subset of `workforce/skills/`, or can it reference an external skill? Default: strict subset (validated by `validate-agent-json.mjs` — already enforced by name matching).
- Q3. How is a skill "deprecated" — by SKILL.md frontmatter only, or by removing it from every agent's `skills[]` first? Default: status flip first, removal in a follow-up cleanup PR.

## Out of scope

- A skill marketplace / fork-and-modify UX. Skills are repo-internal artefacts.
- Inter-skill dependencies (skill A imports skill B). The composition model is "agent + skill array + runtime"; no skill graph in v1.
- A/B testing of skill versions. The outer-loop leaderboard concept in `GROWTH.md` is article-side, not skill-side, in v1.
