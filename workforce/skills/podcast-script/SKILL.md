---
name: podcast-script
description: Turn one published L3/L4 analysis article into one single-narrator, colloquial Japanese podcast narration script with mandatory source citations. Use when the Podcast Scriptwriter must repurpose an analysis article into a spoken-word episode for Spotify (Epic-017). Picks the oldest analysis article without a podcast, writes a script for the ear (not the article read aloud), and attaches script + citations to the article's Notion page as podcastStatus=script-ready. Derivative commentary only — never verbatim reproduction; an empty citation list hard-fails.
---

# podcast-script

Turn **one** published L3/L4 analysis article into **one** single-narrator
Japanese narration script for the podcast, with **mandatory source citations**.

This is a **Cadence** (the `feed-post` / `article-level2` archetype): the binding
is `executor=claude-code-routine` + `scheduler=external/api`, fired by
`wf-orchestrator-tick` into the generic `agent-runner` routine
(`workforce/docs/routines/agent-runner.md`). The routine composes your persona +
this skill body, you generate the script, then a **bundled write script** owns
the Notion write — you do **not** hand-edit any file and do **not** open a PR.

The judgment is yours (the script + which sources to cite); the write is
deterministic (`publish-notion.mjs`). The audio synthesis, voice casting, RSS,
and Spotify submission are downstream and **not** your job (Stories 5–6, owned by
the Producer and the operator).

## One credential (apiKey only)

You read and write the **unified Articles DB** (the analysis articles). Only the
Notion `apiKey` is a secret; the DB id is a non-secret constant in the bundled
scripts. You need just one injected credential:

| Credential | Shape | Used for |
|---|---|---|
| `notion.integration_token` | `{apiKey, …}` — only `apiKey` is read | `pick-article.mjs` (find the next uncovered analysis article) and `publish-notion.mjs` (attach the script + citations to its page) |

## Instructions

1. **Pick one uncovered analysis article — run the picker, don't guess.** Run
   `pick-article.mjs` (below). It returns the oldest **published, Type=analysis**
   article whose `podcastStatus` is empty/`none`. If it returns
   `{"skip": true, …}`, **stop — produce nothing this fire.** Otherwise use the
   returned `{pageId, slug, title, sourceUrls}`.

   ```sh
   NOTION_API_KEY="<credentials['notion.integration_token'].apiKey>" \
     node workforce/skills/podcast-script/pick-article.mjs
   ```

2. **Ground yourself in the article.** Read the published article body (the
   derived markdown export is at `https://kohuehara.xyz/ai-native-article/posts/<slug>.md`;
   if unreachable, read the article's Notion page blocks). The article is your
   primary material — the script is commentary on it and the sources behind it,
   never new claims.

3. **Write ONE single-narrator script for the ear** (target ~10 minutes, roughly
   3,000–6,000 字). Format:
   - **Single narrator, colloquial Japanese.** A knowledgeable friend explaining
     the article — not a newsreader, not a dialogue. (Multi-host is Phase 2.)
   - **Write for listening:** short clauses, one idea at a time, signpost the
     turns (「まず」「ここで面白いのは」「最後に」). A clear open, a body that
     builds, a close that lands.
   - **Derivative commentary, never verbatim reproduction.** Explain and comment
     in your own framing; quote a source only sparingly and attributed. If you
     can't say it in your own words with a citation, cut it.

4. **Assemble the citation list.** Every source the article relied on that you
   draw a fact from goes into the citations — the URLs from `sourceUrls` plus any
   the article body credits. This becomes the show-note credits (mandatory). It
   must **not** be empty.

## Hard rules (editorial integrity — C-1, fail loud — C-4, rights — ADR-0016)

- **Never reproduce source text verbatim.** The episode is derivative
  commentary. Verbatim reproduction is the rights line the Media Rights
  Coordinator (Idris) owns and it is a hard no.
- **Never invent facts.** Every figure, name, date, or quotation traces to the
  article or a cited source. No source, no claim.
- **Mandatory citations.** The citations file must be non-empty — the write step
  rejects an empty one (exit 2). A podcast with no credited sources does not ship.
- **Write for the ear.** If it only works on the page (dense, nested, scannable),
  it isn't a script. Re-author it for listening.
- **Skip a thin source.** A one-fact article is skipped, not padded into ten
  minutes of filler.

## Write the script — run the script, do NOT hand-edit any file

1. Write the full narration script to a temp file (e.g. `/tmp/podcast-script.md`)
   — a file, not a shell arg, so multi-line / Unicode prose isn't mangled.
2. Write the **citation list** (one source per line — title + URL) to a second
   temp file (e.g. `/tmp/podcast-citations.txt`). **Non-empty.**
3. Run (the script PATCHes the article's existing Notion page — its id came from
   the picker):

   ```sh
   NOTION_API_KEY="<credentials['notion.integration_token'].apiKey>" \
     node workforce/skills/podcast-script/publish-notion.mjs \
       --page-id "<pageId from pick-article.mjs>" \
       --script-file /tmp/podcast-script.md \
       --citations-file /tmp/podcast-citations.txt
   ```

4. Report the script's exit code:
   - `0` — page updated. `podcastScript` + `podcastSources` set, `podcastStatus=script-ready`.
     The Producer's synthesis step (Story 5) picks it up from there. Done.
   - `2` — a guard failed: empty citations, or a W-1 editorial guard (empty/short
     script, LLM-artefact prelude, or a last line cut off mid-content), or
     `401/403` auth. Read stderr; do not retry blindly. If the truncation guard
     trips, the script really is cut off — regenerate the ending.
   - `1` / `3` — bad args / missing file, or Notion API / network error.

`NOTION_API_KEY` comes from your task's injected
`credentials["notion.integration_token"].apiKey` — never read it from anywhere
else, never hard-code it. The script re-runs the W-1 + citation guards before
writing, so a degraded script or an uncited episode fails loudly rather than
moving toward audio.

**The page is updated directly in Notion. No PR, no human-approval gate.**

## When NOT to use

- No published analysis article without a podcast — the picker returns
  `{skip:true}`; produce nothing.
- An article whose body is too thin to sustain a ten-minute episode — skip and
  let the next eligible article come round, don't pad.
- Anything that would require reproducing a source verbatim to be worth saying —
  escalate to Idris (rights) rather than shipping a reproduction.
