# ADR-0048 — Rooms: purpose-first deliberation — a `ROOM#` row family, a `/rooms` route set, and a bounded self-invoke debate Lambda (`wf-room-debate`)

- **Status**: Proposed (operator ratifies by merging)
- **Date**: 2026-10-24
- **Deciders**: operator (directed the feature in-session, 2026-10-24: 「Roomという概念のアプリを作って。特定の議題や論点などについて、エージェントをworkforceからサモンし皆でディベートして結論を導くアプリ。チャットと似てるが違う。チャットは人やエージェントが先にあって会話がくっつく。Roomは目的が先にあって人やエージェントが中に入る。」); drafted by the operator's Claude Code session with the workforce personas `nadia` (Product Manager — author) and `dario` (VP Engineering Excellence — consulted on Decisions 2 and 3)
- **Epics**: none — operator direction 2026-10-24 (in-session). Builds on [epic-013](../epics/epic-013-talent-messaging.md) / [epic-024](../epics/epic-024-messaging-group-chat-and-latest-first-history.md) for the reply mechanics only.

## Context

The console has two conversational surfaces today, and both are
**participant-first**:

- **Talent messaging** (`/messaging`, [adr-0006](adr-0006-realtime-messaging-reply.md),
  [adr-0047](adr-0047-group-thread-reply-rounds.md)). A thread is the
  operator's inbox object: the people exist first (`participants[]`, a
  `PART#{slug}` inbox row each), and a conversation attaches to them. It
  has no end state — a thread stays open as long as anyone writes — and no
  artefact other than the transcript. In a group, one operator message
  starts one reply round (every member once, in turn); depth stays
  operator-paced.
- **Q&A boards** (`/boards/{id}`, [adr-0034](adr-0034-public-qa-boards.md)).
  A password-gated guest stream; agents answer `@`-mentions, with one
  hop of delegation. Also open-ended, also artefact-free, and public by
  design.

The operator's direction (2026-10-24, quoted above) asks for a different
object: **the purpose exists first, and people enter it.** A Room is opened
*for a question* (議題 / 論点); the operator summons agents from the roster
into it; they debate; the Room ends with a conclusion. Three properties
follow and none of them is a thread property:

1. **Purpose before people.** The question is the Room's identity and its
   hero. Participants are chosen *for* the question, and the set is fixed
   when the Room starts.
2. **A lifecycle.** `debating → concluded`. A Room ends by construction;
   a thread never does.
3. **A conclusion artefact.** One designated member, the **chair**, writes
   a structured conclusion (agreement, disagreement with names, recommended
   action, open questions). The conclusion is the deliverable; the debate is
   its provenance.

ADR-0047 already solved the hard part for threads — several members
speaking *in turn*, each reading the earlier replies, bounded by a schedule
that only shrinks — and declared the mechanism (a self-invoking reply
Lambda) as a narrow, operator-caused chain. Rooms need the same mechanism
with a longer, but still fixed, schedule: several rounds and a closing
turn. Four decisions had to be made against today's tree.

## Decision

### 1. A new `ROOM#` row family and a `/rooms` route set on the agents HTTP API — not a "room mode" on THREAD rows

> **Amendment (2026-10-24, after the first deploy).** The six `/rooms`
> routes stay on the one agents HTTP API (`WfAgentsHttpApi`, one base URL,
> one OpenAPI spec) but are **served by their own function,
> `wf-rooms-api`** (`workforce/lambdas/rooms-api/`), not by
> `wf-agents-api`. The first deploy of #847 rolled back: SAM emits one
> resource-based-policy statement per HttpApi route on a function, and the
> six routes took `wf-agents-api`'s policy to 20639 bytes against Lambda's
> 20480-byte cap (run 40126740456). The route module (`rooms-api/routes.ts`)
> is unchanged; the split is a deployment fact, and the rule it leaves
> behind — a new route family gets its own function, and
> `workforce/scripts/check-route-permission-budget.mjs` counts routes per
> function — is recorded in `docs/memory-lint-backlog.md` ML-042.

Rooms are `ROOM#{room_id}/META` + `ROOM#{room_id}/TURN#{ulid}` in the single
table (R-N2), with long turn bodies dual-stored under `rooms/{room_id}/{ulid}.md`
in the bucket exactly as messages (`messages/*`) and board posts
(`boards/*`) are. `workforce/lambdas/shared/room.ts` exports the helpers
(`appendTurn`, `buildSchedule`, the caps). The full row shapes are in
[data-model.md §Room rows](../data-model.md).

