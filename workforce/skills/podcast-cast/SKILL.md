---
name: podcast-cast
description: Cast a JA Neural narrator voice for each approved podcast episode (Epic-017). The Podcast Producer (Odette) reviews up to 5 oldest `approved` episodes and, per episode, chooses one Amazon Polly Neural Japanese voice from the pool that best fits the article's tone, writing it to the `podcastVoice` Notion parameter. This is judgment only — the deterministic CI synthesis reads `podcastVoice` (else falls back to a random pool voice). No audio is produced here.
---

# podcast-cast

Cast the narrator for each **approved** episode. This is a **Cadence** (CCR,
Notion-only — no AWS). Odette's judgment is *which voice*, expressed as a Notion
parameter; the deterministic CI job does the actual Polly synthesis later.

The voice pool (V1): **Takumi**, **Kazuha**, **Tomoko** (Polly Neural ja-JP).

## One credential (apiKey only)

| Credential | Used for |
|---|---|
| `notion.integration_token` | `pick-episodes.mjs` (list approved episodes) + `set-voice.mjs` (write `podcastVoice`) |

## Instructions

1. **List the approved episodes** (up to 5, oldest first):

   ```sh
   NOTION_API_KEY="<credentials['notion.integration_token'].apiKey>" \
     node workforce/skills/podcast-cast/pick-episodes.mjs --status approved --limit 5
   ```

   If `episodes` is empty, **skip — produce nothing this fire.**

2. **For each episode, cast a voice.** Use the title (and, if useful, the
   published article at `https://kohuehara.xyz/ai-native-article/posts/<slug>.md`
   or its Notion page) to judge tone, then pick the pool voice that best fits —
   vary it across episodes so the show doesn't sound monotonous, but stay within
   the pool. Casting is your call as Producer.

3. **Write the cast** for each episode:

   ```sh
   NOTION_API_KEY="<…apiKey>" \
     node workforce/skills/podcast-cast/set-voice.mjs --page-id "<pageId>" --voice "<Takumi|Kazuha|Tomoko>"
   ```

   Exit `0` written; `2` voice not in the pool (re-pick); `1`/`3` arg/Notion error.

## Hard rules

- **Only pool voices.** Casting outside `{Takumi, Kazuha, Tomoko}` is rejected
  (the script exits 2) — synthesis must never get an unsupported VoiceId.
- **Judgment only — no audio.** You set a parameter; you never synthesise. If no
  episode is `approved`, you write nothing.
- **At most 5 per fire** (the run cap).

## When NOT to use

- No `approved` episodes — nothing to cast.
- An episode already `audio-ready`/`published` — re-casting would orphan the live
  audio; leave it.
