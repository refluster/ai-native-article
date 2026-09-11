# ADR-0034 — Skills declare `capabilities`, not only `requires`; the runner reconciles and exercises them before the first LLM call

- **Status**: Proposed
- **Date**: 2026-09-11
- **Deciders**: operator (proposed by `dario`, workforce `issue-design`)
- **Related**: [issue #663](https://github.com/refluster/ai-native-article/issues/663) (the finding this ADR resolves), [issue #670](https://github.com/refluster/ai-native-article/issues/670) (the egress allowlist's own missing ownership/record — related but distinct: #670 is about who owns and documents the allowlist itself; this ADR is about a skill *declaring* what it needs from it), R-14 (`check-proxy-bootstrap.mjs`, the point patch this ADR generalises), [ADR-0007](adr-0007-agents-live-in-ddb-not-git.md) / [ADR-0008](adr-0008-skill-body-authoritative-api.md) (the runner composition contract this extends with a new layer), [`credential-injector.ts`](../../lambdas/shared/credential-injector.ts) (the sibling mechanism this mirrors), [ML-027](../../../docs/memory-lint-backlog.md) (the declared-but-unexercised class this belongs to)

## Context

Two independent incidents in the same month, per issue #663:

1. **Mateo, 2026-08.** The read-only-content article pipeline ran 28 times over 7 days and recorded `status: ok` all 28 times, while producing zero articles. The failure was an unreachable external host through the CCR proxy — a capability the skill silently assumed it had. Nobody noticed from monitoring, counts, or the daily digest; a reader asking "when is this article coming out" was the first signal.
2. **Dario, 2026-08.** A ported project's skill declared the credential it needed, and the declaration-presence check (the sibling of this repo's `requires` lint) passed every time — but the credential's actual *scope* was insufficient, and nothing exercised it before the real run. Four days of auth failures followed.

Both incidents are the same shape: **a check that verifies a declaration exists is not a check that the declared thing works.** `requires` + `credential-injector.ts` solved this for credential *types* (an undeclared key throws at the Proxy layer — Epic-010 §5). There is no equivalent for *capability* — outbound egress to a specific host, write scope (not just possession of a token) on an external repo, the ability to create a page in a specific Notion database. `requires` says "I hold a key"; nothing today says "I can actually reach the door this key opens."

**Verified in-repo** (skill-meta.schema.json, current fields): `name`, `display_name`, `version`, `status`, `archetype`, `deliverable`, `cost_class`, `owners`, `improvement_agent`, `created_at`, `requires`, `commons`, `recall_k`. No field expresses egress reachability, write-vs-read scope, or a target resource's existence. R-14 (`check-proxy-bootstrap.mjs`) was written as a point patch for exactly one capability — the proxy-bootstrap import — and even that narrower check missed indirect callers twice (#534, #575) before its current direct+indirect-caller scan. A point patch per incident does not generalise; the next capability gap (a Notion DB the integration isn't shared with, a repo the token can read but not write) gets its own point patch, or ships without one.

## Decision

Add a `capabilities` field to `skill-meta.schema.json` and a runner-side pre-flight reconciliation step, in three parts.

**1. The declaration (schema).**

```jsonc
"capabilities": {
  "type": "array",
  "uniqueItems": true,
  "maxItems": 8,
  "items": {
    "type": "string",
    "pattern": "^(egress:[a-z0-9.-]+|github:(read|write)|notion:(read|write))$"
  },
  "description": "Environment capabilities this skill's write-script exercises at runtime, beyond holding a credential (see `requires`). Each entry is either `egress:<host>` (the proxy must permit this host) or `<service>:read|write` (the credential must carry this scope on the service, not merely exist). Absent = the skill exercises no capability beyond its declared credentials — the common case for a pure-API-token skill like feed-post."
}
```

Optional, mirroring `requires`: a skill with no external-reachability assumption (e.g. one that only calls `POST {agents-api}/feed` with an injected token, already covered by `requires`) declares nothing new. This is deliberately a narrow enum-by-pattern, not a free-form string — the same reasoning `requires`' own allowlist pattern gives: an open string field degrades into per-skill dialects the runner can't reconcile against anything.

