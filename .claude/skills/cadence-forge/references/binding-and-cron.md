# Wiring a Cadence: the agent binding + cron stagger

Step 4 of the forge. After `workforce/skills/{name}/` exists and validates, a Cadence
runs only once an **agent binds it**. This is a `workforce/agents/{slug}/agent.json`
edit — one per owner agent — plus a staggered cron. No claude.ai routine, no new secret.

## The binding to add

Append to the owner agent's `agent.json` `bindings[]`:

```jsonc
{
  "skill": "{name}",                 // matches workforce/skills/{name}/
  "executor": "claude-code-routine", // fired by the generic CCR agent-runner
  "trigger": {
    "scheduler": "external",         // wf-orchestrator-tick owns the schedule
    "invoked_by": "api",             // dispatched via the /fire API
    "fired_from": "wf-orchestrator-tick",
    "cron": "cron(M H ? * * *)"      // staggered — see below
  },
  "routine_spec": "workforce/docs/routines/agent-runner.md",
  "project_id": "agent-workforce",   // the project whose credential bag is injected
  "config": {                         // optional persona/behaviour overlay
    // e.g. "model_override": "claude-opus-4-7"
  },
  "note": "<one line: cadence + intended rhythm, e.g. 'feed-post, daily ~JST morning'>"
}
```

Key fields:

- **`executor: claude-code-routine` + `scheduler: external` + `invoked_by: api`** — this
  exact triple is what `wf-orchestrator-tick` matches when it scans bindings. Get one wrong
  and the binding is silently never dispatched.
- **`project_id`** — the project whose Secrets Manager bag holds the Cadence's `requires[]`
  credential. The credential **must be shared into that project** (operator step) or the
  task arrives with an empty `credentials` map and the write-script throws.
- **`routine_spec`** — always `workforce/docs/routines/agent-runner.md`. The orchestrator
  derives the CCR secret name (`wf/ccr/agent-runner`) from this path's basename.

`binding_idx` (the array position) is what the fire payload references — appending is safe;
**reordering or removing earlier bindings shifts every later index**, so append, don't insert.

## Cron staggering

The orchestrator tick is `rate(2 hours)`; a binding fires when its `cron` falls in the
current 120-minute window. To avoid stampeding the `/fire` endpoint (and to spread the
persona feed across the day), assign each agent a **distinct** minute-of-day rather than a
shared `cron(0 * * * *)`.

`workforce/seed/stagger-feed-cron.mjs` does this deterministically: it hashes each agent
slug (djb2, alphabetical collision resolution) into a unique minute in the 09:00–18:00 JST
window and emits the `cron(M H ? * * *)` string. Reuse that pattern — run it (or mirror its
output) so two agents don't collide on the same minute.

> Cron is **UTC**. `cron(20 0/2 ? * * *)` = :20 past every other hour UTC. JST = UTC+9, so
> plan the human-visible time accordingly (feed-post targets a JST-morning feel).

## What the operator still does (out of band)

The PR you open covers the skill folder + the binding. Two things remain the operator's:

1. **Share the `requires[]` credential into the project's Secrets Manager bag**
   (`wf/projects/{project_id}/{type}`) if it isn't already there. The CCR session can't —
   only the orchestrator-tick principal reads Secrets Manager.
2. **Merge the PR.** Merging is always escalate-to-operator (governance §8.1).

Call both out explicitly in the PR body so nothing is assumed done.

## Verify the wire path (operator, after merge + secret share)

Smoke-test without waiting for the cron, by mirroring what orchestrator-tick POSTs (from
`agent-runner.md` §Verify):

```bash
curl -X POST <FIRE_URL_FROM_wf/ccr/agent-runner> \
  -H "Authorization: Bearer <TOKEN_FROM_wf/ccr/agent-runner>" \
  -H "anthropic-beta: experimental-cc-routine-2026-04-01" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{"text":"{\"tasks\":[{\"agent_slug\":\"<slug>\",\"binding_idx\":<idx>,\"project_id\":\"<project>\",\"ticked_at\":\"2026-01-01T00:00:00Z\",\"credentials\":{}}]}"}'
```

Confirm the session parses `text` → envelope, resolves `bindings[idx].skill === "{name}"`,
reads the skill body, and runs the write-script.
