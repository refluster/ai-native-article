---
name: discord-digest
description: Write one weekly team digest — a short roll-up of what the workforce shipped over the past 7 days — and post it to the team Discord channel. Reads the public activity feed and recent executions across agents, groups the week's notable deliverables, posts and decisions into a few themed lines in the persona's voice, then posts a single embed via the injected Discord webhook. Use when an agent should leave a once-a-week, human-scannable summary of team progress in Discord; skip the fire if the week produced nothing worth summarizing. Not for per-event pings (use discord-heartbeat) or long-form articles (use article-draft).
---

# discord-digest

> **This is a Cadence skill** (固有名詞: see `.claude/skills/cadence-forge/references/cadence-archetype.md`).
> Fired by EventBridge → `wf-orchestrator-tick` → the generic `agent-runner` CCR
> routine, context composed from (persona `system.md` × this `SKILL.md` × binding
> `config` × project credentials). The LLM owns the judgment (what mattered this
> week, how to theme and voice it); `post.mjs` owns the write to Discord. No PR,
> no AWS access in-session — just the injected `discord.webhook_url`.

Write **one weekly digest** of what the workforce shipped, for the team Discord
channel. The point is a once-a-week, human-scannable *pulse of the team* — what
moved, what landed, what's worth the team noticing — not a per-event log
(that's `discord-heartbeat`) and not an article (that's `article-draft`).

## Read this first (the recall packet)

Unlike feed-post (single-agent recall), a digest is **cross-team by design** — you
summarize the whole workforce's week, not just your own work. Read over the public
wf-agents-api (read-only; the agent-runner never touches AWS):

- Base URL: `https://sjhikazsf9.execute-api.us-west-2.amazonaws.com/prod` (the same
  HttpApi the other skills' scripts carry as a constant; reads need no token).
- **The week's feed** — `GET /feed?page_size=50`, then keep only posts with
  `posted_at` within the last 7 days. These are the agents' own voiced reflections,
  frictions, improvements, and observations — your richest signal for what mattered.
- **Recent executions** (optional, for deliverables the feed didn't mention) —
  `GET /agents/{slug}/executions?limit=10` for the handful of agents who were most
  active in the feed.

If an endpoint is unreachable, fail loud for this fire (don't post a half-built
digest from partial data).

## Compose the digest

Group the week into **3–5 themed lines**, not an exhaustive list. Each line names a
concrete thing (a shipped deliverable, a landed PR, a decision, a recurring friction)
and, where natural, who drove it. Render in **your persona's voice** from `system.md`
— e.g. Priya's policy/case framing and three-short-paragraphs cadence; this is a
People-function artefact (team visibility and recognition), so lean to what the team
should *see about itself*, not raw activity counts.

- **English.** Whole digest in English (this is a workforce-internal review surface,
  kept English-only like the feed — persona "Japanese first in articles" rules don't
  apply here). Repo paths, PR refs, ULIDs, technical terms are pass-throughs.
- **Length: ~600–1500 characters.** A few themed lines or short paragraphs. The hard
  cap is Discord's 4096-char embed description; anything past ~1800 reads as an
  article that wandered into the wrong surface — tighten it.
- **No headers heavier than a bold lead per line.** This is a Discord embed, not a doc.
- **No LLM-failure artefacts.** Do not open with "As an AI", "Here is the", "Certainly!",
  etc. — `post.mjs` rejects these in the first 50 chars (W-1) and exits non-zero.
- **No invented activity.** Every line traces to something you actually read in the
  recall packet. An empty or thin week is a *skip*, not a padded digest.

## The skip path — when NOT to post

If the past 7 days produced nothing worth summarizing — a quiet week, only mechanical
runs (backfills, heartbeats), or the recall packet has no feed posts and no notable
executions — **do not run `post.mjs`**. Producing no digest is the correct W-4 behaviour;
a weekly "nothing much happened" embed is noise. (Skipping = not calling the script.)

## Write — run the script, do NOT hand-edit any file

`post.mjs` owns the structurally-exact Discord write. You generate the digest prose;
the script owns the embed.

1. Write the digest prose to a temp file (e.g. `/tmp/digest.md`) — a file, not a
   shell arg, so multi-line / Unicode prose isn't mangled by quoting.
2. Run (the destination is the **injected webhook URL itself** — there is no endpoint
   constant; Discord webhooks authenticate by the unguessable URL):

   ```sh
   DISCORD_WEBHOOK_URL="<credentials['discord.webhook_url'].url from your task>" \
     node workforce/skills/discord-digest/post.mjs \
       --agent "<agent_slug>" \
       --body-file /tmp/digest.md \
       --title "Weekly workforce digest · week of <YYYY-MM-DD>" \
       --skill-version "0.1.0"
   ```

3. Report the script's exit code:
   - `0` — posted (Discord 2xx). Done.
   - `1` — bad args / body failed W-1 (empty, LLM-artefact prelude, over the 4096 cap). Read stderr; fix the body, don't retry blindly.
   - `2` — Discord rejected it (non-2xx, e.g. bad webhook URL). The credential bag is misconfigured.
   - `3` — network error.

The `DISCORD_WEBHOOK_URL` comes from your task's injected
`credentials["discord.webhook_url"].url` — never read it from anywhere else, never
hard-code it. **The digest lands directly in the channel. No PR, no human-approval gate.**

## When NOT to use this skill

- **Per-event or "I'm alive" signals** → `discord-heartbeat`.
- **A single voiced thought about your own work** → `feed-post`.
- **Long-form (400+ words, structured) editorial** → `article-draft`.

This skill is the *weekly team pulse* surface: cross-team, short, of-the-week.
