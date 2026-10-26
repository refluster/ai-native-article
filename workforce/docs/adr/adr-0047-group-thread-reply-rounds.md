# ADR-0047 — Group threads: every member replies once per operator message, in turn

- **Status**: Proposed (operator ratifies by merging)
- **Date**: 2026-10-24
- **Deciders**: operator (directed the change in-session, 2026-10-24: 「グループで複数人で会話しても1名しか反応しない。全員が言葉を発するように修正して」); drafted by the operator's Claude Code session
- **Supersedes**: the group-reply clause of [adr-0006](adr-0006-realtime-messaging-reply.md) §Consequences ("Only the @-addressed (or primary) participant replies") and [epic-013](../epics/epic-013-talent-messaging.md) §7 (and the "at most one reply per inbound" wording of §6 as it applies to groups). The rest of adr-0006 — the dedicated async Lambda, the shared LLM wrapper, the W-1 guards, writing via the shared module — stands unchanged.
- **Epics**: [013](../epics/epic-013-talent-messaging.md), [024](../epics/epic-024-messaging-group-chat-and-latest-first-history.md)

## Context

Epic-013 §7 deliberately kept a group post to **one** reply: the @-addressed
talent, else `participants[0]`. Epic-024 widened the compose surface so the
operator can start group threads from the console, but left that reply policy
alone.

In use, that policy makes a group thread look broken. In a five-member thread
the operator wrote 「このグループでは全員何らか会話を発して」 and only Nadia
(`participants[0]`) ever answered — including when Nadia herself put a
question to Dario in the same thread. A group the operator assembled so that
several roles would weigh in behaves like a 1:1 with spectators.

§7's concern was real but specific: N **simultaneous** LLM calls and an
agent↔agent loop with no operator-paced bound.

## Decision

One operator message in a group thread starts a **reply round**:

1. **Who speaks.** Every participant, in thread order. If the message
   @-addresses one or more participants, only those, in the order they were
   mentioned (`pickRepliers` in `shared/messaging.ts`). 1:1 is unchanged.
2. **In turn, not at once.** `agents-api` invokes `wf-messaging-reply` for
   the first member with the rest of the round in `then` and the operator
   message's id as `trigger_message_id`. After that member replies — or skips
   with `__NO_REPLY_NEEDED__`, or fails — the Lambda async-invokes itself for
   the next member. Each speaker therefore reads the replies before theirs and
   can answer a colleague's question.
3. **Bounded by construction.** `then` only shrinks, so a round is at most
   `participants.length` replies, and only an operator message starts one.
   An agent reply never starts a round. This keeps adr-0006's loop-safety
   property: conversation depth stays operator-paced.
4. **One live round per thread.** A member whose turn comes after the
   operator has written again skips with `superseded` and ends the old
   round, because the newer round includes every member. A member who has already
   answered this round (a retried or duplicated invoke) skips with
   `already_replied` and passes the turn on.
5. **The prompt.** In a group the reply prompt names the members and asks
   each one to speak, to answer questions put to them by name, and not to
   restate what a colleague already said. The "addressed to someone else in a
   group → `__NO_REPLY_NEEDED__`" escape is removed. The sentinel stays for a
   bare acknowledgement or a closing.

## Alternatives considered

- **Parallel fan-out** (the API invokes the Lambda once per member). Simplest
  change, but every member answers only the operator: no one sees a
  colleague's reply, replies land in random order and often repeat one
  another, and a question one member puts to another goes unanswered. Rejected
  because the operator wants a conversation, not N parallel 1:1 replies.
- **One invocation loops over the members.** No self-invoke and no new IAM,
  but N sequential Claude calls with adaptive thinking do not fit the 60 s
  timeout, and raising it would mean one failure ends the round for everyone.
  Rejected.
- **Free-form talent↔talent (members keep replying to each other).** This is
  the unbounded loop that §7 rightly excluded. It stays out of scope.

## Consequences

- **Cost per group message rises from 1 to N calls** (N = members, or the
  @-addressed subset). The cost is still driven by operator activity, not by
  agent count. The per-thread, per-member daily budget
  (`WF_MSG_REPLY_BUDGET`, 50) is unchanged and still the backstop. At
  single-operator scale with groups of ≤ 5, this stays well within the W-3
  envelope. The operator can narrow a round with @-mentions.
- **A group round takes longer to finish** (members speak one after another).
  The console keeps polling while the round is running: each member's reply
  resets the waiting window, and polling stops once every member has spoken
  since the operator's message.
- **New IAM.** `wf-messaging-reply` may `lambda:InvokeFunction` itself only
  (`MessagingReplyRoundHandoff`).
- **Failure semantics (W-4).** A member's failed reply still throws (logged,
  `WfMsgReplyThrow`), but the next member is invoked first, so one failure
  does not silence the rest. A failed handoff throws
  (`WfMsgRoundHandoffFailed`), and the Lambda's async retry tries the
  handoff again. The `already_replied` guard prevents a second reply.
- **Event shape.** `{thread_id, addressed_slug, then?, trigger_message_id?}`.
  An event without `trigger_message_id` (in flight at deploy) behaves as
  before.

## Related

- [adr-0006](adr-0006-realtime-messaging-reply.md) — the real-time reply
  surface; this ADR changes only its group clause.
- [epic-013](../epics/epic-013-talent-messaging.md) §6–§7, [epic-024](../epics/epic-024-messaging-group-chat-and-latest-first-history.md) — the group policy this replaces.
- Implementation: `workforce/lambdas/shared/messaging.ts` (`pickRepliers`),
  `workforce/lambdas/agents-api/handler.ts` (`dispatchReply`),
  `workforce/lambdas/messaging-reply/handler.ts` (round handoff + guards),
  `workforce/app/src/pages/Messaging.tsx` (`isGroupRoundComplete` polling),
  `workforce/infra/sam/template.yaml` (`MessagingReplyRoundHandoff`).
