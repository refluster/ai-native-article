# ADR-0006 — Real-time talent replies run on a dedicated async Lambda, not the CCR batch runner

- **Status**: Accepted
- **Date**: 2026-06-09
- **Deciders**: operator
- **Epics**: [epic-013](../epics/epic-013-talent-messaging.md)

## Context

[ADR-0005](adr-0005-single-execution-model-ccr.md) settled that **scheduled
agent work** — cadences like `feed-post` — runs as a CCR task: the
EventBridge `wf-orchestrator-tick` (every 2 hours) matches each binding's
cron, batches the due tasks, and POSTs them to the CCR `/fire` URL, where the
generic `agent-runner` routine composes (agent × skill × project) and runs the
skill's bundled write-script. The Lambda *runner* was retired; one execution
model for periodic work.

Epic-013 adds a kind of work ADR-0005 never had to serve: an **operator
sends a message to a talent and expects a reply in seconds.** This breaks
two assumptions baked into the CCR batch model:

1. **Latency.** The orchestrator tick fires on a 2-hour cron. A reply that
   rides the next tick is unusable as conversation — the epic's own UX target
   is a reply within ~60 seconds (§Q2).
2. **Trigger shape.** A reply is *event-caused* (one inbound operator
   message → at most one reply), not *schedule-caused*. There is no cron to
   match; the orchestrator's whole dispatch path is cron-matching.

The epic's original §4 sketch predates ADR-0005: it described an
`executor: lambda` binding with a `RunnerContext` external-invoke path that no
longer exists. So the design had to be re-decided against today's tree.

The constraint the operator set: **keep it simple — express the loop with a
few composable mechanisms, not a new exception-laden subsystem.**

## Decision

Talent replies run on a **dedicated, async-invoked Lambda
(`wf-messaging-reply`)** that calls the LLM directly — a deliberate, narrow
*second* execution surface alongside the CCR batch runner.

The whole loop is three existing mechanisms composed:

1. **Async Lambda invoke.** `POST /threads/{id}/messages` (and `POST
   /threads`), after the operator's message persists, fires
   `wf-messaging-reply` with `InvocationType: "Event"` (fire-and-forget,
   `{thread_id, addressed_slug}`). A dispatch failure never fails the send —
   the message already landed; the operator sees "delivery pending" (C-4 /
   W-4), never a silent drop.
2. **The existing LLM wrapper.** The reply Lambda composes the addressed
   agent's persona (`agents/{slug}/system.md`, bundled into the artefact like
   `wf-seed-agents`) + a tight reply prompt and calls `shared/llm-anthropic.ts`
   `complete()` — the **same `wf/anthropic` secret every agent already uses.**
   No new credential, no new provider.
3. **The existing messaging store.** On a valid reply the Lambda writes the
   talent `MSG#` row via `shared/messaging.ts` `sendMessage({from: talentSlug,
   …})` — the same module and trust domain as the operator route, so **no
   bearer-gated talent-write endpoint is needed.**

No TASK queue, no dispatcher, no DynamoDB stream, no CCR `/fire` for messaging.

W-1 editorial integrity is enforced **in the handler, server-side**: a
`finish_reason==='length'` truncation throws (via `complete()`), an
LLM-failure artefact in the first 50 chars throws, an empty body throws, and
the `__NO_REPLY_NEEDED__` sentinel writes nothing (a `skipped` outcome). Loop
safety is structural: the Lambda writes via the shared module, not the HTTP
route, so a reply never re-invokes the Lambda — the chain terminates by
construction. A per-thread daily reply budget is the cost backstop.

## Alternatives considered

- **Ride the 2-hour CCR tick** (bind `messaging-reply` as a cadence). Zero new
  infra, but a reply up to 2 hours late is not a conversation. Rejected on
  latency.
- **A CCR `/fire` per message** (reuse the batch runner for one event-driven
  task). Keeps a single execution model on paper, but the runner is built to
  *batch* scheduled tasks; firing a full CCR session per message adds
  cold-start cost and couples the message path to the routine substrate for no
  UX gain. Rejected as heavier than the problem.
- **DynamoDB Streams → dispatcher Lambda.** Truly decoupled and event-driven,
  but adds a stream + a dispatcher + IAM for a one-hop fan-out that a direct
  async invoke already gives us. Rejected as more machinery than the simplicity
  constraint allows; revisitable if reply volume ever needs queue-grade
  durability/retry.

## Consequences

- **A second execution surface exists.** This narrows ADR-0005's "single
  execution model" claim: CCR remains the model for *scheduled/cadence* agent
  work; real-time operator↔talent replies are an explicit carve-out. The two
  do not overlap — no skill runs on both. ADR-0005 is not superseded (its
  decision for periodic work stands); it is amended in scope by this ADR.
- **Cost scales with operator activity, not agent count.** One operator
  message → at most one Claude call (1:1) or one per @-addressed talent
  (group). The workforce never generates a message unprompted (Epic §6).
- **No new credential or provider.** Reuses `wf/anthropic`. Adding a provider
  later (e.g. Azure OpenAI) would be a swap inside `llm-anthropic.ts`'s
  caller, not a structural change here.
- **Replies are async with a UI poll.** The SPA send returns immediately; the
  reply lands seconds later and surfaces on the next thread refresh (a
  "drafting…" affordance is Story 3b).
- **Group threads stay bounded.** Only the @-addressed (or primary)
  participant replies; full group free-for-all (talent↔talent) remains out of
  scope, where loops would live.

## Related

- [ADR-0005](adr-0005-single-execution-model-ccr.md) — the batch/cadence
  execution model this ADR carves a real-time exception out of.
- [epic-013](../epics/epic-013-talent-messaging.md) §4–§7 — the reply loop,
  W-1 at message scale, loop safety, and group-thread constraints.
