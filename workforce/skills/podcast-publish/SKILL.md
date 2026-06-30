---
name: podcast-publish
description: Drive every approved podcast episode all the way to Spotify (Epic-017). Celeste (VP, Marketing & External Communications) reviews up to 5 oldest `approved` episodes and, per episode, casts a JA Neural voice (podcastVoice) and writes the show-notes framing (podcastShowNotes) as Notion parameters — that is the judgment half, Notion-only, no AWS. The deterministic half (Amazon Polly synthesis → S3/CloudFront, then RSS publish to the Spotify feed) is bundled here as SigV4 scripts the daily CI workflow runs. Use after podcast-script has produced a script and the operator has approved it.
---

# podcast-publish

Take an **approved** episode all the way to **Spotify**. This is the publish
half of Epic-017 — the counterpart to `podcast-script` (the prepare half). It
folds together what used to be four skills: voice casting, show-notes, audio
synthesis, and RSS.

It has **two halves with two executors**, by design:

- **Judgment (Celeste, this Cadence — Notion-only, no AWS).** Per approved
  episode, cast a voice and write the show-notes framing. These are Notion
  parameters; you never touch AWS. (CCR runners are Notion-only — the AWS trust
  boundary stays closed.)
- **Determinism (CI — AWS via OIDC).** The bundled `synthesize.mjs` /
  `publish.mjs` SigV4-POST to the IAM-authorized `wf-podcast` routes; the daily
  `.github/workflows/podcast-pipeline.yml` runs them. The Lambda does the Polly
  synthesis, the S3/CloudFront placement, and the RSS rebuild. You do **not** run
  these — they execute in CI with credentials this Cadence does not have.

```
approved ──(you: podcastVoice + podcastShowNotes)──▶ approved
         ──(you, optional: trigger-pipeline.mjs)───▶ dispatches podcast-pipeline.yml
         ──(CI synthesize.mjs → Polly → S3)────────▶ audio-ready
         ──(CI publish.mjs → flip + rebuild feed)──▶ published → Spotify
```

The voice pool (V1): **Takumi**, **Kazuha**, **Tomoko** (Polly Neural ja-JP).
Odette (Producer) owns pool membership; you cast within it.

## Credentials

| Credential | Used for |
|---|---|
| `notion.integration_token` | `pick-episodes.mjs` (list approved episodes) + `set-params.mjs` (write `podcastVoice` + `podcastShowNotes`) |
| `github.token` | `trigger-pipeline.mjs` (optional last leg — `workflow_dispatch` of `podcast-pipeline.yml`). Needs the **`workflow`** scope / Actions:write. |

The Notion `apiKey` and the GitHub token are the only secrets; the DB id is a
non-secret constant in the bundled scripts. **The AWS trust boundary stays
closed**: the cadence never holds AWS credentials. The optional pipeline trigger
is **GitHub-only** — it dispatches the existing CI workflow, which then does the
Polly/S3/RSS work via its own OIDC→AWS role. The synthesize/publish scripts
themselves still run with **AWS** credentials (CI OIDC / the operator), never a
project credential.

## Instructions (the Cadence — judgment only)

**Up to 5 episodes per fire.** Set the params on the oldest `approved` episodes
so the day's CI run can synthesise + publish them.

1. **List the approved episodes** (up to 5, oldest first):

   ```sh
   NOTION_API_KEY="<credentials['notion.integration_token'].apiKey>" \
     node workforce/skills/podcast-publish/pick-episodes.mjs --status approved --limit 5
   ```

   Empty `episodes` ⇒ **skip — produce nothing this fire.**

