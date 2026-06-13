# ADR-0009 — Scoped capability tokens: one minter, scope-claimed short-lived tokens, retiring per-service static bearers

- **Status**: Proposed
- **Date**: 2026-06-13
- **Deciders**: operator
- **Epics**: [epic-010](../epics/epic-010-project-trust-boundary.md), [epic-011](../epics/epic-011-agent-feed.md)

## Context

The workforce now has more than one authenticated write surface, and the auth
model is **asymmetric and coupled to the service at the edge**:

| Write surface | Caller | Auth today | Lifetime |
|---|---|---|---|
| `POST /feed` (`feed-post`) | internal (CCR) | static bearer `workforce.feed_write_token` (Secrets Manager) | long-lived |
| `POST /agents/{slug}/engagements` | internal (cron / interactive) | ephemeral `AUTH#ENGAGEMENT / TOKEN#{token}` (DynamoDB, TTL) — [ADR-0005](adr-0005-single-execution-model-ccr.md) item 5 | ~90 min |
| `POST /agents/{slug}/engagements` | **external (Phase 7) client** | static bearer `wf/api/engagements-write-token` (Secrets Manager) | long-lived |

Two problems surfaced when an external client tried to POST a business summary
to `/engagements` and got **401**:

1. **The static fallback secret was never provisioned.** Code
   (`validateEngagementWriteBearer`, `handler.ts:2143`) and IAM
   (`template.yaml:453`, `AgentsApiEngagementWriteToken`) are both ready; the
   `wf/api/engagements-write-token` secret simply does not exist, so
   `GetSecretValue` throws and the validator returns `false`. This is an
   operational gap, not a design hole — but it exposed the design tension below.
2. **Token ↔ service is tightly coupled.** Every new write surface (feed,
   engagements, and any future one) needs *its own* long-lived secret to
   provision, rotate, and IAM-scope. The secret count grows linearly with the
   number of services. Long-lived bearers are also replayable and, here,
   **unscoped** — the handler comment at `handler.ts:2117` notes that *"any
   holder of the engagement-write Bearer token may record an engagement against
   any project_id."* That is the maximum blast radius for a leaked credential.

Current service-to-service auth guidance points the other way: prefer
**short-lived, narrowly-scoped tokens minted by one issuer** over long-lived
static keys; apply **least-privilege scope**; for external machine-to-machine
callers use a **client-credentials → scoped access-token exchange**, not a raw
shared bearer. The engagements *internal* path (ADR-0005) already embodies this
(ephemeral DDB capability token, minted by the privileged orchestrator). The
edges — feed, and the external engagements client — do not.

The operator's framing was precise: *don't solve the 401 by minting yet another
per-service static bearer*, and *don't reach for one shared cross-service
"uber" token either* — find the model the rest of the industry already uses.

## Decision

**Generalise the ADR-0005 engagement capability token into a single, scoped
capability-token mechanism, and route every write surface through it.**

1. **One token row, scope-claimed.** Replace the single-purpose
   `AUTH#ENGAGEMENT / TOKEN#{token}` with `AUTH#CAP / TOKEN#{token}` carrying
   `scope: string[]` (e.g. `["engagements:write"]`, `["feed:write"]`, or a
   combination), alongside the existing `expires_at` / `ttl` / `minted_at`.
   The scope claim is what makes a token *cross-service by composition* without
   ever being a long-lived shared secret.
2. **One minter, one validator.**
   - `mintCapabilityToken(scopes, ttl)` (generalises `mintEngagementToken`).
   - `validateScopedBearer(event, requiredScope)` (generalises
     `validateEngagementWriteBearer`): looks the token up, checks expiry, and
     asserts `requiredScope ∈ token.scope`. The engagements route calls it with
     `"engagements:write"`; the feed route with `"feed:write"`.
3. **Internal callers keep the same mechanism, now scope-aware.** The
   orchestrator mints `["engagements:write"]` (and, when it also dispatches a
   feed task, `["feed:write"]`) per fire and injects inline;
   `record-engagement.mjs` mints its own. No CCR session ever reads a secret —
   the ADR-0005 trust boundary (*"minting needs AWS; using does not"*) is
   preserved verbatim.
4. **External clients move to a minimal client-credentials exchange.** One
   long-lived credential **per client** — `wf/clients/{client_id}` holding
   `{ secret, scopes[] }` — replaces the per-service bearer. The client POSTs
   `client_id` + `client_secret` to a small `POST /token` endpoint and receives
   a short-lived `AUTH#CAP` token scoped to its granted `scopes`. N per-service
   secrets collapse to **one credential per external client**; new surfaces are
   reachable by *granting a scope*, not provisioning a new secret.
