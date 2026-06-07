# Epic-013 — Talent messaging: wire the operator↔talent thread store

- **Status**: Draft
- **Owner**: Maya
- **Created**: 2026-06-06
- **Implemented by**: —

> **Scope note:** this Epic turns `/messaging` from a deterministic mock
> (`apps/workforce/src/lib/messages.ts`, `apps/workforce/src/pages/Messaging.tsx`)
> into a working two-way store. It is the workforce's **first UI-write
> surface** — the operator types and the addressed talent answers — so the
> load-bearing design decisions are the write-auth gate (§3) and the
> agent reply loop (§4), not the data shape.

## Problem

`/messaging` ships today as a faithful LinkedIn-Messaging reskin, but every
thread is synthesized at build time from the roster and the compose box is a
disabled `<div>`. The page's own disclosure card says so: *"the live
talent-to-talent messaging store isn't wired yet … Composing is disabled."*
Three concrete gaps follow:

1. **The operator can read the workforce but cannot address it.** Epic-011's
   feed gave each persona a one-way micro-voice; Epic-002's profile gave them a
   static identity. Neither lets the operator say *"Nadia, do a pass on the
   older Stories"* and get an answer back. The only two-way channels today are
   GitHub PR threads (slow, code-shaped) and a manual `aws lambda invoke`
   (no conversation, no memory of what was asked). The mock's own threads —
   Maya tightening a kill criterion, Priya catching an IA collision — are
   exactly the exchanges that currently have nowhere real to happen.

2. **There is no inbound task surface that carries conversational context.**
   `TASK#{ulid}` rows (data-model §Task rows) are how work reaches an agent,
   but a task is a one-shot job spec, not a thread. An agent asked a follow-up
   question ("why did you pick basename lookup?") has no primitive that says
   "here is the conversation so far, reply *as yourself* in it." Every
   clarification today is reconstructed by hand into a fresh task.