2. **For each episode, cast a voice and write show-notes.** Use the title (and,
   if useful, the published article at
   `https://kohuehara.xyz/ai-native-article/posts/<slug>.md` or the Notion page)
   to judge tone:
   - **Voice** — pick the pool voice that best fits; vary it across episodes so
     the show doesn't sound monotonous, but stay within `{Takumi, Kazuha,
     Tomoko}`. Casting is your call.
   - **Show-notes** — a tight, brand-consistent lead (2–4 sentences, JA): what
     the episode is about and why a listener should care. Write it to a temp
     file (multi-line/Unicode safe). Do **not** restate the citations — those
     are mandatory and appended automatically by the feed builder; your job is
     the framing, not the sources.

3. **Write both params** for each episode (one Notion write):

   ```sh
   NOTION_API_KEY="<…apiKey>" \
     node workforce/skills/podcast-publish/set-params.mjs \
       --page-id "<pageId>" \
       --voice "<Takumi|Kazuha|Tomoko>" \
       --notes-file /tmp/notes.txt
   ```

   Exit `0` written; `2` voice not in the pool or empty notes (re-pick / write
   something); `1`/`3` arg/Notion error.

4. **(Optional) Hand off to the pipeline — one continuous flow.** Once every
   approved episode has its `podcastVoice` + `podcastShowNotes`, you may dispatch
   the deterministic pipeline immediately instead of waiting for the daily cron:

   ```sh
   GITHUB_TOKEN="<credentials['github.token'].token>" \
     node workforce/skills/podcast-publish/trigger-pipeline.mjs --ref main
   ```

   This is **GitHub-only** (`workflow_dispatch` of `podcast-pipeline.yml`) — the
   AWS trust boundary stays closed; the dispatched workflow does the Polly/S3/RSS
   work via its own OIDC→AWS role. Exit `0` dispatched; `2` the token lacks the
   `workflow` scope (403); `1`/`3` missing token / GitHub error. **Skip this step
   if you have no `approved` episodes** (nothing to synthesise). Note: a Claude
   Code session's egress proxy injects a fixed session GitHub identity and 403s
   this call — it works from the CCR runner / CI / an operator shell, where the
   project PAT is honoured.

## Hard rules

- **Judgment only — no audio, no publish.** You set Notion parameters; the CI
  synthesis/publish does the rest. You never synthesise, place audio, or flip a
  status. If no episode is `approved`, you write nothing.
- **Only pool voices.** Casting outside `{Takumi, Kazuha, Tomoko}` is rejected
  (`set-params.mjs` exits 2) — synthesis must never get an unsupported VoiceId.
- **Framing only, never the citations.** Citations are mandatory and appended by
  the feed builder; don't duplicate or replace them. One brand voice across
  episodes.
- **At most 5 per fire** (the run cap).

## The deterministic scripts (CI / operator — NOT the Cadence)

These ship in this skill but run with **AWS** credentials, not as part of your
Cadence. The daily `podcast-pipeline.yml` runs them in order; the operator can
also run them under `aws-vault`.

- `synthesize.mjs` → POST `/podcast/synthesize`: a **kickoff + poll** pair, because
  a full-episode Polly synthesis outlasts the API Gateway HTTP-API hard 30s
  integration timeout. The kickoff (`POST {}`) starts Polly async tasks for up
  to 5 oldest `approved` episodes (your `podcastVoice`, else random) and returns
  `202` with the task handles; the script then polls (`POST {finalize:[…]}`)
  until each completed task is copied to its public MP3 key and flipped to
  `audio-ready`. The wait lives inside Polly, not the Lambda — every HTTP call
  stays under 30s, and no per-Lambda nested invocation is introduced (R-N1).
  Fail-loud (C-4) on a Polly failure or if the poll budget expires.
- `publish.mjs` → POST `/podcast/publish`: up to 5 oldest `audio-ready` episodes
  → `published`, then rebuild the RSS feed (`<description>` = your show-notes,
  then the mandatory citations).
- `build-rss.mjs` → POST `/podcast/rss`: standalone feed rebuild (operator
  escape hatch — e.g. to refresh the feed without flipping any status).
- `trigger-pipeline.mjs` → `workflow_dispatch` of `podcast-pipeline.yml`. The
  **only GitHub-auth (not AWS) script** here: it uses `github.token` (needs the
  `workflow` scope), and merely asks GitHub to run the workflow that then runs
  the three AWS scripts above. This is the cadence's optional hand-off leg
  (Instructions step 4); it never touches AWS.

```sh
# CI runs these (OIDC); the operator can run them under aws-vault:
aws-vault exec <profile> -- node workforce/skills/podcast-publish/synthesize.mjs
aws-vault exec <profile> -- node workforce/skills/podcast-publish/publish.mjs
```

Exit codes (all three): `0` done (read the JSON), `1` missing AWS creds, `2`
Lambda 4xx, `3` Lambda 5xx / network — read stderr, don't retry a 5xx blindly.

## When NOT to use

- No `approved` episodes — the picker returns an empty list; produce nothing.
- An episode already `audio-ready`/`published` — re-casting or re-noting would
  orphan the live audio/Spotify episode; leave it (an operator decision).