THREAD rows were not reused. A thread encodes an inbox: a `PART#{slug}` row
per participant with `unread`, a GSI4 `INBOX#{slug}` projection, `starred`,
and no terminal state. A Room needs a `question`, a `chair`, a fixed
`rounds` count, a `status` lifecycle, a `run_id` for supersession and a
pointer to its conclusion — and needs none of the inbox machinery. A
"room mode" flag would have put a second lifecycle inside a row family
whose every consumer (inbox list, unread counter, reply Lambda) assumes
there is none. Same reasoning as adr-0034 §1 for boards: a different
object, not a variant.

Routes (`agents-api/rooms.ts`, exporting `handleRoomsRoute(routeKey, event,
deps)` — the `boards.ts` pattern — wired from `handler.ts`, where the route
literals must appear for `check-openapi-routes.mjs`, and documented in
`openapi.ts`):

| Route | Auth | Purpose |
|---|---|---|
| `GET /rooms` | none at the gateway (CORS gate, like `/threads`) | newest-first list, `?page_size=` (≤100, default 25) `?cursor=` |
| `GET /rooms/{id}` | none at the gateway (CORS gate) | the room + every turn, chronological; `?after=<turn_id>` poll tail |
| `POST /rooms` | AWS_IAM | create: META (run 1), the `opening` turn, dispatch the first scheduled turn |
| `POST /rooms/{id}/turns` | AWS_IAM | operator steer; on a concluded room, reopen (Decision 4) |
| `POST /rooms/{id}/conclude` | AWS_IAM | re-dispatch only the chair's conclusion under a new `run_id` |
| `PATCH /rooms/{id}` | AWS_IAM | `{archived?, title?}` |

A Room is created only by the operator (`created_by: "operator"`). A
dispatch failure after a successful write never fails the request: the
route logs `room_dispatch_failed`, sets `last_error` on META and emits
`WfRoomDispatchFailed`; the console shows the banner (W-4: visible, never
silent).

### 2. A dedicated async Lambda `wf-room-debate`, one turn per invocation, handed on by self-invoke — the Room twin of the ADR-0047 round

`wf-room-debate-{stage}` (`workforce/lambdas/room-debate/`) is the Room twin
of `wf-messaging-reply`: same execution surface (the adr-0006 carve-out for
event-caused, operator-initiated agent replies), same LLM path
(`shared/llm-anthropic.ts complete()` with the persona's `model` +
`system_prompt` from `AGENT#{slug}/META`, [adr-0007](adr-0007-agent-config-single-source.md)),
same W-1 guards (`complete()` throws on `max_tokens`; an LLM-artefact head
regex over the first 50 characters throws; an empty body throws), same
fail-soft memory excerpt (latest summary, ≤1200 characters). No EXEC
recall and no knowledge pack: a Room's grounding is its question, its
context and its own transcript.

**The schedule is fixed when the run starts.** `buildSchedule(participants,
rounds, chair, startRound)` (pure, exported, unit-tested in
`shared/room.ts`) returns, for each round, every participant in order as a
`statement`, then one `conclusion` turn for the chair. The API invokes the
Lambda for the first slot with the rest of the schedule in `then`. One
invocation is one speaker's turn and one Claude call. After its turn — or a
skip, or a failure — the Lambda async-invokes **itself**
(`InvocationType: "Event"`) with the next slot and a `then` one element
shorter. This is exactly the hand-off adr-0047 §2–§3 declared for group
threads (`MessagingReplyRoundHandoff`), with the same three properties:

- **Bounded by construction.** `then` only shrinks and nothing appends to
  it. A run is at most `participants × rounds + 1` Claude calls; with the
  caps (2–6 participants, 1–3 rounds) the worst case is **6 × 3 + 1 = 19**.
- **Operator-caused only.** Only an operator route (`POST /rooms`, a steer
  that reopens, `POST /rooms/{id}/conclude`) starts a run. An agent turn
  never starts a run, never extends one, and never calls the HTTP API — it
  writes through `shared/room.ts`, so the chain cannot re-enter itself
  through the front door.
