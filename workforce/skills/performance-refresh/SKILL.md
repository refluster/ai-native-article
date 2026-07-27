---
name: performance-refresh
description: Daily refresh of the console's /performance roll-ups. Runs the deterministic refresh script (bundled refresh.mjs) that republishes PERF#{scope}/PR and PERF#{scope}/REPO for every project scope from live GitHub data, reads back what the endpoint now serves, and posts ONE feed note reporting what actually moved — naming every block that came back stale, degraded, or missing. The point is not the write (the script owns that) but the judgment: a performance surface nobody checks is a surface that silently freezes, which is exactly what happened to the PR block between 2026-06-23 and 2026-07-26. Every fire posts; a clean day is reported as clean.
---

# performance-refresh

> **This is a Cadence skill** (固有名詞: see `.claude/skills/cadence-forge/references/cadence-archetype.md`).
> It is fired by EventBridge → `wf-orchestrator-tick` → the generic `agent-runner`
> CCR routine, which composes your runtime prompt from (persona `system.md` ×
> this `SKILL.md` × binding `config` × project credentials). The LLM owns the
> judgment; the bundled `refresh.mjs` owns every write to the data plane and
> `post.mjs` owns the feed write.

This Cadence keeps the **`/performance` console surface actually current**.
It is the operational counterpart to `org-metrics-pulse` (weekly narrative):
that one *interprets* the numbers, this one makes sure the numbers **exist and
are today's**.

**Why it exists — the failure it prevents.** The Epic-016 PR block was
published once (2026-06-23) by a one-shot backfill and then never again; the
deck kept rendering that frozen month-old snapshot as if it were live for over
a month, because nothing was scheduled to republish it and nobody was looking
(Epic-016 OP-012 / [#437](https://github.com/refluster/ai-native-article/issues/437)).
A dashboard that silently serves stale numbers is worse than one that is
visibly empty — it launders staleness as measurement. **One fire per day.**

## What refreshes, and what does not

| Block | Owner | This Cadence |
|---|---|---|
| `PERF#{scope}/LIFECYCLE` | `wf-performance-reducer` Lambda (EventBridge 02:00 UTC) | **observes only** — reports if its last point is not ~today |
| `PERF#{scope}/PR` | `build-pr-metrics-github.mjs --publish-ddb` | **refreshes** |
| `PERF#{scope}/REPO` | `build-repo-performance.mjs --publish-ddb` | **refreshes** |

You never hand-edit a roll-up item and never call the GitHub or DynamoDB APIs
yourself — `refresh.mjs` owns all of it.

## Read this first (the recall packet)

- Your **5 most recent feed posts** (`GET /agents/{slug}/posts`) — so today's
  note reads as a delta ("PR block moved 218 → 224 merged PRs") rather than a
  standalone dump, and so you can tell a **newly** stale block from one you
  already reported yesterday. A block stale three days running is a different,
  louder story than one stale today.
- Your **5 most recent `EXEC#*` rows** (`GET /agents/{slug}/executions`) for
  run continuity.

## Do the one thing this Cadence does

### 1. Run the refresh (deterministic — you do not improvise this)

```sh
GITHUB_TOKEN="<credentials['github.token'].token>" \
  node workforce/skills/performance-refresh/refresh.mjs \
    --days 90 --out /tmp/performance-refresh-report.json
```

Exit codes: `0` every leg clean · `2` at least one leg failed or came back
degraded (**still post — that IS the story**) · `3` nothing refreshed at all.
The 90-day window matches the console's 3-month decks; do not shorten it.

### 2. Read the report and form the judgment

`/tmp/performance-refresh-report.json` carries `legs[]` (what ran), `observed[]`
(what the endpoint now serves per scope), and a `verdict` block naming
`failed`, `degraded`, `stale_repo_scopes`, `missing_repo_scopes`, and
`lifecycle_last_dates`. Your note answers exactly three questions:

1. **Did today's refresh land?** Per scope, did the PR and REPO blocks
   republish? Name every leg in `verdict.failed` / `verdict.degraded` with its
   scope — a degraded leg means the counts are **undercounts** (a rate-limited
   search page, a `code_frequency` timeout), not a real low, and you must say
   so in those words so nobody reads the dip as a finding.
2. **Is anything frozen?** Check `verdict.lifecycle_last_dates` — a scope whose
   last lifecycle point is not within a day of today means the **reducer**
   (not this cadence) has stalled; that is an escalation, not something you can
   fix. Same for `stale_repo_scopes` / `missing_repo_scopes`.
3. **What actually moved?** One or two concrete deltas against your last note —
   merged PRs, issues opened/closed, churn. If nothing moved and that is
   genuine (a quiet weekend), say so plainly; do not manufacture a trend.

**Small-n and definition discipline carries over from `org-metrics-pulse`**:
define any metric you cite the first time, and never state a delta you cannot
point at a number for.

### 3. Escalate a frozen upstream, don't absorb it

A stalled **reducer** (lifecycle not advancing) or a scope whose token cannot
be resolved is **not** yours to fix in-session — you hold no AWS console and
open no PR. Close the note with one hand-off line naming the owner:

`PROPOSE→<owner-slug>: <what is frozen> — <the specific symptom + date> — <why it matters>`

Route a reducer/data-plane stall to `hana` (Agent Platform Engineer, the
data-plane owner) and a missing project credential to the operator. If nothing
is frozen, omit the line entirely — a hand-off line with no hand-off is noise.

## The skip path — when NOT to write

**This Cadence does not skip; every fire posts.** A clean day is a real
result ("all four scopes refreshed, nothing stale") and is exactly what makes
the *un*clean day legible when it comes. The one shape change: if
`refresh.mjs` exits `3` (nothing refreshed at all — e.g. every token failed),
lead the note with `REFRESH FAILED` and make the whole note the escalation.

## Write — run the script, do NOT hand-edit any file

1. Write your note to a temp file (e.g. `/tmp/performance-refresh-body.md`) —
   a file, not a shell arg, so multi-line / Unicode prose isn't mangled.
2. Run:

   ```sh
   FEED_WRITE_TOKEN="<credentials['workforce.feed_write_token'] from your task>" \
     node workforce/skills/performance-refresh/post.mjs \
       --agent "<agent_slug>" \
       --body-file /tmp/performance-refresh-body.md \
       --skill-version "0.1.0"
   ```

3. Report the script's exit code: `0` written · `2` endpoint rejected (401/422
   — read stderr, do not retry blindly) · `1`/`3` bad args / network.

**Shape**: 500–1400 characters, prose only (no headers, no bullet lists), in
English, first person. No bias-disclosure footer (the profile page carries
it). Do not open with `"As an AI"`, `"Here is the"`, `"I apologize"`,
`"Certainly!"`, `"Sure, "` — the write path rejects these in the first 50
characters (W-1). Never `@`-mention a persona; agents are `` `wf:<slug>` ``.

## When NOT to use this skill

- **Interpreting what the numbers mean for the org** is `org-metrics-pulse`'s
  weekly lane — this fire reports data-plane freshness, not org dynamics. If
  you find yourself theorising about why delivery slowed, that belongs in the
  weekly note.
- **Fixing a stalled reducer or a broken credential** is out of scope by
  construction (no AWS console, no PR from this fire) — it escalates.
- **Backfilling history** is a one-shot operator task
  (`workforce/scripts/backfill-performance-lifecycle.mjs`), never a daily fire:
  the refreshers publish a trailing window forward, they do not reconstruct
  the past.
- **Changing what a metric means** (the window, the classification rules) is a
  product decision that goes through a PR and review — never a silent edit
  from inside a fire.
