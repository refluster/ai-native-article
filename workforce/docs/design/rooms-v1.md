# Rooms — v1 design note

- **Authors**: Nadia Roy (`nadia`, Product Manager); architecture clauses
  with Dario Lindqvist (`dario`, VP Engineering Excellence)
- **Date**: 2026-10-24
- **Decision record**: [ADR-0048](../adr/adr-0048-rooms-purpose-first-deliberation.md)
  (Proposed — operator ratifies by merging)
- **Direction**: operator, in-session, 2026-10-24 —
  「Roomという概念のアプリを作って。特定の議題や論点などについて、エージェントをworkforceからサモンし皆でディベートして結論を導くアプリ。チャットと似てるが違う。チャットは人やエージェントが先にあって会話がくっつく。Roomは目的が先にあって人やエージェントが中に入る。」
- **Routes**: `/rooms` (list + create), `/rooms/:id` (one room) — inside the
  console's `ProtectedRoutes`, listed in GlobalNav right after Messaging
- **Operating it**: [runbooks/rooms.md](../runbooks/rooms.md)

## The thesis: purpose first, people second

The operator's distinction is the whole design. A chat is
**participant-first**: people (or agents) exist, and a conversation attaches
to them. A Room is **purpose-first**: a question exists, and people enter
it. Everything else in this note follows from taking that literally.

| | Thread (`/messaging`, ADR-0006/0047) | Room (`/rooms`, ADR-0048) |
|---|---|---|
| Identity | who is in it (`participants[]`, an inbox row each) | what it is for (`question`) |
| Created by | the operator, to reach someone | the operator, to settle something |
| Membership | the point of the object | chosen *for* the question, fixed at start |
| Who speaks when | after each operator message, every member once (a round) | a schedule of rounds fixed at start, then the chair |
| Lifecycle | none — open while anyone writes | `debating → concluded` (reopenable) |
| Artefact | the transcript | **the conclusion**; the transcript is its provenance |
| Inbox semantics | unread, star, latest-first inbox | none — a Room is not mail |
| How it ends | it does not | by construction, when the schedule runs out |

So a Room is not a thread with more turns. It is a different object with a
different hero: on the Room page the question is the largest thing on
screen, the context sits under it, and the members are introduced *as the
people summoned to answer it*. A thread page leads with the people.

This is also why a Room is not a "room mode" on THREAD rows (ADR-0048 §1):
the thread's row shape is an inbox, and a lifecycle with a terminal state
would be a second, hidden contract inside it.

## Interaction model

```
operator: question + context + members + chair + rounds
   │
   ▼
Round 1   every member, in the order picked — opening positions
Round 2…  every member again — respond by name, refine, concede or hold
   │        (operator may steer while statements remain: a direction, not a new turn order; once only the conclusion is left a steer is refused — reopen after it lands)
   ▼
Conclusion   the chair — agreement, disagreement (who holds what), action, open questions
   │
   ▼
concluded ──steer──▶ reopen: one more round + a fresh conclusion
          ──conclude now──▶ a fresh conclusion only
```

1. **Summon.** The operator picks 2–6 members from the live roster and one
   of them as chair. The picker shows role, because the useful choice is
   *roles that will disagree*: a Room of five like-minded members produces
   one essay five times.
2. **Rounds.** 1–3, default 2. Round 1 asks for an opening position; later
   rounds ask each member to respond to colleagues by name — agree or
   disagree with specifics, concede or hold — and never to restate. Members
   speak in turn, so each reads everything said before them (the ADR-0047
   lesson: parallel replies are parallel essays).
3. **Steer.** While a Room is debating, the operator can add a direction.
   It does not change the turn order; every speaker still to come reads it.
   This keeps the operator in charge of *what* is argued without making the
   operator a turn-taker.
4. **Conclusion.** The chair writes it, then the Room is concluded.
5. **Reopen.** A steer on a concluded Room is a follow-up question: one more
   round for everyone and a fresh conclusion. The earlier conclusion stays
   in the transcript, so the Room becomes a short, legible history of how
   the answer moved.
6. **Conclude now.** Cuts a debate short, or recovers a failed conclusion.

## Why rounds are fixed at start

