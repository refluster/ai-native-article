---
name: podcast-rss
description: (Re)build the podcast RSS feed Spotify ingests by triggering the deterministic wf-podcast Lambda (Epic-017 Story 6). Use after one or more episodes reach podcastStatus=audio-ready. This skill carries no judgment — it SigV4-POSTs to the IAM-authorized RSS route; the Lambda assembles a valid podcast RSS from every audio-ready/published episode (enclosure = the public MP3, description = the mandatory source citations, GUID = slug) and writes it to the public podcast/feed.xml. The operator submits that feed URL to Spotify once; subsequent episodes auto-ingest.
---

# podcast-rss

(Re)build the podcast **RSS feed**. Deterministic (no archetype, no LLM
judgment) — the distribution counterpart to synthesis.

## What it does

It triggers the `wf-podcast` Lambda's `/podcast/rss` route. The Lambda:

1. Queries Notion for every episode with `podcastStatus` ∈ {`audio-ready`,
   `published`} that has an `audioUrl`.
2. Builds a valid **RSS 2.0 + iTunes** podcast feed:
   - `<item><enclosure>` = the public MP3 (CloudFront/OAC over `podcast/audio/`),
   - `<item><description>` = the episode's `podcastSources` **citations**
     (mandatory — an episode with empty citations aborts the build, ADR-0016),
   - `<guid>` = the article slug, `<pubDate>` = the article date.
3. Writes the feed to the public `podcast/feed.xml`.

## Auth (IAM — no project credential)

IAM-authorized, like `podcast-synthesize`. Run with AWS credentials; the bundled
script SigV4-signs the POST. No new credential type.

## Run it

```sh
aws-vault exec <profile> -- node workforce/skills/podcast-rss/build-rss.mjs
```

The response JSON carries `feedUrl` and the episode count. **Validate the feed**
against a podcast-feed checker (e.g. Cast Feed Validator, Podba.se) before the
first Spotify submission.

Exit codes: `0` rebuilt, `1` missing AWS creds, `2` 4xx, `3` 5xx/network
(fail loud — e.g. an episode reached audio-ready with empty citations).

## Operator follow-up (B-authority, one-time)

Submit the `feedUrl` to **Spotify for Podcasters** once. Subsequent episodes
auto-ingest on each rebuild — no re-submission. After Spotify ingests an
episode, record its Spotify URL into the article's `spotifyUrl` Notion property
and set `podcastStatus=published` (Phase 1 manual; `spotify.token` API
automation is Phase 2). The next site deploy flows `spotifyUrl` →
frontmatter → the reader Spotify link.

## When NOT to use

- Before any episode is `audio-ready` — the feed would be empty.
- As a way to "publish" — this only builds the feed; Spotify submission and the
  `spotifyUrl` capture are operator steps (C-3).