5. **Retire the static bearers behind a legacy-read ratchet.** Mirroring
   epic-010's `WfLegacyCredentialReads` discipline: both `workforce.feed_write_token`
   and `wf/api/engagements-write-token` stay accepted during migration; a
   CloudWatch metric counts every static-bearer validation; the secrets are
   deleted only after the metric reaches zero.

### Phasing

- **Phase 0 — unblock today (operational, not part of this structural change).**
  Provision the existing fallback secret so the external client is not blocked
  while Phases 1–2 land. Explicitly time-boxed: this secret is scheduled for
  deletion in Phase 3.
  ```bash
  aws secretsmanager create-secret \
    --name wf/api/engagements-write-token \
    --region us-west-2 \
    --secret-string '{"token":"<shared-with-the-external-client>"}'
  ```
- **Phase 1 — `AUTH#CAP` + `validateScopedBearer`.** Both routes accept scoped
  tokens *alongside* the existing static bearers (dual-accept). Internal minters
  emit scoped tokens.
- **Phase 2 — `POST /token` exchange + `wf/clients/{client_id}`.** External
  client migrates off the raw bearer.
- **Phase 3 — delete the static bearers** once the legacy-read metric is zero.

## Alternatives considered

1. **Provision a per-service static bearer for engagements (extend the status
   quo).** The one-command unblock. Rejected as the *terminal* answer: it
   doubles down on exactly the token↔service coupling the operator flagged, and
   adds another long-lived, rotatable, unscoped secret. Kept *only* as the
   Phase-0 stopgap, time-boxed to deletion.
2. **One shared cross-service "uber" bearer.** Tempting because it feels like
   "a token that works everywhere." Rejected: it is the maximum blast radius —
   a single leak compromises every surface — and has no scoping, the opposite
   of least privilege. The right form of "works across services" is *one issuer
   minting many narrowly-scoped tokens*, not one secret reused everywhere.
3. **Static API keys instead of bearers.** Rejected: the problem is the
   *lifetime*, not the header name. A long-lived API key is strictly worse than
   a short-lived scoped bearer on the exact axis that bit us.
4. **A full OAuth2 authorization server (Cognito / authentik / etc.).** The
   textbook M2M answer, but over-scaled for a single-operator hobby workforce
   (C-3 / W-class scale discipline). The DDB capability-token mechanism from
   ADR-0005 already exists, is understood, and is sufficient; a `POST /token`
   endpoint over it is a few dozen lines, not a managed IdP. Revisit only if
   external clients proliferate enough to need discovery, rotation tooling, or
   third-party scopes.

## Consequences

**Positive**
- One minter and one validator for all write surfaces; a new surface is a new
  *scope string*, not a new secret to provision/rotate/IAM-scope.
- Scope = least privilege; short TTL = small leak window; both align with the
  service-to-service auth guidance the operator asked us to follow.
- External clients gain scoped, short-lived, rotatable credentials — and the
  "any holder can write any project_id" gap can finally close by encoding the
  project (or `project:*`) into the scope and enforcing it in `appendExecution`.

**Costs / risks to accept**
- `POST /token` is a **new AWS surface** → Zone B, operator-approved; it must be
  rate-limited and TLS-only.
- Scope enforcement in `appendExecution` is a behavioural change (today's bearer
  is unscoped); the dual-accept window must not silently *widen* access.
- A migration window where both paths are live; the legacy-read metric must
  actually reach zero before deletion, or Phase 3 is a foot-gun (C-4: fail loud
  if a static read happens after the deadline).

**Governance**
- This is an **auth-infrastructure** change: Zone B, **operator-approved** (per
  governance §5 and R-N3, the single-secret-store rule — `wf/clients/{id}` stays
  inside the `wf/` namespace). It must not be self-merged.
- When **Accepted**, this ADR **partially supersedes ADR-0005**'s external-client
  clause (the static `wf/api/engagements-write-token` fallback). Per the
  append-only discipline, ADR-0005's body stays as history; its status note is
  updated to point here at acceptance time — not edited now while this is
  Proposed.

## Related

- [ADR-0005](adr-0005-single-execution-model-ccr.md) — origin of the ephemeral
  engagement capability token this ADR generalises (item 5).
- [ADR-0001](adr-0001-record-family-separation.md) — the three-sink separation
  the engagements write surface upholds.
- [epic-010](../epics/epic-010-project-trust-boundary.md) — project-scoped
  credentials and the `WfLegacyCredentialReads` ratchet pattern reused here.
- [epic-011](../epics/epic-011-agent-feed.md) — the feed write surface migrated
  off its static bearer in Phase 1.
- `workforce/docs/data-model.md` — `AUTH#ENGAGEMENT` rows (to be generalised to
  `AUTH#CAP`).
- Governance R-N3 (single secret store) and §5 (action-authority matrix).
