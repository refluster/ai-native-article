# Workforce — Architecture (v1)

> **Status (2026-09-05): partly superseded — read with the ADRs.** This v1 text predates several accepted decisions and has not been rewritten. Where they disagree, the ADRs win:
> - Execution: every (project × agent × skill) task runs as a **Claude Code Remote routine** dispatched by `wf-orchestrator` ([ADR-0005](adr/adr-0005-single-execution-model-ccr.md)). There is no `wf-agent-runner` Lambda; the engineer path is the GHA routine described under R-N1.
> - Agent config: the `workforce/agents/` git tree is retired; `AGENT#{slug}` rows in DynamoDB, written only through agents-api, are the single source ([ADR-0007](adr/adr-0007-agent-config-single-source.md)); skills likewise ([ADR-0008](adr/adr-0008-skill-config-single-source.md)).
> - Surfaces: the HTTP API (`workforce-api.kohuehara.xyz`), the console SPA (`workforce/app/`), messaging ([ADR-0006](adr/adr-0006-realtime-messaging-reply.md)), the podcast ([ADR-0016](adr/adr-0016-podcast-production-surface.md)) and project tools ([ADR-0027](adr/adr-0027-project-tools-surface.md)) all exist; "five personas" is the founding roster, not the current one.
> The data model in [data-model.md](data-model.md) and the rules in [governance.md](governance.md) are current. A full rewrite of this file is a Zone A change.

This is the operating shape of the AI agent workforce. It governs every workforce PR until it's amended via a Zone A change (see [governance.md](governance.md)).

## What this subsystem is

Five AI personas — **Sora** (Researcher / Analyst), **Maya** (PM / Founder), **Ren** (Engineer), **Aoi** (Designer), **Yuki** (GTM / Customer) — operating as a small product-development organisation. They generate output across three product streams:

| Stream | What it produces | Primary surface |
|---|---|---|
| `internal` (dogfooding) | Improvements to the workforce platform itself | GitHub PRs on this repo |
| `client` (independent SaaS) | Features / docs / launches for a client SaaS project | GitHub PRs on the client repo + ancillary artefacts |
| `editorial` (the "SNS") | Articles published on `kohuehara.xyz` under a persona byline | Existing Notion → GAS L4 → gh-pages pipeline |

A single `agent-runner` Lambda handles all five personas; differences between agents are **data** (`agent.json` + `system.md` + assigned skills), not code.

## System diagram

```
       EventBridge rules                                                Secrets Manager
       wf-{agent}-{cadence}-{stage}                                     wf/{anthropic,azure-openai,notion,github}
            │                                                                  ▲
            ▼                                                                  │
    ┌──────────────────┐       async invoke         ┌───────────────────────┐  │
    │ wf-orchestrator  │─────────────────────────▶  │ wf-agent-runner       │──┘
    │ Lambda           │                            │ Lambda                │
    │ (どのエージェントに │                            │ (5 personas in one    │
    │  何をさせるか)     │◀──── DDB read/write ─────▶│  function; behaviour  │
    └──────────────────┘                            │  resolved from data)  │
            │                                       └──────┬────────────────┘
            │ TASK#{id} 行を                               │  ┌──────────────────┐
            │ DDB に enqueue                               │  │ Anthropic API    │
            │                                              ├─▶│ Azure OpenAI     │ ← inference
            │                                              │  └──────────────────┘
            ▼                                              │
    ┌──────────────────┐                                   │  ┌──────────────────────────┐
    │ DynamoDB         │ ◀─ memory/run/deliv writes ───────┤  │ Notion API (article ins.) │
    │ wf-table-{stage} │                                   ├─▶│ GitHub API (PR watch)     │ ← side effects
    └──────────────────┘                                   │  │ GHA workflow_dispatch     │
            │                                              │  │ (Engineer only — R-N1 exc.) │
            ▼                                              │  └──────────────────────────┘
    ┌──────────────────┐                                   │
    │ S3 wf-bucket-…   │ ◀─ memory chunks / drafts ────────┘
    └──────────────────┘

    Observability: CloudWatch (Logs, Metrics, Billing/Error alarms → SNS).
    API surface:   API GW HTTP API arrives in v2 (chat + agent directory).
                   In v1, runners are invoked only by EventBridge and Lambda async invoke.
```

## Lambda responsibilities

The workforce runs on **two Lambdas** (v1). API GW–fronted Lambdas (`chat-api`, `agents-api`) arrive in v2; their handlers will use the same shared libs.

### `wf-orchestrator-{stage}`

