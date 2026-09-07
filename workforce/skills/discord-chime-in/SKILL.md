---
name: discord-chime-in
description: Read the recent human conversation in one Discord channel and leave exactly one in-character comment. The persona's voice comes entirely from its system_prompt; the channel and the listen window come from the binding config. Use when an agent should have a daily presence in a chat channel — reacting to what people actually said, not broadcasting. Not for status embeds (discord-heartbeat) or weekly roll-ups (discord-digest).
---

# discord-chime-in

> **This is a Cadence skill** (固有名詞: see `.claude/skills/cadence-forge/references/cadence-archetype.md`).
> It is fired by EventBridge → `wf-orchestrator-tick` → the generic `agent-runner`
> CCR routine, which composes your runtime prompt from (persona `system_prompt` ×
> this `SKILL.md` × binding `config` × project credentials). The LLM owns the
> judgment; the bundled `fetch.mjs` / `post.mjs` own the authenticated read and
> write. No PR, no AWS access in-session — just the one project-scoped
> capability credential (`discord.bot_token`) injected into your task.

Leave **exactly one comment** in a Discord channel, in your own voice, about what
the people in that channel have actually been saying. The point is a *presence* —
someone who is around, has read the room, and says one thing worth reading — not
a bot that announces things.

## This skill has no voice of its own

Every other Cadence tells you what tone to write in. This one deliberately does
not. **The entire character of the output comes from your `system_prompt`** —
who you are, how you talk, what you notice, what you want. This skill only
guarantees the mechanics: one channel, one window, one comment, the guards.

That separation is what makes the skill reusable. A second persona in the same
channel, or the same persona in a different channel, is one new binding — never
a fork of this file. **Do not add persona-specific instructions here.** If a
behaviour is specific to one character, it belongs in that character's
`system_prompt` or in the binding's `config`.

## Your binding config

Read these from your fire payload's `config` (defaults in parentheses):

| Key | Meaning |
| --- | --- |
| `channel_id` | **Required.** The Discord channel to read and post in. |
| `listen_window_hours` | How far back to read (`24`). Match it to your cron so windows tile without gaps or overlap. |
| `min_chars` | Length floor the comment must clear (`20`). Set it where the persona's own prompt sets it. |
| `max_messages` | Cap on messages pulled into your context (`100`). |
| `reply_to_latest` | When `true`, post as a threaded reply to the newest message instead of a standalone message (`false`). |

`channel_id` is a **parameter, not a secret** — it lives in the binding config in
plain sight. The bot token is the capability and lives only in the project's
credential bag.

## Before the first fire — rehearse it (operator)

This Cadence has two live dependencies that a scheduled fire can only tell you
about by failing: the bot token, and the Discord app's own configuration. Two
bundled scripts rehearse both without waiting for the cron and without posting.

**Read path, against the live API** — validates the token, the channel, the
three channel permissions, and the MESSAGE CONTENT privileged intent, then
shows the exact window the next fire would see:

```sh
BOT_TOKEN="<the bot token>" \
  node workforce/skills/discord-chime-in/preflight.mjs --channel <channel_id>
```

Exit `0` means the cadence will work as soon as the token is stored at
`wf/projects/{project_id}/discord.bot_token`. Exit `2` names which check failed
and how to fix it.

**Write path, offline** — runs every W-1 guard and prints the exact payload it
would send, then exits without touching Discord. It needs no token, so the
write path can be rehearsed before the credential exists:

```sh
node workforce/skills/discord-chime-in/post.mjs \
  --channel <channel_id> --agent <slug> --body-file /tmp/comment.txt \
  --min-chars 100 --dry-run
```

> **Where the token goes.** `getCredential` tries
> `wf/projects/{project_id}/discord.bot_token` first and falls back to the
> legacy bare `wf/discord.bot_token`. The orchestrator's IAM policy grants
> `wf/projects/*` and deliberately does NOT grant the legacy path, so a missing
> project-scoped secret surfaces as an **AccessDenied on `wf/discord.bot_token`**
> — naming the fallback path, not the one to fix. Store it under the project.
> Store it under credential type `discord.bot_token`; a Discord token filed
> under any other type is not read by this skill.

## Read this first (the recall packet)

Run the bundled reader — it is the only way you read the channel. Do not call
the Discord API by hand.

```sh
BOT_TOKEN="<credentials['discord.bot_token'].token from your task>" \
  node workforce/skills/discord-chime-in/fetch.mjs \
    --channel "<config.channel_id>" \
    --window-hours <config.listen_window_hours, default 24> \
    --max-messages <config.max_messages, default 100> \
    --out /tmp/chime-in-context.json
```

It returns an envelope of the window's messages, oldest-first, with your own past
comments and other bots' messages already filtered out. Exit `0` with `count: 0`
is a **valid** result, not a failure — see the skip path.

Read `/tmp/chime-in-context.json`. That envelope is your world for this fire.
You have no other context about the channel, and you must not invent any.

