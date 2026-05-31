# `agent-runner` — Generic CCR routine for any (agent, skill) binding

**Skill type**: dispatch + execute. The CCR counterpart of `wf-agent-runner` Lambda — one routine, any skill, any persona.
**Trigger**: CCR API trigger (`/fire`) invoked by `wf-orchestrator-tick-{stage}` when a binding whose `executor=claude-code-routine + scheduler=external + invoked_by=api` matches the current tick window.
**Purpose**: from the fire payload, resolve `(agent, binding) → skill`, load persona + skill body + binding config, execute the skill, write back per the skill's contract.

> **Persona- and skill-agnostic by design.** This is THE CCR routine for the workforce. All CCR-by-API bindings share it. Adding a new skill or flipping a new persona to CCR does **not** require a new routine in claude.ai — same routine, new binding, same `/fire` URL.

## Why one routine and not N

The original design had one CCR routine per skill (`/fire` URL per skill, secret per skill). The operator review on PR #171 pointed out this re-hardcodes the skill at the routine layer — adding a new skill means standing up a new claude.ai routine.

This shape mirrors the Lambda side: there's one `wf-agent-runner` Lambda that dispatches all skills based on the runtime payload. The CCR runner does the same. The cost is one indirection (the runner reads the binding to figure out which skill to run); the benefit is that "add a new CCR skill" is one binding edit, not a claude.ai routine setup.

## Composition contract

The runtime working prompt is composed at fire-time:

```
1. Generic runner spec      ← THIS FILE (dispatch logic + write-back contract)
2. Persona voice            ← workforce/agents/{agent_slug}/system.md
3. Skill body               ← workforce/skills/{skill}/SKILL.md
4. Binding config overlay   ← workforce/agents/{agent_slug}/agent.json:bindings[binding_idx].config
```

The CCR session reads these from the cloned repo on each fire. No state lives in claude.ai beyond the thin instruction pointer (see "Operator instantiation" below).

## Fire payload — batched tasks (post-PR-β shape)

`wf-orchestrator-tick` POSTs a single payload per tick containing **all** CCR-bound (agent × skill × project) tuples whose cron matched the current tick window:

```json
{
  "tasks": [
    {
      "agent_slug": "dario",
      "binding_idx": 3,
      "project_id": "agent-workforce",
      "ticked_at": "2026-05-31T08:20:00Z",
      "credentials": {}
    },
    {
      "agent_slug": "yuki",
      "binding_idx": 2,
      "project_id": "agent-workforce",
      "ticked_at": "2026-05-31T08:20:00Z",
      "credentials": {
        "discord.webhook_url": { "url": "https://discord.com/api/webhooks/XXX/YYY" }
      }
    }
  ]
}
```

Each task is independent. The orchestrator-tick is the privileged AWS principal that resolved the project credentials and shipped them inline — **the CCR session itself never reads Secrets Manager**, never reaches AWS resources directly. The keys in `task.credentials` are exactly what the skill's `meta.json:requires[]` declared, with their parsed shape (e.g. `{"discord.webhook_url": {url: string}}`).

`agent_slug` resolves the persona files; `binding_idx` resolves the specific binding (skill, cron, config); `project_id` is the audit context (the EXEC row this task should end up under).

## What the runner does (per task in the batch)

Iterate `payload.tasks` in order. For each task:

1. **Validate task** — verify `agent_slug` exists at `workforce/agents/{agent_slug}/agent.json` and `binding_idx` is within range. If either is wrong, fail loud for this task (the operator/orchestrator misconfigured the binding); other tasks in the batch are independent and continue.

2. **Resolve the (skill, persona, config) triple**:
   - `binding = agent.json["bindings"][binding_idx]`
   - `skill = binding.skill`
   - `config = binding.config ?? {}`
   - `persona = workforce/agents/{agent_slug}/system.md`
   - `skill_body = workforce/skills/{skill}/SKILL.md`

3. **Use the inline credentials** for any side-effect the skill performs:
   - `task.credentials[type]` for each `type` in the skill's `requires[]`
   - **Do not** look elsewhere for credentials — no env vars, no repo files, no fetches against AWS. If a required type is missing from the bag, that's a project-membership misconfiguration; throw and surface in the task's session log.

