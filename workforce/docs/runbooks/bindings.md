# Runbook — Agent bindings (R-N4 unified declaration)

Every scheduled or event-driven workforce execution lives in exactly one place: `workforce/agents/{slug}/agent.json:bindings[]`. This runbook explains the shape, when to use each executor, and how the operator instantiates non-Lambda bindings (CCR / GHA).

See also [governance.md §4 R-N4](../governance.md#4-r-n-design-rules-basic-design-simplicity).

## Binding shape

```jsonc
{
  "skill": "<kebab-case-name>",
  "executor": "lambda" | "claude-code-routine" | "gha" | "cli",
  "trigger": {
    "scheduler": "eventbridge" | "claude-code-routine" | "gha" | "external" | "manual",
    "cron": "cron(...)",                  // when scheduler is cron-driven
    "github_event": "pull_request.labeled", // when scheduler reacts to GH events
    "filter": { "label": "wf:needs-review-dario" },
    "invoked_by": "api" | "repository_dispatch" | "manual", // for scheduler=external
    "fired_from": "agents/maya/skills/pdm-decompose"          // audit trail for external
  },
  "routine_spec": "workforce/docs/routines/<name>.md", // for executor=claude-code-routine
  "workflow": ".github/workflows/<name>.yml",          // for executor=gha
  "config": { /* skill-specific persona overlay; see below */ },
  "note": "Human-readable cadence note. Renders in the UI."
}
```

## The `config` field — persona overlay (Skills are persona-agnostic)

Per PR #112's "task assignment is fluid" principle, **skill specs are persona-agnostic** (the routine_spec describes the task contract; what the task IS). The **persona overlay** — how a specific agent does this task — lives in the binding's `config` field.

Examples:

- `pr-review` is one generic spec; Dario's binding has `config.lens_name = "architecture"` with R-N\* / cost / audit checklist; Ren's binding has `config.lens_name = "engineering"` with TS-idiom / test-coverage checklist; Aoi's has `config.lens_name = "design"`.
- `pr-route` is one generic spec; Maya's binding has `config.nomination_rules` for who-to-nominate-when; a future Dario-as-router binding could carry different rules.
- `pr-implement` is one generic spec; Dario's binding has `config.model_override = "claude-opus-4-7"` + `self_check_lens = "architecture"`; a different persona's binding could override to Sonnet + the engineering lens.

The runtime composes the working prompt as: **generic spec + persona voice (`system.md`) + binding config**. Adding a new persona to a skill is one new binding entry + one new config block — no skill-spec rewrite.

The `config` schema is skill-specific; validators check structural fields (executor, scheduler, routine_spec existence) but not the config contents — those are owned by the skill spec author. Tighter schema validation per skill is FU-018.

## Executor × scheduler compatibility

| executor | allowed schedulers | where the artefact lives |
|---|---|---|
| `lambda` | `eventbridge`, `external`, `manual` | `workforce/skills/{name}/` (folder with `meta.json`, `SKILL.md`, optional `handler.ts`) |
| `claude-code-routine` | `claude-code-routine`, `external`, `manual` | `routine_spec` markdown under `workforce/docs/routines/`. `manual` is the **declarative-pending** shape: the routine exists as a spec but is not auto-fired (e.g. invoked conversationally as a sub-agent today, future CCR API trigger). The `routine_spec` is the load-bearing artefact in this mode. |
| `gha` | `gha`, `external` | `workflow` YAML under `.github/workflows/` |
| `cli` | `manual` | nothing — declarative only; binding documents that the skill is invokable on demand. Use `cli` when there is no `routine_spec`; use `claude-code-routine + manual` when the spec exists but is operator-invoked today. |

The orchestrator-tick (`wf-orchestrator-tick-{stage}`) dispatches bindings where `executor=lambda` AND `trigger.scheduler=eventbridge`. `lambda` bindings with `scheduler=external` are fired by another binding's API GW call (notably `wf-webhook-{stage}` in Phase 7) or by another Lambda's async invoke. `lambda` bindings with `scheduler=manual` are operator-driven: `aws lambda invoke --function-name wf-agent-runner-{stage} --payload '{"agent":"nadia","binding_idx":N,"project_id":"asp-cloud","args":{...}}' out.json`. All non-`lambda` bindings are documentation + audit; they are fired by their respective schedulers (CCR cloud / GHA / external POST).

## How to add each kind of binding

### `executor: lambda` — orchestrator-tick fires the wf-agent-runner

This is the original v1 shape, unchanged behaviour. The skill folder under `workforce/skills/{name}/` carries `meta.json` (which sets `owners[]`, must include this agent's slug) and either a `handler.ts` (deterministic) or `SKILL.md` (llm-prose / claude-code-routine).

```jsonc
{
  "skill": "discord-ping",
  "executor": "lambda",
  "trigger": { "scheduler": "eventbridge", "cron": "cron(0 0/6 * * ? *)" },
  "note": "Heartbeat every 6h"
}
```

No operator action needed beyond merging the PR — the orchestrator picks it up on the next tick after the data-plane deploy.

### `executor: claude-code-routine` — CCR in operator's claude.ai cloud

Use this when the work is heavy code-authoring, multi-file design, or anything that benefits from full Claude Code tool access (Read/Edit/Bash/MCP) and the operator's Claude subscription budget.

**Two-step process.** The repo holds the *specification* (so it's PR-reviewable, lint-checked, version-controlled). The operator separately instantiates the actual routine in their claude.ai/code/routines account.

1. **In the PR**: add a binding entry referencing a `routine_spec` markdown file.
2. **Operator action (post-merge)**: at [claude.ai/code/routines](https://claude.ai/code/routines), create the routine using the prompt + trigger + connectors documented in the spec.

CCR can be **schedule-triggered**, **GitHub-event-triggered**, or **API-triggered** (`/fire` endpoint with bearer token).

```jsonc
// CCR fired by Maya's Lambda via /fire API:
{
  "skill": "vp-engineering-implement",
  "executor": "claude-code-routine",
  "trigger": {
    "scheduler": "external",
    "invoked_by": "api",
    "fired_from": "agents/maya/skills/pdm-decompose"
  },
  "routine_spec": "workforce/docs/routines/dario-implement.md"
}
```

```jsonc
// CCR fired on PR label add (GitHub event):
{
  "skill": "pr-review",
  "executor": "claude-code-routine",
  "trigger": {
    "scheduler": "claude-code-routine",
    "github_event": "pull_request.labeled",
    "filter": { "label": "wf:needs-review-dario" }
  },
  "routine_spec": "workforce/docs/routines/dario-review.md"
}
```

**API token storage.** When a binding uses `scheduler: external, invoked_by: api`, the operator generates a `/fire` token in claude.ai/code/routines (shown once) and stores it in Secrets Manager at `wf/ccr/{skill-name}`. The invoking Lambda fetches the token from there at runtime. The routine_spec doc records this storage path.

### `executor: gha` — GitHub Actions workflow

Use this when the work needs a CI-runner shape (matrix builds, large checkouts, deploy gates) AND the team already has a GHA workflow doing the work. Today the only consumer is Ren's path (skill `code-task-brief` runs in Lambda and *dispatches* a GHA workflow — that dispatch is part of the skill, not a separate binding).

If a binding is truly GHA-native (the GHA workflow itself is the routine, fired by GHA cron):

```jsonc
{
  "skill": "deploy-workforce-data-plane",
  "executor": "gha",
  "trigger": { "scheduler": "gha", "cron": "0 7 * * *" },
  "workflow": ".github/workflows/deploy-workforce-data-plane.yml"
}
```

R-N1 still constrains this: GHA cron for workforce work is only permitted via this declared binding path. A workflow with `on.schedule:` but no corresponding binding entry is an R-N4 violation.

### `executor: cli` — operator runs it manually

Declarative entry for skills that exist but have no automatic schedule. The binding documents that the skill is invokable (so it shows up in agent profile listings) but does not fire it. Useful for ad-hoc skills like `pdm-charter` (operator triggers when a new Epic lands).

```jsonc
{
  "skill": "pdm-charter",
  "executor": "cli",
  "trigger": { "scheduler": "manual" },
  "note": "Operator runs after committing a new Epic."
}
```

## Migrating an existing binding to a new executor

Bindings are immutable per-PR (Rule 11 / R-N8: one prompt-version-bump per PR). Changing executor of an existing skill is a Zone B change that bumps `skill.meta.json:version` because the runtime contract changes. Open a separate PR for the executor change; don't piggyback it on a content edit.

## CI lint summary

The agents-api write-time validator (`workforce/lambdas/shared/agent-config.ts`, ADR-0007 — formerly the `validate-agent-json.mjs` CI lint) enforces:

- shape rules (`S9-binding-*`)
- executor × scheduler compatibility (`S9-binding-compat`)
- cron presence when required (`S9-binding-cron`, `S9-binding-ccr-trigger`)
- `external` scheduler must have `invoked_by` (`S9-binding-external-invoked-by`)
- `routine_spec` / `workflow` presence and file existence (`S9-binding-routine-spec`, `R8-routine-spec-exists`, `S9-binding-workflow`, `R8-workflow-exists`)
- `executor=lambda` skill folder + owner cross-checks (`R8-binding-skill-exists`, `R8-binding-skill-owner`)

Lint failures block the PR. Loosening any of these is Zone A (governance amendment).
