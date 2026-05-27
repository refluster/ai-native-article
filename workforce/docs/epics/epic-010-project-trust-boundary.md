# Epic-010 — Project as trust boundary: credentials, executions, agent memory

- **Status**: Accepted (2026-05-26)
- **Owner**: Maya
- **Created**: 2026-05-24
- **Implemented by**: Story 1-A: #110. Story 1-B / Story 2 / Story 3 / Story 4: pending.

## Problem

The workforce has Agents and Skills as first-class entities and treats the (agent × skill) M:N relation as the unit of behaviour (Epic-008). It also has a `PROJECT#{slug}` row in DynamoDB ([data-model.md](../data-model.md)) and a `project_id` attribute on `TASK` and `DELIV` rows. But "project" is currently a *labelling* concept, not a *trust boundary*. Three concrete gaps follow from that:

1. **Credentials are globally pooled, not project-scoped.** Per [R-N3](../governance.md#4-r-n-design-rules-basic-design-simplicity), every API key lives in AWS Secrets Manager under a single flat namespace (`wf/anthropic`, `wf/github`, `wf/notion`, etc.). When agent `ren` opens a PR, the runner reaches for `wf/github` regardless of *which* repository the PR targets. There is no representation of "this token belongs to project C and only project C." As soon as the workforce takes on a second client repo, a third Notion workspace, or a per-project Discord bot, the only options are (a) overwrite the single secret per call, (b) add ad-hoc per-agent secrets, or (c) inline credentials in `agent.json`. All three corrode R-N3.
2. **Execution history is owned by the agent, not the project.** `AGENT#{slug}/RUN#{ulid}` and `AGENT#{slug}/DELIV#{ulid}` ([data-model.md §Row catalogue](../data-model.md#row-catalogue)) make the agent the sole index. There is no efficient way to ask "what happened on project C in the last week, across all agents that touched it" — the project view requires a full-table scan filtered on the `project_id` attribute. As the workforce scales past N=12, this becomes both a query problem (cost) and a governance problem (audit logs aren't naturally bounded by the unit that owns the credentials).
3. **No semantic recall over past work.** The data-model explicitly defers "Vector embeddings / RAG store" to v2/v3 ([data-model.md §What's deliberately NOT in the data model](../data-model.md#whats-deliberately-not-in-the-data-model)). The current memory channel is `memory/{slug}/v{NNNN}.md` — sequential, agent-scoped, queried by recency only. The forthcoming chat surface (Epic-002 agent profile, future agent↔operator chat) needs agents to ground replies in "what I have actually done", which means structured *and* semantic retrieval over their past executions — not just the last K memory chunks.

The unifying observation: **the project is the natural unit of trust, audit, and recall**, but the data model encodes it as a foreign-key tag rather than a container. Promoting it changes very little code and unlocks the next several Epics.

## Proposed solution

Promote `Project` to a full first-class entity that owns three things: a typed **credential bag**, an append-only **execution ledger**, and the bucket prefix for the **artefacts** those executions produce. Agents and skills remain orthogonal to projects (an agent participates in N projects; a skill is executed *against* one project at a time). Agent memory becomes a query — a projection over the ledgers of the projects the agent participates in.

### 1. Four first-class entities

| Entity | Role | Relation |
|---|---|---|
| **Agent** | Actor. Binds N skills. Participates in N projects. | M:N with Skill (Epic-008), M:N with Project (new). |
| **Skill** | Reusable execution unit. Owned by no agent and no project. | M:N with Agent. |
| **Project** | Trust boundary. Owns credentials, execution ledger, S3 prefix. | M:N with Agent. |
| **Execution** | Immutable record of one `(agent, skill, project)` tuple. Append-only under the project's ledger. | 1:1 with skill invocation. |

### 2. The action invariant

> **One skill invocation = one `(agent, skill, project)` triple = one `Execution` row in that project's ledger.**

The runner resolves `project` at the top of the dispatch path (from the task's `project_id`, defaulting to `self` — see §3). Credential injection, artefact-write keys, and the ledger destination are then all derivable from `project` alone. A skill body sees `ctx.credentials[type]` and `ctx.project_id`; it does not see other projects' state. Cross-project work is composed at the agent layer by sequencing two skill invocations, not by passing two projects into one skill.

### 3. The `self` project (default membership)

Every agent is automatically a member of a project named `self` (one project row per agent: `PROJECT#self/{slug}`). `self` holds *the agent's own* artefacts: their personal observability outputs, their notification webhooks (Discord ping to the operator), their own model API key when it differs from the workforce default. This eliminates the "credential with no owning project" anti-pattern. Skills that today reach for `wf/anthropic` will, post-migration, reach for `ctx.credentials["anthropic.api_key"]`, which the runner resolves from `self` unless the current task's `project_id` overrides it.

### 4. One skill execution = one project (strict)

The trust boundary is per-invocation. A skill cannot hold open handles to two projects' credentials simultaneously. The cross-project recipe — "merge a PR on project C, then post a notification to the operator on `self`" — is two skill invocations, not one. This keeps every audit row narrow (one project, one credential bag in scope) and keeps skills reusable (a skill written against `discord.bot_token` works for any project that holds one).

### 5. Type-keyed credential resolution

Skills declare credential needs by **type**, not by name. Types follow reverse-domain notation: `github.token`, `discord.bot_token`, `notion.integration_token`, `anthropic.api_key`. The Skill manifest gains a `requires` field:

```yaml
# workforce/skills/post-discord/meta.json (additive)
{
  "requires": ["discord.bot_token"]
}
```

A project holds at most one value per type (v1). The runner reads `requires`, calls `project.get_credential(type)` for each, and injects the resulting map into the skill context. Anything not in `requires` is not in the map — a skill cannot accidentally reach a credential it didn't declare. This is enforced by an integration test (§Acceptance criteria) and by a runtime guard in `lambdas/shared/credential-injector.ts` (new file).

### 6. Credential storage — refined R-N3 namespace

R-N3 (single secret store: AWS Secrets Manager under `wf/`) holds. **No new store is introduced.** What changes is the *naming convention* inside `wf/`:

```
wf/projects/{project_id}/{credential_type}     # e.g. wf/projects/client-acme/github.token
wf/projects/self/{agent_slug}/{credential_type} # e.g. wf/projects/self/ren/anthropic.api_key
```

Legacy keys (`wf/anthropic`, `wf/github`, `wf/notion`) are aliased to `wf/projects/_default/...` for a deprecation window of one release; the runner reads `wf/projects/_default/*` only when the resolved project has no value for the requested type, and emits a CloudWatch metric so we can see usage tail off. R-N3 is *tightened*, not loosened: every credential is now addressable by `(project, type)`, and the bare `wf/{type}` path is removed at the end of the deprecation window.

### 7. Execution ledger — project-owned, agent-queryable

DDB gains a new row family:

```
pk = PROJECT#{project_id}
sk = EXEC#{ulid}
attributes: agent_slug, skill_name, skill_version, started_at, ended_at,
            status, used_credential_types[], inputs_hash,
            artifact_ref (object — see §8), error?
gsi1pk = AGENT#{agent_slug}   gsi1sk = started_at  (for the agent-memory query)
gsi2pk = SKILL#{skill_name}   gsi2sk = started_at  (for the skill-utilisation query, Epic-004)
```

The membership rows (`PROJECT#{id}/MEMBER#{slug}`) gain **GSI3** (`gsi3pk = MEMBER#{agent_slug}, gsi3sk = joined_at`) for the agent-profile "Memberships" view (per Q9 resolution). One DDB query per agent-profile load instead of a full-table scan.

This **replaces neither** `AGENT#{slug}/RUN#{ulid}` nor `AGENT#{slug}/DELIV#{ulid}` on day one — both continue to be written for two releases (a strict dual-write). The new row is canonical; the old rows are kept for the `/workforce/agents/:slug` profile view until the front-end is migrated to query the new GSI. After two releases, the old `RUN`/`DELIV` writes are removed in a Zone A PR.

Agent memory = the GSI1 query: `gsi1pk = AGENT#ren, gsi1sk between (t0, t1)`. Cross-project visibility is a property of the project's membership list (every agent in project C sees every execution in project C). `self`'s membership is the agent itself, which gives each agent a private execution stream by construction.

### 8. Artefacts — S3, referenced from `Execution`

Every execution writes its output (or an empty receipt for "fire-and-forget" skills) to S3 under a project-prefixed key:

```
s3://wf-bucket-{stage}/projects/{project_id}/{yyyy}/{mm}/{exec_ulid}/{filename}
```

The `Execution` row carries `artifact_ref`:

```json
{
  "uri":          "s3://wf-bucket-prod/projects/client-acme/2026/05/01HXY.../result.json",
  "content_hash": "sha256:…",
  "content_type": "application/json",
  "size_bytes":   2148,
  "summary":      "Merged PR #142 on acme/web; CI green; 3 reviewers approved."
}
```

`summary` is a ≤512-char inline preview (cheap to read on the listing path). The full body is fetched from S3 only on demand. A skill that mistakenly tries to write a credential value into the artefact (caught by a redaction regex in the writer wrapper) throws — credential bodies must never leave the runner.

The bucket prefix `projects/{project_id}/...` is enforced by an IAM condition on the per-stage role: the runner is granted `s3:PutObject` only under the prefix matching the currently-resolved project. A cross-project write fails at the AWS layer, not just at the application layer.

### 9. Agent recall — structured + semantic (both in v1)

The data-model's current deferral of vector embeddings to v2/v3 is **amended by this Epic** (this is the Zone A consequence and the single biggest change in scope). The recall path serves two query shapes from day one:

- **Structured.** `agent.recall(project?, skill?, time_range?, status?, k?)` → DDB query against `GSI1` (agent-scoped) with optional filtering. Hits the row, returns `(Execution, artifact_ref)`. Fast, deterministic, primary use case for the operator chat surface.
- **Semantic.** A per-execution embedding is computed over `{skill_name, inputs_summary, artifact.summary, error}` at write time and stored in a vector index. `agent.recall(query="…", k=5)` returns top-k execution IDs by cosine, which are then hydrated from DDB. The index lives in **S3 Vectors** — AWS-native, fully serverless (no provisioned capacity, pay per stored vector + per query), single account, no new vendor. Embeddings are produced by **Amazon Bedrock Titan Embed Text v2** (`amazon.titan-embed-text-v2:0`, 1024 dims) — AWS-native, ~USD 0.00002/1K input tokens. The choice is forced by R-N5 (single observability stack ⇒ AWS-native) and R-N2 (single state store ⇒ no third-party vector SaaS); S3 Vectors is the lowest-friction option that satisfies "semantic, serverless, no new vendor, no provisioned floor". OpenSearch Serverless was rejected because its 2-OCU minimum (~USD 50/mo) is a provisioned floor disguised as serverless, and pgvector-on-Aurora-Serverless was rejected because R-N2 forbids RDS-family stores.

Each vector carries `{model_id, dim}` metadata alongside the embedding so a future model swap is a re-embed query, not a guess (per Q3 resolution).

A `recall()` call with both `query=` and structured filters runs the semantic search first, then post-filters by the structured predicates — never the other way around, so the k=5 ceiling is honoured on the semantic axis.

> **Operational note**: S3 Vectors was announced GA in 2025. Story 1-B (or a dedicated Story 5) must confirm GA availability in the workforce's deploy region (`us-west-2`) before the vector index is provisioned. If the region is not yet GA at provisioning time, fall back to **storing embeddings as DDB binary attributes on the Execution row** and computing top-k in-Lambda (acceptable to ~10k vectors; about a year's worth at current execution rate) until the region catches up.

### 10. Projects console — operator UI surface (Story 3)

The console adds pages under the existing Workforce SPA and a thin read/write API layered onto the trust boundary defined in §1–§9. The UI **never resolves credential values** — it shows that a `(project, type)` pair exists, who owns it, and when it was last rotated; the value itself stays inside the runner.

| Page | Path | Role |
|---|---|---|
| Projects index | `/workforce/projects` | Filtered list of `PROJECT#*/META` rows. Status / owner chips. `self/*` rows hidden by default. |
| Project detail | `/workforce/projects/:id` | Three tabs: Members (active + audit), Credentials (type list, no values), Executions (ledger, GSI / partition queries). |
| Agent cross-link | `/workforce/agents/:slug` | New "Memberships" section listing projects the agent participates in. |

API surface — relayed through the existing `wf-agents-api` Lambda (per Q5; rename of the Lambda's logical ID to `wf-workforce-api` is a separate follow-up PR once `/projects/*` and any future entity family land), under the Epic-007 routing pattern:

```
GET    /projects                          list (paginated, ?status=, ?owner=, ?include_self=)
GET    /projects/{id}                     META row + member summary
GET    /projects/{id}/members             active members; ?include_revoked=true for audit
GET    /projects/{id}/credentials         [{type, sm_path, last_rotated_at}]   ← VALUES OMITTED
GET    /projects/{id}/executions          ledger, paginated, ?from=&to=&status=&agent=&skill=
GET    /projects/{id}/executions/{ulid}   one row + presigned artefact URL (scoped to {project, ulid})
POST   /projects/{id}/members             { agent_slug }                       (IAM-auth, operator)
DELETE /projects/{id}/members/{slug}      soft delete → revoked_at             (IAM-auth, operator)
PATCH  /projects/{id}                     { status: "archived", owner_agent? } (IAM-auth, operator)
PUT    /projects/{id}/credentials/{type}  { value }       (Story 4 — IAM-auth, operator, audited)
```

Four invariants the API surface MUST enforce, even though the helper layer in §1 does not:

- **Credentials are never *read* through the API.** `GET /credentials` returns paths and rotation metadata only. Values resolve only inside the runner via `getCredential()` (§5).
- **Credentials can only be *written* by the operator, and every write produces an audit row.** `PUT /credentials/{type}` (Story 4) is IAM-auth; the Lambda writes the value to Secrets Manager AND appends an audit row `PROJECT#{id}/AUDIT#{ulid}` with `{event: "credential_put", actor, type, value_sha256, timestamp}`. The response never echoes the value. The Lambda's structured logs never include the request body. A test asserts the value never appears in CloudWatch.
- **`listExecutions` is read-gated.** §7 leaves this open in the helper by design. The API resolves the Cognito principal to `_operator` or an `AgentSlug`, and rejects unless that principal is `_operator` or an active member of the project.
- **Artefact presigned URLs are scoped to `(project_id, exec_ulid)`.** A signing Lambda emits the URL; direct S3 references from the SPA are forbidden, matching the §8 IAM prefix-restriction at the AWS layer.

`POST /projects` is **not** exposed: new projects come from `workforce/projects/{id}/project.json` + a seed step, mirroring Epic-007's "Creates via API are deliberately not exposed". `self/{slug}` is auto-seeded by Story 1-B. `PROJECT#ai-native-article` is seeded as a regular (non-`self`) project for the editorial pipeline (per Q4 resolution).

Mutation operations take an IAM-authed operator. Agent-as-actor mutation (e.g. Maya removes a member on the operator's behalf) is out of scope (per Q7) and listed under Out of scope.

**Story 3** covers the read surface + the membership / archive mutations. **Story 4** covers the credential write surface (the `PUT` endpoint, the audit row family, the UI confirm-step + value-blanked input field). Both are in this Epic; both can be filed as separate GitHub issues by Maya.

## Behaviour at N = 100+ agents

The proposed shape is **better** at 100+ agents than the current one, in three ways:

1. **Credential blast radius shrinks per-agent.** Today a leaked `wf/github` token compromises every project. Post-Epic, each project's tokens are addressable and rotatable independently. At N=100 agents across (say) 20 projects, the worst-case credential compromise affects 1/20th of the workforce.
2. **Execution ledger query cost stays bounded.** The agent-profile view (`/workforce/agents/:slug`) is a single GSI1 query against `AGENT#{slug}`, not a scan over a growing global RUN/DELIV table. The project audit view is a single PK query against `PROJECT#{slug}`. Neither degrades with workforce size.
3. **The recall surface scales by partitioning, not by sharding.** S3 Vectors is per-bucket pay-per-use with no provisioned floor — adding the 100th agent adds storage proportional to that agent's history, not a new partition cost. Filtering by `agent_slug` is a query-time metadata filter (S3 Vectors supports metadata filtering natively). Per-recall latency is independent of total workforce size.

The shape that *would* scale badly at 100+ — a single global execution log, or a provisioned per-agent vector index multiplied 100×, or per-agent Secrets Manager entries — is explicitly **not** what this Epic proposes. The single Secrets Manager + single S3 Vectors bucket + single DDB table choices are the same R-N2/R-N3/R-N5 commitments the workforce already made; this Epic only refines their *internal naming*.

The one variable that does grow linearly with project count is the IAM policy size (one prefix-restriction statement per project for the runner role). At 100 projects that policy is ~6 KB — well under AWS limits (10 KB inline, 20 KB managed). At 1000 projects we revisit and switch to a session-policy or assumable per-project role; that's a v3 conversation.

## Cost impact

| Item | Monthly | Notes |
|---|---|---|
| S3 Vectors (storage + queries, AWS-native serverless) | ~USD 1 | No provisioned floor. ~150 MB cumulative after year 1 (100 execs/day × 1024-dim float32 + metadata); query traffic <1k/day in v1. |
| Bedrock Titan Embed Text v2 (`amazon.titan-embed-text-v2:0`, 1024 dim) | ~USD 1 | 100 execs/day × ~500 input tokens at USD 0.00002/1K. AWS-native; no third-party vendor. |
| Additional S3 PutObject + storage (~10× v1 due to per-execution artefacts) | ~USD 3 | Lifecycle: transition to S3 Standard-IA at 90 days, no auto-delete. |
| **Total added** | **~USD 5/mo** | |

The existing total after Epic-009 is USD 83/100. Adding this Epic's USD 5 puts us at USD 88 — **well within the W-3 ceiling**. **No W-3 raise required** (the prior draft proposed a raise to USD 200 because of OpenSearch Serverless's USD 50/mo provisioned floor; replacing it with S3 Vectors eliminates that line item entirely).

This also removes the "split this Epic if W-3 is declined" fall-back: §9 ships in v1 alongside §1–§8.

## Acceptance criteria

- `workforce/lambdas/shared/project.ts` exports `Project.get_credential(type)`, `Project.append_execution(...)`, `Project.list_executions(filter)`. Unit tests cover the cross-project denial path.
- `workforce/skills/*/meta.json` schema (`workforce/scripts/validate-skill-meta.mjs`) gains an optional `requires: string[]` field, validated against a known type list.
- A new file `workforce/lambdas/shared/credential-injector.ts` injects only the declared `requires` types; an attempt to read an undeclared type from the skill context throws.
- DDB has the new row families `PROJECT#{id}/EXEC#{ulid}` (GSI1 / GSI2 per §7), `PROJECT#{id}/MEMBER#{slug}` with **GSI3** (per Q9), and `PROJECT#{id}/AUDIT#{ulid}` (per Story 4). Migration is dual-write for two releases; the cut-over PR removes the old `RUN`/`DELIV` writes.
- Secrets Manager namespace migration: a one-shot Lambda copies existing `wf/{type}` → `wf/projects/_default/{type}`, the runner falls back to `_default` on miss, and the CloudWatch metric `WfLegacyCredentialReads` exists and graphs to zero over the deprecation window.
- `PROJECT#ai-native-article` is seeded with `notion.integration_token` (per Q4); every editorial-pipeline agent (Aoi, Elena, Mira, Theo, Yuki, plus any future editorial persona) is added as a member. Article-publishing skills resolve their Notion token from this project, not from `wf/notion`.
- An integration test verifies S3 IAM denies a `PutObject` to a prefix other than the resolved project's.
- `agent.recall(query="…")` returns top-k executions for the calling agent, never executions from a project the agent does not belong to (covered by an authorisation test).
- Semantic recall is backed by **S3 Vectors** with **Bedrock Titan Embed Text v2** (no OpenSearch, no third-party embeddings). The fallback path (DDB-binary embeddings + Lambda top-k) is documented in §9 and active until S3 Vectors is GA in `us-west-2`.
- [data-model.md §What's deliberately NOT in the data model](../data-model.md#whats-deliberately-not-in-the-data-model) updated to remove "Vector embeddings / RAG store" from the deferral list and to add `PROJECT#{id}/EXEC#{ulid}`, `PROJECT#{id}/MEMBER#{slug}` (+ GSI3), and `PROJECT#{id}/AUDIT#{ulid}` to the row catalogue.
- **Story 3 — Projects console** (UI + read/write API per §10):
  - The Workforce SPA mounts `/workforce/projects` (index) and `/workforce/projects/:id` (three tabs: Members / Credentials / Executions) on `workforce.kohuehara.xyz`.
  - The endpoints in §10 are deployed via the existing `wf-agents-api` Lambda and CORS-allowed for the workforce origin. `GET` is public; `POST` / `DELETE` / `PATCH` require AWS_IAM.
  - `GET /projects/{id}/credentials` returns `{type, sm_path, last_rotated_at}` only; an integration test asserts the response body contains no secret material.
  - `GET /projects/{id}/executions` enforces the read-gate (operator OR active member); an authorisation test denies a non-member agent's call.
  - The presigned-URL emitter rejects an `exec_ulid` whose row lives under a different `project_id` prefix; verified by a deny test.
  - `self/{slug}` projects are filtered out of the default index view; visible from `/workforce/agents/:slug` and via `?include_self=true`.
  - The SPA falls back to a static `apps/workforce/public/workforce-projects-mock.json` until Story 1-B's dual-write is on; the flip to live data is a follow-up commit, not a separate Story (per Q11).
- **Story 4 — Credential write surface** (UI value-editing per Q6):
  - `PUT /projects/{id}/credentials/{type}` accepts `{value}` and writes to Secrets Manager at `wf/projects/{id}/{type}`. IAM-auth (operator); rejects on any other principal.
  - Every successful write appends `PROJECT#{id}/AUDIT#{ulid}` with `{event: "credential_put", actor, type, value_sha256, timestamp}`. The audit row never contains the value itself.
  - The Lambda's structured logs are scrubbed: a CI test parses CloudWatch logs after a put and asserts the value (and its base64 form) appears nowhere.
  - The response body is `{type, sm_path, last_rotated_at}` — never the value.
  - The SPA shows a confirm-step modal with a value-blanked input (no copy-on-blur, no autocomplete). After submission the page re-fetches `GET /credentials` and shows only the updated `last_rotated_at`.
- This Epic's `Status` flips to `Implemented` only when (a) every `wf/{type}` legacy key is removed, (b) the dual-write window has ended, (c) the front-end agent-profile view reads from the new row family, (d) Story 3's projects console is live on `workforce.kohuehara.xyz` reading live DDB data, and (e) Story 4's credential write surface is live with the audit row family wired and the no-leak CI test green.

## Open questions

All 11 questions were resolved on 2026-05-26 in the same Accepted-flip review. The resolutions are preserved here as the design audit trail; the body above is the canonical text.

- **Q1 — resolved: per-agent `PROJECT#self/{slug}`.** Granular-first is the lower-change-cost direction: collapsing N per-agent rows into one shared `self` later is a mechanical merge, while splitting one shared `self` into N requires re-deriving per-agent values (and re-relitigating the blast-radius argument). Per-agent also matches the security recommendation. Reverse if a concrete shared-`self` use case appears.
- **Q2 — resolved: soft-defined type registry.** The credential type list (`github.token`, `notion.integration_token`, …) is a data-driven JSON registry at `workforce/lambdas/shared/credential-types.json`, not a hardcoded TS enum. The parser preserves `@` from day one so the future `type@name` syntax (`github.token@deploy`) lands without a parser change. v1 still rejects names containing `@` at the registry layer; the parser stays permissive.
- **Q3 — resolved: AWS-only embedding stack.** `voyage-3-lite` (third-party / Voyage AI, outside AWS) is replaced by **Amazon Bedrock Titan Embed Text v2** (`amazon.titan-embed-text-v2:0`, 1024 dims, USD 0.00002/1K input tokens). Each stored vector carries `{model_id, dim}` metadata so a future model swap is a re-embed query, not a guess. See §9.
- **Q4 — resolved: introduce `PROJECT#ai-native-article`.** A new project (slug: `ai-native-article`) holds the editorial pipeline's `notion.integration_token`. Every article-authoring persona (Aoi, Elena, Mira, Theo, Yuki, plus any new editorial agent) is seeded as a member. Article-publishing skills resolve `notion.integration_token` from this project's bag; the bare `wf/notion` key is migrated under the §6 `_default` shim and removed at the end of the deprecation window. The project name `ai-native-article` matches the repo and is unambiguous; if a second article-stream project appears later it gets its own slug.
- **Q5 — resolved: ride along on `wf-agents-api`.** Single CORS surface, no extra cold-start, `routeKey` dispatch extends cleanly. The Lambda's logical ID is renamed to `wf-workforce-api` in a follow-up PR once `/projects/*` lands (the "agents-api" name is misleading once it serves three entity families). **Split-out trigger** (so we don't drift past this): route count > 25, or cold-start > 1s p95, or per-route deploy isolation becomes a frequent ask — any one of these triggers a Zone-A split into per-entity Lambdas.
- **Q6 — resolved: yes, UI credential value editing, expressed as Story 4 within this Epic.** The trust-boundary story is incomplete without a write path; pushing value-writes to "aws CLI only" defeats the goal of a single operator surface. Story 4 adds `PUT /projects/{id}/credentials/{type}`, an audit row family, log-scrub CI, and a confirm-step UI modal — see §10 invariants and the Story 4 acceptance criteria block.
- **Q7 — resolved: out of scope.** Mutation auth is operator-only AWS_IAM in v1. Agent-as-actor mutation is moved to Out of scope.
- **Q8 — resolved: `self/*` hidden by default; surface via `?include_self=true` and on `/workforce/agents/:slug`.** Consistent with Q1's many-self-projects shape — defaulting visible would clutter the index with N self projects against a small handful of real ones.
- **Q9 — resolved: option (b), add GSI3** (`gsi3pk = MEMBER#{agent_slug}, gsi3sk = joined_at`). One DDB query per agent-profile load instead of a full-table scan. The GSI add lands in the Story 3 PR; per Q9's own caveat, this is non-trivial to roll back, so the GSI definition is locked once that PR merges.
- **Q10 — resolved: out of scope.** Credential rotation audit display stays in CloudTrail for v1; the Story 4 `AUDIT#{ulid}` rows give us the in-table data we'd need to surface this later, but the UI surface for it is a separate Epic.
- **Q11 — resolved: accepted.** Story 3 ships first against a static `workforce-projects-mock.json` fall-back, then flips to live DDB in a follow-up commit (not a separate Story) once Story 1-B's dual-write window opens. As of 2026-05-26, Story 1-B's runner / seed / backfill pieces are already on `main` (per #110-adjacent merges), so the gap between mock and live may close inside the Story 3 PR series itself.

## Out of scope

- Per-project IAM roles (assumable). v1 uses a single runner role with a prefix-restricted policy. Per-project roles are the right shape if and when an attacker model includes "the runner itself is compromised"; today the model assumes runner integrity.
- Cross-agent message passing as a first-class primitive. Still v2 ([data-model.md](../data-model.md#whats-deliberately-not-in-the-data-model)). Project-shared execution visibility is *not* the same thing as inter-agent messaging — agents read each other's executions but do not send each other commands.
- WORM / append-only hash-chained execution ledger (tamper-evident audit). DDB PITR + S3 Versioning are sufficient for v1 (W-2). Tightening to a hash chain is a Zone A amendment when the threat model demands it.
- A "credential rotation skill" that automates token refresh. Today rotation is operator-driven; automating it is a separate Epic and a separate trust conversation.
- Per-project budget ceilings (W-3 currently aggregates by agent). Possible v2 — would compose naturally with the new `PROJECT#{id}` rows, but the operator surface and the alarm configuration are non-trivial. Not in this Epic.
- **Agent-as-actor mutation** (per Q7). Mutation endpoints in §10 take an IAM-authed operator only. Letting an agent (e.g. Maya) call `DELETE /members/:slug` on the operator's behalf requires an agent-identity flow (Cognito or signed-request-from-runner) that the workforce does not yet have. Separate Epic when the need is concrete.
- **Credential rotation audit display in the console** (per Q10). Story 4 writes `PROJECT#{id}/AUDIT#{ulid}` rows; surfacing those rows as a "rotation history" tab on `/workforce/projects/:id` is a separate Epic. CloudTrail remains the authoritative source for v1.
