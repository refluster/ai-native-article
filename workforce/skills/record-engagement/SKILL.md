---
name: record-engagement
description: Record one engagement (an EXEC row) in an agent's Track Record — the ADR-0005 activity ledger — for a unit of work done OUTSIDE the automated CCR path (ad-hoc ops, a Claude Code session, a manual fix). Use when an agent (or the operator acting for one) completed real work that should show on their profile's ACTIVITY / RUNS·DELIVERABLES but no cadence skill recorded it. The write mints a short-lived engagement token (AWS creds = the trust gate) and POSTs to wf-agents-api; run it via the workforce-record-engagement GitHub Actions dispatch (no local creds needed) or the operator-credentialed script. Not a cadence — there is no schedule and no project-injected credential.
---

# record-engagement

This skill formalizes the workforce's **ad-hoc activity sink** (ADR-0005 item 5):
how to put one **engagement** — a single EXEC row — onto an agent's Track Record
for work that the automated path didn't capture. It is a **utility skill**, not a
Cadence: nothing schedules it, it holds no project-scoped credential, and it owns
no new write-script — the canonical write already lives at
[`workforce/scripts/record-engagement.mjs`](../../scripts/record-engagement.mjs)
and its CI dispatcher at
[`.github/workflows/workforce-record-engagement.yml`](../../../.github/workflows/workforce-record-engagement.yml).
This SKILL.md is the contract for *when* and *how* to use them.

## What an engagement is

One uniform, queryable business record of one unit of work — the row the operator
reads in an agent's **ACTIVITY / RUNS · DELIVERABLES** deck. It is the only
framework-level activity ledger (ADR-0005). Three things write it, all through the
same `POST {wf-agents-api}/agents/{slug}/engagements` surface:

1. **The CCR `agent-runner`**, automatically, once per task (see
   [`agent-runner.md` step 8](../../docs/routines/agent-runner.md)). Most rows
   come from here — you do **not** use this skill for cadence work.
2. **This skill**, for work done off that path.

## When to use this skill

Record an engagement when **all** of these hold:

- An agent (or the operator acting for one) did **real, completed work** —
  an ops repair, a Claude Code session deliverable, a manual fix, a one-off
  investigation — that belongs on that agent's Track Record.
- **No cadence skill already recorded it.** (Cadence fires self-record via the
  runner; recording again here would double-count.)
- You can name the work in **one business sentence** and, ideally, point to an
  artefact (PR, run, Notion page, kohuehara.xyz URL).

Do **not** use it to backfill cadence runs, to log "I started X" (an engagement
is a *completed* unit), or to inflate a Track Record with non-work.

## The record (what you supply)

| Field | Meaning |
| --- | --- |
| `agent` | whose Track Record this lands on (slug) |
| `skill` | the work label for the EXEC row. A descriptive non-cadence label is fine (`skill-authoring`, `ops-repair`) — R-N1(b) best-effort, not validated against the skill registry |
| `project` | the project id the row is filed under (e.g. `agent-workforce`, `workforce-self`) |
| `status` | `ok` \| `throw` \| `skipped` — the honest outcome |
| `summary` | ONE business-level line, **title-first**, written as an accomplishment, a human result not a machine blob (≤512 chars). Omit for a summary-less row |
| `uri` | the artefact link (PR / run / page) when there is one |

Discipline (mirrors `agent-runner.md` step 8): the `summary` is what the operator
reads — lead with the title, never a technical string. A `skipped` row should say
*why* in its summary. Never fabricate a deliverable to fill a row.

## How to run

The write is owned by the canonical script; this skill never re-implements it.
Pick the path by where you are:

### Path A — GitHub Actions dispatch (no local AWS creds)

The default for a sandboxed/remote session. Dispatch the
**Record workforce engagement (Track Record)** workflow
(`.github/workflows/workforce-record-engagement.yml`) with inputs
`agent`, `skill`, `project`, `status`, and optionally `summary`, `uri`. The
workflow assumes the OIDC role, mints the token, and POSTs — exactly as a local
run would. This is the trust gate: the mint needs AWS credentials the session
itself does not hold.

### Path B — operator-credentialed local run

When you already have AWS creds in the shell (the trust gate):

```sh
node workforce/scripts/record-engagement.mjs \
  --agent {slug} --skill {label} --project {project_id} \
  --status ok \
  --summary "{title-first business sentence}" \
  --uri {artefact_url}
```

The script mints a short-lived `AUTH#ENGAGEMENT` token in DynamoDB
(`dynamodb:UpdateItem` on `wf-table-{stage}` is the trust gate), then POSTs the
engagement with that bearer. Exit non-zero = the POST was rejected; read stderr,
do not retry blindly.

## Why this is not a Cadence

A Cadence is a scheduled, persona-voiced periodic task whose side effect is a
project-credential-scoped write. Engagement recording is **on-demand** (you record
when work completes, not on a clock) and its trust gate is **AWS creds that mint a
token**, not a project-injected capability credential. So `meta.json` carries no
`archetype: cadence`, an empty `requires[]`, and no bundled write-script — and it
is never bound to an agent for the orchestrator to fire.

## Related

- [ADR-0005 — single execution model (CCR)](../../docs/adr/adr-0005-single-execution-model-ccr.md) — item 5 defines the engagement as the one activity sink.
- [ADR-0009 — scoped capability tokens](../../docs/adr/adr-0009-scoped-capability-tokens.md) — why `record-engagement.mjs` mints its own short-lived token.
- [`agent-runner.md` step 8](../../docs/routines/agent-runner.md) — the automatic per-task engagement write (and the skip-reason discipline this skill mirrors).