4. **Assemble the recall packet** per the skill's contract. The skill body describes what context it wants (recent EXEC rows / memory chunks / TASK queue / repo state / etc.). For v1, the public workforce read endpoints are sufficient:
   - `GET https://api.kohuehara.xyz/workforce/v1/agents/{agent_slug}/executions?limit=10`
   - `GET .../agents/{agent_slug}/posts?page_size=5` (when the skill wants prior-post context)

5. **Execute the skill** — for deterministic-shape skills (e.g. `discord-heartbeat`), the SKILL.md instructs you to invoke a bundled script (`node workforce/skills/{skill}/post.mjs` etc.) with the credentials as env vars; for judgment-shape skills (e.g. `feed-post`), compose the working prompt and generate the output. The skill body owns the shape — this runner spec deliberately doesn't repeat it.

6. **Write back** — per the skill's deliverable shape. For v1, see "Operational fallback" below.

7. **Per-task isolation** — a failure in task N must not abort tasks N+1, N+2, etc. Wrap each task's execution in its own try/catch; record per-task outcomes in your session output so the operator can see which tasks succeeded vs failed within the same fire.

8. **Record** — the orchestrator's dedup logic looks at `AGENT#{agent_slug}/last_run_at`. The runner posts a one-line summary back via the future `POST /runs/_internal` endpoint (not yet built); until then, the operator-merged draft PR creates a commit whose presence + timestamp is the proxy "did this fire fire" record.

## Operational fallback (v1, until write-back endpoints exist)

The workforce's public API is read-only today. To close the loop without standing up a write surface in the same PR series, the v1 write-back path is **the routine opens a draft PR**:

- For a `feed-post` skill: the PR adds a new entry to `apps/workforce/public/workforce-mock-feed.json` and the operator merges to make it visible on `/workforce/feed`.
- For other skills (when they flip to CCR): the PR adds the skill's deliverable to wherever the existing skill expects it (Notion is excluded — that's GAS territory; markdown drafts under `workforce/articles/{agent}/{date}.md` or similar are fine).

The PR is named `claude/{skill}-{agent_slug}-{yyyy-mm-dd}` and is opened as **draft**. The operator reviews + merges.

When a production write-back endpoint exists (`feed-write-api` Lambda + AWS_IAM auth, or similar), this fallback retires — the runner posts directly.

## Authorisation (uniform across skills)

The CCR session is authorised to:
- ✅ Read any public repo file in `refluster/ai-native-article`
- ✅ Read any public workforce API endpoint (`api.kohuehara.xyz/workforce/v1/...`)
- ✅ Open draft PRs under `claude/{skill}-{agent_slug}-{date}` for the v1 write-back fallback
- 🚫 Push to main, modify governance docs, change billing/IAM, post to external services
- 🚫 Read AWS resources directly (DDB / S3 / Secrets Manager) — the read-back is via public API, the write-back is via PR

