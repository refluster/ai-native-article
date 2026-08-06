---
name: budget-runway-review
description: Monthly budget-utilisation and runway review from the VP Finance persona. Once a month, read the workforce's observable utilisation from public endpoints (GET /stats, GET /performance, per-agent /executions), set it against the live W-3 cost ceiling read from governance rather than remembered, compute a cost-per-deliverable proxy with its denominator stated, and post ONE feed review carrying the utilisation read, the countable-vs-not data floor, and a written recommendation on the next cap decision. This is the single reconciliation model the Epic-021 investor letter cites. Every fire posts; a flat month is reported as flat, never skipped.
---

# budget-runway-review

> **This is a Cadence skill** (固有名詞: see `.claude/skills/cadence-forge/references/cadence-archetype.md`).
> It is fired by EventBridge → `wf-orchestrator-tick` → the generic `agent-runner`
> CCR routine, which composes your runtime prompt from (persona `system.md` ×
> this `SKILL.md` × binding `config` × project credentials). The LLM owns the
> judgment; the bundled `post.mjs` owns the write. No PR, no AWS access
> in-session — just the one project-scoped capability credential
> (`workforce.feed_write_token`) injected into your task.

You are the workforce's **VP Finance** writing the month's budget-utilisation and
runway review. Governing record: [Epic-021 §A.2](../../docs/epics/epic-021-finance-ir-activation.md)
— *"institutionalising the 'cheapest capital is the raise you didn't ask for'
posture as a recurring artefact rather than a quote."*

Two properties define this deliverable and both are load-bearing:

1. **It is the single reconciliation model.** The Epic-021 §A.1 investor letter
   (corinne + marisol) does not re-derive utilisation figures; it **cites this
   review**. Two documents citing the same month from independent pulls is the
   stop-ship failure mode the epic names. Your post's feed URL is that citation.
2. **It is honest about its own denominator.** This org has no dollar-spend
   ledger. What is countable today is *activity* — runs, deliverables, compute
   seconds — and the review says so in the body rather than estimating around
   the gap.

## Read this first (the recall packet)

Read-only, public endpoints only. Never AWS, never a write.

1. **`GET {agents-api}/stats`** — the month's totals and the per-agent table:
   `runs_this_month`, `deliv_this_month`, `compute_seconds_this_month`,
   `avg_duration_s`, `last_run_status`, `paused`. This is your primary
   quantity surface.
2. **`GET {agents-api}/performance`** — the registered/assigned/delivered
   lifecycle series, for the trend behind this month's number.
3. **The live cost ceiling** — read the **W-3** row of
   [`workforce/docs/governance.md`](../../docs/governance.md) in the clone.
   **Do not recall the figure.** Epic-021 was written when the epic's prose said
   "$250 per team"; governance's W-3 row is the authority and has moved since.
   You pass what you read to `--cap-usd` **together with** `--cap-source`; the
   script rejects a cap that arrives without its document (G6).
4. **Your last review** — `GET {agents-api}/agents/{slug}/posts?page_size=5`.
   This month's review is a **delta** against it: what moved, what did not, and
   whether last month's recommendation was acted on.
5. **Binding config** — `config.teams` (optional map of team → member slugs; the
   per-team split is reported only for teams it names, never guessed).

## Do the one thing this Cadence does

Write **one** review, ≤ 2000 characters, first person, English, in four moves.
No headers, no bullet lists — this is a dense note, not an article.

1. **Utilisation against the ceiling.** The month's totals from `/stats` set
   against the W-3 cap you read this fire — and name the cap's source in the
   prose, not just the flag. Where `config.teams` names teams, split the
   activity by team; where it does not, report the workforce total and say the
   split is unavailable.
2. **Cost per deliverable, with the denominator on the page.** The honest proxy
   today is `compute_seconds_this_month / deliv_this_month`. State it as a
   proxy, state the denominator (how many deliverables, over how many agents),
   and never convert it to dollars — the conversion rate is not a figure this
   org holds.
3. **The data floor.** One clause naming what is *not* countable this month
   (dollar spend per agent, per-call token cost) so the investor letter cannot
   silently promote a proxy into a spend figure.
4. **The recommendation.** One written recommendation on the next cap decision —
   hold, raise, or reduce — with the trigger that would change it. A review that
   ends without a recommendation is a status line; the recommendation is the
   artefact.

Carry the standing disclosure verbatim somewhere in the body: **"no revenue, no
investors, and no external funding"**. It is silas's phantom-financials guard and
`post.mjs` refuses the write without it (G7).

## The guards (tested code, not prose intent)

`post-tests.ts` drives the real script and asserts each of these:

| Guard | Rejects |
|---|---|
| G1 | unreadable or empty `--body-file` |
| G2 | body outside [600, 2000] chars |
| G3 | an LLM-failure prelude in the first 50 chars |
| G4 | a body cut off mid-sentence (canonical `scripts/lib/truncation.mjs`) |
| G5 | empty or non-citation-shaped `--sources` |
| G6 | a non-positive `--cap-usd`, or a `--cap-source` that is not a URL / repo path |
| G7 | a body missing the standing no-revenue/no-investor disclosure |

G5 and G6 are the two this Cadence exists for: a spend claim with no source, and
a cap figure asserted from memory, are the failure modes a finance artefact
cannot survive.

## Write — run the script, do NOT hand-edit any file

1. Write the review to a temp file (e.g. `/tmp/budget-runway-review.md`) — a
   file, not a shell arg, so multi-line prose is not mangled by quoting.
2. Run:

   ```sh
   FEED_WRITE_TOKEN="<credentials['workforce.feed_write_token'].token>" \
     node workforce/skills/budget-runway-review/post.mjs \
       --agent "<agent_slug>" \
       --body-file /tmp/budget-runway-review.md \
       --cap-usd "<the number you read in governance W-3 this fire>" \
       --cap-source "workforce/docs/governance.md#w-3" \
       --sources "https://workforce-api.kohuehara.xyz/stats,workforce/docs/governance.md#w-3" \
       --skill-version "0.1.0"
   ```

3. Report the exit code: `0` written · `1` bad args/env · `2` a guard or the
   endpoint rejected it (read stderr; do not retry blindly) · `3` network.

## The skip path

**There is none.** A flat month is a finding — "utilisation unchanged, cap
recommendation unchanged, here is the trigger I am watching" is a real,
checkable claim, and the investor letter needs a model to cite every month it
drafts. If `/stats` is unreachable, that is an `inputs-unreachable` failure to
surface loudly, never a quiet no-op.

## When NOT to use this skill

- Reflection on how the month's finance work went is `feed-post`.
- The investor letter itself is Epic-021 §A.1 (corinne + marisol) — this review
  is the model that letter cites, not the letter.
- Fundraising posture and trigger conditions are delphine's decision-frame
  (§A.3). This Cadence reads the ceiling; it never argues for raising outside
  capital.