3. **The mock is load-bearing fiction that will rot.** `lib/messages.ts`
   hard-codes seven conversations that reference real PRs (#171, #123), real
   skills (`feed-post`, `discord-heartbeat`), and real org edges. As the
   workforce evolves those references drift out of date with nothing
   regenerating them, and the disclosure card quietly trains the operator to
   distrust the page. A mock that mirrors a real target is useful exactly
   until the real target exists; then it is debt.

The unifying observation: the workforce already has a track record
(Epic-010 ledger), a micro-voice (Epic-011 feed), and an identity surface
(Epic-002 profile) — but **no addressable channel**. A thread is the natural
unit of an addressable channel: it has participants, it accrues messages, and
— unlike the feed — it expects a reply. That's what this Epic adds.

This is workforce-internal. Threads are workforce state (DDB + S3 per R-N2),
not editorial artefacts; the W-2 boundary is sharp (a message never touches
Notion). The page stays at `/messaging` on the existing SPA (R-N6); no public
`kohuehara.xyz` surface is involved.

## Proposed solution

A `THREAD#` row family, an operator-authored `POST` path on `wf-agents-api`,
and a new event-driven `messaging-reply` skill. The operator sends a message
from the UI; the handler appends it and enqueues a reply `TASK` for the
addressed talent; the agent-runner dispatches `messaging-reply`; the agent
reads the thread plus its own recall and answers in persona voice. **v1 is
operator↔talent only** — agents reply when addressed, never initiate, and
never reply to themselves (the loop-safety property in §6). Talent↔talent
autonomy is explicitly out of scope (§Out of scope).

### 1. Thread + message shape

A thread is a participant set plus an append-only message log. Messages are
short (work-register, ~1–3 sentences like the mock) but the body is
dual-stored exactly like Epic-011 posts so a long message degrades gracefully.

```yaml
# THREAD#{thread_id} / META
thread_id:       ulid
participants:    ["nadia"]        # talent slugs; operator is implicit
group:           false
group_label:     null             # set only when group=true
created_by:      "operator"       # operator | {slug}; v1 always operator
created_at:      ISO timestamp
last_message_at: ISO timestamp    # denormalized for inbox sort
starred:         false            # operator-scoped flag (single-operator, C-3)

# THREAD#{thread_id} / MSG#{ulid}
from:            "nadia"          # talent slug, or "operator"
at:              ISO timestamp
body_preview:    "..."            # ≤320 chars inline
body_ref:        "messages/{thread_id}/{ulid}.md"  # S3, only if body >320 chars
finish_reason:   "stop"           # LLM stop_reason for agent messages; null for operator
tokens_in:       0                # agent messages only
tokens_out:      0
skill_version:   "0.1.0"          # messaging-reply version that authored an agent msg
```

`from`, `body_preview`, `at` are the same three fields `ChatMessage` already
carries in `lib/messages.ts:12` — the mock's shape is the v1 target by
construction, so the SPA types barely move.

### 2. Data shape (DDB) — one new partition, one new GSI

| `pk` | `sk` | Purpose | Key attributes |
|---|---|---|---|
| `THREAD#{thread_id}` | `META` | Thread descriptor | `participants[]`, `group`, `group_label?`, `created_by`, `created_at`, `last_message_at`, `starred` |
| `THREAD#{thread_id}` | `MSG#{ulid}` | One message | `from`, `at`, `body_preview` (≤320c), `body_ref?` (S3), `finish_reason?`, `tokens_in?`, `tokens_out?`, `skill_version?` |
| `THREAD#{thread_id}` | `PART#{slug}` | Per-participant inbox/unread row | `slug`, `unread` (int), `last_read_at`, `gsi4pk="INBOX#{slug}"`, `gsi4sk=last_message_at` |

The `PART#` row is what makes "list my threads, newest first, with unread
badges" a single query rather than a scan — it carries the `INBOX#{slug}`
projection on a new **GSI4**:

```
gsi4pk = "INBOX#{slug}"          # one per participant; operator is INBOX#operator
gsi4sk = last_message_at         # ISO, reverse-chrono range scan
```

GSI4 is the fourth index (Epic-011 added GSI3 `FEED`); kept minimal, same
precedent. The full message body is dual-stored S3↔inline exactly as
Epic-011 §4 and Epic-010 §8 — bodies under the ~320-char preview cap (the
overwhelming majority, given the work-register voice) never need the S3 fetch.

`data-model.md` gains the three-row catalogue entry and the GSI4 description.

### 3. Operator write path + the auth gate (the load-bearing decision)

This is the workforce's first surface where the **UI writes state**. Every
prior write originated server-side (runner) or from an opted-in external
client (R-N1(b)). The operator needs to be an actor, and an unauthenticated
write endpoint on a public API is unacceptable even at single-operator scale.

We reuse the **exact pattern R-N1(b) already established**: a Bearer token the
operator issues to themselves, stored in Secrets Manager under `wf/`
(R-N3), checked at the route. This is *not* multi-tenant auth — there is one
token, one operator (C-3). It is the same posture as the engagement POST-back
path, lifted to the operator's own browser session (the token is injected at
SPA build/deploy for the authenticated `workforce.kohuehara.xyz` origin; the
public `gh-pages` mirror has no token and falls back to mock — see §8).

```
GET  /threads                        # operator inbox  (?cursor=&filter=unread|starred)
GET  /threads/{id}                   # thread + messages (S3 fetch for long bodies)
POST /threads                        # start a thread {participants[], body}      [auth]
POST /threads/{id}/messages          # operator sends a message {body}           [auth]
POST /threads/{id}/read              # clear operator unread                      [auth]
POST /threads/{id}/star              # toggle star                               [auth]
```

The four write routes (`[auth]`) require the operator Bearer token; the two
reads are operator-only by the same hostname convention the feed uses
(Epic-011 §6 / Q3). There is deliberately **no** route by which a talent
posts a message from outside the runner — agent messages originate only from
the `messaging-reply` handler (§4), mirroring "POST /feed is not exposed"
(Epic-011 §6) and "POST /projects is not exposed" (Epic-010 §10).

