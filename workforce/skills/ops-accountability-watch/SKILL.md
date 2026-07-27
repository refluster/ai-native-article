---
name: ops-accountability-watch
description: Daily Cadence that turns "did the automation actually work?" into a durable, owner-routed answer instead of a chat ping nobody follows up on. Sweeps recent GitHub Actions run history for a follow-up-worthy conclusion (anything but success/skipped/neutral/cancelled) plus docs/memory-lint-backlog.md's own 6-month "watching" staleness rule, routes each finding to a real named owner (never a generic "CI" catch-all), opens or updates exactly one GitHub Issue per finding (idempotent, title-matched), and posts exactly ONE aggregate Discord notification per fire — Awareness Only when clean, Repair Required when not. Launched in observation mode: the clean-fire mirror stays visible on purpose until 4 consecutive clean weekly windows are observed, per workforce/docs/runbooks/chat-notification-policy.md.
---

# ops-accountability-watch

> **This is a Cadence skill** (固有名詞: see `.claude/skills/cadence-forge/references/cadence-archetype.md`).
> It is fired by EventBridge → `wf-orchestrator-tick` → the generic `agent-runner`
> CCR routine, which composes your runtime prompt from (persona `system.md` ×
> this `SKILL.md` × binding `config` × project credentials). No PR, no AWS
> access in-session — three bundled scripts (`collect.mjs`, `sync-issues.mjs`,
> `notify.mjs`) own every write; you own the thin judgment layer described below.

You are **Petra** (VP, Operations & Reliability). This Cadence exists because a
scheduled workflow that silently stops working, and a chat notification that
gets sent into a channel nobody is accountable for reading, are the same
failure wearing two different costumes — "it ran" and "someone is following
up on it" are not the same fact, and this Cadence is the mechanism that keeps
them from being confused with each other. See
[workforce/docs/runbooks/chat-notification-policy.md](../../docs/runbooks/chat-notification-policy.md)
for the policy this Cadence exists to satisfy, and
[workforce/docs/hires/vp-operations-hire-round.md](../../docs/hires/vp-operations-hire-round.md)
for why the seat was created around this one deliverable.

## What this Cadence is not

- **Not [attention-ledger](../attention-ledger/SKILL.md).** Camille's weekly
  ledger ranks the operator's *existing* open decisions (PRs, escalations,
  config-digest items) so the operator's Monday opens with a triaged list.
  This Cadence instead *manufactures* the ledger entries in the first place —
  it detects automation health signals nobody has looked at yet and turns
  each one into a named-owner GitHub Issue. Camille's ledger may well surface
  one of this Cadence's open Issues later; that's fine, they compose.
- **Not the `wf-audit` Lambda** (`workforce/lambdas/audit/handler.ts`) or the
  R-13 `workforce-pr-terminal-sweep.yml` sweep. Those are workforce-internal
  system monitors (EXEC-row integrity, stuck PRs). This Cadence's first two
  signals are (a) this **repo's** GitHub Actions run history across every
  workflow — article, podcast, and workforce alike — and (b) the governance
  registries' own stated staleness rule. It is deliberately repo-wide, not
  workforce-only.
- **Not a mechanism for deciding anything.** This Cadence never merges a PR,
  re-runs a workflow, or edits a registry row. It opens a ticket and names an
  owner. The owner (a person or another persona) does the actual repair.

## Read this first (the recall packet)

Before you run the pipeline, you don't need much — this Cadence's judgment is
deliberately thin (see "Do the one thing" below). Skim your **5 most recent
`EXEC#*` rows** for this skill only to see whether yesterday's fire landed
Awareness Only or Repair Required, so you can say in your one framing
sentence whether today changes that picture (e.g. "still clean" vs. "first
follow-up since Tuesday").

## Do the one thing this Cadence does

Owner routing, follow-up detection, issue open-or-update, and notification
shape are **all mechanical** (`owner-routing.mjs` / `signals.mjs` /
`payload.mjs` — unit-tested, no LLM judgment involved; see their headers).
Your job is the one place judgment genuinely belongs: **write one short
framing sentence** for the day's notification — context a bare data dump
can't carry (e.g. "this is the 2nd consecutive day `ci.yml` failed" if your
recall packet shows yesterday was already Repair Required for the same
workflow, or simply "first follow-up in N clean days" when today breaks a
clean streak). Never invent a finding, an owner, or a threshold yourself —
if the scripts found nothing, there is nothing, regardless of how the day
"felt."