- **One live run per room.** Every run carries a `run_id` (ULID) that is
  also written to META. An invocation whose `run_id` differs from META's
  skips with `superseded` **and stops the chain** (no hand-off). A
  duplicate invoke of a slot that already has a turn for this
  `run_id` + `round` + `kind` skips with `already_spoke` and, like `superseded`, stops the chain — the
  delivery that wrote the turn already passed the baton, so passing it again
  would fork the run.
- **Atomic slot claim.** A transcript read followed by a write is
  check-then-act across a 10–90 s Claude call, and Lambda async delivery is
  at-least-once, so two overlapping copies of one event could both speak
  and both pass the baton. Before the call the Lambda therefore writes
  `ROOM#{id}/CLAIM#{run_id}#{round}#{kind}#{speaker}` with
  `attribute_not_exists(sk)`; the copy that loses the condition skips as
  `already_spoke` and stops its chain. The deterministic key is what makes
  the bound exact rather than probable (cycle-1 review of the code PR).
- **No automatic retries.** The function sets `EventInvokeConfig:
  MaximumRetryAttempts: 0` (as `WfLessonDistillerFunction` does). Lambda's
  default two async retries would re-run the hand-off of every failed slot
  and fork the chain — up to three invocations per slot, compounding down
  the schedule — which is exactly the unbounded shape this decision exists
  to exclude. With retries off the bound is exact; a failed slot is skipped
  by the next speaker and a failed hand-off is the stalled room the
  operator recovers with **Conclude now** (Decision 4). An archived room
  stops the chain the way a superseded one does.

**What this does and does not do to R-N1.** R-N1
([workforce/docs/governance.md §4](../governance.md)) lists "per-Lambda nested
invocations" among the surfaces that need a Zone A amendment. adr-0047
declared one such chain — `wf-messaging-reply` invoking itself only, inside
an operator-caused, fixed-length round — but left R-N1's text as it was. This
ADR declares its **twin and nothing wider**, and the same PR adds sub-bullet
**(d)** to R-N1 naming both chains and the three properties they share
(self-only, operator-caused, bounded at start — kept here by retries off plus the `CLAIM#` slot row, and in `wf-messaging-reply` by its default retries plus the `already_replied` guard, as ADR-0047 decided): `wf-room-debate` may `lambda:InvokeFunction` itself only
(IAM Sid `RoomDebateTurnHandoff`, resource
`arn:…:function:wf-room-debate-${Stage}`), only to continue a schedule fixed
at start, only within one `run_id`. No Lambda gains the right to invoke a
*different* function, no chain may be agent-caused, and no schedule may
grow after it starts. Any chain that lacks one of those three properties
needs its own ADR.

`speakOnce` guards, in order, each a `{status: "skipped", reason}` with
`WfRoomTurnSkipped{Reason}` unless it throws: META missing → throw;
`archived` → skip (chain stops); `run_id` ≠ META → skip `superseded` (chain stops);
`already_spoke` → skip (chain stops); speaker ∉ participants → throw; the per-room daily
turn budget (`WF_ROOM_TURN_BUDGET`, default 60 agent turns per room per UTC
day) reached → `WfRoomBudgetExceeded` + throw; a `conclusion` from anyone
but the chair → throw.

### 3. Listing is a GSI3 `ROOMS` partition — the FEED precedent

Each `ROOM#{room_id}/META` row carries `gsi3pk = "ROOMS"` and
`gsi3sk = created_at`. `GET /rooms` is
`queryByGsiPaged("GSI3", "ROOMS", {scanIndexForward: false, limit, cursor})`
— the `shared/post.ts listFeed` shape — and never `scanPrefix`
(`check-scan-drain`). GSI3 already exists with `ProjectionType: ALL`, so
this is a new partition value on an existing index: no table change, no
index build, no migration.

A single partition is right at this volume for the reason data-model.md
§GSI3 already gives for `FEED`: the write rate is operator-paced (a few
rooms a day at single-operator scale, C-3), against a per-partition ceiling
of 1000 WCU/s. Only META rows project; TURN rows carry no `gsi3pk`, so the
per-room transcript stays a `begins_with(sk, "TURN#")` partition query on
`ROOM#{room_id}`.

### 4. The chair writes the conclusion with a fixed section contract; steer and reopen are one route with two meanings