`POST /threads/{id}/messages` does three things atomically-enough (a single
write per row, ordered): (a) write the operator `MSG#` row, (b) bump
`META.last_message_at` and increment the addressed talent's `PART#.unread`,
(c) enqueue a reply `TASK` (§4). If (c) fails, the message still persists and
the failure is a W-4 throw with a CloudWatch metric — the operator sees their
message landed but gets a "delivery pending" state, never a silent drop.

### 4. The reply loop: `messaging-reply` skill (event-driven)

A new skill under `workforce/skills/messaging-reply/`:

```
workforce/skills/messaging-reply/
├── SKILL.md          # persona-facing prompt body (Rule 11)
├── meta.json         # { name, version 0.1.0, executor: llm-prose, cost_class: low }
└── handler.ts        # runner-side: load thread, assemble recall, write reply MSG row
```

Unlike `feed-post` (cron-triggered), `messaging-reply` is **event-driven**.
Per R-N4, the binding declares `executor: lambda` with `trigger.scheduler:
external` — the agent-runner already accepts `external` invokes (R-N4, Phase 7
PR3a widened `RunnerContext` for exactly this). The enqueued reply `TASK`
carries `{thread_id, addressed_slug}`; the runner dispatches `messaging-reply`
for that agent.

`SKILL.md` (tight, so `system.md` does the voice work):

- "Read the thread you've been addressed in: the last 10–20 messages
  (`THREAD#{id}/MSG#*`, time-ordered). This is the primary material."
- "Assemble your recall packet as usual — your own recent `EXEC` rows
  (Epic-010 §7 GSI1), your last 1–2 memory chunks. Answer *from your work*,
  not from invention."
- "Write **one** reply, in your own voice (your `system.md`). First-person,
  1–4 sentences, work-register. No headers, no bullet lists — this is a
  message, not a document."
- "If the last operator message needs no reply (an acknowledgement like
  'Nice. Ship it.', a closing, or a message addressed to someone else in a
  group), output the literal token `__NO_REPLY_NEEDED__` and nothing else."
- "Never address yourself, never start a new topic, never reply to your own
  message."

The `__NO_REPLY_NEEDED__` sentinel is the W-4 fail-loud path against the
"agent fabricates a reply to a non-question" failure: the handler treats it as
a `status=skipped` RUN with `skip_reason="no_reply_needed"`, writes **no**
`MSG#` row, and leaves the operator's unread untouched. The mock already
encodes this — the Vikram thread ends with the operator's "Nice. Ship it."
and no agent reply (`lib/messages.ts:98`). The metric `WfMsgNoReplyRate` makes
a chatty agent (replying to every acknowledgement) visible.

A successful reply writes the agent `MSG#` row, bumps `last_message_at`, and
increments the **operator's** `PART#operator.unread` so the UI badges it.

### 5. Editorial integrity (W-1) at message scale

W-1 applies to a message the same way Epic-011 §7 applied it to a post:

- The handler **throws on `finish_reason==='length'`** (R-N1 exception path /
  W-4). A 1–4 sentence reply fits comfortably under `max_completion_tokens`;
  a length-truncation is a real signal, not an expected case.
- The handler **rejects LLM-failure artefacts** by the same regex set
  `article-health` uses (`"As an AI"`, `"I apologize"`, `"Here is the"` in the
  first 50 chars). A rejection writes `status=throw` and emits a metric; no
  `MSG#` row lands.
- Empty bodies (after the `__NO_REPLY_NEEDED__` token is handled) throw.
- No bias-disclosure footer on a message (same reasoning as Epic-011 §7 — a
  100-char disclosure inside a 2-sentence message destroys the signal); the
  author chip links to the persona profile, which carries it.

A message is not a `kohuehara.xyz` article (W-2 untouched). The boundary is
the same one the feed draws: an L1 article goes through Notion; a message
never does.

### 6. Loop safety + cost containment (the property that makes this affordable)

The single design rule that bounds cost and prevents runaway agent chatter:
**a reply is caused only by an inbound operator message, and an agent never
replies to its own message.** Consequences:

- Conversation depth is operator-paced. The workforce never generates a
  message without the operator having just sent one. There is no agent→agent
  fan-out (that's the out-of-scope talent↔talent case, which is where loops
  live).
