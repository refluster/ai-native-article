# `prompt_version` on the GA4 reader events — design note

- **Status**: Proposed (draft PR for #572; `issue-design`). A design note, not an ADR: it settles
  *how* a claim the statute already makes (GROWTH.md §2/§5) becomes true, and which value the key
  carries. The one L1 edit it proposes (GROWTH.md:205) is written out as a diff below for the
  operator to apply or reject; it is **not** made in this PR.
- **Implements nothing.** The implementation is the slice list at the end.

## Decision

Wire `prompt_version` end to end, and define it as **`<skill>@<meta.json version>` of the cadence
that generated the article** (for example `article-level3@0.3.0`), written once at publish time and
carried Notion property → `fetch-notion` → frontmatter/manifest → the two GA4 events. Until the
last slice ships, GROWTH.md:205 must stop saying the wiring exists.

## What forced it

- **The claim is false at every link, not only the last one.** #572 reports 0 hits for
  `prompt_version` in `packages/shared/src/analytics.ts` and `newsletter/app/src/lib/`. Re-checked
  against `main` (2026-10-07), the chain GROWTH.md describes has five links and none exists:
  1. the cadences' `publish-notion.mjs` write only `Title`, `Author`, `Type`, `Status`, `Date`,
     `SourceURLs`, `Abstract`, `Category`, `Tags`; no `Prompt Version` / `Judge Score` property
     (GROWTH.md "Notion — add properties" says they do);
  2. `newsletter/pipeline/fetchers/notion.mjs` reads `Abstract`, `Author`, source URLs and tags,
     never a prompt version;
  3. `newsletter/pipeline/writers/posts-md.mjs` writes no `promptVersion` frontmatter or manifest
     key (the live `manifest.json` has 0 occurrences);
  4. `ArticleMeta` (`newsletter/app/src/types/article.ts`) has no such field, and the
     `AnalyticsEvent` union types neither event with it;
  5. the GA4 custom dimension is operator console work that nothing records as done.
- **The value the doc describes does not exist.** GROWTH.md:73 defines `prompt_version` as the
  *winning candidate's generator*, e.g. `l3-claude-pattern-2026-04-23a`. That presumes the
  multi-candidate panel. `newsletter/app/src/types/quality.ts` is a spec nothing imports (root
  CLAUDE.md, "Known stale spots"), and GROWTH.md:250 itself says there is now a single generation
  path per level. A reader-side key cannot be wired to a generator id nobody computes.
- **A workforce cadence already assumes the bucketing works.** `reader-signal`
  (`workforce/skills/reader-signal/SKILL.md`, lines 3, 20, 47, 56) reads `promptVersion` from the
  manifest and compares across prompt versions; with the key absent from the corpus it can only say
  the data is not flowing. (`org-metrics-pulse` only names prompt-version performance as
  `reader-signal`'s lane, line 106; `editorial-desk` makes no such comparison.)
- **Scope of the miss.** Every `article_view` / `article_read_complete` event since the site
  launched carries no version. Those cannot be backfilled in GA4; only events after the wiring
  can be bucketed.

## Design

1. **Value.** `<skill>@<version>` from the skill bundle's `meta.json` at publish time, e.g.
   `article-level2@0.4.1`. This is the discipline GROWTH.md:250 already asks for ("bump when a
   skill body changes"), and the ADR-0017/0018 gate already forces a `meta.json` version bump on
   every `SKILL.md` body edit, so the key changes exactly when the prompt does, with no new human
   step. If the panel (`quality.ts`) is later implemented, the value becomes the chosen
   candidate's `systemPromptVersion`; the property name and the GA4 dimension stay the same.
2. **Notion.** One new rich_text property, `Prompt Version`, on the unified Articles DB. Both
   `publish-notion.mjs` scripts set it (the script already knows its own bundle). `Judge Score` is
   a separate decision and is out of scope here.
3. **Export.** `fetchers/notion.mjs` reads `Prompt Version`; `posts-md.mjs` writes
   `promptVersion` to frontmatter and the manifest only when non-empty (older rows omit it, as
   `author` does today). `ArticleMeta` gains `promptVersion?: string`.
4. **Events.** `article_view`, `article_read_25/50/75/90` and `article_read_complete` all gain
   `prompt_version: string` in the `AnalyticsEvent` union, **required**, not optional. Optional
   would let a call site drop it and still typecheck; required makes the union the guard. The
   value is the article's version; `'unversioned'` for a legacy article (published before the
   wiring); `'missing'` for an article published after the wiring whose `promptVersion` is empty
   (a dropped link, the failure the Reversal section tells the first verification to look for).
   The depth events are included so engagement depth can be bucketed too; leaving them out would
   make "read 50%" unanalysable by version. `Article.tsx` already holds the meta (`m`) at
   `article_view` and a `categoryRef` for the milestone events; a sibling ref carries the version.
5. **GA4 console.** Register `prompt_version` as an **event-scoped** custom dimension. GROWTH.md:205
   says "user-scoped"; that looks wrong for a per-article event parameter, because a user-scoped
   dimension attributes one value to a user across events, and a reader who opens two articles
   would be bucketed under whichever was set last. The operator confirms in the GA4 admin UI.
   The dimension only collects from the day it is registered, so register it **before or with**
   slice 3 ships; record that date in this note as the start of the analysable window (events
   sent earlier are not recoverable into the dimension).
6. **Interim truth.** Until slice 3 (below) merges, GROWTH.md:205 should read as target state. The
   edit is offered in two steps in the next section, so the retraction can land without
   pre-committing the value.

### Proposed GROWTH.md edits (L1; for the operator, not in this PR)

**Step 1, interim retraction** (can merge first; commits to no value):

```diff
-Register `prompt_version` as a user-scoped custom dimension in the GA4 property. The [analytics lib](../../packages/shared/src/analytics.ts) then passes it on `article_view` and `article_read_complete`. Outer-loop reports group by `prompt_version`.
+Register `prompt_version` as an **event-scoped** custom dimension in the GA4 property. **Status: not yet wired** (see workforce/docs/design/prompt-version-ga4-bucketing.md, #572); nothing sends `prompt_version` today.
```

**Step 2, value definition** (applies when slice 3 merges):

```diff
-**Status: not yet wired** (see workforce/docs/design/prompt-version-ga4-bucketing.md, #572); nothing sends `prompt_version` today.
+The [analytics lib](../../packages/shared/src/analytics.ts) passes it on `article_view`, `article_read_25/50/75/90` and `article_read_complete`, with value `<skill>@<meta.json version>` of the generating cadence (`unversioned` for articles published before the wiring). Outer-loop reports group by `prompt_version`.
```

The same edit should mark the other panel-era places as such: GROWTH.md:58 (generator panel with
distinct `systemPromptVersion`s), :67 and :73 (GA4 "bucketed by prompt_version", where
`prompt_version` is "the winning candidate's generator", e.g. `l3-claude-pattern-2026-04-23a`),
:180 (`generator: { id, model, systemPromptVersion }`), :304 (leaderboard bucketed by the winning
candidate's `systemPromptVersion`), and AGENTS.md rule 11 (attribution by
`generator.systemPromptVersion`). The diffs are left to whoever applies this.

## Alternatives rejected

- **Retract the GROWTH.md claim and leave bucketing unbuilt** (the issue's option b). Rejected as
  the end state: the quality layer's outer loop is the reason the rubric/roster machinery exists,
  and a loop with no key cannot close. Kept as the **interim** wording, which is the cheap
  half of this proposal and can merge first.
- **Wire the panel's `systemPromptVersion` as GROWTH.md describes.** Rejected for now: it needs
  the multi-candidate generator to exist (`quality.ts` is unimported), so the slice would block on
  Zone A rubric/roster work. The skill version is available today and is upgradeable in place.
- **A hand-maintained prompt-version string in each skill body.** Rejected: a second version
  number that someone must remember to bump is exactly the drift GROWTH.md:250 warns about;
  `meta.json` is already gate-enforced.
- **Derive the version at build time from git history of the skill.** Rejected: the live
  `SKILL.md` body is DDB-authoritative (ADR-0008), so git history can lag the prompt that actually
  ran.
- **Send only on `article_view`.** Rejected: engagement (`article_read_complete`) is the signal the
  loop optimises, so both events carry it (the issue's own ask).

## Cost

- Four small code slices across four surfaces (two cadence scripts, the pipeline, the SPA) and one
  console step. The two `publish-notion.mjs` edits are in Zone A skill bundles (version bump and a
  matching `PATCH /skills/{name}` per ADR-0017/0018), so they need the operator's merge.
- A new Notion property must exist before the cadences write it; a write to a missing property
  fails the Notion call. Slice 1 therefore has an operator pre-step (add the property) and must
  fail loud on a rejected write (W-4), not drop the field.
- GA4 cardinality: one value per skill version, a handful over a year, well inside the custom
  dimension limits.
- The pre-wiring corpus and all historical events stay in the `unversioned` bucket permanently.
- Skill-version granularity is coarser than a per-candidate id. Two articles from the same version
  cannot be told apart by prompt, which is correct for the outer loop's question.

## Reversal, and what says it was wrong

Stop writing the property and ignore the dimension; nothing stored is load-bearing, and old events
are unaffected. It was wrong if, after one full month of data, `reader-signal` cannot produce a
comparison across at least two versions because versions change faster than events accumulate
(small-n), in which case bucket by a coarser key (skill, minor version). It is also wrong if the
GA4 dimension shows `unversioned` for new articles, which means a write link silently dropped the
field; that is the check the first post-deploy verification runs.

## Out of scope

Judge score on events; the multi-candidate panel; the GA4 reporting job (`quality/leaderboard.md`);
the event-catalogue reconciliation in GROWTH.md (#408); any edit to GROWTH.md, `quality.ts`, rubric
or roster (Zone A); the GA4 console action itself.

## Governance consulted

Root `CLAUDE.md` (C-1, C-2, quality layer, Zone A list), `AGENTS.md` Zone model, `docs/governance.md`
§4.4, `newsletter/docs/GROWTH.md` §2, §5, §6, ADR-0017/0018 (skill version gate), ADR-0008 (live
skill body), ADR-0005 (bilingual editions; the property is edition-independent).

## Implementation slices (each one `issue-implement` PR)

1. **Zone A, operator**: add `Prompt Version` (rich_text) to the Articles DB; `article-level2` and
   `article-level3` `publish-notion.mjs` set it from their own `meta.json` and read it back (the
   existing read-back already checks `Author`/`Title`); `meta.json` bumps and `PATCH /skills`.
2. `fetchers/notion.mjs` + `fetchers/types.mjs` + `writers/posts-md.mjs` + `ArticleMeta`: carry
   `promptVersion`; pipeline tests for present and absent.
3. `analytics.ts` union + `Article.tsx`: send `prompt_version` on `article_view`, the four
   `article_read_NN` events and `article_read_complete`. The field is required in the union, so
   typecheck rejects a call site that drops it (an optional field would not be caught; the union
   is typed per event and `trackEvent` is called without casts at `article_view`). Add a small
   test or smoke check that the built `article_view` params carry the key. R-16/R-17 unaffected.
4. **Operator**: register the event-scoped GA4 dimension (**before or with slice 3**, and note the
   date as the start of the analysable window); apply the GROWTH.md edits above (step 1 first);
   verify one live `article_view` for a post-wiring article carries a value other than
   `unversioned` and `missing`.