**2. The reconciliation (runner, before the first LLM call).** The agent-runner (`workforce/docs/routines/agent-runner.md`) gains a step between "resolve the (skill, persona, config) triple" (current step 2) and "assemble the recall packet" (current step 4): for each entry in the skill's declared `capabilities`, confirm the execution environment can, in fact, provide it — an `egress:<host>` entry gets a HEAD (or equivalent minimal-cost) request through the same proxy path the skill's write-script will use; a `<service>:read`/`<service>:write` entry gets a scope read (e.g. GitHub's own token-scope introspection, a Notion `retrieve` on the target DB) rather than an operation that mutates anything. A mismatch — the host is not allowlisted, the token cannot show write scope — **fails the task before the LLM call**, not mid-run, as a named row (`status: throw`, `dispatch_error: capability <name> unavailable: <detail>`), never a "success" with an empty deliverable — closing exactly the inversion in Mateo's incident.

**3. The exercise-once discipline (Dario's rule, generalised).** A capability declared and never exercised is a decoration, not a contract. The reconciliation step in (2) *is* the harmless exercise — every declared capability gets exhibited once, every fire, before the fire's real work starts. This generalises R-14's point fix (bootstrap the proxy or die immediately) to the whole `capabilities` vocabulary, and it is why (2) must run before, not instead of, real usage: the point is that "declared" and "working" are asserted to be the same signal on every single fire, not sampled or assumed stable between fires.

## Alternatives considered

**Leave it to failure classification instead of declaration** (the falsification Mateo's own letter proposes). If the reconciliation step ships and mid-run capability deaths do not measurably fall, the right conclusion is that capability is not a thing that can be enumerated ahead of time, and effort should go into classifying failures after the fact (e.g. a `capability-suspected` reason code on a `throw` row) rather than declaring them before. Rejected as the first move, kept as the fallback: declaration is cheap to add and directly addresses the *silent success* failure mode (28 green rows), which after-the-fact classification does not — a classified failure is still a failure that happened 28 times before anyone looked. This ADR's own falsifier (below) is exactly the trigger for moving here if declaration underperforms.

**Extend `requires` itself to carry a scope suffix** (e.g. `github.token@write:repo`) instead of a separate `capabilities` array. Rejected: `requires` answers "what credential do I read from `ctx.credentials`" and is enforced by the Proxy-layer throw-on-undeclared-access mechanism (`credential-injector.ts`) — a mechanism keyed on *type identity*, not scope. Overloading it with scope semantics would require every one of `credential-injector.ts`'s eight mirror points to also parse and validate scope grammar, multiplying the blast radius of this change by 8 for no benefit `capabilities` doesn't already give as a separate, independently-versioned field. Keeping the two separate also lets a skill declare `egress:<host>` with no credential involved at all (a public API call), which a `requires`-suffix scheme cannot express.

**A free-form string capability field**, trusting skill authors to write something reconcilable. Rejected for the same reason `requires`' own base-type allowlist exists: a free-form field degrades into per-skill dialects (`"can reach ferc.gov"` vs `"egress: ferc.gov"` vs `"FERC access"`) that no mechanical reconciler can parse, reproducing exactly the gap this ADR closes one layer down.

**Do nothing; keep patching point failures as R-14 did.** Rejected on the evidence in Context: two incidents in one month, in different subsystems, of the identical shape (declaration-presence checked, declaration-truth never exercised) — a third point patch treats the pattern as coincidence.

## Consequences

**Good.** A capability gap fails loud, once, at pre-flight — before an LLM call is spent, before a fire is misrecorded as `ok`. The 7-day silent outage and the 4-day auth-failure incident both become a single named `throw` row at fire 1, not a discovery by an external reader or four days of retries.

**The cost we are accepting.** `capabilities` becomes a ninth mirror point alongside `requires`' existing eight (`skill-meta.schema.json`, `validate-skills.mjs`, the runner's reconciliation logic itself, and any documentation enumerating the vocabulary) — the same maintenance tax `credential-injector.ts`'s own header already warns about for `requires`. Every fire that declares a capability also pays one HEAD/introspection round-trip per capability before its real work starts — cheap in isolation, but latency added to every such fire.

**What could still go wrong.** A pre-flight check can be a false negative (a host that blocks HEAD but permits GET, for instance), trading a late, expensive failure for an earlier, cheaper, but possibly less accurate one — the correctness of each capability kind's exercise method becomes its own thing to get right. This ADR does not resolve #670 (who owns and records egress-allowlist *changes*) — it assumes "is this host currently allowlisted" is queryable, and leaves deciding whether it *should* be to #670.

**Not addressed.** Retrofitting every existing skill with a declaration (adoption is incremental, the same rollout shape `requires` itself had); the specific reconciliation implementation (which module owns the pre-flight calls, retry/backoff policy — an implementation PR's decision within this ADR's contract); extending the vocabulary past `egress:<host>` and `<service>:read|write` (a future ADR's job if a third incident shows two shapes are insufficient).

**Falsifier.** Per Mateo's own pre-registered falsifier in #663: if this ships and mid-run capability deaths do **not** fall over the following month's fires (measured against the pre-#663 baseline via `EXEC#*` `status: throw` rows citing a capability-shaped `dispatch_error`), capability is not enumerable ahead of time with enough precision to catch what actually goes wrong, and effort moves to the failure-classification alternative above instead.

**Implementation** — not in this PR: (1) add `capabilities` to `skill-meta.schema.json` + `validate-skills.mjs`, (2) wire the pre-flight reconciliation into the agent-runner composition contract and document it in `workforce/docs/routines/agent-runner.md`, (3) migrate one proxy-egress-dependent skill (a `daily-research`-style Cadence) as the reference adopter. Tracked by re-opening #663's acceptance criteria once this ADR is Accepted.

---
Authored by an LLM persona (workforce `issue-design`, R-N1(a)). This proposes a decision; it does not make one.