- One operator message → at most one agent LLM call (1:1) or at most one per
  addressed agent (group, §7). Cost scales with **operator activity**, not
  agent count — see §Cost impact.
- Backstop guard: the handler enforces a per-thread reply budget
  (`WfMsgRepliesPerThreadPerDay`, default 50) and refuses to reply past it,
  throwing W-4-style. At single-operator scale this never trips in normal use;
  it's the seatbelt against a bug that re-enqueues.

### 7. Group threads

Group threads (the mock's "Elena + reports") are real in v1 but constrained:
when the operator posts to a group, **only @-addressed talents** get a reply
TASK; absent an explicit address, only the thread's primary participant
(`participants[0]`) replies. This keeps a group post from fanning out into N
simultaneous LLM calls and keeps §6's "one reply per inbound" property. Full
free-for-all group dynamics (every member chiming in, members replying to each
other) is out of scope — that's talent↔talent autonomy by another name.

### 8. SPA changes + the mock→live cutover

`apps/workforce/src/pages/Messaging.tsx` and `lib/messages.ts` change as
little as possible — the mock was built to be the v1 target:

- **Data source switch.** When `VITE_WORKFORCE_AGENTS_API_BASE` is set
  (authenticated workforce origin), the page fetches `GET /threads` /
  `GET /threads/{id}`; when unset (public `gh-pages` mirror), it falls back to
  `buildMockThreads(roster)` exactly as today. This is the *same dual posture*
  the app already uses for `workforce-mock-stats.json` (config/api.ts), so the
  mock is retained as the unauthenticated fallback, not deleted — the
  disclosure card stays on `gh-pages`, disappears on the live origin.
- **Enable composing.** The disabled `<div>` at `Messaging.tsx:328-335`
  becomes a real textarea + send. On send: optimistically append the operator
  `MSG`, render the recipient in a "drafting…" pending state, and poll
  `GET /threads/{id}` (2–3s interval, ~60s ceiling) until the agent `MSG`
  lands or `__NO_REPLY_NEEDED__` resolves the thread. No WebSockets (C-3 /
  R-N6 simplicity); polling is adequate at single-operator scale.
- **Real unread + filters.** The `unread` badge and the `Unread`/`Starred`
  filter pills (`FILTER_PILLS`, currently inert) bind to `PART#` rows. `read`
  fires on thread open; `star` on the star toggle.
- **Compose-to-new.** The compose button (`Messaging.tsx:144`, currently a
  placeholder) opens a roster picker → `POST /threads`.
- **Update the disclosure.** On the live origin the "placeholder data" card is
  replaced by a one-line "Messages are answered by the addressed talent's next
  run — replies are not instant" latency note (managing the expectation that
  this is async, not a chat bot).

## Stories

Decomposed for assignment. Each Story carries a **hypothesis** (why it earns
its place) and a **kill criterion** (the measurable condition under which we
stop, not a vibe — per the standing convention that *a Story without a kill
criterion is just a wish*).

### Story 1 — Thread store: DDB rows, GSI4, S3 dual-store, read API

The `THREAD#` row family (§2), GSI4, the S3 message-body path, and the two
**read** routes (`GET /threads`, `GET /threads/{id}`). `data-model.md`
updated. No write path, no skill yet — seed a handful of threads via a script
and prove the SPA renders them live (behind the API-base flag) identically to
the mock.

- **Hypothesis:** the mock's shape is already the right shape, so the store +
  read API is mostly mechanical and de-risks the rest of the Epic cheaply.
- **Kill criterion:** if rendering live threads requires changing the
  `ChatMessage`/`Conversation` SPA types in more than cosmetic ways (i.e. the
  mock shape was wrong), stop and re-derive the data model before building the
  write path.

### Story 2 — Operator write path + auth gate

The four `[auth]` routes (§3), the Bearer-token gate reusing the R-N1(b)
pattern, the `PART#` unread bookkeeping, and `read`/`star`. Composing enabled
in the SPA (§8) — but the recipient stays silent (no reply skill yet); the
operator's message simply persists and badges.

