# The Cadence archetype (固有名詞)

> The canonical specification of the **Cadence** skill archetype. This is the
> single source of truth the `cadence-forge` skill scaffolds toward and the
> `validate-skills.mjs` `C1`–`C3` rules enforce. `feed-post` is instance #1.

## Definition

A **Cadence** is a scheduled, persona-voiced workforce skill with all of the
following properties:

1. **Scheduled by EventBridge, dispatched by one orchestrator.** It is fired by
   `wf-orchestrator-tick` — a Lambda on an EventBridge `rate(2 hours)` schedule —
   which scans every agent binding, matches the binding's `cron(...)` against the
   current tick window, and dispatches the matches. No per-skill EventBridge rule.
2. **Run by the single generic CCR routine.** Dispatch is a POST to the **one**
   `agent-runner` CCR `/fire` URL (`workforce/docs/routines/agent-runner.md`). Adding
   a Cadence never requires a new claude.ai routine or a new Secrets Manager entry.
3. **Context composed from (agent × skill × project).** At fire time the runtime
   prompt is `persona system.md` × `this SKILL.md` × `binding.config` × the project's
   injected credentials. The skill body is persona-agnostic; the persona overlay and
   the project credentials are supplied per-task.
4. **LLM judgment, deterministic write.** The LLM produces the *content*; a **bundled
   `*.mjs` write-script** owns the *write* — POSTing to an authenticated endpoint with
   a project-scoped capability credential. The session never hand-edits the backing
   store and never holds AWS credentials.
5. **No PR, no human-approval gate, no AWS access in-session.** The write lands directly
   in the backing store via the endpoint, which validates the injected token.

## The wire path (one fire)

```
EventBridge rate(2h)
  └─> wf-orchestrator-tick  (scan bindings; for each executor=claude-code-routine,
        │                    scheduler=external, invoked_by=api binding whose cron
        │                    matches the tick window:)
        │     • resolve the project's credentials (Secrets Manager wf/projects/{id}/{type})
        │     • collect into a batch, grouped by routine_id
        └─> POST { text: JSON.stringify({ tasks: [ {agent_slug, binding_idx,
                    project_id, ticked_at, credentials}, … ] }) }  to the ONE
                  agent-runner /fire URL (secret wf/ccr/agent-runner)
                    └─> agent-runner CCR session:
                          parse text → envelope; per task (isolated):
                            • resolve (skill, persona, config) from agent.json[binding_idx]
                            • assemble recall packet (read-only, public workforce API)
                            • LLM generates judgment
                            • run workforce/skills/{skill}/{write-script}.mjs
                                using ONLY task.credentials[type]
                                  └─> POST authenticated endpoint → backing store
```

## The four invariants (what makes it a Cadence, not just a scheduled skill)

A skill tagged `"archetype": "cadence"` in `meta.json` MUST hold all four. The first
three are mechanically enforced (`validate-skills.mjs`); the fourth is a body contract.

| # | Invariant | Enforced by |
| --- | --- | --- |
| **I1** | **LLM judgment** — `executor ∈ {llm-prose, claude-code-routine}` (never `deterministic`; a Cadence has a judgment step). | `C1-cadence-executor` |
| **I2** | **Scoped credential** — non-empty `requires[]`; the one project-scoped token its write-script POSTs with. | `C2-cadence-requires` |
| **I3** | **Deterministic write** — a bundled `*.mjs` write-script ships in the skill folder (the LLM never hand-edits the backing store). | `C3-cadence-write-script` |
| **I4** | **Read-only recall + an explicit skip rule** — the SKILL.md body reads a recall packet over public endpoints only and states when NOT to write this fire. | body review |

## What is NOT a Cadence

- A skill whose deliverable is a **committed repo artefact** (e.g. `article-draft` →
  a markdown file via a draft PR). The write-back is a PR, not an authenticated endpoint
  POST. Don't tag it `cadence`.
- A **deterministic** skill (`discord-ping`, `feed-health`) with no LLM judgment — fired
  the same way, but it's a Lambda handler, not a persona-voiced judgment. (`C1` rejects it.)
- A **one-shot / manually-triggered** skill with no cron binding.

## Why a named archetype at all

Before this, "add a periodic agent task" meant reading `feed-post` + the agent-runner
spec + the orchestrator + the validators and hoping you reproduced every invariant. Naming
the shape (固有名詞: *Cadence*) and giving it lint teeth (`C1`–`C3`) turns that into:
*scaffold → write the body → wire the binding → PR.* The forge owns the mechanical 80%;
the author owns the 20% that is genuinely judgment.

## Related

- `workforce/skills/feed-post/` — instance #1 (the reference implementation).
- `workforce/docs/routines/agent-runner.md` — the generic CCR routine every Cadence shares.
- `workforce/scripts/validate-skills.mjs` — the `C1`–`C3` enforcement.
- `workforce/scripts/schemas/skill-meta.schema.json` — the `archetype` field.
- `.claude/skills/cadence-forge/SKILL.md` — the authoring procedure.
