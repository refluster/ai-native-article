# Epic-008 — Skill repository as the execution unit

- **Status**: Implemented (2026-06-23)
- **Owner**: Maya
- **Created**: 2026-05-18
- **Implemented by**: PR-A (substrate + 7 pilots, validators) + PR-B (runner integration) + PR-C (RUN/DELIV traceability) + PR-D (skill seed Lambda + DDB mirror + `/skills` endpoints on agents-api) all landed; substrate since extended by ADR-0008 (#332) + ADR-0012 (#349).

> **Status reconciliation (2026-06-23, Mateo).** Flipped In-progress → Implemented: every PR-A…PR-D deliverable is present and live — `validate-skills.mjs` + schemas, the registry build, `skill_name`/`skill_version` on EXEC rows, the `seed-skills` Lambda upserting `SKILL#{name}/META`, and `GET /skills` / `GET /skills/{name}` on agents-api. The substrate is load-bearing enough that two later ADRs (0008 judgment-config single-source, 0012 decouple-binding-from-ownership) build directly on it.

## Problem

The workforce treats Skills as the reusable instructions that drive agent behaviour: `agent.json:skills` references them by name, governance §3 classifies `workforce/skills/{name}/SKILL.md` as Zone A with Rule 11, and naming.md fixes their directory shape. But the substrate is **declarative only** today:

- `agent.json:skills` is a name array (Maya has `["plan-write", "article-draft", "notion-publish"]`) — no file under `workforce/skills/` materialises any of them.
- `lambdas/agent-runner/handler.ts` doesn't load skills; it dispatches on `task_kind` via a hard-coded `defaultBriefFor()` switch. The "skill" abstraction is bypassed at runtime.
- There is no schema for SKILL.md, no validator, no test that an agent's declared skill exists, no traceability from a RUN row back to the skill that drove it.
- The complementary [Epic-004](epic-004-skill-catalog.md) covers the **catalog/utilisation view layer** (`/workforce/skills` UI, invocation stats, stale detection) and explicitly defers the substrate; it has no bite without that substrate.

The operator's directive (chat, 2026-05-18) is: **the Skill is the execution unit.** Multiple agents assign the same Skill and execute it periodically inside their own context. Separately, dedicated improvement agents lift each Skill's quality over time. The repository of Skills is a **layer independent of the agent repository** — agents point at Skills; Skills are not owned by any one agent.

Epic-008 defines that substrate.

## Constraints

Two non-negotiable constraints shape the design:

1. **W-5 / Rule 11 — Persona and skill stability.** A SKILL.md body bump is its own PR. The repository structure must support per-skill identity that survives independent of any agent edit.
2. **Compatibility with the Anthropic Agent Skills spec** (<https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview>). Each Skill is one directory containing `SKILL.md` with YAML frontmatter `name` (≤64 chars, `^[a-z0-9-]+$`, no reserved tokens "anthropic"/"claude") and `description` (non-empty, ≤1024 chars). Companion files (additional Markdown, scripts under e.g. `scripts/`, references under e.g. `references/`) are loaded on-demand via filesystem access ("progressive disclosure" — Level 1 metadata always loaded, Level 2 SKILL.md body when triggered, Level 3 bundled files only when referenced).

The existing `.claude/skills/` set (`gas-call`, `gas-deploy-verify`, `article-health`) already conforms — `SKILL.md` with `name`+`description` only, `scripts/` subdirectory for executable artefacts. `workforce/skills/` adopts the same shape, plus a sidecar `meta.json` for workforce-specific operational metadata that doesn't belong in the portable SKILL.md.

## Proposed solution

### Repository layout

```
workforce/skills/{name}/
├── SKILL.md         # Anthropic-spec frontmatter + body. Rule-11 bump unit.
├── meta.json        # Workforce-specific operational metadata (see schema).
├── scripts/         # (optional) Executable artefacts run via bash.
│   └── *.mjs        #   File names kebab-case (R-N7).
└── references/      # (optional) Additional Markdown loaded by reference from SKILL.md.
    └── *.md
```

- `SKILL.md` is the **Anthropic-spec entry file**. Frontmatter has exactly two required fields (`name`, `description`); a Skill exported as-is to claude.ai or the Skills API works unmodified. The body uses the progressive-disclosure pattern: short procedural guidance, with links to `references/*.md` for depth.
- `meta.json` is a **workforce-internal sidecar**. Operational state that the Anthropic loader doesn't care about lives here; it does not pollute SKILL.md.
- `scripts/` and `references/` mirror the layout used by the existing `.claude/skills/*`.

### `SKILL.md` frontmatter (spec-compliant subset)

```yaml
---
name: article-draft
description: Produce a 400-800 word L1 article in Japanese with one observation, one inference, and one disclosure per paragraph. Use when an editorial agent needs to convert a single L0 source into a publishable insight piece.
---
```

Constraints (enforced by validator, derived from the spec):

- `name` matches `^[a-z][a-z0-9-]*$` (tighter than spec's `^[a-z0-9-]+$` — disallows leading digit, consistent with R-N7 and `^[a-z]+$` for agent slugs).
- `name` ≤ 64 chars, must not contain "anthropic" or "claude".
- `name` equals the directory name (parallel to `agent.json:slug` rule).
- `description` non-empty, ≤ 1024 chars, no XML tags.
- The description must read as "what + when" — the validator checks for ≥ 1 of {"Use when", "Use whenever", "Triggers on"} in the description, matching the spec's recommendation. A warning, not a hard fail (Anthropic's own pre-built Skills don't all include it).

### `meta.json` (workforce extension)

```json
{
  "name": "article-draft",
  "version": "0.1.0",
  "status": "active",
  "trigger_class": "lambda",
  "cost_class": "small",
  "owners": ["maya", "sora"],
  "improvement_agent": null,
  "inputs": ["l0-source-ref"],
  "outputs": ["article-markdown"],
  "created_at": "2026-05-18",
  "deprecated_replacement": null
}
```

Field semantics:

| Field | Type | Purpose |
|---|---|---|
| `name` | string | Must equal `SKILL.md:name` and the directory name. |
| `version` | semver | Bumped on Rule-11 PR. Mirrors `agent.json:prompt_version`. First version is `0.1.0` (Rule-11 documented exception). |
| `status` | `active` / `stale` / `deprecated` | Catalog filter (Epic-004 Q1). Default `active`. |
| `trigger_class` | `lambda` / `claude-code-routine` | Where the Skill's *scripts* can execute. `lambda` Skills are prompt-only at v1 (no bash inside the runner); `claude-code-routine` Skills route through the R-N1 exception path so scripts run on GHA. See "Trigger dispatch model" below. |
| `cost_class` | `small` (~$0.05) / `medium` (~$0.20) / `large` (~$0.60) | Pre-flight cost projection. Multiplied by per-agent monthly budget for W-3 enforcement. |
| `owners` | string[] | Agent slugs allowed to invoke the Skill. The validator cross-checks `agent.json:skills`. |
| `improvement_agent` | string or null | Slug of the agent assigned to improve this Skill (Epic-009 placeholder). `null` until that Epic lands. |
| `inputs` | string[] | Symbolic input slot names; informational at v1, basis for typed inputs in v2. |
| `outputs` | string[] | Symbolic output slot names; informational at v1. |
| `created_at` | ISO 8601 date | Set on first PR; never edited. |
| `deprecated_replacement` | string or null | When `status="deprecated"`, the slug of the Skill that supersedes it. |

`meta.json` lives in Zone B (operational), but a SKILL.md body bump (Rule-11 PR) is expected to also update `meta.json:version` in the same PR — that's the one documented coupling.

### Agent → Skill pointer

`agent.json:skills` stays a string array of skill names. No version pinning at v1; the runner always reads the latest. Pinning is deferred to a follow-up Epic if Skills start to drift faster than agents can re-validate.

Two validations added to `validate-agent-json.mjs`:

- `R8-skills-exist`: every name in `agent.json:skills` must correspond to `workforce/skills/{name}/SKILL.md`.
- `R8-skills-owner`: every name in `agent.json:skills` must list the agent's slug in `meta.json:owners`.

### Trigger dispatch model

The Skill is the execution unit. Two trigger surfaces, both already permitted by R-N1 / R-N4:

```
┌─ EventBridge (R-N4) ──────────────────────────────────────────────┐
│  wf-orchestrator-tick                                              │
│        │                                                           │
│        ▼ reads AGENT#{slug}/META + assigned skills                 │
│  Per-agent cron match → dispatch to wf-agent-runner                │
│        │                                                           │
│        ▼                                                           │
│  agent-runner picks one Skill from agent.skills × current cadence  │
│   ├─ trigger_class=lambda                                          │
│   │     load SKILL.md → compose into system prompt → LLM call      │
│   │     scripts/ are inert at v1 (no bash tool in the runner)      │
│   │                                                                │
│   └─ trigger_class=claude-code-routine                             │
│         build task brief → workflow_dispatch workforce-engineer-routine.yml       │
│         (existing R-N1 exception, generalised: any code-writing    │
│          Skill, not only Ren's pr deliverable)                     │
└────────────────────────────────────────────────────────────────────┘
```

Selection rule inside the runner (v1, simplest viable):

1. List `agent.skills` ∩ `Skills with status=active`.
2. Filter by `trigger_class` consistent with the task: for now, `task_kind=l0-to-l1` → any `trigger_class=lambda` Skill whose `outputs` contains `article-markdown`. Hard-coded mapping table; replace with a planner in v2.
3. Pick the first match. Record the selected `{name, version}` on the RUN row.

The orchestrator-tick model (Epic-006 S1) already iterates agents on a 5-minute cadence; Skills change nothing about scheduling. The agent's cron stays the period at which the agent **wakes**; which Skill it runs is data, not schedule.

The user's directive named "Claude Code Routine" as an alternative trigger source. Two readings, both supported:

- **Outer trigger** — a CC Routine on a separate cron (not EventBridge) could invoke `wf-agent-runner` via API GW (v2). Not in scope here; if it lands, the run record carries `trigger_source=cc-routine` to distinguish from `trigger_source=eventbridge`.
- **Per-Skill execution surface** — `trigger_class=claude-code-routine` Skills hand off to the existing `workforce-engineer-routine.yml` workflow. This is the path through which Skill scripts actually run; Lambda agents stay in prompt-only mode.

### Runner integration

`agent-runner/handler.ts` (current state: hard-coded `defaultBriefFor`) gains a new shared lib `workforce/lambdas/shared/skill.ts`:

```ts
// shared/skill.ts (sketch)
export interface SkillFrontmatter { name: string; description: string; }
export interface SkillMeta { name: string; version: string; status: "active"|"stale"|"deprecated"; trigger_class: "lambda"|"claude-code-routine"; cost_class: "small"|"medium"|"large"; owners: string[]; /* ... */ }
export interface LoadedSkill { frontmatter: SkillFrontmatter; meta: SkillMeta; body: string; }

export async function loadSkill(name: string): Promise<LoadedSkill>;        // reads from the bundled workforce/skills/{name}/
export function pickSkillForTask(agent: AgentMetaRow, taskKind: TaskKind, skills: LoadedSkill[]): LoadedSkill | undefined;
export function composeSystemPrompt(baseSystemMd: string, skill: LoadedSkill): string;
```

Composition: `composeSystemPrompt` appends the Skill body to the agent's system prompt under a clearly delimited heading (`\n\n---\n\n## Active skill: {name} (v{version})\n\n{body}`). One Skill per run; multi-Skill composition is v2.

The runner's existing `defaultBriefFor()` switch is **deleted** when Skills cover all the active `task_kind`s. Until then, both paths coexist: if no Skill matches the task, fall back to `defaultBriefFor`. The fallback is logged at WARN.

### Traceability — RUN and DELIV row additions

Two new optional attributes on the existing rows (data-model.md extension; no schema break):

| Row | New attribute | Type | Notes |
|---|---|---|---|
| `AGENT#{slug}` / `RUN#{ulid}` | `skill_name` | string | The Skill chosen for the run. Empty when the `defaultBriefFor` fallback fires. |
| `AGENT#{slug}` / `RUN#{ulid}` | `skill_version` | string | `meta.json:version` at run time. |
| `AGENT#{slug}` / `DELIV#{ulid}` | `skill_name` | string | Same value as the parent run for one-hop lookup. |
| `AGENT#{slug}` / `DELIV#{ulid}` | `skill_version` | string | Same. |

Operator surfaces (Epic-004 catalog, Epic-002 agent profile) consume these fields directly. The user's "種別とID" requirement is satisfied: `(skill_name, skill_version)` is the tracing tuple; an agent's RUN list is filterable by Skill.

### Repository as an independent layer

This Epic distinguishes the **Skill repository** from the **Agent repository** even though both live under `workforce/`:

- File layout is parallel: `workforce/agents/{slug}/{agent.json, system.md}` vs. `workforce/skills/{name}/{meta.json, SKILL.md}`.
- DDB mirrors: Skills get a `SKILL#{name}/META` row (parallel to `AGENT#{slug}/META`), seeded by a new `WfSeedSkillsFunction` Lambda that mirrors `WfSeedAgentsFunction` (Epic-007).
- API surface (v2, deferred): `GET /skills`, `GET /skills/{name}`, `PATCH /skills/{name}` for operational fields (status flip, improvement-agent assignment).
- Authority: a Skill body bump is Rule-11 (one PR per skill); operational fields are PATCH-able without a body PR.

The independence matters because a Skill that two agents share has no single agent owner. Routing improvement work, ownership disputes, and deprecation through the Skill row (not through any one agent's row) is the data-modelling step that makes the "execution unit" promise hold.

### Mechanical checks added in this Epic's PR sequence

The validator and CI gates added across the implementation PRs:

1. `validate-skills.mjs` (new) — for each `workforce/skills/{name}/`:
   - SKILL.md exists; frontmatter parses; `name` matches directory and spec constraints.
   - `meta.json` exists; schema-valid (JSON Schema in `scripts/schemas/skill-meta.schema.json`).
   - `meta.json:name` equals `SKILL.md:name` equals directory name.
   - `meta.json:version` is semver.
   - `meta.json:owners` are real agent slugs (cross-check against `workforce/agents/`).
2. `validate-agent-json.mjs` (extended) — `R8-skills-exist` and `R8-skills-owner` above.
3. `validate-naming.mjs` (extended) — `workforce/skills/{name}/` directory and `scripts/*.mjs`, `references/*.md` file names follow R-N7.
4. CI step `workforce:skills` invokes all three.

## Behaviour at N_skills = 50+ / N_agents = 100+

- Bundle size: 50 Skills × ~3 KB SKILL.md + ~1 KB meta.json + (avg) 5 KB references = ~450 KB packaged into the agent-runner Lambda zip. Comfortable (Lambda zip limit 50 MB unzipped).
- Read latency: `loadSkill(name)` is a local fs read inside Lambda. Negligible. The catalog API (v2) reads from `SKILL#{name}/META` rows; one read per page request.
- Validator: `validate-skills.mjs` runs in O(N_skills) on every PR. 50 skills < 1s.
- Catalog UI (Epic-004): see its own behaviour-at-N section.
- Selection rule (`pickSkillForTask`) is O(N_skills_per_agent), bounded ~10 in practice. Hard-coded mapping table starts to creak around N_skills > 20 — that's the signal to introduce a planner (v2 Epic).

## Acceptance criteria

This Epic produces **four PRs**, sequenced. Each is independently mergeable.

- **PR-A — Repository layout + schema + validator + first pilot.**
  - `workforce/skills/{name}/` directory pattern, `SKILL.md` + `meta.json` schema (JSON Schema file under `workforce/scripts/schemas/`).
  - `workforce/scripts/validate-skills.mjs` enforcing the constraints in "Mechanical checks" above.
  - CI integration (`workforce:skills` npm script, wired into `workforce:lint`).
  - First pilot skill ported from the runner's `defaultBriefFor`: **`article-draft`** (corresponds to `task_kind=l0-to-l1`). SKILL.md body lifted verbatim from the existing brief; owners = `["sora", "maya"]`.
  - Extends `validate-agent-json.mjs` with `R8-skills-exist` and `R8-skills-owner` checks.
  - Maya's `agent.json:skills` and Sora's `agent.json:skills` are verified by the new check (no agent.json edits in this PR — the existing names already match the pilot).

- **PR-B — Runner integration.**
  - `workforce/lambdas/shared/skill.ts` with `loadSkill`, `pickSkillForTask`, `composeSystemPrompt`.
  - `agent-runner/handler.ts` calls the new helpers. When a Skill matches the task, system prompt is composed Skill-side; else fall back to `defaultBriefFor` with a WARN log.
  - `agent-runner/Makefile` bundles `workforce/skills/` into the Lambda zip alongside `workforce/agents/` (the existing `system.md` copy step).
  - End-to-end test: a `dryRun=false` runner invocation against `dev` with Sora picks `article-draft`, writes a Notion article, and the resulting RUN/DELIV rows carry the new `skill_name=article-draft` attribute.

- **PR-C — Traceability + agent-profile + catalog surfaces.**
  - `RUN#…` and `DELIV#…` row writers (`shared/task.ts` types + `agent-runner` writes) carry `skill_name` and `skill_version`.
  - `data-model.md` updated with the two new fields.
  - Agent profile page (Epic-002) shows the most-recent Skill per RUN row in the timeline.
  - Skill catalog (Epic-004) starts to render real invocation counts because the data is now present.

- **PR-D — Skill seed Lambda + DDB mirror.**
  - `workforce/lambdas/seed-skills/handler.ts` — mirror of `seed-agents`. Reads `workforce/skills/**/{SKILL.md, meta.json}`, upserts `SKILL#{name}/META` preserving operational fields. Idempotent.
  - SAM template adds `WfSeedSkillsFunction`. Seed trigger reuses the agents-seed deploy hook.
  - `agents-api` (Lambda handler) extended to expose `GET /skills` + `GET /skills/{name}` reading from `SKILL#…/META`. `PATCH` deferred to v2 per Epic-007's pattern.

PR-A unblocks Epic-004's "this skill exists" badge. PR-B unblocks "Skills are actually executed." PR-C unblocks the user's "種別とID" traceability requirement. PR-D unblocks the catalog API at scale.

End-to-end smoke after all four PRs land:

```
# After PR-D
curl https://<api>/skills                 → 1+ items (article-draft pilot, plus
                                            any further skills added in follow-ups)
curl https://<api>/skills/article-draft   → SKILL.md body + meta.json fields

# After Sora's twice-daily L0→L1 fires once
curl https://<api>/agents/sora            → last RUN row shows skill_name=article-draft
curl https://<api>/skills/article-draft   → invocation count = 1
```

## Open questions

- **Q1. SKILL.md frontmatter extensions.** The Anthropic spec allows additional frontmatter fields (it specifies *required* fields, not *only allowed* fields). We chose to put workforce-specific metadata in a sidecar `meta.json` instead, to keep SKILL.md trivially portable to claude.ai / Skills API. Default: keep the sidecar. Operator confirms.
- **Q2. Selection rule planner.** PR-B ships a hard-coded `(task_kind → required outputs)` table. At N_skills > ~20 this becomes a planner — but a planner is its own design conversation. Default: defer to a v2 Epic; ship the table now with a TODO marker.
- **Q3. `trigger_class=claude-code-routine` generalisation.** The current R-N1 exception is Ren-specific. PR-B allows any agent to invoke a `claude-code-routine` Skill, which generalises the exception. Default: yes — but this is a governance amendment to §4 R-N1 (one sentence: "any Skill with `trigger_class=claude-code-routine` may invoke the CC routine path, regardless of the calling agent"). Operator approves before PR-B lands.
- **Q4. Cost class enforcement.** PR-A defines `cost_class` but PR-B does not enforce it (only logs the projected cost). Should the budget guard reject Skills whose projected cost would breach the agent's remaining monthly cap, even if the run is the first of the month? Default: yes, soft cap (warn) in PR-B, hard cap (throw) after one month of telemetry.
- **Q5. Skill scripts on Lambda.** `scripts/*.mjs` in a `trigger_class=lambda` Skill is currently inert (the runner has no bash tool). Two options: (a) accept that Lambda Skills are prompt-only and document; (b) add a sandboxed `child_process` execution path. Default: (a). Bash-style scripts run via the `claude-code-routine` path, which is what the existing `.claude/skills/*` already do.
- **Q6. Bumping skills vs bumping agents.** Today Rule 11 says one persona bump per PR. With Skills as the new execution unit, should "one Skill bump per PR" be co-equal, or should a PR that adjusts both an agent's prompt and one of its Skills be allowed? Default: enforce strictly separate PRs — the audit trail is cleaner and reverts compose. Governance amendment to W-5 / §3 to make explicit.

## Out of scope

- **Epic-009 — Skill improvement agent.** Each Skill gets a dedicated improvement agent that reads the Skill's invocation log + DELIV evaluations and proposes Rule-11 bump PRs. `meta.json:improvement_agent` is the field that wires it; nothing else in this Epic depends on it. The improvement loop, its review cadence, and its budget envelope are the Epic-009 conversation.
- **Inter-skill dependencies.** A Skill cannot import another Skill. The composition model stays "agent + one Skill per run + runtime"; no Skill graph at v1. Epic-004 already calls this out.
- **A/B testing of Skill versions.** A Skill has one active version at a time. Parallel versions ("article-draft@0.3.0" alongside "article-draft@0.4.0") are not modelled. If competing versions become useful, that's a follow-up Epic about Skill experimentation.
- **Skill marketplace / external Skills.** Skills are repo-internal artefacts. The fact that SKILL.md is Anthropic-spec-compliant means a Skill *could* be uploaded to claude.ai or the Skills API, but doing so is an operator action, not a runtime path.
- **POST /skills (programmatic Skill creation via API).** New Skills come from PRs that add files. `WfSeedSkillsFunction` picks them up. Mirrors Epic-007's deliberate no-POST policy for agents.
- **Skill execution outside the workforce.** The existing `.claude/skills/*` (`gas-call`, `gas-deploy-verify`, `article-health`) continue to live under `.claude/skills/` and operate under the root [AGENTS.md](../../../AGENTS.md). They are *compatible* with this design (same file shape) but **not migrated** by this Epic — they're tooling for the operator's Claude Code sessions, not workforce agent Skills.
