---
name: podcast-shownotes
description: Write the show-notes framing for each audio-ready podcast episode (Epic-017). Celeste (VP, Marketing & External Communications) reviews up to 5 oldest `audio-ready` episodes and, per episode, writes a short summary / why-it-matters lead to the `podcastShowNotes` Notion parameter. This is judgment only — the deterministic RSS build leads each episode's feed description with these notes, then the mandatory source citations follow. No publishing happens here.
---

# podcast-shownotes

Write the listener-facing **show-notes** for each **audio-ready** episode. A
**Cadence** (CCR, Notion-only — no AWS). Celeste's judgment is the framing copy,
written as a Notion parameter; the deterministic publish/RSS job folds it into
the feed `<description>` (notes first, then the mandatory citations).

## One credential (apiKey only)

| Credential | Used for |
|---|---|
| `notion.integration_token` | `pick-episodes.mjs` (list audio-ready episodes) + `set-shownotes.mjs` (write `podcastShowNotes`) |

## Instructions

1. **List the audio-ready episodes** (up to 5, oldest first):

   ```sh
   NOTION_API_KEY="<credentials['notion.integration_token'].apiKey>" \
     node workforce/skills/podcast-shownotes/pick-episodes.mjs --status audio-ready --limit 5
   ```

   Empty `episodes` ⇒ **skip — produce nothing this fire.**

2. **For each episode, write show-notes.** A tight, brand-consistent lead — what
   the episode is about and why a listener should care — in 2–4 sentences (JA).
   Ground it in the article (`https://kohuehara.xyz/ai-native-article/posts/<slug>.md`
   or the Notion page). Do **not** restate the citations — those are appended
   automatically and are mandatory; your job is the framing, not the sources.
   Write the notes to a temp file (multi-line/Unicode safe).

3. **Write the notes** for each episode:

   ```sh
   NOTION_API_KEY="<…apiKey>" \
     node workforce/skills/podcast-shownotes/set-shownotes.mjs --page-id "<pageId>" --notes-file /tmp/notes.txt
   ```

   Exit `0` written; `2` empty notes (write something or skip the episode);
   `1`/`3` arg/Notion error.

## Hard rules

- **Framing only, never the citations.** Citations are mandatory and appended by
  the feed builder; don't duplicate or replace them.
- **Judgment only — no publish.** You set a parameter; the CI publish step flips
  `audio-ready → published`. At most 5 episodes per fire.
- **One brand voice** across episodes — consistent with the site's tone.

## When NOT to use

- No `audio-ready` episodes — nothing to write.
- An episode already `published` — its notes are live; re-editing is an operator
  decision, not a cadence rewrite.