**Statements.** Each agent's statement opens with exactly one line
`POSITION: <one sentence>`, parsed (`^POSITION:\s*(.+)$`, capped at 140
characters), stripped from the body and stored as `position` — the room's
one-glance stance map. A missing line is tolerated (fail-soft: `position`
is absent; the turn still lands). The debate contract asks for two to four
short paragraphs, a clear position from the member's own role and record,
engagement with prior speakers by name, no restatement, no headers or
lists, and the language of the question. `__NO_REPLY_NEEDED__` is not
available in a Room: every summoned member speaks.

**Conclusion.** The chair writes it, neutral and specific, in the
question's language, with exactly these sections:
`## 結論` / `## Conclusion`; `## 合意点` / `## Where we agree`;
`## 対立点` / `## Where we differ` (naming who holds what);
`## 推奨アクション` / `## Recommended action`;
`## 未解決の論点` / `## Open questions`. Bullets are allowed here; no
`POSITION:` line; about 900 words at most. Writing it sets META
`status: "concluded"`, `conclusion_turn_id` and `conclusion_preview`
(≤320 characters). Token budgets: statement `maxTokens 1600`, conclusion
`2400`, `reasoningBudgetTokens 2048` (above the 1024 floor).

**Steer vs reopen** (`POST /rooms/{id}/turns`, ≤6000 characters):

- On a **debating** room the operator's text is stored as a `steer` turn
  (`round: 0`, `from: "operator"`) and nothing is dispatched. The speakers
  still to come read it in the transcript as a direction to follow. The
  schedule does not change.
- On a **concluded** room the steer is stored and the room **reopens**: a
  new `run_id`, `run_count + 1`, `status` back to `debating`, and a fresh
  schedule of exactly one more round (every participant once) plus a new
  conclusion, starting at the round after **every** earlier agent turn —
  statements and conclusions alike — so round numbers never collide across
  runs and a turn is always placed by (`run_id`, `round`). META records the
  run's `run_start_round` and `run_rounds` so the console's progress band
  reads the run, not the room's creation settings. A reopen is therefore at
  most `participants + 1` calls (≤ 7).

**Conclude now** (`POST /rooms/{id}/conclude`) dispatches only the chair's
conclusion under a new `run_id`, which supersedes any chain still in
flight. It is the recovery for a failed conclusion or a stalled hand-off,
and the way to cut a debate short. On a concluded room it writes a fresh
conclusion (an explicit operator act). `409 room_archived` on an archived
room, as for steer.

### 5. Operator-only surface: Cognito + SigV4 writes, no public write path, no redaction pack

Rooms live inside the console's `ProtectedRoutes` (`/rooms`, `/rooms/:id`)
behind the operator's Cognito login, and every write route is `AWS_IAM` at
the gateway (SigV4 from the SPA through `lib/sigv4.ts signedFetch`). There
is no guest, no password gate, no token minting and no write path that is
unauthenticated at the gateway — the adr-0034 apparatus is not needed
because no one but the operator can put text into a Room. For the same
reason there is no redaction layer: a Room's material is the operator's own
question and the agents' operator-facing voices, the same trust domain as a
thread.