- **Hypothesis:** an authenticated single-operator write surface is achievable
  without introducing multi-tenant auth (no Cognito, no RBAC) — the R-N1(b)
  Bearer pattern is sufficient (C-3).
- **Kill criterion:** if a secure single-operator write gate cannot be built
  without a real identity provider (Cognito/OAuth), stop and escalate — that's
  a C-3 / R-N3 question for the operator, not an implementation detail to
  power through.

### Story 3 — `messaging-reply` skill + the reply loop

The skill (§4), the `external`-triggered binding on all talent agents, the
enqueue-on-send wiring (§3c), the `__NO_REPLY_NEEDED__` sentinel, W-1
enforcement (§5), and the SPA "drafting… → reply lands" poll (§8). This is the
Story that makes the page *answer*.

- **Hypothesis:** a persona reading the thread + its own recall produces
  replies the operator finds worth sending the next message to — the channel
  is genuinely two-way, not a novelty.
- **Kill criterion:** if, after two weeks of real operator use, the operator
  sends **no measurable follow-up** (threads die at depth 1: operator → one
  agent reply → abandoned) across the corpus, the reply loop isn't earning its
  cost — pause Story 4 and reconsider whether async messaging beats just
  invoking a task.

### Story 4 — Group threads + loop-safety backstop

Constrained group reply (§7), the per-thread reply budget guard (§6), the
`WfMsgNoReplyRate` / `WfMsgRepliesPerThreadPerDay` metrics, and the
post-corpus health sweep in post-deploy CI.

- **Hypothesis:** @-addressed group replies are useful without opening the
  talent↔talent loop, and the budget guard never trips in normal
  single-operator use.
- **Kill criterion:** if the loop-safety guard trips in normal operation
  (not a bug), the §6 model is wrong — stop and redesign causality before
  shipping group threads.

## Behaviour at N = 100+ agents

This Epic scales on the variable that *doesn't* grow with agent count:

- **Cost is operator-paced, not agent-paced.** Unlike the feed (N writes/day
  by construction), messaging produces a reply only when the operator sends a
  message. At N=100 the operator still has one pair of hands; the LLM-call
  volume is identical to N=17. This is the Epic's nicest scaling property.
- **DDB writes:** a busy day might be ~50 operator messages → ~50 replies →
  ~150 row writes across distinct `THREAD#` partitions. Negligible.
- **Inbox query:** GSI4 range scan with `Limit=25` returns the operator's
  latest threads in O(25) regardless of total thread count; cursor-based
  pagination on `gsi4sk` (same pattern as feed/profile timelines).
- **Bindings:** `messaging-reply` is `external`-triggered, so it adds **zero
  EventBridge rules** — no per-agent cron, unlike Epic-011's stagger. At
  N=1000 the binding count is unchanged.
- **Compose-to picker** at N=100 wants search-as-you-type over the roster
  (the directory already has Epic-001 search); the picker reuses it rather
  than rendering 100 rows. At N=1000, server-side participant search — a v2
  conversation, not a v1 one.

## Cost impact

| Item | Monthly | Notes |
|---|---|---|
| LLM calls (operator-paced; assume ~20 reply-worthy messages/day × 30 = 600/mo × ~3500 tok in + ~150 tok out, Haiku 4.5 at USD 1/M in + USD 5/M out) | ~USD 3 | VPs (Sonnet) on a fraction of threads add ~USD 1; rounding. |
| DDB writes (~150/day × 30 = 4500/mo, PAY_PER_REQUEST) | < USD 0.01 | |
| S3 storage (message bodies, most under the inline preview cap → few writes) | < USD 0.01 | |
| Secrets Manager (one operator token under `wf/`) | < USD 0.40 | One secret, R-N3. |
| **Total added** | **~USD 4/mo** | Fits inside W-3's USD 160/mo (current usage well under after Epic-009/010). |

At N=100 the total is **unchanged** (operator-paced, §Behaviour). The only way
this Epic's cost grows is the operator messaging more — which is the operator's
own throttle. No ceiling raise.

## Acceptance criteria

- `THREAD#{id}/{META,MSG#,PART#}` row family and **GSI4**
  (`gsi4pk=INBOX#{slug}, gsi4sk=last_message_at`) exist; `data-model.md`
  carries the catalogue entry and the GSI4 description.
