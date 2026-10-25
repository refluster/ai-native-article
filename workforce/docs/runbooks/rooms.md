# Runbook — Rooms (ADR-0048)

A Room is a page at `https://workforce.kohuehara.xyz/rooms/{room_id}` that
exists **for one question** (議題 / 論点). The operator writes the question,
summons agents from the roster, and they debate it in a fixed number of
rounds; the chair then writes the conclusion. Design:
[ADR-0048](../adr/adr-0048-rooms-purpose-first-deliberation.md) (Proposed)
and [design/rooms-v1.md](../design/rooms-v1.md).

Rooms are operator-only: they sit inside the console's sign-in (Cognito),
and every write is SigV4-signed (`AWS_IAM` at the gateway).

## Room or thread?

| Open a… | When |
|---|---|
| **Thread** (`/messaging`) | You want to talk *with* someone — ask Nadia how a launch went, brief a group, keep a running conversation. People come first; the conversation never has to end. |
| **Room** (`/rooms`) | You have a *question* that needs several roles to argue it out and you want a written answer at the end — "should we drop the 2-hour tick for pr-autopilot?", 「この記事シリーズを英語先行にすべきか」. The question comes first; the Room ends with a conclusion. |

Rule of thumb: if you would be disappointed to finish without a decision
memo, open a Room.

## Create a room

`/rooms` → **New room**. The panel asks for:

| Field | Limits | Notes |
|---|---|---|
| Title | ≤ 120 chars | The card name in the list. Editable later. |
| Question | ≤ 2000 chars | The 議題 / 論点 itself — the Room's hero. Write it as a question someone could disagree with. Its language (Japanese if it contains any kana/kanji, else English) sets the language of every statement and of the conclusion. |
| Context | ≤ 4000 chars, optional | Background the members need: constraints, numbers, what was already tried. Every member reads it on every turn. |
| Participants | 2–6 agents | Picked from the live roster (search box, chips, role shown). Choose for *disagreement*: roles that will see the question differently. Archived agents cannot be summoned. |
| Chair | one of the participants | Writes the conclusion. Defaults to the first participant. Pick someone whose role is to weigh, not to advocate. |
| Rounds | 1, 2 or 3 (default 2) | Round 1 = opening positions; later rounds respond, refine, concede or hold. |

⌘/Ctrl+Enter submits. The API stores the Room, writes your question as the
`opening` turn, and dispatches the first speaker. The first statement
usually lands within 10–40 s.

The schedule is fixed at this moment: every participant speaks once per
round, in the order you picked them, then the chair concludes. Nothing an
agent says can add a turn.

On the mock origin (no live API configured) the page shows an empty state
instead of the composer; rooms need the live API.

## Read the room

- **Header** — the question (large), the context under it, and the members:
  Sigil, name, role, a chair badge.
- **Progress band** — `Round 2 of 3 · 3/5 have spoken` and who is drafting
  now (the next pending speaker). The page polls every 4 s while the room is
  debating and the tab is visible, and stops once it is concluded.
- **Turns**, grouped under round dividers (`Round 1`, `Operator`,
  `Conclusion`). Each agent statement shows its **`POSITION:` line**
  emphasised — the speaker's one-sentence stance — and then two to four
  short paragraphs. Read the position lines top to bottom for the shape of
  the debate; read the bodies for the reasons. A statement without a
  position line is not an error (the model omitted it; the turn still
  counts).
- **Conclusion** — a separate card in the question's language with five
  sections: `結論 / Conclusion`, `合意点 / Where we agree`, `対立点 / Where
  we differ` (who holds what), `推奨アクション / Recommended action`,
  `未解決の論点 / Open questions`.

## Steer, reopen, conclude now, archive

All four are on the Room page. They map to two API routes.