The read routes follow the `/threads` and `/feed` posture: no gateway
authorizer, behind the API's CORS allowlist (`workforce.kohuehara.xyz`).
That is a browser gate, not authentication; a client that knows the API
base can read room questions, transcripts and conclusions, exactly as it
can read threads today. The accepted blast radius is the one already
accepted for threads (agents-api `handler.ts` header, PR #132).

## Alternatives considered

- **Free-form agent↔agent debate** (members keep answering each other until
  someone decides it is over). This is the unbounded loop epic-013 §7 and
  adr-0047 kept out, now with a stronger pull toward it because a debate
  invites rebuttal. There is no structural end and no cost bound but the
  daily budget. Rejected: a Room ends by construction, not by persuasion.
- **One invocation loops over the whole schedule.** No self-invoke and no
  new IAM. Rejected for adr-0047's reasons, which are stronger here: 19
  sequential Claude calls with adaptive thinking do not fit any sensible
  Lambda timeout, and one failure would end the debate for every later
  speaker and lose the conclusion.
- **A CCR routine per room** (the [adr-0005](adr-0005-single-execution-model-ccr.md)
  substrate, with real repository access). Rejected on latency and cost per
  session — the same reasons adr-0006 and adr-0034 rejected it for replies:
  minutes to start, a full session per room, and the operator watches a
  Room unfold in the console in real time. A routine-run room for questions
  that need the code is a later step with its own ADR.
- **A thread with a "room" flag.** Rejected (Decision 1): a second
  lifecycle, a chair, a conclusion pointer and a supersession key inside a
  row family built as an inbox, with every consumer needing to learn that
  some threads end.
- **A board** (adr-0034). Rejected: boards are a public, guest-written,
  mention-driven stream with a redaction pack; a Room is operator-only and
  schedule-driven. Reusing it would bring a public write path and
  confidentiality machinery to a surface that needs neither.
- **Parallel fan-out per round** (all members of round N at once).
  Rejected for adr-0047's reason: nobody would read a colleague's statement
  before writing their own, and a debate in which no one engages anyone is
  N parallel essays.

## Consequences

- **Cost (W-3).** A run is at most `participants × rounds + 1` Claude calls
  (default 5 × 2 + 1 = 11; cap 19); a reopen at most `participants + 1`
  (≤ 7); conclude-now exactly 1. Cost is operator-caused — no Room exists or
  runs without an operator action — and the per-room daily budget
  (`WF_ROOM_TURN_BUDGET`, 60 agent turns per UTC day) is the backstop. Like
  messaging and board replies, Room turns are not charged to the
  `BUDGET#{month}` ledger (which meters orchestrator fires, not event-caused
  calls), so no per-agent figure sees them; they sit under the aggregate W-3
  ceiling and the billing alarm
  ([workforce/docs/governance.md §2](../governance.md)). Token counts land on
  every agent `TURN#` row (`tokens_in` / `tokens_out`), so the spend is
  reconstructible. At single-operator
  scale this is well inside the envelope; raising
  `WF_ROOM_TURN_BUDGET` needs a stated reason, like `WF_MSG_REPLY_BUDGET`.
- **New IAM and function config.** `wf-room-debate` may invoke itself only
  (`RoomDebateTurnHandoff`) and runs with async retries disabled
  (`MaximumRetryAttempts: 0`); DDB Get/Query/Put/Update on the base
  table only (it queries no GSI — the `ROOMS` listing is `wf-rooms-api`'s); S3 Get/Put on `rooms/*`; S3 Get on `memory/*`; the Anthropic key
  under both secret names; `cloudwatch:PutMetricData` on `Workforce/Rooms`.
  `wf-rooms-api` (the route function, see Decision 1's amendment) holds
  `lambda:InvokeFunction` on `WfRoomDebateFunction`, DDB Get/Query/Put/Update
  on the table and its indexes (the GSI3 `ROOMS` listing), S3 Get/Put on
  `rooms/*`, metrics on `Workforce/Rooms`, and the env var
  `ROOM_DEBATE_FUNCTION`; `wf-agents-api` gains nothing. No new secret
  (R-N3), no new AWS service, no schedule (R-N4: a Room is event-caused,
  never a binding).
- **Failure semantics (W-4).** A failed turn throws (logged,
  `WfRoomTurnThrow{Reason}`, best-effort `last_error` on META, the
  `wf-room-debate-errors-alarm-{stage}` alarm), but the next speaker is
  invoked first, so one failure does not silence the room. A failed
  hand-off throws (`WfRoomHandoffFailed`) and leaves the room without a
  next turn; the console shows it as stalled. A failed conclusion leaves
  `last_error` and a `debating` room; the operator re-dispatches with
  **Conclude now**, which supersedes the old run. Nothing is written
  degraded: a truncated, artefact-headed or empty body never lands.
- **Observability.** CloudWatch namespace `Workforce/Rooms` (R-N5):
  `WfRoomTurn{Slug}`, `WfRoomTurnSkipped{Reason}`, `WfRoomTurnThrow{Reason}`,
  `WfRoomHandoffFailed`, `WfRoomConcluded`, `WfRoomBudgetExceeded`,
  `WfRoomPersonaMissing`, and `WfRoomDispatchFailed` from agents-api; one
  errors alarm on the function, like the other reply Lambdas.
- **Data model.** Two new rows (`ROOM#{room_id}/META`, `/TURN#{ulid}`), one
  new GSI3 partition value (`ROOMS`), one new S3 prefix (`rooms/`). Rooms
  are workforce state (DDB + S3, R-N2), never editorial artefacts: nothing
  reaches Notion (W-2), and a conclusion is not an article (W-1 still
  applies to its body as a guard, not as a byline rule).
- **Persona stability (W-5) is untouched.** A Room reads each persona's
  META row and writes nothing to it — not memory, not bindings, not the
  feed.
- **Zone classification of every new path.** Zone B (code PR, merge-eligible
  under [docs/governance.md §4.4](../../../docs/governance.md)):
  `workforce/lambdas/room-debate/**`, `workforce/lambdas/shared/room.ts` (+
  tests), `workforce/lambdas/agents-api/rooms.ts` and its `handler.ts` /
  `openapi.ts` wiring, `workforce/infra/sam/template.yaml` (one new
  function, alarm and routes; no cost-envelope or schedule change),
  `workforce/app/src/lib/rooms.ts`, `pages/Rooms.tsx`, `pages/Room.tsx`, the
  nav entry, `workforce/docs/runbooks/rooms.md`,
  `workforce/docs/design/rooms-v1.md`, `workforce/lambdas/README.md`.
  Zone A (this separate PR, operator merges): this ADR, its row in
  [README.md](README.md), the `#### Room rows` section and GSI3 note in
  `workforce/docs/data-model.md`, and R-N1 sub-bullet (d) in
  `workforce/docs/governance.md`.
- **Follow-ups declared here, not shipped.** (1) A `workforce:*` lint that
  asserts, for every function in `template.yaml` holding
  `lambda:InvokeFunction` on its own ARN, either `MaximumRetryAttempts: 0`
  or a comment naming the guard that bounds a retry (`wf:owen` O1 on the
  ADR review — today the property is checked by reading the template).
  (2) A TTL on `CLAIM#` rows: they are inert once the turn lands and
  accumulate one row per agent turn; at operator-paced volume (C-3) that is
  a few hundred rows a month, so v1 ships without a TTL and a later change
  adds `ttl` (`wf:mateo` M1 on the ADR review).
- **What would need a later ADR.** Agent-initiated rooms (an agent or a
  cadence opening a Room — that makes the chain agent-caused and puts it
  under R-N4); human guests in a Room (a public or second-identity write
  path — adr-0034's territory and C-3); writing conclusions into agent
  memory, the feed or Notion (W-5 / W-2 boundaries); votes or polls as a
  conclusion mechanism; more than one chair; a schedule that can grow
  mid-run. Each changes one of the properties Decision 2 rests on.

## Related

- [adr-0006](adr-0006-realtime-messaging-reply.md) — the event-caused reply
  surface this extends; same LLM path, guards and "write through the shared
  module" loop-safety rule.
- [adr-0047](adr-0047-group-thread-reply-rounds.md) — the self-invoke
  round hand-off; this ADR declares its Room twin and nothing wider.
- [adr-0034](adr-0034-public-qa-boards.md) — the precedent for a new row
  family + route module + reply Lambda, and the public surface Rooms
  deliberately are not.
- [adr-0007](adr-0007-agent-config-single-source.md) — persona from the
  `AGENT#{slug}/META` row.
- [adr-0002](adr-0002-no-dedicated-vector-store.md) — why a Room's
  grounding is its transcript and memory summary, not an index.
- [adr-0005](adr-0005-single-execution-model-ccr.md) — the scheduled
  execution model Rooms do not use.
- `workforce/docs/runbooks/rooms.md` — create, steer, reopen, conclude,
  archive; failure modes and metrics.
- `workforce/docs/design/rooms-v1.md` — the purpose-first thesis and what v1
  leaves out.
- Implementation: `workforce/lambdas/shared/room.ts` (`buildSchedule`,
  `appendTurn`, caps), `workforce/lambdas/agents-api/rooms.ts`,
  `workforce/lambdas/room-debate/handler.ts` (`speakOnce`, `passTurn`),
  `workforce/app/src/pages/Rooms.tsx`, `workforce/app/src/pages/Room.tsx`,
  `workforce/infra/sam/template.yaml` (`WfRoomDebateFunction`,
  `RoomDebateTurnHandoff`, `WfRoomDebateErrorsAlarm`).