- `workforce/skills/messaging-reply/{SKILL.md, meta.json, handler.ts}` exist;
  `meta.json:executor = "llm-prose"`, `cost_class = "low"`, `version = "0.1.0"`.
- The handler implements `__NO_REPLY_NEEDED__` (writes a `status=skipped,
  skip_reason="no_reply_needed"` RUN, **no** `MSG#` row) and
  **throws on `finish_reason==='length'`** and on the LLM-artefact regex set;
  integration tests cover all three.
- The reply loop is **operator-caused only**: an integration test asserts an
  agent never enqueues a reply to its own `MSG#` row, and the per-thread
  reply-budget guard throws past its cap.
- `GET /threads`, `GET /threads/{id}` (reads) and `POST /threads`,
  `POST /threads/{id}/{messages,read,star}` (Bearer-token writes) are deployed
  via `wf-agents-api`, CORS-allowed for the workforce origin; an unauthenticated
  write returns 401, not a silent no-op (W-4).
- All talent `agent.json` files carry a `messaging-reply` binding with
  `executor=lambda, trigger.scheduler=external`; `validate-agent-json.mjs`
  recognises it and asserts no `cron` is attached (it's event-driven, not
  scheduled).
- `/messaging` composes and sends on the authenticated origin: the operator's
  message persists, the recipient shows a pending state, and the agent reply
  (or `__NO_REPLY_NEEDED__` resolution) lands via poll. On `gh-pages` the page
  falls back to the mock unchanged.
- `unread` badges and the `Unread`/`Starred` filters bind to `PART#` rows and
  are no longer inert.
- A post-deploy health sweep over the message corpus reports 0 truncated and
  0 LLM-artefact bodies (Epic-011 §Acceptance precedent).
- `Status` flips to `Implemented` only when (a) `/messaging` is live on the
  authenticated origin, (b) at least one talent has replied via the
  production `external` binding (not a manual invoke), and (c) the
  message-corpus health sweep is in post-deploy CI.

## Open questions

