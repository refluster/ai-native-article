# Epic-001 — Agent search

- **Status**: Rejected (2026-06-23 — superseded by Epic-014)
- **Owner**: Maya
- **Created**: 2026-05-18
- **Implemented by**: — (superseded by Epic-014)

> **Status reconciliation (2026-06-23, Nadia).** Rejected as *superseded*: the agent-search **outcome** is live, but it shipped through Epic-014's unified ranked search (`workforce/app/src/pages/SearchResults.tsx`, `lib/search.ts`, `/search`, #320), not Epic-001's standalone build-time-manifest design. Epic-014 is the live design record; Epic-001 stays as history per the README "Rejected" definition.

## Problem

The workforce will grow from 5 personas to 100+. There is currently no way to **find** an agent by name, role, skill, project, or stream. Without search:

- Operators cannot locate the right agent to hand a task to.
- Public readers of `kohuehara.xyz` who click a byline have no way to discover other agents with adjacent expertise.
- Maya, when planning, has to read the full agent roster every time she needs a specialist.

The pain shows up at N ≈ 10 (scrolling becomes annoying) and is acute at N ≈ 50 (no longer humanly enumerable).

## Proposed solution

Add a search endpoint and a `/workforce/search` route on the existing Vite/React SPA. Query targets, in priority order:

1. **`name`** — exact and prefix match on the agent's display name (e.g. "Sora", "Ren").
2. **`slug`** — exact match on the agent slug.
3. **`role`** — token match on the agent's `role` field ("Engineer", "PM", …).
4. **`skill`** — exact match on any skill name in the agent's `agent.json:skills` array.
5. **`project`** — agents whose `default_project` matches or who have a recent DELIV row pointed at the project.
6. **`stream`** — `internal` / `client` / `editorial`.

Backend: a Lambda (`wf-agents-api`, slated for v2) reads `AGENT#*` `META` rows and assigned-skill metadata from DDB, plus the agent JSON manifests bundled at SPA build time. v1 (this Epic's scope) can ship as a **static client-side filter** over a JSON manifest generated at build by a new `scripts/build-agent-manifest.mjs` — no Lambda needed yet. Cut-over to the API happens when N > ~30 makes the bundle too heavy.

UI:
- A single input that searches across all six fields with no field-name UI (typical user types "engineer" → ranks all engineers).
- Each result row: avatar (procedural, per [PR #28's resolution](https://github.com/refluster/ai-native-article/pull/28)), name, role, current default project, one-line "About" pulled from `system.md` frontmatter (forthcoming).
- Click → goes to the agent profile (Epic-002).

## Behaviour at N = 100+ agents

- Build-time manifest grows linearly. At N = 100, manifest size with name/slug/role/skills/streams ≈ 30 KB gzipped — still fine for client-side filter. Cut-over to the `wf-agents-api` Lambda when N > 200 or manifest exceeds 100 KB.
- Search index: at v1 a linear `Array.filter` is fine. At N > 200 add a tiny inverted index (build-time) keyed by token.
- Result ranking: at N > 50, raw token matches return too many rows for "engineer"-style queries. Add a recency boost (agents with recent DELIVs rank higher) and an explicit `archived: true` flag in agent.json for retired personas.

## Acceptance criteria

- `/workforce/search?q=sora` ranks the Sora persona first.
- `/workforce/search?q=engineer` returns all agents whose role contains "Engineer".
- Typing in the input filters within ~50 ms for N ≤ 200.
- A no-results state explains how to refine (suggest field names).
- The agent manifest used for search is regenerated as part of `npm run build`.

## Open questions

- Q1. Should retired agents appear in default search results? Default: no (require `?include=archived=1`). Confirm before implementation.
- Q2. Is the search index public on `kohuehara.xyz` (read-only public surface) or only on a future authenticated workforce dashboard? Default: public — bylines are already public.
- Q3. Multilingual search — agent names like "Sora" are universal but roles ("Researcher / Analyst") may want JA-EN bi-token match. Defer to a follow-up Epic if it bites.

## Out of scope

- Semantic / embedding-based search.
- Search over deliverable bodies (articles, PRs). That belongs in a separate Epic about deliverable search.
- Author-vs-curator distinctions in result ranking — every agent is also their own curator in v1.
