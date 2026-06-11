---
name: article-level2
description: Convert one L1 source entry into one L2 explanation (briefing-document) article in Japanese — the agent-workforce equivalent of the GAS L1→L2 batch. Use when an editorial-stream agent must turn an uncovered L1 source into a faithful, evidence-grounded explanation: an Executive Summary up front, source-specific section headings, and every number/name/date/quote taken verbatim from the source. Published to Notion as Type=explanation, Author={agent_slug}, Status=ready.
---

# article-level2

Convert **one** L1 source entry into **one** L2 explanation article in Japanese.

This is the agent-workforce counterpart of the GAS `L2_BATCH` / `handleL2Create`
pipeline (`newsletter/gas/src/Code.gs`). The GAS path fetches a source URL, builds a
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

## Two Notion DBs, one credential (apiKey only)

This skill reads the **L1 source library** and writes the **unified Articles DB** —
two different databases. Only the Notion `apiKey` is a secret; the two database
ids are **not** secret (they're already committed in `newsletter/gas/src/Code.gs` and
`newsletter/pipeline/normalize-categories.mjs`), so the scripts hold them as constants. You
therefore need just one injected credential:

| Credential | Shape | Used for |
|---|---|---|
| `notion.integration_token` | `{apiKey, …}` — only `apiKey` is read | both `pick-l1-source.mjs` (read L1 + unified coverage) and `publish-notion.mjs` (write the explanation to the unified DB) |

The Notion integration behind `apiKey` must be shared with **both** databases in
Notion. (L2 and L3 share the unified Articles DB, distinguished by `Type`; a future
`article-level3` skill reuses the same credential + unified DB. L1 is the one
genuinely separate DB — its id is a constant in `pick-l1-source.mjs`.)

## Instructions

1. **Pick one uncovered L1 source — run the picker, don't guess.** Run
   `pick-l1-source.mjs` (below). It queries L1 + the unified DB and returns the
   oldest L1 source whose Source URL no explanation covers yet (same filters as
   `handleL2Batch`). If it returns `{"skip": true, …}`, **stop — produce nothing
   this fire.** Otherwise use the returned `{title, summary, sourceUrl}` as your
   subject. **Ground every claim in that source** (fetch `sourceUrl` for the body
   when it's reachable; otherwise work from `summary` only — see Hard rules).

   ```sh
   NOTION_API_KEY="<credentials['notion.integration_token'].apiKey>" \
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
- **For JS-only / paywalled hosts (x.com, twitter.com, linkedin.com, and CDN
  consent-wall sites like nytimes/ft/wsj/bloomberg/mckinsey), fetch via Jina
  Reader first**: `https://r.jina.ai/<source-url>` returns pre-extracted clean
  Markdown. This mirrors the GAS `L2_SOURCE_FETCH_VIA_READER` routing in
  `newsletter/gas/src/Code.gs` — a direct fetch of these hosts returns 402/HTML-bot-walls,
  but the Jina-extracted body is groundable. Only fall back to the L1-summary-only
  path if Jina *also* fails.
- If the source body still could not be fetched, work from the L1 summary *only*
  and do not supply facts, statistics, company names, or people the summary
  doesn't contain.
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
2. Write the **abstract** — a faithful 2–3 sentence lead (your `## Executive
   Summary`, **not** the speculative L1 summary) — to a second temp file (e.g.
   `/tmp/l2-abstract.txt`). This populates the `Abstract` column, matching how
   other rows lead.
3. Run (the script writes to the unified Articles DB — its id is a built-in
   constant, so only `NOTION_API_KEY` is needed). Pass the picker's `category`
   (a bare A–E letter) — the script canonicalises it to `"B: Role Blurring"` etc.
   and fills both `Category` and `CategoriesMulti`, exactly like the GAS L2 write:

   ```sh
   NOTION_API_KEY="<credentials['notion.integration_token'].apiKey from your task>" \
     node workforce/skills/article-level2/publish-notion.mjs \
       --author "<agent_slug>" \
       --type explanation \
       --status ready \
       --body-file /tmp/l2-article.md \
       --abstract-file /tmp/l2-abstract.txt \
       --category "<category from the picker, e.g. B>" \
       --source-url "<sourceUrl from step 1>"   # omit if none
   ```

4. Report the script's exit code:
   - `0` — page created. The row carries `Author={agent_slug}, Type=explanation,
     Status=ready`, plus `Abstract` + `Category`/`CategoriesMulti` (queued; the
     GAS L4 batch flips Status to `published`). Done.
   - `2` — W-1 editorial guard failed (empty/short body, LLM-artefact prelude,
     or a last line that looks cut off mid-content — the shared
     `scripts/lib/truncation.mjs` heuristic), or `401/403` auth (project
     credential bag misconfigured). Read stderr; do not retry blindly. A
     complete italic bias-disclosure footer (`*…ください。*`) is a valid ending —
     if the guard trips, the body really is cut off; regenerate the ending,
     don't trim the footer.
   - `1` / `3` — bad args / missing H1 title, or Notion API / network error.

`NOTION_API_KEY` comes from your task's injected
`credentials["notion.integration_token"].apiKey` — never read it from anywhere
else, never hard-code it. (The DB ids are non-secret constants inside the
scripts.) The script re-runs the W-1 guards before writing, so a degraded body
fails loudly rather than landing on the site.

**The page lands directly in Notion. No PR, no human-approval gate.** The page is
written to the unified Articles DB with the live schema (`Title`, `Author` and
`SourceURLs` as `rich_text`, `Type`/`Status` as `select`, `Date`) — the same
property contract as the GAS L2 write. The existing GAS L4 batch picks up the row
and publishes it to `kohuehara.xyz`; `newsletter/pipeline/fetch-notion.mjs` surfaces `Author`
+ `Type` into the front-end manifest so `AuthorChip` renders the byline.

## When NOT to use

- A source already covered by an existing L2 explanation — skip and pick the next
  uncovered entry (the GAS coverage check keys on source URL).
- A test/placeholder source (`example.com`) — never flows to L2.
- A source whose original text is a one-line headline only — escalate, do not pad.
