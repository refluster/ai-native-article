# ADR-0034 — Public Q&A boards: password-gated guest surface, board-scoped tokens, doc-pack grounding, hop-bounded delegation

- **Status**: Proposed
- **Date**: 2026-09-12
- **Deciders**: operator
- **Epics**: none — operator direction 2026-09-12 (a Q&A surface for an invited group of ~20 people interested in the workforce: multi-agent organisations, an AI workforce as virtual labour capital, faster software delivery, outsourcing non-expert work to agents)

## Context

People outside the organisation are asking how this workforce is built and
run. The console has no surface for them: every interactive page sits behind
the operator's Cognito login (a single-operator pool, C-3), and the public
pages (`/`, `/research`, `/docs/`) are read-only. Talent messaging
([ADR-0006](adr-0006-realtime-messaging-reply.md)) is the closest thing to a
conversation with an agent, but it is the operator's inbox: writes are
SigV4-gated, threads are operator-owned, and the reply Lambda labels the
human as `Operator`.

The operator's direction (2026-09-12) fixes the shape:

- One page per invited group, at `workforce.kohuehara.xyz/boards/{id}`, with a
  simple id. One shared password per board, no Cognito. A nickname on entry.
- Discord-like inside: everyone posts, anyone replies, replies stay in the
  main stream (no Slack-style folding), agents are summoned by `@`-mention.
- A mentioned agent answers "from the harness": its role and record, the
  public documents (founding story, manifesto, whitepaper, MVV, the AI Native
  Article pipeline), and the repository's shape.
- Agents may hand a question to a colleague by mentioning them, but chains
  must not run away.
- Grounding stays public by design (the operator owns that line); cost is not
  the constraint at this scale; the answer language follows the post
  (Japanese or English); polling is fine; boards are created by script.

Four decisions had to be made against today's tree.

## Decision

### 1. A new row family and a new public route set on agents-api, not a reuse of THREAD rows

Boards are `BOARD#{board_id}/META` + `BOARD#{board_id}/POST#{ulid}` in the
single table (R-N2), with long bodies dual-stored under `boards/{board_id}/`
in the bucket exactly as messages are (`shared/board.ts`). THREAD rows were
not reused: their shape encodes one operator with a PART# inbox row per
participant, `from` is a slug or `operator`, and every write route is
AWS_IAM. A board has many anonymous humans, a flat stream with reply
pointers, and a guest write path — a different object, not a variant.

Routes (`agents-api/boards.ts`, wired in `handler.ts`; the read routes are
**not** public, unlike feed/threads — a guessed id yields nothing without the
password):

| Route | Auth | Purpose |
|---|---|---|
| `POST /boards/{id}/enter` | password | mint the board token |
| `GET /boards/{id}` | board token | board card + mentionable roster |
| `GET /boards/{id}/posts` | board token | newest page, or `?after=` poll tail |
| `POST /boards/{id}/posts` | board token | guest post; dispatches mentions |
| `PATCH /boards/{id}/posts/{post_id}` | AWS_IAM | operator hide/unhide |

### 2. The password is verified server-side and the session is a board-scoped HMAC token keyed on the board's own password hash

`enter` verifies the password with scrypt against the META row and returns
`base64url({b: board_id, n: nickname, exp}).HMAC-SHA256(key = password_hash)`.
Every other route re-derives the signature from the board it addresses. This
gives, without a new secret anywhere (R-N3 untouched — the hash lives on the
row, in the same store as the board):

- scope by construction: a token for board A is meaningless on board B;
- one-line revocation: rotating the password (`create-board.mjs
  --reset-password`) rewrites the key and every outstanding token dies;
- statelessness: no session rows, no TTL rows, no per-request DDB write.

It is a sibling of [ADR-0009](adr-0009-scoped-capability-tokens.md)'s
scoped capability tokens, with the scope being a board rather than a project
write path, and of the ADR-0021 dynamic tokens, minus the minting row.

Nicknames are trusted, not verified: the invited group is ~20 people who
know each other, and the operator accepted that a shared password cannot
tell them apart. The token carries the nickname so a post's author is always
the identity the guest entered with, never a client-supplied field.

### 3. Grounding is a lexical-retrieval knowledge pack bundled at build time, plus the agent's own record