| You want to… | Do | What happens |
|---|---|---|
| Redirect a debate that is still running | **Steer the room** (composer, while debating) | Your text is stored as an operator `steer` turn. Nothing is re-dispatched and the schedule does not change: every speaker still to come reads your steer in the transcript and treats it as a direction to follow. Speakers who already spoke this round do not speak again. Once every statement of the run has landed, only the chair is left and it has already read the transcript: the composer is disabled ("The chair is writing the conclusion — reopen with a follow-up once it lands") and the API answers `409 room_concluding` without storing anything. |
| Ask a follow-up after the conclusion | **Reopen with a follow-up** (composer, once concluded) | Your text is stored, and the Room reopens: a new run with **one** more round (every participant once) and a fresh conclusion by the same chair. Status goes back to Deliberating; the old conclusion stays in the transcript. |
| Stop the debate and get a conclusion now, or retry a failed conclusion | **Conclude now** | Dispatches only the chair's conclusion under a new run id. Any speaker still queued in the old run is dropped (`superseded`). A statement that was already being drafted when you clicked may still land just after the conclusion. On an already-concluded room this writes a fresh conclusion. |
| Put the Room away | **Archive** | The Room is marked archived; steer and conclude answer `409 room_archived`; any turn still queued skips (`archived`) without calling Claude, the run stops, and a still-debating Room records that on its banner. Un-archive with the same button (or `PATCH {"archived": false}`, below). |

Steer and reopen are the same button and the same route
(`POST /rooms/{id}/turns`); the Room's status decides which one you get.

## How a run is bounded

Every run is a list fixed when it starts. One entry is one Claude call.

| Run | Calls |
|---|---|
| Create | participants × rounds + 1 (the conclusion) |
| Reopen (steer on a concluded room) | participants + 1 |
| Conclude now | 1 |

Worked example: 5 participants, 2 rounds → 5 × 2 + 1 = **11** calls. The
largest possible room (6 participants, 3 rounds) is 6 × 3 + 1 = **19**.
Each call is one speaker's turn on `wf-room-debate`, which then invokes
itself for the next entry; the list only gets shorter (ADR-0048 §2, the
same mechanism as the group-thread round in ADR-0047).

The backstop is a per-room daily budget: **60 agent turns per room per UTC
day** (`WF_ROOM_TURN_BUDGET` on the function). A room reopened several times
in one day can reach it; a single run cannot.

## When something goes wrong

The Room page shows the last failure as a **`last_error` banner** (W-4:
visible, never silent). Start there, then CloudWatch → `wf-room-debate-prod`
logs.

| Symptom | Cause | What to do |
|---|---|---|
| Banner right after creating, nobody speaks | The Room was stored but the first dispatch failed (`room_dispatch_failed`, `WfRoomDispatchFailed`). | **Conclude now** gets you a conclusion from the question alone; or create the Room again. If it repeats, check the `wf-rooms-api-{stage}` logs and its `lambda:InvokeFunction` permission on `wf-room-debate-{stage}`. |
| One member's turn is missing, the rest carried on | That turn threw (`WfRoomTurnThrow{Reason}`); the baton was passed first, so the room continued. Usual reasons: `stop_reason=max_tokens` (W-1 truncation — nothing was written), an LLM-artefact head, an empty body, or `AGENT#{slug}/META lacks model/system_prompt` (`WfRoomPersonaMissing` — fix the row through agents-api, ADR-0007). | Nothing, if the debate still reads well. Otherwise steer after it concludes (reopen) so the member gets another turn. |
| Banner names the budget (`WfRoomBudgetExceeded`) | The room has had 60 agent turns today. Every later turn in the run throws without calling Claude. | Wait for the next UTC day and reopen or Conclude now, or open a fresh Room. Raise `WF_ROOM_TURN_BUDGET` on the function only with a stated reason (same posture as `WF_MSG_REPLY_BUDGET`). |
| Progress band stuck on one speaker; after ~3 min the page says **stalled — Conclude now** | The hand-off to the next turn failed (`WfRoomHandoffFailed`) or a turn died before passing it on. No further turn is queued. | **Conclude now** re-dispatches only the conclusion. If you wanted the remaining statements, let it conclude and then reopen with a steer — that runs one more full round. |
| Debating, every turn present, but no conclusion; banner names the chair | The conclusion turn threw (truncation, artefact, empty body). | **Conclude now** — it writes a fresh conclusion under a new run id. |
| A queued speaker never speaks after you pressed Conclude now or reopened | By design: the old run is `superseded` (`WfRoomTurnSkipped{Reason=superseded}`) and its chain stopped. | Nothing. |
| A turn skipped with `already_spoke` | AWS delivered the same turn twice (async retries are off, so it is never a retry). Before its Claude call each copy claims the turn's slot with a conditional put (`CLAIM#…` row); the copy that loses — or that finds the turn already in the transcript — stops there, so the run does not fork, even when both copies run at once. | Nothing — it is the guard working. |
| Concluded, banner "a steer arrived while the chair was writing the conclusion…" (`WfRoomSteerDuringConclusion`) | A steer raced the last statement and was stored after the chair read its transcript, so the conclusion does not answer it. | **Reopen with a follow-up** — paste the steer; one more round and a fresh conclusion address it. |
| Banner "Can't reach the room" under the progress band | Three polls in a row failed (the message is the fetch error). A stall shown next to it may be a read fault, not a stopped schedule. | Reload; check the `wf-rooms-api-{stage}` logs before spending a **Conclude now**. |
| An unarchived Room shows **Deliberating** and a banner "run stopped: the room was archived mid-run" | It was archived while its run was still going; the next queued turn skipped (`archived`) and the chain stopped. | **Conclude now**, or let it be — it stays as it was. |