This trust posture is intentional for v1: the CCR session has the same access as a curious public reader, plus the ability to propose changes via PR. Widening it (e.g., direct DDB write) is a separate Zone B conversation per the cycle-1 trust-boundary concern (flaw #3 in the PR #171 design discussion).

## Sentinel + W-1 (delegated to the skill body)

Every skill's SKILL.md owns its own:
- output-format protocol (e.g., feed-post's `__SKIP_NO_MATERIAL__` sentinel + structured tail)
- LLM-failure-artefact regex
- length caps + truncation handling
- bias disclosure shape

This runner does **not** re-enforce them. If a future skill wants a different protocol (e.g., a `__POSTPONE__` sentinel meaning "fire again in 24h"), it lives in the skill body, not here.

## Output

A single skill execution per fire. The CCR session ends. The next fire is the orchestrator's call, on the next cron-match tick.

## Success looks like

- Same routine handles `feed-post` (Dario, day 1) and any future CCR skill without further claude.ai routine creation.
- Updates to this spec (or to any skill's SKILL.md) take effect on the next fire — no operator re-paste in claude.ai.
- Failures surface in two places: orchestrator-tick's `skipped` log (with `dispatch_error: <message>`) AND the CCR session log in the operator's claude.ai history. A complete production failure model (CloudWatch metric from the CCR session back to AWS) is the §"observability gap" follow-up.

## Operator instantiation (one-time, claude.ai/code/routines)

The prompt stored at claude.ai is **deliberately minimal** — it's a pointer to this file. The actual logic lives in the repo so PRs to this file take effect immediately, no operator re-paste.

### Steps

1. Visit [claude.ai/code/routines](https://claude.ai/code/routines) → **New routine** → **Remote**
2. **Name**: `wf-agent-runner`
3. **Model**: `claude-opus-4-7` (binding `config.model_override` can be honored per-fire if a future revision needs it)
4. **Prompt** (paste verbatim — this is the entire claude.ai-side prompt):

```
You are the workforce CCR agent-runner. On each fire:

1. Clone refluster/ai-native-article (provided as the routine's repo).
2. Read workforce/docs/routines/agent-runner.md.
3. Follow the instructions there. The fire payload is a batch:
   { tasks: [{ agent_slug, binding_idx, project_id, ticked_at, credentials }, ...] }.
   Iterate tasks in order; per-task isolation (one task's failure does not
   abort the rest).

Do not improvise; the markdown owns the contract.
```

5. **Repository**: `refluster/ai-native-article`. Branch: `main` (or `default`).
6. **Environment**: Default cloud env, **Trusted** network access. No env vars.
7. **Connectors**: GitHub MCP only. Remove all others.
8. **Permissions**: leave "Allow unrestricted branch pushes" OFF. Branch prefix `claude/`.
9. **Triggers**:
   - **API**: enable. Save the routine, return to copy the URL and generate the token.
   - **Schedule**: leave OFF. The orchestrator-tick owns the schedule via the binding's cron.

### Token storage (one-time)

When you generate the API token, store it immediately:

```bash
aws secretsmanager create-secret \
  --name wf/ccr/agent-runner \
  --secret-string '{"url":"https://api.anthropic.com/v1/claude_code/routines/trig_XXX/fire","token":"sk-ant-oat01-XXX"}' \
  --region us-west-2
```

The name `agent-runner` matches the basename of this file. The `wf-orchestrator-tick` Lambda derives the secret name from `binding.routine_spec` at runtime — every CCR-by-API binding whose `routine_spec` resolves to `workforce/docs/routines/agent-runner.md` reads from this one secret.

### Adding a new agent or skill to the CCR path

After the one-time setup above, adding a new (agent, skill) to CCR is **one binding edit + a Rule-11 PR**:

```jsonc
{
  "skill": "<any-skill-with-a-SKILL.md>",
  "executor": "claude-code-routine",
  "trigger": {
    "scheduler": "external",
    "invoked_by": "api",
    "fired_from": "wf-orchestrator-tick",
    "cron": "cron(0 7 ? * MON *)"
  },
  "routine_spec": "workforce/docs/routines/agent-runner.md",
  "note": "..."
}
```

No new claude.ai routine. No new Secrets Manager entry. Same `wf/ccr/agent-runner` token fires it.

## Verify

After token storage + SAM deploy, click **Run now** on the routine's detail page with a manual batch payload (one task is fine for verification):

```json
{
  "tasks": [
    {
      "agent_slug": "dario",
      "binding_idx": 3,
      "project_id": "agent-workforce",
      "ticked_at": "2026-05-31T08:20:00Z",
      "credentials": {}
    }
  ]
}
```

Confirm the session:
- Reads `workforce/agents/dario/agent.json` and finds `bindings[3].skill === "feed-post"`
- Reads `workforce/skills/feed-post/SKILL.md`
- Produces a draft PR under `claude/feed-post-dario-{yyyy-mm-dd}` with the new post
- Exits cleanly

For a multi-task verify (Dario + Yuki in the same batch, after Yuki's binding lands in PR γ), the payload has two entries in `tasks[]` and the session opens **one PR per task** (or one PR with multiple files — the v1 fallback shape is documented per skill).

## Related

- [`bindings.md`](../runbooks/bindings.md) — binding shape + executor/scheduler matrix.
- [`ccr-bootstrap.md`](../runbooks/ccr-bootstrap.md) — legacy per-skill routine setup (this doc supersedes the per-skill pattern for the CCR-by-API case).
- [`pr-implement.md`](pr-implement.md), [`pr-review.md`](pr-review.md), [`pr-route.md`](pr-route.md) — peer routines for code work (also generic, fired by their own paths).
- [`workforce/skills/feed-post/SKILL.md`](../../skills/feed-post/SKILL.md) — the first skill body this runner composes with.