The tempting design is a debate that runs "until the members agree".
Epic-013 §7 and ADR-0047 already named why that is the wrong default: an
agent↔agent exchange with no operator-paced bound is a loop whose end is
decided by persuasion, and whose cost is decided by the same thing. ADR-0047
solved it for group threads by fixing the round when the operator writes —
`then` only shrinks, so a round ends by construction.

A Room takes the same rule one step further. The **whole run** is fixed
when it starts (`buildSchedule(participants, rounds, chair)`):
`participants × rounds` statements and one conclusion, at most 6 × 3 + 1 =
19 calls. Nothing an agent writes can add a turn. Every way to get more
debate is an operator act — a reopen (+ participants + 1) or a conclude-now
(+ 1) — and each starts a new `run_id` that supersedes whatever was still
queued, so two schedules never interleave.

What we give up: a Room cannot stop early because the members converged in
round 1, and it cannot extend itself because round 2 opened a new fault
line. Conclude-now covers the first; reopen covers the second. Both keep
the operator as the only source of extra cost, which is the property that
makes a Room safe to open casually.

## The chair

One member writes the conclusion. That member also debates — the chair is a
participant, not an outside moderator — but speaks last with a different
contract: neutral, specific, in the question's language, in five fixed
sections (`結論 / Conclusion`, `合意点 / Where we agree`, `対立点 / Where we
differ`, `推奨アクション / Recommended action`, `未解決の論点 / Open
questions`). "Where we differ" must name who holds what: a conclusion that
flattens a real disagreement into consensus is the failure the section
exists to prevent.

Fixed sections make conclusions comparable across rooms and readable at a
glance, and they give a later consumer (memory, a feed post, an issue) a
stable shape to read — which is one reason those consumers are deferred
rather than designed around a free-form summary (below).

The chair defaults to the first participant picked. The operator should
choose a role whose job is to weigh rather than advocate (a PM, a VP), but
v1 does not enforce this.

## The `POSITION:` line

Every statement opens with one line, `POSITION: <one sentence>`. The Lambda
parses it (≤ 140 characters), strips it from the body, and stores it as
`position`; the page shows it emphasised above the paragraphs.

- **It is the Room's stance map.** Reading only the position lines, top to
  bottom, shows who started where and who moved — the debate's shape in
  ten lines, before reading any reasons.
- **It forces a stance.** The debate contract asks for a clear position
  from the member's own role and record; a required first line makes "it
  depends" visible as such.
- **It is fail-soft.** A model that omits the line still lands its turn;
  `position` is absent and the page shows the body alone. A missing stance
  line is a quality signal, not an integrity failure (W-1 guards truncation,
  artefacts and empty bodies; this is none of those).
- The conclusion has no `POSITION:` line: the chair's job there is to
  report positions, not take one.

## Language follows the question

The question's language — Japanese if it contains any kana or kanji, else
English — sets the language of every statement and of the conclusion,
including the section headings. A Room is one conversation about one
question; mixing languages turn by turn would make the transcript harder to
read for the one person it is written for. The context field does not
change this, and neither does a steer in the other language. (Bilingual
editions — a Room rendered in both — are not in v1; nothing about a Room is
published.)

## What the page shows

- **Header**: the question as the hero, context below, members with Sigil +
  name + role + a chair badge.
- **Progress band**: `Round 2 of 3 · 3/5 have spoken` and who is drafting
  now (the next pending speaker). This replaces the thread page's
  "drafting…" affordance: in a Room the operator wants to know *how far
  through* the debate is, not only who is typing.
- **Turns grouped by round** with dividers (`Round 1`, `Operator`,
  `Conclusion`); the conclusion in its own card, rendered as Markdown; the
  operator's turns styled like the operator bubble in Messaging so the two
  surfaces share one visual for "the operator spoke".
- **Composer** at the bottom: "Steer the room" while debating, "Reopen with
  a follow-up" once concluded — one route, two meanings, labelled by state.
- **`last_error` banner** (W-4): a failure is on the page, never only in
  CloudWatch. After three minutes without progress the page offers
  "stalled — Conclude now".
- Design tokens only (`wf-*`, R-2); mobile-first (16 px gutter, no
  horizontal scroll); `WorkforceLayout`, `Sigil`, `Skeleton*`.

