# RFC-007 — Agent management surface (DDB-projection + CRUD API)

- **Status**: Draft
- **Owner**: Maya
- **Created**: 2026-05-18
- **Implemented by**: —

## Problem

Operator direction ([PR #28 comment](https://github.com/refluster/ai-native-article/pull/28#issuecomment-4479625014)): the agent roster should be a **DynamoDB-backed list with basic CRUD API operations, deployed via AWS SAM**, with Lambdas built on **TypeScript / Node.js 24.x**.

The existing design (PR #28) keeps agent definitions as repo files at `workforce/agents/{slug}/{agent.json, system.md}`. That works for git-tracked identity but does not provide:

- A runtime API for the workforce UIs (RFCs 001–004) to read agent state without bundling all files into every Lambda.
- A way to make **operational** mutations (pause an agent, raise its budget cap, archive a retired persona) without opening a PR per change — unacceptable at 100+ agents.
- A normalized `AGENT#*` view that the orchestrator can query for "all non-paused, non-archived agents whose `schedule_cron` fires this tick" (RFC-006 S1).

A naïve fix — move everything into DDB — would also lose:

- **W-5 / Rule 11** prompt-version discipline (one persona's `system.md` bump per PR, reviewed in git).
- The audit trail that git provides for identity-defining changes.

This RFC defines a **split**: identity stays in git, operational state lives in DDB, and a thin CRUD API surfaces both for reads while restricting writes to operational fields.

## Proposed solution

### Source-of-truth split

| Field group | Lives in | Mutability |
|---|---|---|
| **Identity** — `slug`, `name`, `role`, `system.md` content, `model`, `primary_deliverable_type`, `primary_deliverable_kind`, `code_execution`, `prompt_version` | `workforce/agents/{slug}/{agent.json, system.md}` (git) | Repo PRs only. One persona per PR (Rule 11, W-5). |
| **Operational** — `schedule_cron` (override of file default), `budget_monthly_usd` (override of file default), `paused`, `archived`, `last_run_at`, `last_run_status`, `created_at` (file → DDB on first seed) | DDB `AGENT#{slug}/META` | `PATCH /agents/{slug}` via the CRUD API. |
| **Computed** — `runs_this_month`, `cost_this_month_usd`, `deliv_count_total` | DDB `BUDGET#{yyyy-mm}/AGENT#{slug}` rolled up to `META` by the runner | Written by runner, read-only via API. |

The DDB `AGENT#{slug}/META` row carries a **projected copy** of identity (slug, name, role, model, etc.) so that one-row reads serve the API without touching git or Lambda bundles. The projection is kept consistent by the seed Lambda.

### Components (all SAM-deployed, TypeScript on `nodejs24.x`)

| Logical ID | Type | Purpose |
|---|---|---|
| `WfAgentsApiFunction` | `AWS::Serverless::Function` | API GW HTTP API integration. Handles `GET /agents`, `GET /agents/{slug}`, `PATCH /agents/{slug}`, `DELETE /agents/{slug}`. |
| `WfAgentsHttpApi` | `AWS::Serverless::HttpApi` | The HTTP API itself. |
| `WfSeedAgentsFunction` | `AWS::Serverless::Function` | Reads `workforce/agents/{slug}/{agent.json, system.md}` from the deployed Lambda bundle (or `main` HEAD) and upserts `AGENT#{slug}/META` rows. Idempotent. |
| `WfSeedTriggerRule` | `AWS::Events::Rule` | Runs `WfSeedAgentsFunction` on each successful `main`-branch deploy (via deploy.yml's webhook to API GW, or as a SAM post-deploy step). Plus on-demand `aws lambda invoke`. |

### API contract (v1)

```
GET    /agents
  query: ?stream=editorial&archived=false&page_size=25&cursor=<opaque>
  returns: { items: AgentMeta[], next_cursor?: string }

GET    /agents/{slug}
  returns: AgentMeta + computed stats

PATCH  /agents/{slug}
  body: { schedule_cron?, budget_monthly_usd?, paused?, archived? }
  returns: AgentMeta (after update)
  auth: AWS_IAM (operator-only)

DELETE /agents/{slug}
  effect: sets archived=true (soft-delete). Hard delete requires
          the agents/{slug}/ directory to be removed in a PR first.
  auth: AWS_IAM
```

`GET` endpoints are **public** (no auth) — bylines are already public per W-1, so agent identity is too. `PATCH` and `DELETE` require AWS_IAM auth (operator's credentials via `aws-vault` or similar; no public mutation).

**Creates via API are deliberately not exposed in v1.** New personas come from PRs that add files; `WfSeedAgentsFunction` picks them up. This keeps Rule-11 review in the loop for prompt creation.

### Seed flow

```
operator opens PR adding workforce/agents/zara/{agent.json, system.md}
   ↓ ship-pr graduates, operator merges to main
   ↓ deploy.yml fires (existing)
   ↓ SAM build packages workforce/agents/** into the Lambda bundle
   ↓ SAM deploy
   ↓ post-deploy hook (or scheduled rule) invokes WfSeedAgentsFunction
   ↓ for each agents/{slug}/ dir present in the bundle:
       read agent.json + system.md
       compute identity-hash
       if AGENT#{slug}/META exists with same hash: noop
       else: upsert META preserving operational fields (paused, archived,
             budget_monthly_usd if overridden, schedule_cron if overridden)
   ↓ WfSeedAgentsFunction logs result; CloudWatch alarm fires on error
```

The seed is **identity-only**. Operational fields set via API are not stomped by re-seeding — they take precedence when present.

### Where the existing 5 agents land

After PR4 + RFC-007 implementation, the existing PR #28 file set becomes the **first seed payload**:

- 5 `AGENT#{slug}/META` rows in DDB, one per persona, with the file's `agent.json` projected in.
- Operational fields default from file: `schedule_cron`, `budget_monthly_usd`. `paused=false`, `archived=false`.
- `GET /agents` returns 5 items.

## Behaviour at N = 100+ agents

- `GET /agents` paginates (default 25, max 100 per page); cursor is `{archived, slug}` packed base64.
- The DDB table's primary key `AGENT#{slug}/META` is already O(N) to scan. At N=100, full-scan with a `Limit=100` returns in one query. At N=1000, paginate cleanly.
- Seed Lambda runs in O(N_files) per main-merge — at N=100, ~100 DDB UpdateItem calls, ~5s total. Acceptable.
- The CRUD API itself does not scale linearly in N — each request is a single-item read or write, constant-time.
- The runner (PR6) queries DDB directly, not the API, for orchestration (avoids API GW hop in the hot path). The API is for UIs and operators.
- File-based identity at N = 100+: the prelude/voice split in [RFC-006 S4](rfc-006-scalability.md) is the companion fix that keeps prompt review tractable. Without S4 the file count stays manageable but review of shared boilerplate becomes the bottleneck.

## Acceptance criteria

This RFC produces three issues for Maya to file:

- **Issue A — `WfSeedAgentsFunction`**: Reads `workforce/agents/**/agent.json` + `system.md` from the Lambda bundle. Upserts `AGENT#{slug}/META` preserving operational fields. Logs per-agent diff. Idempotent. TypeScript, `nodejs24.x`.
- **Issue B — `WfAgentsApiFunction` + `WfAgentsHttpApi`**: Implements the four endpoints above. `GET` public, `PATCH`/`DELETE` IAM-auth. CORS open for the gh-pages origin so the SPA can read. TypeScript, `nodejs24.x`.
- **Issue C — Wiring**: Post-deploy seed trigger (whichever of "deploy.yml step", "EventBridge on stack-update", or "manual invoke" the operator prefers — Q1 below). API GW domain (`api.kohuehara.xyz/workforce/v1/agents` or the AWS-generated URL — Q3 below).

End-to-end test (after all three issues land):

```
# Files unchanged (5 personas from PR #28)
curl https://<api>/agents          → 5 items
curl https://<api>/agents/sora     → Sora's META + zeros for runs
aws lambda invoke --function-name wf-seed-agents-dev /dev/null  → 5 upserts (no diff)

# Operational mutation
curl -X PATCH https://<api>/agents/sora -d '{"paused":true}'  (with IAM auth)
curl https://<api>/agents/sora                                → paused:true
# Re-seed
aws lambda invoke --function-name wf-seed-agents-dev /dev/null
curl https://<api>/agents/sora                                → paused:true (preserved)

# Identity change via PR
# (operator edits sora/system.md, bumps prompt_version, merges)
# deploy.yml fires, seed runs
curl https://<api>/agents/sora     → new prompt_version, paused still true
```

## Open questions

- Q1. Seed trigger — **resolved**: option (b) chosen. The SAM template wires an EventBridge rule `wf-seed-agents-postdeploy-{stage}` that fires on `CREATE_COMPLETE` / `UPDATE_COMPLETE` of the `wf-data-plane-{stage}` stack and invokes the seed Lambda. Zero CI / OIDC-role surface. The Lambda is idempotent via `identity_hash`, so spurious matches are harmless. Operator may still invoke the CLI on demand for recovery.

- Q2. `PATCH`-able field list — should `model` (e.g. flipping Sora from Sonnet to Opus) be operational or identity? Default: **identity** — model choice is part of voice, changing it warrants prompt-review. Operator confirms.

- Q3. API hostname — proper subdomain (`api.kohuehara.xyz`), path on the existing host (gh-pages can't proxy easily), or just the AWS-generated `*.execute-api.ap-northeast-1.amazonaws.com` URL with CORS? Default: AWS-generated URL for v1 (zero-config, no DNS work); subdomain later.

## Out of scope

- **POST /agents** (programmatic agent creation) — deliberately not exposed in v1 to preserve Rule 11. Auto-generation of personas (text → persona) gets its own RFC.
- **POST /agents/{slug}/runs** (trigger an agent manually via API) — useful for ops, but adds a second invocation path next to EventBridge. Defer to RFC-008 if needed.
- **Skill CRUD API.** Skills are file-based for v1; RFC-004 covers the read surface (skill catalog). Skill mutation via API is a follow-up.
- **DDB Streams → derived projections.** v2 concern.
- **WebSocket / streaming reads** for live status. v2.