Metrics, namespace **`Workforce/Rooms`**:

| Metric | Meaning |
|---|---|
| `WfRoomTurn{Slug}` | a turn landed, per speaker |
| `WfRoomTurnSkipped{Reason}` | `archived`, `superseded`, `already_spoke` |
| `WfRoomTurnThrow{Reason}` | a turn failed (the room continued) |
| `WfRoomHandoffFailed` | the self-invoke to the next turn failed (the room stalls) |
| `WfRoomConcluded` | a conclusion landed |
| `WfRoomSteerDuringConclusion` | a steer landed after the chair read its transcript (the banner says to reopen) |
| `WfRoomBudgetExceeded` | the per-room daily turn budget was hit |
| `WfRoomPersonaMissing` | a member's META row lacks `model` / `system_prompt` |
| `WfRoomDispatchFailed` | `wf-rooms-api` stored a write but could not dispatch the Lambda |

Alarm: **`wf-room-debate-errors-alarm-{stage}`** — any `Errors` on
`wf-room-debate-{stage}` over 5 minutes, published to the same alarm topic
as the other reply Lambdas.

The six `/rooms` routes are served by their own function,
**`wf-rooms-api-{stage}`** (`workforce/lambdas/rooms-api/`), behind the same
HTTP API and base URL as agents-api — not by `wf-agents-api`, which hit
Lambda's 20 KB resource-policy cap when these routes were added (deploy run
40126740456 rolled the stack back). Request handling, the IAM re-check and
the dispatch to `wf-room-debate` (hence `WfRoomDispatchFailed`) all happen
there; look in its logs for `room_dispatch_failed` and
`rooms_api_unhandled`. Its alarm is **`wf-rooms-api-errors-alarm-{stage}`** —
any `Errors` on `wf-rooms-api-{stage}` over 5 minutes, same alarm topic.

## Where the data lives

- DynamoDB `wf-table-{stage}`: `ROOM#{room_id}` / `META` (question, members,
  chair, rounds, status, `run_id`, `run_count`, `last_error`, …) and
  `ROOM#{room_id}` / `TURN#{ulid}` (one per opening, statement, steer,
  conclusion), plus one `ROOM#{room_id}` /
  `CLAIM#{run_id}#{round}#{kind}#{speaker}` per agent turn (the
  duplicate-delivery claim). The list is the GSI3 `ROOMS` partition, newest first. Full
  shapes: [data-model.md §Room rows](../data-model.md).
- S3: `rooms/{room_id}/{ulid}.md` for turn bodies over 320 characters.
- Nothing goes to Notion, the feed, or agent memory (W-2, W-5).

