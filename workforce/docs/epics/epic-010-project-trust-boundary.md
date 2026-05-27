# Epic-010 — Project as trust boundary: credentials, executions, agent memory

- **Status**: Draft
- **Owner**: Maya
- **Created**: 2026-05-24
- **Implemented by**: —

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
- **Semantic.** A per-execution embedding is computed over `{skill_name, inputs_summary, artifact.summary, error}` at write time and stored in a vector index. `agent.recall(query="…", k=5)` returns top-k execution IDs by cosine, which are then hydrated from DDB. The index lives in **OpenSearch Serverless** (kNN vector engine) — same AWS account, same VPC, no new vendor. The choice is forced by R-N5 (single observability stack ⇒ AWS-native) and R-N2 (single state store ⇒ no third-party vector SaaS); OpenSearch is the lowest-friction AWS-native option that satisfies "semantic but not a new vendor". An alternative (pgvector on a small RDS instance) is rejected because R-N2 forbids RDS.

A `recall()` call with both `query=` and structured filters runs the semantic search first, then post-filters by the structured predicates — never the other way around, so the k=5 ceiling is honoured on the semantic axis.

### 10. Projects console — operator UI surface (Story 3)

The console adds pages under the existing Workforce SPA and a thin read/write API layered onto the trust boundary defined in §1–§9. The UI **never resolves credential values** — it shows that a `(project, type)` pair exists, who owns it, and when it was last rotated; the value itself stays inside the runner.

| Page | Path | Role |
|---|---|---|
| Projects index | `/workforce/projects` | Filtered list of `PROJECT#*/META` rows. Status / owner chips. `self/*` rows hidden by default. |
| Project detail | `/workforce/projects/:id` | Three tabs: Members (active + audit), Credentials (type list, no values), Executions (ledger, GSI / partition queries). |
| Agent cross-link | `/workforce/agents/:slug` | New "Memberships" section listing projects the agent participates in. |

API surface — relayed through the existing `wf-agents-api` Lambda (see Q5), under the Epic-007 routing pattern:

```
GET    /projects                          list (paginated, ?status=, ?owner=, ?include_self=)
GET    /projects/{id}                     META row + member summary
GET    /projects/{id}/members             active members; ?include_revoked=true for audit
GET    /projects/{id}/credentials         [{type, sm_path, last_rotated_at}]   ← VALUES OMITTED
GET    /projects/{id}/executions          ledger, paginated, ?from=&to=&status=&agent=&skill=
GET    /projects/{id}/executions/{ulid}   one row + presigned artefact URL (scoped to {project, ulid})
POST   /projects/{id}/members             { agent_slug }                       (IAM-auth)
DELETE /projects/{id}/members/{slug}      soft delete → revoked_at             (IAM-auth)
PATCH  /projects/{id}                     { status: "archived", owner_agent? } (IAM-auth)
```

Three invariants the API surface MUST enforce, even though the helper layer in §1 does not:

- **Credentials are never read through the API.** The credentials endpoint returns paths and rotation metadata only. Values resolve only inside the runner via `getCredential()` (§5).
- **`listExecutions` is read-gated.** §7 leaves this open in the helper by design. The API resolves the Cognito principal to `_operator` or an `AgentSlug`, and rejects unless that principal is `_operator` or an active member of the project.
- **Artefact presigned URLs are scoped to `(project_id, exec_ulid)`.** A signing Lambda emits the URL; direct S3 references from the SPA are forbidden, matching the §8 IAM prefix-restriction at the AWS layer.

`POST /projects` is **not** exposed: new projects come from `workforce/projects/{id}/project.json` + a seed step, mirroring Epic-007's "Creates via API are deliberately not exposed". `self/{slug}` is auto-seeded by Story 1-B.

