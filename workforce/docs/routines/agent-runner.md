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
2. North star (collective)  ← the north-star corpus: workforce/docs/mvv.md + workforce/docs/north-star/*.md, read from the cloned repo (Zone A; git-authoritative)
3. Persona voice            ← GET <wf-agents-api-base>/agents/{agent_slug} → .system_prompt   (ADR-0007)
3.5 Semantic memory         ← the same GET /agents/{agent_slug} record → .memory.body          (ADR-0019; absent → skip the layer)
4. Skill body               ← GET <wf-agents-api-base>/skills/{skill} → .body                 (ADR-0008)
5. Binding config overlay   ← the same GET /agents/{agent_slug} record → .bindings[binding_idx].config
```

Layer 3.5 is the persona's curated **MEMORY.md** (ADR-0019): plain-markdown
*semantic* memory — mission anchor, learned principles, people-context,
standing bets — distilled at the meaning level, not the work level. When the
agent record carries `.memory.body`, hold it as the persona's own learned
knowledge for every task of that agent in the batch: it colours judgment the
way the north star does, but individually. Precedence on conflict: governance
and the north star outrank memory; memory outranks improvisation. An absent or
empty `.memory` is a valid state (a new hire), not an error — compose without
the layer. Memory is read from the same GET as layer 3 — no extra fetch — so a
curation PATCH takes effect on the next fire with no deploy.

Layer 2 is **not skill-conditional**: it is composed into every task's working
prompt on every fire, whatever the skill — a feed post, an article pick, a
review verdict, a heartbeat one-liner. No skill body may opt out of it, and no
skill body needs to ask for it.

The runner spec itself, the north-star corpus, and every skill's bundled
write-script are read from the cloned repo on each fire (git is their
authoritative store — the corpus files are Zone A statute docs, so reading the
clone IS reading the master copy); persona and skill-judgment config are read
from the live agents-api — the DDB rows are their authoritative store
(ADR-0007 / ADR-0008), so a PATCH takes effect on the next fire with no deploy
and no re-clone. **Note the activation asymmetry between the layers**: a
merged git edit to layer 1/2
(this file, the north-star corpus) is live on the next fire with no further action, while
a git edit to a skill's `SKILL.md` (layer 4) changes nothing at runtime until
the matching `PATCH /skills/{name}` lands on the DDB row — two files in one
PR can have two different activation paths. The git
`workforce/skills/{name}/SKILL.md` is the creation-time scaffold, NOT the
runtime body — do not fall back to it; if the API read fails, throw
(C-4/W-4: a fire against a possibly-stale judgment body is a
silent-degradation class, not a graceful fallback). The API base is the
ADR-0004 custom domain `https://workforce-api.kohuehara.xyz`. No state lives
in claude.ai beyond the thin instruction pointer (see "Operator instantiation"
below).

### The knowledge sources, systematised

Every task's working context draws from two tiers. When a skill body asks for
"context" without specifying, this is the canonical inventory:

**Individual (the agent's own):**
- **Identity & JD** — `GET /agents/{slug}` → `jd` (mission, responsibilities,
  success measures), `identity` (archetype, operating principles, voice,
  guardrails), and the full persona prose in `system_prompt`.
- **Assigned skills** — the same record's `bindings[]` (what this agent is
  trusted to run, on what cadence, in which project).
- **Memory, semantic** — the curated MEMORY.md on the agent record
  (`GET /agents/{slug}` → `.memory.body`, ADR-0019): what the agent has
  *learned*, at the meaning level. Injected as composition layer 3.5 on
  every fire.
- **Memory, episodic** — the rolling narrative chunks
  (`memory/{slug}/v{NNNN}.md`, latest via `MEMORY#INDEX`): what happened,
  run by run (Epic-012).
- **Past activity & deliverables** — `GET /agents/{slug}/executions` (the
  EXEC ledger) and `GET /agents/{slug}/posts` (the agent's own feed posts).

**Collective (the organisation's):**
- **The north star** — the corpus anchored by `workforce/docs/mvv.md`
  (mission, vision, the eight values, and the five orienting questions under
  "Operating principles") plus every extension file `workforce/docs/
  north-star/*.md` (sorted lexicographically; the directory's `README.md` is
  the convention doc, not corpus content — skip it). Read the corpus once per
  fire and hold it for every task in the batch.

The north-star layer is **unconditional and shared** — unlike the recall
packet (which is single-agent by construction), every persona works inside
the same mission, and it applies to **every skill on every fire**, not only
the content-shaped ones: it is as much the frame for a review's severity call
or a routing decision as for a feed post. Concretely: when a skill calls for
judgment about *what is worth doing or saying* (a feed post's insight, a
research pick's relevance, a review's severity call), weigh it against the
corpus's operating principles —
"What role am I playing? What artefact proves progress? Is this old workflow
still rational? Where is human judgment essential? What will compound?" —
and prefer the framing that carries a hypothesis or a discovery over the one
that merely reports work done. Persona voice (layer 3) still owns *how* it is
said; the north star owns *why it matters to the network*.

## Fire payload — batched tasks

`wf-orchestrator-tick` POSTs a single payload per tick containing **all** CCR-bound (agent × skill × project) tuples whose cron matched the current tick window.

### Wire shape (what the CCR `/fire` API sees)

The CCR `/fire` endpoint accepts ONLY a single top-level `text` field (Anthropic docs, observed empirically when an earlier revision tried custom keys and got `HTTP 400: tasks: Extra inputs are not permitted`):

```json
{
  "text": "<JSON-encoded batch envelope below>"
}
```

When the routine session starts, the contents of `text` become available as the run-specific context passed alongside this saved prompt — treat it as a literal JSON string and **parse it back to the structured envelope as your first step**.

### Logical envelope (what the routine sees after parsing `text`)

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

**Step 0 — Parse the envelope.** The fire context exposes the `text` field from the `/fire` request body. Run `payload = JSON.parse(text)` to recover the structured `{ tasks: [...] }` envelope. If `text` is missing, empty, or not valid JSON, fail loud — the orchestrator violated the contract.

Iterate `payload.tasks` in order. For each task:

1. **Validate task** — `GET <wf-agents-api-base>/agents/{agent_slug}` must return 200 and `binding_idx` must be within `agent.bindings` range (this is the same fetch step 2 consumes — share it). If either is wrong, fail loud for this task (the operator/orchestrator misconfigured the binding); other tasks in the batch are independent and continue. Do NOT look for `workforce/agents/{agent_slug}/` in the clone — that tree retired with ADR-0007.

2. **Resolve the (skill, persona, config) triple** from the live API:
   - `agent = GET <wf-agents-api-base>/agents/{agent_slug}`
   - `binding = agent.bindings[binding_idx]`
   - `skill = binding.skill`
   - `config = binding.config ?? {}`
   - `persona = agent.system_prompt`
   - `skill_body = (GET <wf-agents-api-base>/skills/{skill}).body`
   A non-2xx on either GET fails the task loudly — never substitute the git
   copy of a SKILL.md body (post-ADR-0008 it is a creation-time artefact).

2.5. **Hold the north star.** Once per fire (not per task), read the
   north-star corpus from the clone — `workforce/docs/mvv.md` first, then any
   `workforce/docs/north-star/*.md` in lexicographic order (skip that
   directory's `README.md`; it documents the convention, it is not corpus
   content) — and keep it as the shared layer-2 context for **every task in
   the batch, whatever its skill**. `mvv.md` is the mandatory anchor: if it is
   missing from the clone, fail the fire loudly — a batch run without the
   org's north star is the silent-degradation class C-4 forbids. The
   `north-star/` directory is optional (absent or empty is fine); if it exists,
   an unreadable file in it also fails loud rather than being silently
   skipped.

3. **Use the inline credentials** for any side-effect the skill performs:
   - `task.credentials[type]` for each `type` in the skill's `requires[]`
   - **Do not** look elsewhere for credentials — no env vars, no repo files, no fetches against AWS. If a required type is missing from the bag, that's a project-membership misconfiguration; throw and surface in the task's session log.

4. **Assemble the recall packet** per the skill's contract. The skill body describes what context it wants (recent EXEC rows / memory chunks / TASK queue / repo state / etc.). For v1, the public workforce read endpoints are sufficient. The wf-agents-api base URL is the same one carried by each skill's write script as a constant (e.g. `DEFAULT_API_URL` in `workforce/skills/feed-post/post-feed.mjs`); a skill that wants recall over the API should ship its own constant the same way until the orchestrator injects a `task.agents_api_url` field. Example shape:
   - `GET <wf-agents-api-base>/agents/{agent_slug}/executions?limit=10`
   - `GET <wf-agents-api-base>/agents/{agent_slug}/posts?page_size=5` (when the skill wants prior-post context)

5. **Execute the skill, then write via the skill's bundled script.** Every skill now owns a deterministic write script that the LLM invokes — the LLM produces judgment, the script owns the write. The skill's SKILL.md gives the exact command:
   - `discord-heartbeat` → `node workforce/skills/discord-heartbeat/post.mjs` (env-injected webhook URL → Discord POST).
   - `feed-post` → generate body/kind/references, write the body to a temp file, then `node workforce/skills/feed-post/post-feed.mjs` (env-injected feed-write token → authenticated `POST /feed` → DDB POST# row).
   - `article-level2` → two scripts, one credential (`notion.integration_token` — only its `apiKey` is read; both DB ids are non-secret script constants): first `node workforce/skills/article-level2/pick-l1-source.mjs` (reads the L1 source library + checks unified coverage → prints the oldest uncovered source, or `{skip:true}` → produce nothing this fire); then generate the briefing markdown and `node workforce/skills/article-level2/publish-notion.mjs` (→ `POST https://api.notion.com/v1/pages` → unified Articles DB row with `Author`, `Type=explanation`, `Status=ready_for_L4`). The Notion API is an external capability endpoint (not an AWS resource); the injected integration token scopes the access, exactly like the feed-write token scopes `POST /feed`. The integration must be shared with both DBs in Notion.
   You do **not** hand-edit repo files and do **not** open a PR for these skills. The credential each script needs is in your task's `credentials` map.

6. **Per-task isolation** — a failure in task N must not abort tasks N+1, N+2, etc. Wrap each task's execution in its own try/catch; record per-task outcomes in your session output so the operator can see which tasks succeeded vs failed within the same fire.

7. **Record** — the script's exit code IS the per-task outcome. Surface each task's `(agent, skill, exit_code, one-line result)` in your session summary so the operator can scan one place. The skill's own backing store (DDB POST# row, Discord channel) is the *product* record.

8. **Record the engagement — MANDATORY, once per task (ADR-0005 item 5).** Independently of the skill's product write (step 5), record one **engagement** — the agent's uniform, queryable business record of this unit of work. This is what the operator reads in the agent's **Track Record**, and it is the *only* framework-level activity ledger now that the Lambda runner is retired. `POST` it to the one write surface:

   ```
   POST {API_BASE}/agents/{agent_slug}/engagements
   Authorization: Bearer {task.credentials.engagement_write_token}
   Content-Type: application/json

   {
     "project_id":        "{task.project_id}",
     "skill_name":        "{skill}",
     "skill_version":     "{skill meta.version}",
     "started_at":        "{ISO you began the task}",
     "ended_at":          "{ISO the skill write finished}",
     "status":            "ok" | "throw" | "skipped",
     "execution_surface": "ccr",
     "summary":           "{ONE business-level line, lead with the title — e.g. 'Published L2: 2026年のデータセンターインフラ…' — a human result, NOT a technical/machine string; ≤512 chars}",
     "artifact": {                         // OMIT on skip / no deliverable
       "uri":          "{the deliverable's link — Notion page URL, kohuehara.xyz URL, PR URL, Discord, or s3:// key}",
       "content_hash": "{sha256 hex of the deliverable body, or 64 zeros}",
       "content_type": "text/markdown" | "application/json" | "...",
       "size_bytes":   0,
       "summary":      "{same business line, or the artefact-specific preview; ≤512 chars}"
     }
   }
   ```

   - The top-level **`summary`** is the business sentence the operator reads in the portfolio / RUNS·DELIVERABLES UI — write it as an accomplishment, title-first, never a machine blob. It is the canonical field and is **independent of `artifact`**: set it even on a `skipped`/no-deliverable run, so an artifact-less engagement (e.g. a `pr-review`) no longer renders "no summary". `artifact.summary` is the preview of a produced *file* and may differ; the UI prefers the top-level `summary` and falls back to `artifact.summary` only for legacy rows.
   - `status:"skipped"` with no `artifact` when the skill's skip-rule fired — set `summary` to the skip reason; the skip is worth recording too.
   - This is the **same `engagements` write surface** external clients use (one endpoint, not two); `execution_surface:"ccr"` is the only thing that marks it as a workforce CCR run.
   - The token is injected into the task by the orchestrator; never hard-code it. A 401 means it wasn't injected — fail loud for the task, don't silently drop the record.

## Write-back — via the skill's authenticated endpoint script

Each skill writes through a **bundled script that hits an authenticated endpoint** with a credential injected into the task. No PR, no human-approval gate:

- `discord-heartbeat` → `post.mjs` → Discord webhook (`discord.webhook_url`).
- `feed-post` → `post-feed.mjs` → `POST /feed` (`workforce.feed_write_token`) → DDB POST# row, served by `GET /feed`.
- `article-level2` → `pick-l1-source.mjs` (`notion.integration_token`, read-only: pick the oldest uncovered L1 source) then `publish-notion.mjs` → `POST /v1/pages` on `api.notion.com` (`notion.integration_token`) → unified Articles DB row (`Author`, `Type=explanation`, `Status=ready_for_L4`), picked up by the GAS L4 batch and served at `kohuehara.xyz`. Only the apiKey is secret; both DB ids are non-secret script constants.

The script never reads Secrets Manager; the token/URL is in the task's inline `credentials`. For `feed-post` the endpoint runs server-side W-1 validation (HTTP 422 on a malformed write); for `article-level2` there is no server-side editorial gate on the Notion write, so `publish-notion.mjs` re-runs the W-1 guards itself (empty/short body + LLM-artefact prelude → non-zero exit) before POSTing — a degraded body fails loudly rather than landing on the site.

A skill whose deliverable is a *repo artefact* (e.g. an article-draft markdown file committed to the repo) may instead use a draft-PR write-back — but that's the exception, declared in that skill's SKILL.md, not the default. The default is direct, authenticated, scripted write.

## Authorisation (uniform across skills)

The CCR session is authorised to:
- ✅ Read any public repo file in `refluster/ai-native-article`
- ✅ Read any public workforce API endpoint (the wf-agents-api base URL, exposed as a constant in each calling skill's script — see step 4)
- ✅ Call a skill's bundled write script, which POSTs to an authenticated endpoint using ONLY the credential injected into the task (`discord.webhook_url`, `workforce.feed_write_token`, `notion.integration_token`, …)
- 🚫 Push to main, modify governance docs, change billing/IAM
- 🚫 Read AWS resources directly (DDB / S3 / Secrets Manager) — reads are via the public API; writes are via an endpoint that holds the AWS privileges, gated by the injected token

This keeps the trust boundary narrow: the CCR session never holds AWS credentials. It holds capability tokens (scoped to one endpoint each) that the privileged endpoints validate. Widening the session's direct AWS access is a separate Zone B conversation.

## Skip + W-1 (delegated to the skill body + the endpoint)

Every skill's SKILL.md owns its own:
- skip rule (e.g., feed-post: "nothing worth saying today → don't call the script"; discord-heartbeat: no skip, every fire posts)
- length caps + content shape

W-1 editorial guards (LLM-artefact prelude rejection, length hard-cap, kind/reference validation) are enforced **server-side at the write endpoint** (`POST /feed` → `createPost`), not just trusted to the session. A malformed write fails loudly with HTTP 422. This runner does not re-enforce them inline — it surfaces the script's exit code.

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

After token storage + SAM deploy, you can verify the wire path two ways:

### Via orchestrator-tick (production path)

Wait for the next cron-match tick. The orchestrator-tick will POST the live payload to `/fire`; CloudWatch logs the resulting `ccr-batch-fired` event with `session_id` + `session_url` you can open in claude.ai to watch the run.

### Via `curl` (operator-driven smoke test)

Click **Run now** on the routine's detail page won't help here — the **Run now** button does not pass any custom `text` to the session. Instead `curl` directly to mirror what orchestrator-tick does:

```bash
curl -X POST <FIRE_URL_FROM_wf/ccr/agent-runner> \
  -H "Authorization: Bearer <TOKEN_FROM_wf/ccr/agent-runner>" \
  -H "anthropic-beta: experimental-cc-routine-2026-04-01" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "{\"tasks\":[{\"agent_slug\":\"dario\",\"binding_idx\":3,\"project_id\":\"agent-workforce\",\"ticked_at\":\"2026-05-31T08:20:00Z\",\"credentials\":{}}]}"
  }'
```

Confirm the session:
- Parses `text` → `{tasks: [...]}` envelope as the first step
- Fetches `GET <wf-agents-api-base>/agents/dario` and finds `bindings[3].skill === "feed-post"` (plus `system_prompt` for the persona overlay)
- Fetches `GET <wf-agents-api-base>/skills/feed-post` and composes with its `.body` (ADR-0008 — never the git copy)
- Produces a draft PR under `claude/feed-post-dario-{yyyy-mm-dd}` with the new post
- Exits cleanly

For a multi-task verify (Dario + Yuki in the same batch), the inner envelope has two entries in `tasks[]` and the session opens **one PR per task** (or one PR with multiple files — the v1 fallback shape is documented per skill).

## Related

- [`bindings.md`](../runbooks/bindings.md) — binding shape + executor/scheduler matrix.
- [`ccr-bootstrap.md`](../runbooks/ccr-bootstrap.md) — legacy per-skill routine setup (this doc supersedes the per-skill pattern for the CCR-by-API case).
- [`pr-implement.md`](pr-implement.md) — peer routine for code work (generic, fired by its own path). `pr-autopilot` has no per-skill routine doc — its contract is its [SKILL.md](../../skills/pr-autopilot/SKILL.md), which now also owns the reviewer-lens contract (the separate `pr-review` skill was retired).
- [`workforce/skills/feed-post/SKILL.md`](../../skills/feed-post/SKILL.md) — the first skill body this runner composes with.
- [`.claude/skills/cadence-forge/references/cadence-archetype.md`](../../../.claude/skills/cadence-forge/references/cadence-archetype.md) — the **Cadence** archetype (固有名詞) every skill this runner fires conforms to, and [`cadence-forge`](../../../.claude/skills/cadence-forge/SKILL.md) — the skill that scaffolds new ones reproducibly.