## API, for curl users

Base: the agents-api base (`$AGENTS_API_BASE`, e.g.
`https://workforce-api.kohuehara.xyz`). Reads carry no gateway authorizer —
they sit behind the CORS allowlist like `/threads`, which keeps browsers on
other origins out but is not authentication. Writes are `AWS_IAM`: sign with
SigV4 from an `aws-vault` / SSO shell.

| Route | Auth | Body / query | Response |
|---|---|---|---|
| `GET /rooms` | none (CORS gate) | `?page_size=` (≤ 100, default 25), `?cursor=` | `200 {rooms, cursor?}`, newest first |
| `GET /rooms/{id}` | none (CORS gate) | `?after=<turn_id>` → only newer turns | `200 {room, turns}`, turns chronological; `room` is always returned |
| `POST /rooms` | AWS_IAM | `{title, question, context?, participants[], chair?, rounds?}` | `201 {room_id}`; `400 invalid_*` on validation |
| `POST /rooms/{id}/turns` | AWS_IAM | `{body}` (≤ 6000 chars) | `201 {turn_id, reopened}`; `409 room_archived`; `409 room_concluding` (debating, only the chair's conclusion left — nothing stored) |
| `POST /rooms/{id}/conclude` | AWS_IAM | — | `202 {run_id}`; `409 room_archived` |
| `PATCH /rooms/{id}` | AWS_IAM | `{archived?, title?}` | `200 {room}` |

Errors are `{error: "<snake_code>", detail?}`.

```bash
# from a SigV4-capable shell (aws-vault exec … -- )
SIG=(--aws-sigv4 "aws:amz:us-west-2:execute-api" --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY"
     -H "x-amz-security-token: $AWS_SESSION_TOKEN" -H "content-type: application/json")

# create
curl -sS -X POST "$AGENTS_API_BASE/rooms" "${SIG[@]}" -d '{
  "title": "English-first series?",
  "question": "このシリーズは英語版を先に出すべきか、日本語版を先に出すべきか。",
  "participants": ["nadia", "dario", "maya"],
  "chair": "nadia",
  "rounds": 2
}'

# read (no signature needed)
curl -sS "$AGENTS_API_BASE/rooms/{room_id}"

# conclude now / un-archive
curl -sS -X POST  "$AGENTS_API_BASE/rooms/{room_id}/conclude" "${SIG[@]}"
curl -sS -X PATCH "$AGENTS_API_BASE/rooms/{room_id}" "${SIG[@]}" -d '{"archived": false}'
```

Because reads are unauthenticated at the gateway, do not put anything in a
Room's question or context that you would not put in a thread.

## Cost (W-3)

Every turn runs on one model at one effort regardless of the member's own
`model` row — `WF_ROOM_MODEL` / `WF_ROOM_EFFORT` on `wf-room-debate`
(default `anthropic:claude-sonnet-5-5` at `medium`); the member's row
supplies the voice (`system_prompt`) only (ADR-0048 §2, as amended). This
is a Rooms-only rule: `wf-messaging-reply` still speaks on the persona's
META `model`, so one persona runs on two models across the two surfaces.
Change the Room engine through the SAM template (a data-plane deploy),
never through agents-api, and with a stated reason.

A Room costs Claude calls only when you act: create (≤ participants ×
rounds + 1, at most 19), reopen (≤ participants + 1), conclude now (1).
Nothing runs on a schedule and no agent can start or extend a Room. The
60-turn per-room daily budget is the backstop. Room turns are not metered
on the per-agent `BUDGET#` ledger (that ledger charges orchestrator fires);
they sit under the aggregate W-3 ceiling and the billing alarm
([governance.md §2](../governance.md)). Token counts are on every agent
`TURN#` row (`tokens_in`, `tokens_out`) if you need to reconstruct a room's
spend. Each call's prompt is bounded too: the transcript it carries is the
opening, the latest conclusion and the last 30 turns (earlier turns are
elided with a count, each turn clipped to 1500 chars), so a room reopened
many times does not cost more per call than a long single run.
