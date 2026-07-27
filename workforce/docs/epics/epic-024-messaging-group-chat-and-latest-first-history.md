# Epic-024 — Messaging: group compose + latest-first history paging

- **Status**: Implemented (2026-07-17)
- **Owner**: operator (refluster)
- **Created**: 2026-07-16
- **Implemented by**: [#479](https://github.com/refluster/ai-native-article/pull/479)

> **Lifecycle note.** The operator directed this improvement in-session on
> 2026-07-15 ("複数人でグループチャット… 最新メッセージから見る… 私の承認なしで
> 進めてもらって良い"), which is the operator sign-off the `Draft → Accepted`
> gate exists to capture — so this Epic lands as `In-progress` in the same PR
> as its implementation, with this note as the audit trail.

> **Status reconciliation (2026-07-18, Nadia — backlog-reconcile).** Flipped
> `In-progress (2026-07-16)` → `Implemented (2026-07-17)`; a forward,
> monotonic-legal flip, bucket **Done**. Evidence: the single implementation
> PR **[#479](https://github.com/refluster/ai-native-article/pull/479)**
> (`e67fc4f`) merged all four acceptance surfaces — the newest-first paged
> `GET /threads/{id}?page_size=&cursor=` + `getThreadDetail` rebase in
> `lambdas/agents-api/handler.ts` + `lambdas/shared/messaging.ts`, and the
> open-at-latest / reverse-infinite-scroll / group-compose chip row in
> `app/src/pages/Messaging.tsx` + `app/src/lib/messages.ts` — each with vitest
> coverage (`messaging-tests.ts`, `messages.test.ts`). The change is **live on
> both target surfaces**: the merge fired `deploy-workforce-console` (CloudFront,
> `workforce/app/**`) → **success** (2026-07-16, re-run 2026-07-17) and
> `deploy-workforce-data-plane` (SAM, `workforce/lambdas/**`) → **success**
> (2026-07-16). The `Implemented by` line, a placeholder `(PR link set on open)`
> until this pass, now cites #479. **Open questions Q1 (unread jump-point) / Q2
> (group-label input) stay deferred follow-ups per the body — not committed
> remaining work, so no issue is filed.** Issue diff: 0 (no Epic-024 tracking
> issue was ever filed; implementation-in-one-PR per the lifecycle note above).

## Problem

Epic-013 shipped the two-way operator↔talent thread store, and its backend
deliberately over-built for the future: `POST /threads` accepts
`participants[]` + `group_label`, `createThread` derives `group` from the
participant count, and the group reply policy (§7 — @-addressed talent, else
`participants[0]`) is live in `pickAddressedSlug`. But two usability gaps
remain on the SPA, and one latent read-path defect sits under them:

1. **The compose UI is 1:1-only.** `Compose` in
   `workforce/app/src/pages/Messaging.tsx` holds a single `recipient: string
   | null`; the moment one talent is picked the picker disappears. The
   operator cannot start the "Elena + reports"-style group thread the mock
   has always promised — the only group threads that exist are seeded ones.
   The backend capability is dark inventory.

2. **Threads open at the oldest message.** The thread pane renders the
   transcript top-to-bottom with no scroll anchoring, so opening a long
   thread lands the operator at the *first* message ever sent and the newest
   — the one they came to read — is a long manual scroll away. Every
   messaging product opens at the latest message and lets the reader scroll
   *up* into history; ours inverts that.

3. **Latent truncation of the newest messages (W-4-adjacent).**
   `getThreadDetail` queries `MSG#` ascending with `Limit=200` — the same
   shape as the engagement-ledger read bug the `queryBySkPrefix` docstring
   warns about: past 200 messages the query window keeps the *oldest* 200
   and silently drops the newest. The reply Lambda reads the same helper, so
   a long-lived thread would eventually compose replies against stale
   context. No production thread is near the cap yet; this Epic fixes the
   shape before one is.

## Proposed solution

Three coordinated changes, no schema change (the `THREAD#` row family and
GSI4 are untouched — `MSG#{ulid}` already sorts chronologically, which is
exactly what reverse paging needs):

### 1. Paged, newest-first thread reads (API)

`GET /threads/{id}` gains `?page_size=` (default 50, same parse/caps as the
inbox) and `?cursor=`. The handler queries `MSG#` with
`ScanIndexForward=false` + `Limit=page_size` (via the existing
`queryBySkPrefixPaged`), reverses the page back to chronological order for
rendering, and returns it plus an opaque `older_cursor` whenever more
history exists. No cursor ⇒ the latest page; passing `older_cursor` back
walks toward the beginning of the thread. `getThreadDetail` (the reply
Lambda's context read) is rebased onto the same newest-first query so its
window keeps the *newest* N — fixing gap 3 with no caller change.

### 2. Open at the latest message; lazy-load older upward (SPA)

The thread pane pins to the bottom when a thread opens and when a new
message lands. Scrolling to the top of loaded history fetches the next
older page via `older_cursor`, prepends it, and preserves the scroll
position (offset by the prepended height) — the standard reverse-infinite-
scroll contract. Because the detail fetch now returns a page rather than
the whole transcript, the awaiting-reply poll's change detector moves from
`messages.length` to the last message id, and summary refreshes merge into
(never replace) already-loaded history.

### 3. Group compose (SPA)

`Compose` moves from a single `recipient` to a `recipients: string[]` chip
row — pick several talents, remove chips, then send; >1 recipient creates a
group thread through the *unchanged* `POST /threads` contract. The
duplicate-thread hint generalises: for one recipient it finds the existing
1:1; for several, an existing group with the same participant set. Group
reply policy stays Epic-013 §7 (@-addressed, else primary) — this Epic
widens the *compose* surface, not the reply fan-out.

## Behaviour at N = 100+ agents

- **Reads shrink, not grow.** Today opening a thread reads up to 200 MSG
  rows + S3 hydrations; with paging it reads `page_size` (50) regardless of
  thread length. Older pages are fetched only on demand.
- **Group compose is roster-search-bounded.** The picker reuses the existing
  filtered candidate list (cap 40 rows); a 100-talent roster changes
  nothing. Group *reply* cost stays one LLM call per operator message
  (Epic-013 §6/§7 unchanged), so cost remains operator-paced at any N.
- **Cursor shape is the shared one** (base64url `LastEvaluatedKey`, as
  feed/inbox paging) — no new pagination machinery to maintain.

## Acceptance criteria

- `GET /threads/{id}?page_size=&cursor=` returns the newest page in
  chronological order with `older_cursor`; omitting the cursor returns the
  latest page; following cursors reaches the first message. Covered by
  vitest in `shared/messaging-tests.ts` + `agents-api/handler-tests.ts`.
- `getThreadDetail`'s window keeps the newest N messages (regression test
  pins a >limit thread).
- Opening a thread in `/messaging` shows the latest message without
  scrolling; scrolling to the top of loaded history loads the older page
  and keeps the viewport anchored.
- The compose pane accepts multiple recipients and creates a live group
  thread; the addressed-reply behaviour matches Epic-013 §7.
- The gh-pages mock posture is unchanged (mock threads render as before;
  no pagination affordance appears when there is no older history).

## Open questions

- **Q1. Unread jump-point.** Opening at the latest message loses the "first
  unread" anchor a badge count implies. Default: open at latest (the stated
  use case); a "N unread ↑" jump affordance is a follow-up if it itches.
- **Q2. Group label.** v1 derives the list-row title from participant names
  and sends no `group_label`; a label input in compose is deferred until a
  real naming need appears (the backend already accepts it).

## Out of scope

- Talent↔talent autonomy, reactions, editing, WebSockets — all remain out
  per Epic-013.
- Widening the group reply fan-out beyond @-addressed / primary (Epic-013
  §7, Q5).
- Full-text message search (Epic-013 Q7).

## Related

- **Epic-013 — Talent messaging** ([epic-013-talent-messaging.md](epic-013-talent-messaging.md)): the store, routes, and reply loop this Epic completes the UX for; §7 group policy inherited unchanged.
- **Epic-011 — Workforce activity feed** ([epic-011-agent-feed.md](epic-011-agent-feed.md)): source of the shared cursor pagination shape (`queryBySkPrefixPaged`).
- **Implementation surfaces:** `workforce/lambdas/shared/messaging.ts`, `workforce/lambdas/agents-api/handler.ts`, `workforce/app/src/lib/messages.ts`, `workforce/app/src/pages/Messaging.tsx`.
