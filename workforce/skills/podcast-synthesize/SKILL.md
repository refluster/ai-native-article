---
name: podcast-synthesize
description: Turn an approved podcast episode into an MP3 by triggering the deterministic wf-podcast Lambda (Amazon Polly Neural Japanese, one voice chosen at random per cast → S3). Use after podcast-script has attached a script to an article's Notion page (podcastStatus=approved). This skill carries no judgment — it SigV4-POSTs to the IAM-authorized synthesis route; the Lambda reads the script from Notion, synthesises it, writes the MP3 to the public podcast/audio/ prefix, and sets audioUrl + podcastStatus=audio-ready. Owned by the Podcast Producer (voice-pool + QA).
---

# podcast-synthesize

Turn an **approved** episode into an MP3. This is a **deterministic** step
(no archetype, no LLM judgment) — the production counterpart to the
`podcast-script` Cadence. The judgment already happened (Rhys wrote the script);
this skill just casts and synthesises it.

## What it does

It triggers the `wf-podcast` Lambda's `/podcast/synthesize` route. The Lambda:

1. Reads the target episode from Notion — by `--slug`, or the **oldest**
   `podcastStatus=approved` page if no slug is given.
2. Strips the `podcastScript` to plain text and synthesises it with **Amazon
   Polly Neural Japanese**, **one voice chosen at random per cast** from the JA
   Neural pool (`StartSpeechSynthesisTask` — async, required because a ~10-minute
   script exceeds the 3,000-char synchronous cap). The Producer (odette) owns
   pool membership.
3. Writes the MP3 to `s3://…/podcast/audio/{slug}.mp3` (served publicly to
   Spotify's crawler via CloudFront/OAC — the bucket stays private, ADR-0016).
4. Writes `audioUrl` + `podcastStatus=audio-ready` back to the Notion page.

A Polly/synthesis failure throws → HTTP 500 → the alarm fires (C-4, fail loud);
a truncated/empty script never lands a broken episode.

## Auth (IAM — no project credential)

The route is IAM-authorized. Run this with AWS credentials (the operator's or
the orchestrator's) — the bundled script SigV4-signs the POST, exactly like
`workforce/seed/*/register.mjs`. The Notion token lives in the Lambda (the shared
`wf/notion` secret via its IAM role), never in this session, so there is **no new
credential type**.

## Run it

```sh
# the oldest approved episode:
aws-vault exec <profile> -- node workforce/skills/podcast-synthesize/synthesize.mjs

# a specific article (slug from the Notion page / pick-article.mjs):
aws-vault exec <profile> -- node workforce/skills/podcast-synthesize/synthesize.mjs --slug c91368439868
```

Exit codes: `0` synthesised (or a `{skip:true}` when nothing is approved),
`1` missing AWS creds, `2` the Lambda rejected the request (4xx), `3` the Lambda
failed (5xx) or a network error — read stderr, don't retry a 5xx blindly.

## When NOT to use

- Before `podcast-script` has set `podcastStatus=approved` — there is nothing
  to synthesise (the Lambda returns `{skip:true}`).
- To re-cast a `published` episode — that would orphan the live Spotify episode;
  re-synthesis is an operator decision.