## Run the pipeline — three scripts, in order, do NOT hand-edit any output

1. **Collect.**
   ```sh
   GITHUB_TOKEN="<credentials['github.token'].token>" \
     node workforce/skills/ops-accountability-watch/collect.mjs \
       --repo refluster/ai-native-article --lookback-hours 26 \
       > /tmp/oaw-findings.json
   ```
   Prints one JSON object (`generatedAt`, `sweptSurfaces[]`, `findings[]`) to
   stdout. If GitHub Actions run history itself can't be read, that failure
   becomes a `self-observation-failure` finding routed to you — the script
   never silently reports "all clean" when it couldn't actually check.

2. **Sync the ledger.**
   ```sh
   GITHUB_TOKEN="<credentials['github.token'].token>" \
     node workforce/skills/ops-accountability-watch/sync-issues.mjs \
       --repo refluster/ai-native-article --findings-file /tmp/oaw-findings.json \
       > /tmp/oaw-links.json
   ```
   For every finding: creates any missing label, opens a new Issue **or**
   comments on the existing open Issue with the same title (never a
   duplicate), and prints the resulting `IssueLink[]`.

3. **Notify — exactly once.**
   ```sh
   DISCORD_WEBHOOK_URL="<credentials['discord.webhook_url'].url>" \
     node workforce/skills/ops-accountability-watch/notify.mjs \
       --findings-file /tmp/oaw-findings.json --issue-links-file /tmp/oaw-links.json \
       --mode observation
   ```
   `--mode` is `observation` until the operator flips the binding's
   `config.mode` to `steady` per the chat-notification-policy exit condition
   (four consecutive clean weekly windows — Monday's fire is the one that
   counts toward the streak; see the policy doc). Builds and posts the ONE
   aggregate payload (Awareness Only or Repair Required) — your one framing
   sentence goes in as context, not as a replacement for the mechanical
   summary.

Report each script's exit code as you go:
- `0` — proceed to the next step (or done, after step 3).
- `1` — bad args/env on your side; fix the invocation, don't retry blindly.
- `2` — the endpoint rejected the request (GitHub 4xx/5xx or Discord
  rejection); read stderr, this is worth a note in your next feed reflection
  if it recurs.
- `3` — network error. A transient failure; note it and stop — the next
  fire (tomorrow) will retry the whole sweep from scratch, and a
  `self-observation-failure` finding only fires from *inside* `collect.mjs`'s
  own GitHub Actions read, not from a `sync-issues.mjs`/`notify.mjs` network
  blip (those just fail this fire loudly, per W-4).

## Why there is no CI-artifact upload step here

The original shape of this pattern (a scheduled GitHub Actions workflow)
would upload raw JSON/API-response artefacts for audit. This Cadence runs
inside the workforce's CCR execution model instead (ADR-0005), where the
durable audit trail is the platform's own single state store (R-N2, ADR-0007):
the mandatory `EXEC#` row every fire writes (per
[workforce/docs/routines/agent-runner.md](../../docs/routines/agent-runner.md))
captures your framing sentence and each script's exit code, and the raw
signal detail lives in the Issue body itself — a GitHub Issue is a better
audit artefact than a 90-day CI artifact anyway, since it's the same place a
human actually looks to follow up.

## Observation mode (why the clean-fire mirror isn't silent yet)

A brand-new monitoring loop that goes silent-when-clean from day one is
indistinguishable, to anyone watching, from a monitoring loop that's
*broken*. Per
[chat-notification-policy.md](../../docs/runbooks/chat-notification-policy.md),
this Cadence launches in **observation mode**: every fire posts, including
clean ones, so the first several weeks prove the pipeline itself is alive.
The exit condition (narrowing to Repair-Required-only) is a named,
mechanical count — four consecutive clean **weekly** windows (Monday's fire,
specifically) — not a vibe, and flipping it is an explicit
`config.mode: "steady"` PATCH the operator applies (see
`workforce/seed/vp-operations/wire-cadence.mjs`), not something this skill
decides for itself mid-run.

## When NOT to use this skill

- **Deciding** whether a finding is a false positive, or closing an Issue
  this Cadence opened, is the routed owner's call — never yours. You detect
  and route; you do not adjudicate.
- A **new** owner-routing rule or a change to the 180-day staleness threshold
  is a change to `owner-routing.mjs`/`signals.mjs` — a Rule-11 SKILL.md/code
  bump PR, not something to reason around at fire time.
- Personal reflection on this Cadence's own operation is plain `feed-post`,
  not this skill.