- Triggered by per-agent EventBridge rules and (v2) by API GW.
- Reads `agent.json` and DDB state for the named agent: pending tasks, recent runs, monthly token budget.
- Decides: "should this agent run now, and if so, what task?" Skips if a task is already pending, or if the monthly budget guard would breach.
- Writes a `TASK#{ulid}` row and async-invokes `wf-agent-runner` with the task id.

### `wf-agent-runner-{stage}`

- Triggered by orchestrator async invoke (and v2: by API GW for chat).
- Loads agent definition (`agent.json`, `system.md`), assigned skills (`skills/{name}/SKILL.md`), and the agent's memory index from DDB + S3.
- Calls the LLM (Anthropic or Azure OpenAI, routed by `agent.json:model`) with `finish_reason==='length'` guard (W-4).
- Executes the deliverable's side effect:
  - `type=article` → insert into Notion DB with `Author=<slug>`. Existing GAS L4 batch picks it up and publishes to `kohuehara.xyz`.
  - `type=pr` → trigger GHA `workforce-engineer-routine.yml` via `workflow_dispatch` (Ren only; R-N1 exception).
  - `type=plan` / `type=design-doc` / `type=launch-plan` → write to DDB and/or Notion per the type's defined target.
- Records `RUN#{ulid}` (cost, tokens, status) and `DELIV#{ulid}` (artefact pointer) rows in DDB. Conditional write with `memver` for memory updates (lost-update prevention).

## The R-N1 exception — Engineer's Claude Code routine path

Ren (Engineer) cannot run interactive code-writing tooling inside Lambda. The only documented deviation from "all reasoning runs on Lambda" is:

```
wf-agent-runner (Ren)
   │
   ├─ LLM call to build the task brief (what to change, why, acceptance criteria)
   │
   ├─ POST to GitHub Actions workflow_dispatch — workforce-engineer-routine.yml
   │       │
   │       ▼
   │   Claude Code routine on GHA (writes code, opens draft PR)
   │       │
   │       ▼
   │   draft PR appears on the target repo
   │
   ├─ wf-agent-runner exits immediately. Does NOT block.
   │
   └─ EventBridge rule wf-engineer-poll-{stage} (every 5 min) wakes wf-orchestrator,
      which calls GitHub API to find Ren's recent PRs.
      ├─ PR found and ready → DELIV#{id} type=pr, memory updated, alerts cleared
      └─ No PR within 24h → DLQ + W-4 alarm
```

This exception is the only one. All other persona work — Sora's research synthesis, Maya's hypothesis posts, Aoi's design notes, Yuki's positioning content — flows through the single `wf-agent-runner` path.

## What this v1 does NOT include

Deferred to v2+ and out of scope for the PR1–PR12 sequence below unless explicitly added:

- API Gateway HTTP API (`wf-chat-api`, `wf-agents-api`). v1 has no chat UI.
- CloudFront / S3 distribution for a separate `workforce.kohuehara.xyz` frontend. Workforce-side surfaces (agent profile, directory) live on the existing gh-pages SPA's `/workforce/*` routes.
- Inter-agent orchestration (Maya hands a task to Ren via DDB). Each agent's cron is independent in v1.
- External signal ingestion (RSS scan, SNS scrape). Sora's first iteration writes from system.md domain knowledge.
- Multi-stage workflows spanning days (Step Functions). v1 tasks complete in a single Lambda invocation.

See the plan file shared with this branch's session for the full PR1–PR12 sequence.

## Skill bundle convention

Each skill is a self-contained folder under `workforce/skills/{name}/`:

```
workforce/skills/{name}/
  SKILL.md      ← Anthropic Agent Skills frontmatter (name + description) + body
  meta.json     ← workforce-internal sidecar (executor, version, owners, deliverable)
  handler.ts    ← deterministic executor only — auto-registered, no edits to lambdas/
```

Adding a deterministic skill means dropping this folder; the agent-runner's `shared/skill-registry-generated.ts` (produced by `workforce/scripts/build-skill-registry.mjs`) picks it up at build time via the import graph. Skills can `import` from `workforce/lambdas/shared/*` (the workforce-provided runtime API surface — `webhook.ts`, `skill-types.ts`, etc.); the reverse direction is forbidden by the auto-registry boundary. This keeps the agent×skill relationship M:N at the data layer (any agent can bind any skill via `bindings[]`) and at the file layer (skills don't know about which agents own them; agents don't know how skills are implemented).

## How to read alongside other docs

- **[governance.md](governance.md)** — the rules: invariants W-1..W-5, design rules R-N1..R-N8, zone classifications for `workforce/`, action-authority matrix.
- **[naming.md](naming.md)** — the R-N7 naming table in full, plus what `validate-naming.mjs` enforces.
- **[data-model.md](data-model.md)** — DDB single-table schema, S3 prefix layout, Notion DB extensions.
