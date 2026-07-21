# ADR-0021 — Dynamic memory-write token: ADR-0009's minted-token pattern replaces the static secret

- **Status**: Accepted
- **Date**: 2026-07-21
- **Deciders**: operator (refluster) — in-message direction on the ADR-0020 rollout ("トークン管理の複雑性が上がるため極力同じものを使いまわしたい" / "ADR-0009の動的発行方式に将来移行する（フォローアップPR）"); drafted by a Claude Code session
- **Related**: [ADR-0020](adr-0020-delegated-memory-curation.md) (the write route + Cadence this token authorises; superseded by this decision), [ADR-0009](adr-0009-scoped-capability-tokens.md) (the scoped-capability-token direction this instantiates), [ADR-0005](adr-0005-single-execution-model-ccr.md) (CCR trust boundary — sessions hold capability tokens, never AWS creds), [Epic-018](../epics/epic-018-semantic-memory-curation.md)

## Context

ADR-0020 shipped `POST /agents/{slug}/memory` gated by a bearer token, and
picked the fastest correct thing for the first cut: a single static secret,
`wf/projects/agent-workforce/workforce.memory_write_token`, minted once in
Secrets Manager and compared with `timingSafeEqual`. That shipped and works.

Reviewing the production rollout, the operator raised the token-management
cost directly: every new static per-service secret is one more credential to
provision, rotate, and reason about, and asked whether the mint step could
reuse something that already exists rather than adding a bespoke secret.
ADR-0009 had already answered this question at the org level — "one minter,
scope-claimed short-lived tokens, retiring per-service static bearers" — and
the org already has a working instance of exactly that shape:
`shared/engagement-token.ts`, which mints a short-lived token into DynamoDB
per orchestrator fire and validates it before falling back to a legacy
static secret. The operator picked the ADR-0009-aligned migration as a
follow-up PR rather than live with a second static secret.

## Decision

Move `workforce.memory_write_token` from "static Secrets Manager secret,
primary" to "short-lived DynamoDB-minted token, primary; the ADR-0020 static
secret, fallback" — mirroring the engagement-token shape exactly, not
inventing a new one:

1. **`shared/memory-write-token.ts`** (new module, mirrors
   `engagement-token.ts`): `mintMemoryWriteToken(ttlSeconds = 5400)` writes
   one `AUTH#MEMORY_WRITE / TOKEN#{token}` row (`expires_at` +  a DynamoDB TTL
   attribute) via `UpdateCommand`; `isValidMemoryWriteToken(token)` reads the
   row and asserts `expires_at > now`. "Trust = can write the table" — no new
   IAM grant is needed because both Lambdas already hold table-wide
   `WfTable` access (`AgentsApiTableAccess`, `OrchestratorDdbAccess` — neither
   policy is pk-scoped).
2. **Orchestrator mints per-task, not per-tick.** Unlike the engagement token
   (minted once per orchestrator tick and injected into every task via a
   flat credential key, since every skill needs it), the memory-write token
   is only needed by the memory-curation binding. `resolveCredentialsForTask`
   special-cases `type === "workforce.memory_write_token"` inside the normal
   per-binding `requires[]` resolution loop and mints fresh rather than
   reading Secrets Manager — the credential key and shape presented to the
   skill (`{token}`) are unchanged, so this is invisible to the
   memory-curation skill's `SKILL.md` / `update-memory.mjs` contract.
3. **`validateMemoryWriteBearer` tries the dynamic path first, the ADR-0020
   static secret second** — the same two-path shape
   `validateEngagementWriteBearer` already established. A DDB read error
   falls through to the static path rather than 500ing.
4. **The static secret survives as the fallback**, exactly as
   `wf/api/engagements-write-token` survives alongside the dynamic
   engagement token: an operator/ad-hoc escape hatch (e.g. hand-testing the
   route with `curl`), not the normal path. No secret rotation or deletion
   is required by this ADR.
5. No change to §5 authority, the ADR-0019 content contract, the shrink
   guard, the audit trail, or the memory-curation Cadence's binding — this
   ADR is scoped to *how the write capability is authenticated*, not *what
   it authorises* or *who holds it*.

## Alternatives considered

- **Keep the ADR-0020 static secret as-is.** Simplest, but leaves a second
  bespoke per-service secret in Secrets Manager exactly when the operator
  asked to reduce that surface, and doesn't follow the direction ADR-0009
  already committed the org to.
- **Retire the static secret entirely (dynamic-only).** Rejected for the same
  reason the engagement token kept its fallback: a DDB outage or a
  hand-testing session without a freshly-minted token would have no way to
  exercise the route. Keeping both costs one `try` block.
- **Mint once per orchestrator tick (like the engagement token) instead of
  per-task.** The engagement token is shared across every task because every
  skill needs to record an engagement; the memory-write token is needed by
  exactly one binding (memory-curation). Minting inside
  `resolveCredentialsForTask`'s existing per-binding loop is simpler than
  adding a second tick-level special case for a single-consumer credential.
- **A shared `AUTH#CAPABILITY` namespace instead of a dedicated
  `AUTH#MEMORY_WRITE` pk.** Would need a `capability` attribute to
  disambiguate engagement vs. memory tokens read from the same partition,
  adding a field to check rather than relying on the partition key itself.
  Not worth it for two capability types; revisit if a third capability token
  is added and the pattern should generalise.

## Consequences

- No new secret to provision or rotate for this migration; the token
  lifecycle for memory-write now matches engagement-write exactly, which is
  the ADR-0009 direction generalising across the org's capability tokens.
- No SAM/IAM template change — both Lambdas already have table-wide `WfTable`
  access.
- A leaked memory-write token now expires in 90 minutes by default instead of
  living until manually rotated — smaller blast radius, same one-field
  mutation scope from ADR-0020.
- The memory-curation Cadence's skill contract, binding, and `requires[]`
  declaration are unchanged; this migration is invisible to the skill layer.
- ADR-0020 is superseded by this decision for the *authentication mechanism*
  section only; its route design, content contract, shrink guard, curator
  assignment (freya), and §5 authority grant remain in force and are not
  restated here.