Mutation operations take an IAM-authed operator. Agent-as-actor mutation (e.g. Maya removes a member on the operator's behalf) requires an identity-flow the workforce does not yet have, and is out of scope.

## Behaviour at N = 100+ agents

The proposed shape is **better** at 100+ agents than the current one, in three ways:

1. **Credential blast radius shrinks per-agent.** Today a leaked `wf/github` token compromises every project. Post-Epic, each project's tokens are addressable and rotatable independently. At N=100 agents across (say) 20 projects, the worst-case credential compromise affects 1/20th of the workforce.
2. **Execution ledger query cost stays bounded.** The agent-profile view (`/workforce/agents/:slug`) is a single GSI1 query against `AGENT#{slug}`, not a scan over a growing global RUN/DELIV table. The project audit view is a single PK query against `PROJECT#{slug}`. Neither degrades with workforce size.
3. **The recall surface scales by partitioning, not by sharding.** OpenSearch Serverless auto-scales the vector index; the partition key is `agent_slug` (so agent recall hits one partition). Adding the 100th agent doesn't change the per-recall latency; it adds one partition.

The shape that *would* scale badly at 100+ — a single global execution log, or a per-agent vector index multiplied 100×, or per-agent Secrets Manager entries — is explicitly **not** what this Epic proposes. The single Secrets Manager + single OpenSearch + single DDB table choices are the same R-N2/R-N3/R-N5 commitments the workforce already made; this Epic only refines their *internal naming*.

The one variable that does grow linearly with project count is the IAM policy size (one prefix-restriction statement per project for the runner role). At 100 projects that policy is ~6 KB — well under AWS limits (10 KB inline, 20 KB managed). At 1000 projects we revisit and switch to a session-policy or assumable per-project role; that's a v3 conversation.

## Cost impact

| Item | Monthly | Notes |
|---|---|---|
| OpenSearch Serverless (vector engine, 2 OCU min) | ~USD 50 | New line item. The minimum billable footprint dominates at workforce scale; the per-execution embed cost is rounding error. |
| Additional S3 PutObject + storage (~10× v1 due to per-execution artefacts) | ~USD 3 | Lifecycle: transition to S3 Standard-IA at 90 days, no auto-delete. |
| Embedding API calls (assume Voyage `voyage-3-lite` at ~USD 0.02/M tokens, 100 execs/day × 500 tokens) | ~USD 1 | Per W-3, this counts against the workforce budget. |
| **Total added** | **~USD 54/mo** | |

The existing total after Epic-009 is USD 83/100. Adding this Epic's USD 54 puts us at USD 137 — **over the W-3 ceiling**. **This Epic therefore depends on a W-3 ceiling raise to USD 200/mo**, which is a Zone A change to [governance.md §2](../governance.md#2-l0-invariants-w-1w-5) and must accompany this Epic's implementation PRs (not precede them; the ceiling raise has no effect without the spend).

If the operator declines the W-3 raise, the recommended fall-back is to **split this Epic**: implement §1–§8 (no semantic recall) in v1 — that adds only ~USD 3/mo — and re-open §9 as Epic-011 when the vector workload is justified. The structured-recall path alone delivers ~70% of the chat surface's value.

## Acceptance criteria

- `workforce/lambdas/shared/project.ts` exports `Project.get_credential(type)`, `Project.append_execution(...)`, `Project.list_executions(filter)`. Unit tests cover the cross-project denial path.
- `workforce/skills/*/meta.json` schema (`workforce/scripts/validate-skill-meta.mjs`) gains an optional `requires: string[]` field, validated against a known type list.
- A new file `workforce/lambdas/shared/credential-injector.ts` injects only the declared `requires` types; an attempt to read an undeclared type from the skill context throws.
- DDB has the new row family `PROJECT#{id}/EXEC#{ulid}` and the GSI1 / GSI2 indexes described in §7. Migration is dual-write for two releases; the cut-over PR removes the old `RUN`/`DELIV` writes.
- Secrets Manager namespace migration: a one-shot Lambda copies existing `wf/{type}` → `wf/projects/_default/{type}`, the runner falls back to `_default` on miss, and the CloudWatch metric `WfLegacyCredentialReads` exists and graphs to zero over the deprecation window.
- An integration test verifies S3 IAM denies a `PutObject` to a prefix other than the resolved project's.
- `agent.recall(query="…")` returns top-k executions for the calling agent, never executions from a project the agent does not belong to (covered by an authorisation test).
- [governance.md §2](../governance.md#2-l0-invariants-w-1w-5) W-3 raised to `USD 200/month combined`, in the same PR series, with a CloudWatch Billing Alarm reconfigured to match.
- [data-model.md §What's deliberately NOT in the data model](../data-model.md#whats-deliberately-not-in-the-data-model) updated to remove "Vector embeddings / RAG store" from the deferral list and to add `PROJECT#{id}/EXEC#{ulid}` to the row catalogue.
- **Story 3 — Projects console** (UI + read/write API per §10):
  - The Workforce SPA mounts `/workforce/projects` (index) and `/workforce/projects/:id` (three tabs: Members / Credentials / Executions) on `workforce.kohuehara.xyz`.
  - The endpoints in §10 are deployed via the existing `wf-agents-api` Lambda and CORS-allowed for the workforce origin. `GET` is public; `POST` / `DELETE` / `PATCH` require AWS_IAM.
  - `GET /projects/{id}/credentials` returns `{type, sm_path, last_rotated_at}` only; an integration test asserts the response body contains no secret material.
  - `GET /projects/{id}/executions` enforces the read-gate (operator OR active member); an authorisation test denies a non-member agent's call.
  - The presigned-URL emitter rejects an `exec_ulid` whose row lives under a different `project_id` prefix; verified by a deny test.
  - `self/{slug}` projects are filtered out of the default index view; visible from `/workforce/agents/:slug` and via `?include_self=true`.
  - The SPA falls back to a static `apps/workforce/public/workforce-projects-mock.json` until Story 1-B's dual-write is on; the flip to live data is a follow-up commit, not a separate Story.
- This Epic's `Status` flips to `Implemented` only when (a) every `wf/{type}` legacy key is removed, (b) the dual-write window has ended, (c) the front-end agent-profile view reads from the new row family, and (d) Story 3's projects console is live on `workforce.kohuehara.xyz` reading live DDB data.

## Open questions

- **Q1. Should `self` be one project per agent (`PROJECT#self/{slug}`) or one composite project (`PROJECT#self` containing all agents)?** The Epic proposes per-agent — each agent's "personal" credentials are private to that agent. The alternative (one shared `self`) would let any agent ping the operator on any other agent's behalf, which collapses to the same blast radius problem this Epic is trying to fix. Recommend keeping per-agent; flag if a use case for shared `self` emerges.
- **Q2. Same-type, multiple values per project.** A future need: project C uses both an org-level GitHub token (admin) and a per-repo deploy key (scoped). The Epic keeps v1 strict (1 type = 1 value) but reserves `type@name` syntax (`github.token@deploy`) for the inevitable v2 extension. Worth flagging now so the parser supports `@` from day one without parsing it.
- **Q3. Embedding model lock-in.** `voyage-3-lite` is the v1 choice on cost grounds, but the index is not free to re-embed. We should write the embedding `model_id` and `dim` next to each vector so re-indexing on a model change is a query, not a guess. Adds one row in OpenSearch metadata; small.
- **Q4. Does Notion go in `wf/projects/{id}/notion.integration_token`?** Today Notion is the editorial source of truth (W-2). It's currently shared across all editorial agents. Treating editorial-pipeline Notion as a project (`PROJECT#editorial`) is the cleanest fit; the per-persona article-publishing skills then resolve their token from that one project. Confirm before committing the migration.
- **Q5. API placement for `/projects/*`.** Ride along on the existing `wf-agents-api` Lambda (default — single CORS surface, no extra cold-start, `routeKey` dispatch extends cleanly) or split into a new `wf-projects-api`? Split only if cold-start budget tightens. If we ride along, rename the Lambda's logical ID in a follow-up PR for clarity.
- **Q6. Credential value editing from the UI.** Default: **no**. The UI shows type / path / rotation metadata. Values are written via `aws secretsmanager put-secret-value` or IaC. Surfacing a guarded write path (confirm + audit) is a follow-up Epic, not Story 3.
- **Q7. Mutation auth scope.** AWS_IAM (operator's `aws-vault` credentials) for `POST /members`, `DELETE /members/:slug`, `PATCH /projects/:id`. Agent-as-actor mutation (Maya removes a member on the operator's behalf) is out of scope — it requires a separate identity-flow the workforce does not yet have.
- **Q8. `self/{slug}` rendering.** Default: filtered out of `/workforce/projects` by default; surface via `?include_self=true` and on `/workforce/agents/:slug`. Alternative — always shown but with a visual demotion — would risk Q1's per-agent-private guarantee if a future operator action targets the wrong row.
- **Q9. Members-by-agent index.** The agent-profile "Memberships" section needs "which projects is `ren` a member of?". Three options: (a) full-table scan filtered on `agent_slug` (acceptable to ~100 projects, slow beyond), (b) a new GSI3 (`gsi3pk = MEMBER#{agent_slug}, gsi3sk = joined_at`), (c) duplicate the membership into an `AGENT#{slug}/PROJECT#{id}` mirror row. Recommend (b) for the index-per-query consistency with §7. Confirm before adding the GSI in the Story 3 PR (GSI adds is non-trivial to roll back).
- **Q10. Credential rotation audit display.** Out of scope for Story 3; rotation events live in CloudTrail. Surfacing them in the console is a separate Epic.
- **Q11. Live-data cutover.** Story 3 ships first against a static `workforce-projects-mock.json` fall-back, then flips to live DDB once Story 1-B's dual-write is on. The flip is one PR with no schema change, not a separate Story.

## Out of scope

- Per-project IAM roles (assumable). v1 uses a single runner role with a prefix-restricted policy. Per-project roles are the right shape if and when an attacker model includes "the runner itself is compromised"; today the model assumes runner integrity.
- Cross-agent message passing as a first-class primitive. Still v2 ([data-model.md](../data-model.md#whats-deliberately-not-in-the-data-model)). Project-shared execution visibility is *not* the same thing as inter-agent messaging — agents read each other's executions but do not send each other commands.
- WORM / append-only hash-chained execution ledger (tamper-evident audit). DDB PITR + S3 Versioning are sufficient for v1 (W-2). Tightening to a hash chain is a Zone A amendment when the threat model demands it.
- A "credential rotation skill" that automates token refresh. Today rotation is operator-driven; automating it is a separate Epic and a separate trust conversation.
- Per-project budget ceilings (W-3 currently aggregates by agent). Possible v2 — would compose naturally with the new `PROJECT#{id}` rows, but the operator surface and the alarm configuration are non-trivial. Not in this Epic.