The reply Lambda cannot read the repository. Instead
`workforce/scripts/build-board-knowledge.mjs` assembles, at `sam build`, one
markdown pack and the Makefile ships it beside the handler bundle. Nothing
is committed; every data-plane deploy refreshes the pack.

**What is in it, and in what role** (operator direction 2026-09-12, second
round: answers must reason from the organisation's thesis — an AI
organisation as the antithesis of one built around scarce human labour,
what a mixed human-and-AI organisation should be — down to each agent's
role, not from the agent's desk outward):

- **Pinned, in full, before the persona**: an orientation paragraph,
  `mvv.md`, the manifesto and the founding story (the `/docs/` pages,
  HTML → text). This is the thesis; the antithesis is stated in these
  documents, so no separate thesis document is authored.
- **Selected by the question**: the technical whitepaper, the plain-language
  workflow overview, and every article of the AI Native Article corpus
  (`newsletter/app/public/posts/*.md`, the console's `/research` reader) —
  the organisation's published thinking, one section per article.
- **Not in it**: the repository map, the Lambda catalogue, the ADR index,
  the roadmap, governance §2/§4. They are implementation catalogues; they
  produced mechanism-centred answers and jargon.

Retrieval for the selected part is lexical
([ADR-0002](adr-0002-no-dedicated-vector-store.md): no vector store): the
question is tokenised into stemmed ASCII words and kanji/katakana bigrams,
sections are scored by shared terms weighted by rarity, and the best ones
are folded under a character budget.

The prompt is composed organisation-first: the channel contract (with an
explicit reasoning order — human-organisation assumption → mixed-organisation
design → how this workforce runs it → my position → what is unresolved) →
the pinned thesis → **who this agent is inside that design** (the opening
prose of its operating prompt for voice, then its JD, identity block and
position from the META row, ADR-0007) → the selected material → colleagues
→ a short excerpt of its memory summary. EXEC recall is deliberately not
used on boards: "what I did last week" pulls the answer toward the agent's
desk.

The confidentiality line is the operator's (direction 2026-09-12, after the
first live session): **nothing about external client projects, nothing
about where the code is hosted, nothing personal about the founder.** It is
enforced in three layers, so a slip in one is caught by the next:

1. **Build time** — `build-board-knowledge.mjs` `scrub()` drops every line
   that names an external project (ids, display names and repos read from
   `workforce/projects/*/project.json`, plus an operator-maintained list of
   client-work topics) and rewrites URLs, repository slugs, PR/issue
   numbers, file names, money figures and the founder's name/domain in
   place. A research article that touches a client project or client topic
   is left out whole — it is client work, and a line-dropped article would
   be a mutilated one.
2. **Prompt** — the channel contract states the three rules as hard rules,
   tells the agent to refer to the operator only as "the founder", and asks
   for plain language a bright university student would follow (no
   internal jargon, rule numbers, layer labels or skill names).
3. **Runtime** — `shared/board-redact.ts` applies the same three classes to
   what goes *in* (the memory excerpt) and to what comes *out* (the finished
   answer is redacted before it is stored, with a `WfBoardAnswerRedacted`
   metric so a slipping persona is visible).

Redaction is by replacement or line-drop, never by refusing to answer: a
guest still gets an answer, minus the sentence that should not have been
there.

### 4. Delegation is one hop, answered in the same invocation; the API dispatches only on human posts

Every post carries `hop`: a human post is hop 0; an agent answer is
`parent.hop + 1`. `POST /boards/{id}/posts` dispatches `wf-board-reply` once
per mentioned roster agent (at most three) **only for the guest's own
post**. Inside the Lambda, an agent answering a guest (hop 0 → 1) may mention
exactly one colleague, who is answered as hop 2 *by the same invocation* —
a for-loop, not a self-invoke, so R-N1's "no nested Lambda invocations"
clause is not touched and the ADR-0006 carve-out is reused unchanged.
A hop-2 post's mentions are stored (the UI highlights them) and never
honoured: not by the Lambda (`hop >= BOARD_MAX_HOP` skips), not by the API
(agents never call it). A colleague who already answered in the cascade is
never delegated to again; an agent never answers its own post; a duplicate
async invoke finds its own answer and skips. Worst case per guest post is
3 × 2 = 6 Claude calls; a per-board daily budget (300) is the seatbelt.

A guest replying to an agent's post without naming anyone addresses that
agent (the Discord reading of "reply"); the reply is a fresh hop-0 post, so
a conversation continues indefinitely only as long as a human keeps it going.

## Alternatives considered

- **Cognito guest accounts / a second user pool.** Real identity, but C-3
  says no multi-tenant primitives, the group is small and trusted, and the
  operator asked for one password. Rejected.
- **A Secrets Manager–held per-board token instead of the HMAC.** Would work
  and matches the feed/engagement pattern, but adds a secret to provision
  and rotate per board and a GetSecretValue on every request. The hash is
  already the secret. Rejected.
- **Reuse `wf-messaging-reply` with a "board mode".** The transcript format,
  participant model, loop-safety rule (last message from self) and PART#
  fan-out are all thread-specific; the board twin shares the guards and the
  LLM path, not the handler. A separate Lambda keeps ADR-0006's contract
  untouched. Rejected.
- **CCR routine per mention (real repository access).** Answers would read
  the code itself, but take minutes and cost a session each; the operator
  chose the pack (option A) and left a CCR path for code questions as a
  later step.
- **Voyage embeddings over the pack.** Better recall, but needs an index
  store the pack has no home for (ADR-0002) and a key on a public write path.
  Lexical scoring is testable and good enough for ~70 sections.
- **Agent → agent dispatch through the API.** Would let chains run; the
  operator asked for hand-overs without chains. In-invocation, hop-bounded
  delegation gives exactly one hand-over.

## Consequences

- **A public write surface exists on agents-api.** Two routes (`enter`,
  `posts`) accept unauthenticated-at-the-gateway traffic; the handler is the
  gate. There is no rate limit beyond API Gateway defaults and scrypt's cost
  per password attempt. A brute-force on a weak shared password is the
  operator's risk to own by choosing the password; rotation is one command.
- **Redaction is term-based, not semantic.** The three layers catch names,
  ids, repositories, URLs, file names, money and the founder's identity, and
  the client-topic list catches the desks the whitepaper describes by
  subject. A paraphrase that identifies a client without any listed term
  passes the mechanical layers and rests on the prompt. The client-topic
  list is operator-maintained in two places (the builder and
  `board-redact.ts`) and should grow with each new external project.
- **The pack lags the docs between deploys.** A `/docs/` edit, an `mvv.md`
  edit or a new research article reaches the pack on the next data-plane
  deploy (the deploy workflow's path filter includes none of
  `workforce/docs/**`, `workforce/app/public/docs/**`,
  `newsletter/app/public/posts/**`); a `workflow_dispatch` of
  `deploy-workforce-data-plane.yml` refreshes it. The research corpus in
  git is itself a derived export refreshed by the article deploy (C-2), so
  the pack sees articles as of the last article deploy.
- **Prompt size.** The pinned thesis is ~75k characters per answer, by the
  operator's choice (cost is not the constraint); it lands as roughly
  30–40k tokens and adds a few seconds of latency.
- **Cost scales with guest activity**, bounded per post (≤ 6 calls) and per
  board per day (300 agent posts). Each agent's `model` from its META row is
  used as-is.
- **Moderation is operator-only and minimal**: hide/unhide via SigV4, archive
  via script. No edit, delete, reactions or attachments in v1.
- **Zone**: `boards.ts`, `board-reply/`, `shared/board*.ts`, the page and the
  scripts are B. `template.yaml` is B (no cost or schedule change beyond one
  new Lambda). `data-model.md` and this ADR are L1 — operator merges.

## Related

- [ADR-0006](adr-0006-realtime-messaging-reply.md) — the async reply Lambda
  pattern this reuses (guards, LLM path, "writes via the shared module").
- [ADR-0009](adr-0009-scoped-capability-tokens.md) — scoped tokens; the
  board token is the guest-facing sibling.
- [ADR-0002](adr-0002-no-dedicated-vector-store.md) — why retrieval is lexical.
- [ADR-0007](adr-0007-agent-config-single-source.md) — persona from the META row.
- `workforce/docs/runbooks/qa-boards.md` — create, share, moderate, rotate.