- **Q1. Operator write auth — Bearer token or something heavier?** Default:
  the R-N1(b) Bearer-token pattern (one token, Secrets Manager, C-3). Operator
  confirms this is acceptable before Story 2 opens, since it's the first
  UI-write gate and sets precedent. If the operator wants Cognito, that's a
  Zone A / R-N3 conversation (Story 2's kill criterion).
  - **→ Resolved (D3, then revised after #256):** neither a Bearer token nor a
    new Cognito pool. The writes use **AWS_IAM (SigV4)** — the same gate the
    other operator writes on this API already use (PATCH /agents, /feed,
    /projects). The SPA already logs the operator in via the workforce Cognito
    user pool (`infra/sam-web`) and mints temporary AWS creds from the
    workforce Identity Pool, whose operator role already grants
    `execute-api:Invoke` on this API. #256 first shipped a *second*, redundant
    single-operator user pool + JWT authorizer; the follow-up removes it and
    folds the four write routes onto the existing AWS_IAM login. Net: one login,
    one auth pattern, no new infra.
- **Q2. Reply latency expectation.** Replies are not instant — they ride the
  addressed agent's next run (event-driven, but Lambda cold-start + LLM call =
  seconds, not milliseconds). v1 polls with a ~60s ceiling and a "drafting…"
  state. Is async-with-polling the right UX, or does the operator expect
  chat-bot immediacy (which would argue for a synchronous invoke path —
  more cost, more coupling)? Default: async; revisit if it feels broken.
- **Q3. Should the operator token live in the SPA bundle at all?** Injecting a
  Bearer token at build time into a static SPA means the token is in the
  shipped JS on the authenticated origin. At single-operator scale on an
  unindexed host this is acceptable (same trust model as the engagement
  token), but a short-lived token minted per session would be cleaner. Default:
  build-time injection on the authenticated origin only; never on `gh-pages`.
  - **→ Moot under the AWS_IAM resolution (see Q1):** there is no static write
    token in the bundle. SigV4 signing uses short-lived credentials minted per
    session from the Identity Pool — exactly the "short-lived token minted per
    session" this question wished for.
- **Q4. Talent-initiated threads.** v1 is operator-initiated only
  (`created_by` is always `operator`). Should an agent be able to start a
  thread *to the operator* (e.g. a friction the agent wants to raise
  directly, rather than via the feed)? Default: out of scope — that's the
  feed's job (Epic-011 friction posts). Re-open if the feed proves too
  low-bandwidth for things that genuinely need a reply.
- **Q5. Group reply policy.** §7 limits group replies to @-addressed talents
  (else `participants[0]`). Is @-addressing discoverable enough in the UI, or
  should a group post default to "all members may reply" with the budget guard
  as the only brake? Default: @-addressed only (bounds cost, preserves §6).
- **Q6. Does `messaging-reply` get W-5 / Rule-11 treatment on later edits?**
  Default: yes — `SKILL.md` is Zone A with Rule 11; the initial version is the
  documented first-version exception (W-5 last clause).
- **Q7. Retention.** Threads are append-only and never deleted in v1 (Epic-011
  posts precedent). At what corpus size does the operator want archival /
  search? Default: defer; the inbox filter + per-thread view suffices at v1
  volume. Full-text message search is a v2 conversation (would reuse
  Epic-010 §9 embeddings if that lands).
- **Q8. Does the mock get deleted once live?** Default: **no** — it's retained
  as the `gh-pages` (unauthenticated) fallback, the same way
  `workforce-mock-stats.json` is. The disclosure card stays accurate on the
  public mirror and disappears on the authenticated origin. The mock's
  hard-coded PR/skill references should be refreshed once (Story 1) so the
  public preview isn't visibly stale.

## Out of scope

- **Talent↔talent autonomous messaging.** Agents messaging each other without
  the operator in the loop is where unbounded fan-out and reply loops live
  (§6). v1 is strictly operator↔talent. A bounded, operator-observed
  talent↔talent channel is a v2 Epic with its own loop-safety analysis.
- **Real-time delivery (WebSockets / push).** v1 polls. SSE/WebSocket is a
  v2 decision against R-N6 (the SPA is request/response today).
- **Reactions, read-receipts beyond unread-count, typing indicators,
  editing/deleting messages.** Messages are append-only (Epic-011 precedent).
- **Operator-authored posts / operator-as-first-class-actor across the whole
  workforce.** This Epic gives the operator a *write token* scoped to
  messaging; a general operator-actor primitive (Epic-010 §10 Q7) is still
  out.
- **Attachments / rich media in messages.** Plain text + light Markdown
  (paragraph breaks, inline code) only, matching the feed's render shape.
- **Multi-language.** JA-first, inheriting each persona's `system.md` voice,
  matching the editorial site's stance.
- **Public surface on `kohuehara.xyz`.** Messaging is workforce-internal;
  threads never enter the L0→L4 editorial pipeline.

## Related

- **Epic-011 — Workforce activity feed** ([epic-011-agent-feed.md](epic-011-agent-feed.md)): the one-way micro-voice this Epic complements with a two-way channel; shares the dual-store body shape, the W-1 enforcement, and the `__SENTINEL__`/skip pattern.
- **Epic-010 — Project as trust boundary** ([epic-010-project-trust-boundary.md](epic-010-project-trust-boundary.md)): the EXEC ledger (§7) the reply recall reads from; the R-N1(b) Bearer-token pattern (§10) this Epic reuses for the operator write gate.
- **Epic-002 — Agent profile** ([epic-002-agent-profile.md](epic-002-agent-profile.md)): the author chip on every message links here; carries the bias disclosure messages omit.
- **Epic-007 — Agent management API** ([epic-007-agent-management-api.md](epic-007-agent-management-api.md)): `wf-agents-api`, which the thread routes layer onto.
- **data-model.md** ([../data-model.md](../data-model.md)): gains the `THREAD#` row family and GSI4.
- **Implementation surfaces:** `apps/workforce/src/pages/Messaging.tsx`, `apps/workforce/src/lib/messages.ts` (mock → live cutover, §8).
