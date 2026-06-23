# Epic-014 — Global nav search (talent + skills)

- **Status**: Implemented (2026-06-23)
- **Owner**: nadia
- **Created**: 2026-06-15
- **Implemented by**: #320. Live surface: `workforce/app/src/lib/search.ts`, `pages/SearchResults.tsx`, `components/GlobalSearch.tsx` (mounted in `GlobalNav`).

> **Status reconciliation (2026-06-23, Nadia).** Flipped In-progress → Implemented: the sole tracked PR (#320) is merged — the shared `lib/search` ranking module (unit-tested), the `/search` page, and the `GlobalNav` typeahead are all live with every acceptance criterion checked. Only the status line lagged one step.

## Problem

Every workforce console page renders the LinkedIn-style `GlobalNav` with a
search box reading **"Search talent, skills…"** — but the box is a
non-functional placeholder. Submitting it threw the query away and bounced
the operator to `/agents`; the input value was never read. The two things
the placeholder promises to find — **talent** (agents) and **skills** — are
exactly the two things it could not find.

The directory pages (`/agents`, `/skills`) each grew their own private
`.filter()` search, so the operator *can* search, but only after navigating
into the right directory first and only within that one entity type. There
is no single "I know roughly what I'm looking for, find it" entry point —
the one a network-shaped IA leads every user to expect in the top bar.

This is the practical, header-level instantiation of the search need that
Epic-001 (agent search) and Epic-004 (skill catalog) each scoped for their
own directory. Those Epics remain `Draft`; this Epic does **not** supersede
them — it delivers the cross-entity *global* box they both assumed would
exist, and reuses the client-side-filter-over-manifest decision Epic-001
§"Proposed solution" already settled (no OpenSearch at v1).

## Proposed solution

One shared ranking module, two surfaces, zero new backend:

1. **`lib/search.ts`** — pure `searchAgents()` / `searchSkills()` returning
   ranked hits with a `matchedOn` field (why each row matched). Tiered
   substring match (exact → prefix → word-prefix → substring) weighted by
   field importance (identity > role/owner > prose). Deterministic
   tie-break by slug/name. Unit-tested without React.
2. **`/search?q=…` page** (`SearchResults.tsx`) — the "see all" surface:
   Talent section + Skills section, each ranked, with per-row match-reason
   chips and explicit no-results copy that names refinements.
3. **`GlobalNav` typeahead** (`GlobalSearch.tsx`) — a combobox that shows
   the top-5 talent + top-5 skill hits live as you type; Enter (or "See all
   results") routes to `/search`; clicking a row jumps straight to that
   agent/skill. Keyboard: ArrowUp/Down to move, Enter to select, Escape to
   close; ARIA `combobox`/`listbox`/`option` + `aria-activedescendant`.

Data comes from the existing cached loaders (`loadWorkforceManifest`,
`loadWorkforceSkillManifest`) — the live agents-api roster (ADR-0008 §7) and
the static skill manifest. The dropdown lazy-loads both on first focus, so
pages the operator never searches from pay nothing.

## Behaviour at N = 100+ agents

- **Match cost.** A linear scan over agents + skills per keystroke is
  O(N·fields). At N = 100 agents + ~30 skills that is a few thousand cheap
  string ops per keystroke — well under one frame. This matches Epic-001's
  "linear `Array.filter` is fine at v1" call.
- **Cut-over trigger.** Add a build-time inverted index (token → ids) when
  N > ~200 *or* a measured keystroke latency > 50 ms, per the same
  threshold Epic-001 set. The shared `lib/search` boundary means that
  swap touches one module, not both surfaces.
- **Dropdown bound.** The typeahead is capped at 5 per group regardless of
  N, so the popup never grows unbounded; the `/search` page shows the full
  ranked list. Ranking (not truncation) is what keeps the top-5 useful as N
  grows — a recency/seniority boost is the named follow-up if "engineer"-
  style queries return too flat a top-5 (FU, see Open questions Q2).
- **Archived agents.** The roster manifest does not currently carry an
  `archived` flag (it lives in the stats feed), so archived personas are
  presently searchable. Filtering them out is deferred (Q1) — not silently;
  it is named here.

## Acceptance criteria

- [x] `/search?q=ren` ranks the Ren persona first; `/search?q=engineer`
  returns every agent whose role contains "Engineer".
- [x] `/search?q=pr-` surfaces both `pr-review` and `pr-autopilot`;
  `/search?q=<owner-slug>` surfaces the skills that owner owns.
- [x] The `GlobalNav` box shows a live typeahead (talent + skills) and
  Enter routes to `/search?q=…`; clicking a row navigates to the entity.
- [x] A blank/no-match state explains how to refine (name / role / city /
  skill / owner) rather than rendering empty or dumping the full roster.
- [x] The ranking is deterministic and unit-tested (`lib/search.test.ts`).
- [x] Keyboard accessible: Arrow/Enter/Escape; ARIA combobox semantics.

## Open questions

- **Q1.** Should archived agents appear in global results? Default: no, once
  the manifest carries the flag. Deferred to the archived-flag follow-up.
- **Q2.** Ranking boost (recency / org-depth) for flat role queries — defer
  until "engineer"-style top-5s prove too flat in practice.
- **Q3.** Mobile (< `sm`) has no nav search (parity with the prior
  placeholder, which was also `hidden sm:flex`). A mobile search affordance
  is a named follow-up, not part of this Epic.

## Out of scope

- Backend search endpoint / inverted index (client-side filter at v1, per
  Epic-001).
- Search over projects, deliverables, feed posts, or article bodies — each
  is its own entity-search Epic.
- Semantic / embedding search.
- A mobile (< `sm`) search affordance (Q3 follow-up).