## Do the one thing this Cadence does

Write **one comment**, as yourself, responding to what you just read.

- **React to something specific.** Name the thing that actually came up in the
  window. A comment that would read identically on any other day is a failed
  fire, even though it posts cleanly.
- **One comment, one thought.** Not a summary of the channel, not a list, not a
  reply to each person in turn.
- **Language follows the channel.** Write in the language people in the window
  are writing in. (Unlike `discord-digest`, this is a human conversational
  surface, not a workforce-internal review surface — the English-only rule does
  not apply here.)
- **Length: `config.min_chars` to 2000 characters.** 2000 is Discord's hard cap
  on a plain message and `post.mjs` rejects anything over it rather than
  truncating (C-1). In practice a comment that runs past a few hundred
  characters has stopped being chat.
- **Plain chat text.** No headers, no embed-style structure, no markdown tables.
  You are a participant in a conversation.
- **Never @-mention.** `post.mjs` suppresses all mentions on the wire, so an
  `@everyone` in your prose renders as inert text — but write as if it did not,
  and don't reach for mentions.
- **No invented activity.** Everything you reference traces to a message in the
  envelope. If you are unsure whether something was said, it was not.
- **No LLM-failure prelude.** Don't open with "承知しました", "以下の通り",
  "As an AI", "Here is the…" — `post.mjs` rejects these in the first 50
  characters (W-1) and exits non-zero.

## The skip path — when NOT to write

**Do not call `post.mjs`** — and report the skip as the fire's outcome — when:

- `count` is `0`. Nobody said anything in the window. A comment into an empty
  room is invented activity.
- Every message in the window is yours or another bot's (the reader already
  drops these, so this surfaces as `count: 0`).
- The window holds nothing you can respond to specifically — a lone "👍", a
  bare link with no discussion. Padding a comment to clear `min_chars` is worse
  than staying quiet.

Skipping is the correct W-4 behaviour, not an error. Unlike `discord-heartbeat`
— where a skip is indistinguishable from an outage — the liveness of the
dispatch chain is already covered by the heartbeat, so this Cadence is free to
be quiet.

There is one thing to watch: if `count` is `0` on **every** fire for days while
humans are demonstrably talking in the channel, that is not a quiet channel —
that is a permissions or intent misconfiguration. Say so in your write-back
rather than silently skipping forever. The same goes for a window whose
`empty_content_count` equals its `count`: messages arriving with empty
`content` means the app is missing the **MESSAGE CONTENT** privileged intent.

## Write — run the script, do NOT hand-edit any file

1. Write your comment to a temp file (a file, not a shell arg, so multi-line and
   non-ASCII prose isn't mangled by quoting).
2. Run:

   ```sh
   BOT_TOKEN="<credentials['discord.bot_token'].token from your task>" \
     node workforce/skills/discord-chime-in/post.mjs \
       --channel "<config.channel_id>" \
       --agent "<agent_slug>" \
       --body-file /tmp/chime-in-comment.txt \
       --min-chars <config.min_chars, default 20> \
       --skill-version "0.2.0"
   ```

   Add `--reply-to <id of the newest message in the envelope>` when
   `config.reply_to_latest` is true.

3. Report the script's exit code:
   - `0` — posted. Done.
   - `1` — bad args, or your comment failed a W-1 guard (empty, too short, too
     long, artefact prelude). **Rewrite the comment and run once more** — this
     is your output being rejected, not an infrastructure failure.
   - `2` — Discord rejected the write: `401` bad token, `403` the bot lacks
     **View Channel** / **Send Messages** on this channel, `404` unknown
     channel. Do not retry; report it.
   - `3` — network error. The next fire is the retry.

Do **not** retry a `2` or `3` inside this fire — the cron is the retry surface.

Never read the token from anywhere but your task's injected
`credentials["discord.bot_token"]`, and never echo it into your write-back.

## Cost

Two HTTPS calls per fire plus one short generation. The window read is the only
thing that grows: `max_messages: 100` of chat is a few thousand tokens. At a
daily cadence this is well under a `small` cost class.

## When NOT to use this skill

- A recurring **status** signal with a fixed shape → `discord-heartbeat`.
- A periodic **roll-up** of what the workforce shipped → `discord-digest`.
- An **alert** derived from a sweep, with findings → `ops-accountability-watch`.
- Anything long enough to want a title → it's an article, not a chat comment.

## Related

- `workforce/skills/discord-chime-in/preflight.mjs` — the read-only rehearsal (operator).
- `workforce/skills/discord-chime-in/fetch.mjs` — the deterministic read.
- `workforce/skills/discord-chime-in/post.mjs` — the deterministic write + W-1 guards.
- `workforce/docs/routines/agent-runner.md` — the CCR routine that executes this skill.
- `workforce/docs/runbooks/bindings.md` — the binding shape and the dead-cron rule.
- `workforce/lambdas/shared/credential-injector.ts` — `discord.bot_token`'s shape.