## What v1 deliberately leaves out

Each item below changes one of the properties ADR-0048 rests on — operator-
caused, fixed schedule, operator-only surface, nothing written outside the
Room — so each needs its own decision record, not a v1.x patch.

| Left out | Why not now | What it would need |
|---|---|---|
| **Agent-initiated rooms** (an agent opens a Room when it hits a cross-role question) | Makes the chain agent-caused: cost would no longer be bounded by operator activity, and the R-N1 declaration in ADR-0048 §2 covers operator-caused chains only. | A new ADR amending ADR-0048 §2, an R-N4 binding or event declaration for the opener, a W-3 budget line; an Epic for the behaviour ("when should an agent convene a room?"). |
| **Scheduling a room from a cadence** (e.g. a weekly retro Room) | A scheduled run is a binding (R-N4), not an operator act, and every binding needs a budget line. | A cadence scaffolded with `cadence-forge` whose write-script calls `POST /rooms` with a scoped credential (the ADR-0009 pattern), plus an ADR declaring the scheduled caller. |
| **Human guests** (invited people in a Room) | A second identity class and a write path that is not the operator's — C-3 and the ADR-0034 territory (password gate, scoped tokens, redaction). | A new ADR modelled on ADR-0034; probably a board-to-room bridge rather than guest accounts. |
| **Votes / polls** as the conclusion mechanism | A tally hides reasons, and with LLM members it measures prompt framing more than judgement. The chair's "Where we differ" section is the v1 answer. | An ADR (new row kind or META fields, `data-model.md` change) and an eval that shows a tally adds signal over the chair's text. |
| **Multiple chairs** / a chair panel | One accountable author per conclusion is simpler to read and to audit; a panel needs a merge rule for conflicting conclusions. | An ADR amending ADR-0048 §4 (who writes, how conflicts resolve); likely the GROWTH.md multi-judge pattern as precedent. |
| **Conclusions into agent memory** | Memory is persona state (W-5) with its own curation path (ADR-0019/0021); an unreviewed write from a Room would bypass it. | An ADR on the memory write path (a curated "room outcome" chunk, by whom, with what shrink guard). |
| **Conclusions into the feed, Notion or an issue** | The feed is agent-authored by cadences (Epic-011); Notion holds articles, not workforce state (W-2); an auto-filed issue is an agent-caused write on GitHub. | Per destination: an ADR (feed: who is the author?), or an explicit operator action ("file as issue") added as a Zone B button — the latter is the cheap next step. |
| **Code-grounded rooms** (members read the repository) | Lambda turns see only the question, context, transcript and a memory excerpt; reading code needs a CCR session per room (ADR-0005/0006: minutes and a session each). | An ADR for a CCR-backed room variant, the same later step ADR-0034 left open for boards. |
| **Adaptive length** (stop early on consensus, extend on dissent) | Breaks "fixed at start"; see above. | An ADR showing a bound that still holds without the operator in the loop. |

## Which Zone A documents should eventually absorb this

This note and the runbook are Zone B and can move with the code. Some of
what they say belongs, in the end, in statute:

- **`workforce/docs/data-model.md`** — the `ROOM#` rows, the GSI3 `ROOMS`
  partition and the `rooms/` S3 prefix. Drafted with ADR-0048 and shipped in
  the same operator-merged PR.
- **`workforce/docs/governance.md` §4 R-N1** — the rule text still lists
  "per-Lambda nested invocations" as needing a Zone A amendment and does
  not name the two declared self-invoke chains (ADR-0047's messaging round,
  ADR-0048's room schedule). A sub-bullet naming both, and the three
  properties they share (self-only, operator-caused, schedule fixed at
  start), would make the rule match the ADRs.
- **`workforce/docs/architecture.md`** — when its body gets the Zone A
  rewrite it is waiting for (CLAUDE.md §Known stale spots), the event-caused
  reply family (`wf-messaging-reply`, `wf-board-reply`, `wf-room-debate`)
  belongs in the execution-surface picture beside the CCR batch runner.
- **`workforce/DESIGN.md`** — if the round divider, the emphasised position
  line or the conclusion card reappear on a second surface, they become
  components there rather than Room-page specifics.
