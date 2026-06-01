---
name: article-level2
description: Convert one L1 source entry into one L2 explanation (briefing-document) article in Japanese — the agent-workforce equivalent of the GAS L1→L2 batch. Use when an editorial-stream agent must turn an uncovered L1 source into a faithful, evidence-grounded explanation: an Executive Summary up front, source-specific section headings, and every number/name/date/quote taken verbatim from the source. Published to Notion as Type=explanation, Author={agent_slug}, Status=ready_for_L4.
---

# article-level2

Convert **one** L1 source entry into **one** L2 explanation article in Japanese.

This is the agent-workforce counterpart of the GAS `L2_BATCH` / `handleL2Create`
pipeline (`gas/src/Code.gs`). The GAS path fetches a source URL, builds a
briefing-document prompt, calls Azure, and writes an `explanation`-type row into
the unified Notion Articles DB. This skill produces the *same deliverable* — a
faithful briefing-document explanation — attributed to the running agent so the
article carries a byline on `kohuehara.xyz`.

It runs on the **CCR execution model** (the same pattern as Dario's `feed-post`):
the binding is `executor=claude-code-routine` + `scheduler=external/api`, fired
every 2 hours by `wf-orchestrator-tick` into the generic `agent-runner` routine
(`workforce/docs/routines/agent-runner.md`). The routine composes your persona +
this skill body, you generate the explanation, then a **bundled write script**
owns the Notion write — you do **not** hand-edit any file and do **not** open a PR.

## Two Notion DBs, two credential variants

This skill reads the **L1 source library** and writes the **unified Articles DB** —
two different databases, reached with two injected credential variants (same Notion
integration `apiKey`, different `databaseId`):

| Credential | Shape | Used for |
|---|---|---|
| `notion.integration_token@l1` | `{apiKey, databaseId}` (L1 source library) | `pick-l1-source.mjs` reads uncovered L1 sources |
| `notion.integration_token@l2` | `{apiKey, databaseId}` (unified Articles DB) | coverage check + `publish-notion.mjs` writes the explanation |

(L2 and L3 share the unified Articles DB, distinguished by `Type`; a future
`article-level3` skill needs only `@l2`. L1 is the one genuinely separate DB.)

## Instructions

1. **Pick one uncovered L1 source — run the picker, don't guess.** Run
   `pick-l1-source.mjs` (below). It queries L1 + the unified DB and returns the
   oldest L1 source whose Source URL no explanation covers yet (same filters as
   `handleL2Batch`). If it returns `{"skip": true, …}`, **stop — produce nothing
   this fire.** Otherwise use the returned `{title, summary, sourceUrl}` as your
   subject. **Ground every claim in that source** (fetch `sourceUrl` for the body
   when it's reachable; otherwise work from `summary` only — see Hard rules).

   ```sh
   NOTION_API_KEY="<credentials['notion.integration_token@l1'].apiKey>" \
   L1_DB_ID="<credentials['notion.integration_token@l1'].databaseId>" \
   UNIFIED_DB_ID="<credentials['notion.integration_token@l2'].databaseId>" \
     node workforce/skills/article-level2/pick-l1-source.mjs
   ```

2. Produce **one** Japanese briefing-document explanation (target ~3000 字).
3. Follow the L2 briefing format (identical to the GAS `buildL2Prompt` contract):
   - **Line 1**: a `#` H1 — a concrete Japanese title specific to the source's
     subject. No generic placeholders ("AIの可能性", "変化への対応" are banned).
   - **Directly below**: a `## Executive Summary` section — a 2–3 sentence lead
     surfacing the single most important takeaway before the reader scrolls.
   - **Body**: 2–5 `##` sections, each named after a source-specific theme.
     Separate evidence (facts from the source) from conclusion (the implication
     you draw). Use short paragraphs plus bullet lists carrying the actual
     numbers, names, dates, and direct quotations.
4. Append the agent's bias-disclosure footer (from the agent's `system.md`).

## Hard rules (editorial integrity — C-1, fail loud — C-4)

- **Never invent facts.** Every concrete figure, proper noun, date, or quotation
  must come verbatim from the supplied source. Do not abstract, round, or alter
  them.
- If the source body could not be fetched (X.com posts, paywalls, JS-only pages),
  work from the L1 summary *only* and do not supply facts, statistics, company
  names, or people the summary doesn't contain.
- If you cannot link to or quote the source, **do not publish** — escalate.
- Objective, incisive tone. Avoid reviewer-voice hedges ("重要だ", "今後注目される")
  and throat-clearing preambles.

## Write the article — run the script, do NOT hand-edit any file

The page is written by a **deterministic script**, not by you editing JSON. You
generate the *judgment* (the briefing-document markdown); `publish-notion.mjs`
owns the *write* (correct schema, properties, block conversion) by POSTing a new
page into the unified Articles DB with the injected integration token.

Steps:

1. Write the full explanation markdown to a temp file (e.g. `/tmp/l2-article.md`)
   — a file, not a shell arg, so multi-line / Unicode prose isn't mangled by
   quoting. The first line must be the `# Title` H1 (used as the page Title and
   stripped from the body blocks).
2. Run (note the write uses the **`@l2`** variant — the unified Articles DB):

   ```sh
   NOTION_API_KEY="<credentials['notion.integration_token@l2'].apiKey from your task>" \
   NOTION_DB_ID="<credentials['notion.integration_token@l2'].databaseId from your task>" \
     node workforce/skills/article-level2/publish-notion.mjs \
       --author "<agent_slug>" \
       --type explanation \
       --kind article \
       --body-file /tmp/l2-article.md \
       --source-url "<sourceUrl from step 1>"   # omit if none
   ```

3. Report the script's exit code:
   - `0` — page created. The row carries `Author={agent_slug}, Type=explanation,
     Status=ready_for_L4`. Done.
   - `2` — W-1 editorial guard failed (empty/short body or LLM-artefact prelude),
     or `401/403` auth (project credential bag misconfigured). Read stderr; do not
     retry blindly.
   - `1` / `3` — bad args / missing H1 title, or Notion API / network error.

The `NOTION_*` values come from your task's injected
`credentials["notion.integration_token@l2"]` (`{apiKey, databaseId}`) — never read
them from anywhere else, never hard-code them. The script re-runs the W-1 guards
before writing, so a degraded body fails loudly rather than landing on the site.

**The page lands directly in Notion. No PR, no human-approval gate.** The existing
GAS L4 batch picks up `Status=ready_for_L4` rows and publishes them to
`kohuehara.xyz`; `scripts/fetch-notion.mjs` surfaces `Author` + `Type` into the
front-end manifest so `AuthorChip` renders the byline.

## When NOT to use

- A source already covered by an existing L2 explanation — skip and pick the next
  uncovered entry (the GAS coverage check keys on source URL).
- A test/placeholder source (`example.com`) — never flows to L2.
- A source whose original text is a one-line headline only — escalate, do not pad.
