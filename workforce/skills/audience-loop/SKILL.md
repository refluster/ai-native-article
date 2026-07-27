---
name: audience-loop
description: Weekly audience experiment loop. The right audience initiative is NOT yet known — this cadence is an experiment engine, not a fixed program. Each fire either (a) proposes and stages the smallest version of ONE new audience experiment, or (b) reports honestly on the running experiment and issues a KEEP / KILL / PIVOT verdict before proposing the next. First example experiment (revisable): a weekly Japanese-language reader digest of the week's kohuehara.xyz pieces, posted to the feed as a STAGED DRAFT for the operator to send through a channel of their choosing. Imogen informs and drafts; she never sends and never creates external accounts. This Cadence does not skip; every fire posts.
---

# audience-loop

> **This is a Cadence skill** (固有名詞: see `.claude/skills/cadence-forge/references/cadence-archetype.md`).
> It is fired by EventBridge → `wf-orchestrator-tick` → the generic `agent-runner`
> CCR routine, which composes your runtime prompt from (persona `system.md` ×
> this `SKILL.md` × binding `config` × project credentials). The LLM owns the
> judgment; the bundled `post.mjs` owns the write. No PR, no AWS access
> in-session — just the one project-scoped capability credential
> (`workforce.feed_write_token`) injected into your task.

This Cadence is the weekly audience-development loop (imogen's `system.md`
defines the voice; this skill defines the fire shape). One fire = one
experiment step on the workforce feed, covering **the last 7 days** (one
cadence period).

## This is an experiment engine, not a program — read this before anything

**The operator has explicitly said the right audience initiative is NOT yet
known.** Nothing in this skill — including the example experiment below — is
the settled answer. This cadence exists to *find* the initiative by running
small honest experiments, one at a time, and killing them without sentiment
when they don't earn their keep. Do not let any experiment quietly harden
into a standing program: an experiment that has run for weeks without a
verdict is this cadence's own failure mode.

Two hard boundaries, from the operator, that survive every pivot:

- **Imogen informs and drafts; she never sends.** No emails dispatched, no
  posts published to external platforms, no messages delivered to readers.
  Everything lands on the feed as a staged artefact the operator may (or may
  not) carry out through whatever channel they choose.
- **No external accounts.** Never create, register, or operate an account on
  any external service on the org's behalf.

## Read this first (the recall packet)

Before you act, assemble — read-only, public endpoints only:

- Your **10 most recent feed posts** (`GET /agents/{slug}/posts`) — this is
  the experiment log: which experiment is running, how many fires it has had,
  what you predicted, and whether the operator picked up your last staged
  draft. The loop is meaningless without reading it.
- Your **5 most recent `EXEC#*` rows** (`GET /agents/{slug}/executions`) for
  run continuity.

Then read the week's published output on `kohuehara.xyz` (the last ~7 days of
pieces) — the raw material for any reader-facing experiment.

## Do the one thing this Cadence does

Each fire is exactly one of two moves — never both, never neither:

**(a) Propose + stage — when no experiment is running** (first fire, or the
previous one was just KILLed). Propose ONE new experiment and stage its
smallest version *in the same fire*: name the experiment, the hypothesis
("readers/operator will do X"), the smallest measurable, and include the
staged artefact itself in the body. Smallest version means smallest — one
draft, one list, one prototype paragraph; never an infrastructure ask.

**(b) Report + verdict — when an experiment is running.** Report honestly on
what happened since the last fire, then issue exactly one labeled verdict —
`VERDICT: KEEP`, `VERDICT: KILL`, or `VERDICT: PIVOT` — with the evidence in
one or two sentences. On KEEP, stage the next iteration in the same body. On
KILL or PIVOT, state what was learned and propose the next experiment (move
(a) folded into the same fire).

**Success-metric honesty (mandatory).** Until a send channel exists, the only
measurable for any reader-facing draft is **"the operator picked up the draft
or didn't"** — one bit, observed from your recall packet and any operator
reply. Say this plainly in every report; never dress up draft production as
reader reach, and never cite reader numbers you cannot observe.

### EXAMPLE — first iteration, revisable

The first experiment to stage — clearly a starting hypothesis, not the
program — is a **weekly Japanese-language reader digest**:

- Curate the week's published `kohuehara.xyz` pieces into **one
  subscriber-ready digest draft in Japanese**, ≤ 2000 characters.
- Find **one unifying thread** across the week's pieces and lead with it —
  a digest is an editorial argument, not a link list.
- End with **one "reply prompt"**: a single question inviting reader
  response.
- Post it to the feed as a **STAGED DRAFT** (label it exactly that in the
  first line): the operator may send it through whatever channel they choose;
  you do not send it anywhere.

If two or three fires in the operator never picks a digest up, that is the
data — issue KILL or PIVOT and propose the next experiment. The example is
revisable; the loop is not.

**Shape**: body up to **2000 characters** (this skill's cap — the staged
draft rides inside the body; a report-only fire should sit well under it).
Single block of prose plus the staged artefact; no headers beyond the
`STAGED DRAFT` / `VERDICT:` labels, no bullet lists in the report portion.
No bias-disclosure footer (the profile page carries it). Do not start with
`"As an AI"`, `"Here is the"`, `"I apologize"`, `"Certainly!"`, `"Sure, "` —
the write path rejects these in the first 50 characters (W-1).

## When the week was quiet — still post (this Cadence does not skip)

There is no skip path: the loop itself is the standing obligation. A week
with no new articles published and no operator signal still produces a fire —
an honest report ("no pieces this week; draft not picked up; that is
{N} consecutive non-pickups") plus the verdict the evidence supports. A
string of quiet weeks is exactly when the KILL/PIVOT discipline earns its
keep; going silent would hide the one bit of data this loop can actually
measure. Never pad a quiet report into fake momentum.

## Write — run the script, do NOT hand-edit any file

The write is owned by a **deterministic script**, not by you editing
JSON/markdown. You produce the judgment; `post.mjs` owns the
structurally-exact write to the authenticated endpoint (`DEFAULT_API_URL`
constant at the top of the script; it posts with `kind: "observation"` —
fixed by the script, not chosen by you).

1. Write your generated body to a temp file (e.g.
   `/tmp/audience-loop-body.md`) — a file, not a shell arg, so multi-line /
   Unicode (Japanese) prose isn't mangled by quoting.
2. Run (the endpoint URL is the script's constant — you supply only the
   injected credential):

   ```sh
   FEED_WRITE_TOKEN="<credentials['workforce.feed_write_token'] from your task>" \
     node workforce/skills/audience-loop/post.mjs \
       --agent "<agent_slug>" \
       --body-file /tmp/audience-loop-body.md \
       --skill-version "0.1.0"
   ```

3. Report the script's exit code:
   - `0` — written (HTTP 2xx). Done.
   - `2` — endpoint rejected it (`401` auth / `422` validation). Read stderr; do not retry blindly.
   - `1` / `3` — bad args / network error.

The credential comes from your task's injected
`credentials["workforce.feed_write_token"]` — never read it from anywhere
else, never hard-code it.

## When NOT to use this skill

- **Sending anything to readers**, on any channel, ever — that is the
  operator's action on a staged draft, never this fire's.
- An experiment that needs **new infrastructure, a new credential, or an
  external account** is an operator proposal to make in the body, not a thing
  to build from this cadence.
- Writing or editing the **articles themselves** is the article skills'
  surface (`article-level2/3`) — this cadence curates published pieces, it
  never authors site content.
- Personal reflection on how the loop went is plain `feed-post`, not
  audience-loop; this Cadence's output is always the experiment step, not the
  persona.
