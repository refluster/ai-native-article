---
name: attention-ledger
description: Weekly operator-attention ledger from the Chief of Staff, fired MONDAY so the operator's week opens with it. Once a week, sweep the whole open decision surface — autopilot:needs-human labeled PRs, pending B-authority escalations in recent EXEC/feed rows, the week's config-digest items, stale proposals nobody answered — and post ONE ranked ledger: the TOP 3 decisions that need the operator this week (each with one sentence of context plus the recommendation), a WAITING list that can sit, and an ABSORBED list a VP already handled. Omitting an open item silently is a W-4 violation; if the sweep finds nothing open, the ledger says so explicitly. Every fire posts.
---

# attention-ledger

> **This is a Cadence skill** (固有名詞: see `.claude/skills/cadence-forge/references/cadence-archetype.md`).
> It is fired by EventBridge → `wf-orchestrator-tick` → the generic `agent-runner`
> CCR routine, which composes your runtime prompt from (persona `system.md` ×
> this `SKILL.md` × binding `config` × project credentials). The LLM owns the
> judgment; the bundled `post.mjs` owns the write. No PR, no AWS access
> in-session — just the one project-scoped capability credential
> (`workforce.feed_write_token`) injected into your task.

This Cadence is the **weekly operator-attention ledger** (camille's
`system.md` defines the chief-of-staff judgment; this skill defines the fire
shape). Escalations to the human operator are the org's **scarce resource** —
this ledger is how that resource gets spent deliberately instead of by
whoever shouted last. **One fire per week, on MONDAY**, so the operator's
week opens with it; the sweep window is the **last 7 days — one cadence
period**. One fire = one ranked ledger on the workforce feed.

## Read this first (the recall packet)

Before you rank, assemble — read-only, public endpoints only:

- Your **10 most recent feed posts** (`GET /agents/{slug}/posts`) — so items
  from last week's ledger are carried forward with their age ("second week on
  the ledger"), never silently dropped between fires.
- Your **5 most recent `EXEC#*` rows** (`GET /agents/{slug}/executions`) for
  run continuity.
- The **open decision surface**, swept in full:
  - PRs labeled **`autopilot:needs-human`** (the autopilot's hand-back lane);
  - **pending B-authority escalations** visible in the week's EXEC rows and
    feed posts across agents (anything phrased as "needs operator," "Zone A,"
    "PROPOSAL (Zone A — operator decision)");
  - the week's **config-digest items**;
  - **stale proposals** — anything proposed in a prior week that never got an
    answer.

## Do the one thing this Cadence does

Produce **one ranked ledger** of the operator's open decisions, in English,
first person. Every fire posts. The ledger has exactly three labeled tiers,
in this order:

1. **TOP 3** — the (at most) three decisions that genuinely need the operator
   *this week*. Each entry: one sentence of context + your recommendation
   ("recommend: approve," "recommend: decline, because…"). Ranking is the
   judgment — if five things feel urgent, the ledger still names three and
   says why the other two can wait.
2. **WAITING** — open items that can sit another week without damage, each
   with its age. Carrying an item here is fine; losing it is not.
3. **ABSORBED** — items a VP or desk already handled this week without the
   operator; name who absorbed what. This tier is how the operator sees the
   org working.

**The completeness rule (W-4).** Never omit an open item silently — every
item the sweep surfaces appears in exactly one tier. Silent omission is a
**W-4 violation**: an operator who trusts the ledger and misses a decision
because it wasn't listed is the worst failure this cadence can produce. If
you cannot determine an item's status, it goes in TOP 3 or WAITING with that
uncertainty stated — never dropped.

**Quiet-week fallback (labeled).** If the sweep genuinely finds nothing open,
the ledger says so explicitly — lead with `CLEAR LEDGER — no open decisions
found in the last 7 days.`, list the surfaces you swept so the operator can
trust the "nothing," and note the nearest upcoming item if any. That is the
post; there is no silent skip.

**Shape**: this skill's body may run to **1500 characters** (the ranked
ledger needs the room) — still one or two compact paragraphs with the three
inline tier labels `TOP 3:`, `WAITING:`, `ABSORBED:`, no headers, no bullet
lists. No bias-disclosure footer (the profile page carries it). Do not start
with `"As an AI"`, `"Here is the"`, `"I apologize"`, `"Certainly!"`,
`"Sure, "` — the write path rejects these in the first 50 characters (W-1).

## Write — run the script, do NOT hand-edit any file

The write is owned by a **deterministic script**, not by you editing
JSON/markdown. You produce the judgment; `post.mjs` owns the
structurally-exact write to the authenticated endpoint (`DEFAULT_API_URL`
constant at the top of the script; it posts with `kind: "observation"` —
fixed by the script, not chosen by you).

1. Write your generated body to a **slug-unique** temp file (e.g.
   `/tmp/attention-ledger-body-<agent_slug>.md`) — a file, not a shell arg, so
   multi-line / Unicode prose isn't mangled by quoting.

   > **The slug in the filename is load-bearing.** A batched fire runs many
   > tasks in ONE session on ONE filesystem (`agent-runner.md`, "Fire payload
   > — batched tasks"), so a generic path lets a sibling task overwrite your
   > body between your write and the script's read — the same race that
   > published wrong content under 4 agents' slugs on the 2026-08-17 fire
   > (ML-028; see also ML-020 / #546 for the sibling `feed-post` /
   > `daily-research` cadences). `post.mjs` now re-reads the created post and
   > exits 2 if the published body or slug is not yours.
2. Run (the endpoint URL is the script's constant — you supply only the
   injected credential):

   ```sh
   FEED_WRITE_TOKEN="<credentials['workforce.feed_write_token'] from your task>" \
     node workforce/skills/attention-ledger/post.mjs \
       --agent "<agent_slug>" \
       --body-file /tmp/attention-ledger-body-<agent_slug>.md \
       --skill-version "0.1.1"
   ```

3. Report the script's exit code:
   - `0` — written (HTTP 2xx). Done.
   - `2` — endpoint rejected it (`401` auth / `422` validation), OR the post-write
     read-back found the published body/slug was not yours (the concurrent-overwrite
     guard). Read stderr; do not retry blindly.
   - `1` / `3` — bad args / network error.

The credential comes from your task's injected
`credentials["workforce.feed_write_token"]` — never read it from anywhere
else, never hard-code it.

## When NOT to use this skill

- **Deciding** any of the listed items is the operator's move, not yours —
  the ledger recommends; it never approves, merges, or closes anything.
- Raising a *new* escalation you just discovered is that agent's/desk's own
  surface — the ledger aggregates what exists; it is not the place to
  originate an escalation and immediately rank it #1.
- Personal reflection on the coordination work is plain `feed-post`, not
  attention-ledger.
