# ADR-0031 — Automate `spotifyUrl` capture; define (not yet flip) the criteria to retire the `script-ready → approved` human gate

- **Status**: Proposed
- **Date**: 2026-09-09
- **Deciders**: operator (refluster) — drafted by `wf:dario` (`issue-design`) for review
- **Epics**: [017](../epics/epic-017-podcast-spotify-distribution.md)
- **Related**: [adr-0016](adr-0016-podcast-production-surface.md) (the surface this extends — no decision there is reversed), `governance.md` R-N1 / R-N3 / §5, [#400](https://github.com/refluster/ai-native-article/issues/400) (this story), [#385](https://github.com/refluster/ai-native-article/issues/385) (Phase 1 — RSS + Spotify submission, still open), [#379](https://github.com/refluster/ai-native-article/issues/379) (Epic-017 tracker, closed)

## Context

Epic-017 shipped Phase 1 with two **interim** guards, both explicitly scoped by
the operator as "human gate now, mechanical later" (epic-017 §Status
reconciliation, 2026-06-29):

1. A **human approval gate**, `script-ready → approved`, sitting before any
   Polly synthesis spend — the operator reads Idris's `complianceVerdict`
   (`PASS` / `FLAG: …`) and flips the Notion property by hand.
2. **Manual `spotifyUrl` capture** — after Spotify ingests an episode from the
   RSS feed, the operator copies the episode's Spotify URL into the article's
   Notion row by hand (runbook §6).

Issue #400 (Epic-017 Phase 2) names both as candidate automations and states
its own Authority line verbatim: *"New credential type (`spotify.token`) +
loosening the human gate = B (operator); both are product-shape decisions.
File as design/ADR before implementing."* `issue-implement` (`wf:ren`,
2026-08-08) correctly declined to build against it for exactly that reason.
`issue-triage` (`wf:nadia`, 2026-09-09) re-laned it to `design` today,
confirming no such ADR exists through adr-0030 and that the drafting does not
need to wait on #385 — the decision can be written and reviewed independently
of Phase 1's remaining verification tail.

**#385 is still open.** Its own acceptance criteria are the manual
`spotifyUrl` capture and a feed-checker validation pass; the epic's
2026-07-07 reconciliation note records the one-time Spotify *submission* as
done (operator-reported) but the per-episode `spotifyUrl` backfill, the
reader-link render, and the feed-checker pass as unverified. **This ADR
proposes the mechanism and criteria; it does not claim Phase 1's track record
exists yet.** Both candidate automations below are gated on #385 closing
before implementation starts (see Consequences).

## Decision

**(a) Automate `spotifyUrl` capture as a new deterministic route on the
existing `wf-podcast` Lambda, backed by a new project-scoped credential
`spotify.token` (Spotify Web API Client Credentials flow); do not automate
the `approved → published` status flip, which ADR-0016's status machine
already sets at feed-rebuild time, independent of `spotifyUrl`.**

**(b) Do not retire the `script-ready → approved` human gate now. Define the
track-record criteria that would justify retiring it, so that when Idris's
compliance verdict has earned the record, a future operator PATCH — not a
code change — flips it on.** This ADR is the design/ADR the issue's Authority
line requires before any implementation; it is not itself the operator's
sign-off to loosen the gate.

### (a) `spotifyUrl` automation — mechanism

- **New route**: `POST /podcast/spotify-sync` on `wf-podcast` (same IAM-authorized
  HttpApi as `/podcast/synthesize` and `/podcast/rss`; same "no agent
  reasoning, default Lambda surface" posture as the rest of the Lambda per
  ADR-0016 Decision §2). Invoked by `podcast-pipeline.yml` (daily, OIDC → AWS),
  after the existing `publish.mjs` step, on the same cadence as synthesize/publish.
- **Selection**: rows with `podcastStatus ∈ {audio-ready, published}` (i.e.
  already in the feed) **and** an empty `spotifyUrl`, oldest first, bounded
  batch (`BATCH_LIMIT`, matching the synthesize/publish convention).
- **Lookup**: Spotify Web API `GET /v1/search?type=episode&q=show:{SPOTIFY_SHOW_ID} {episode title}`
  (public search; Client Credentials grant — no listener/user OAuth context
  needed, since the workforce is not acting on behalf of a Spotify user). The
  request is authorized with a short-lived bearer minted server-side from the
  `spotify.token` credential (`{client_id, client_secret}`) via Spotify's
  `POST /api/token` `client_credentials` grant — the Lambda mints and caches
  it in-memory per invocation; no long-lived user refresh token is stored,
  because Client Credentials tokens are non-user-scoped and re-mintable from
  the static app secret alone.
- **Match discipline (the correctness-critical step).** A wrong `spotifyUrl`
  is a reader-facing, W-1-adjacent editorial defect — the icon would link to
  the wrong audio under the article's byline. The route requires an **exact
  match on the episode GUID embedded in the RSS `<guid>` (the article slug)**
  against Spotify's returned episode's `external_urls` / description
  metadata where available, **falling back to exact-string title match**
  (the RSS `<item><title>` is byte-identical to the value passed as the
  Spotify search query) with **no fuzzy/best-effort match accepted**. A
  result set with zero exact matches is treated as "not yet indexed", not
  "no episode" — see retry policy below. A result set with more than one
  exact-title match (e.g. a title collision) **throws** (C-4) rather than
  picking one; a title collision could exist between our episodes or, in the
  worst case, alias a different publisher's episode, and picking on
  ambiguity is exactly the failure mode this route exists to avoid.
- **Retry / indexing lag.** Spotify's crawler indexing lag after an RSS
  update is unbounded in practice (minutes to ~24h+ observed industry-wide).
  The route is therefore **idempotent and re-run daily** rather than
  poll-to-completion in one invocation (the same reasoning as the
  `/podcast/synthesize` kickoff+poll split in ADR-0016 §Operational
  sequence): an episode with no match today is simply retried tomorrow. A
  **bounded staleness alarm** — `audio-ready`/`published` for more than
  **14 days** with `spotifyUrl` still empty — fails loud: the route emits a
  CloudWatch metric (`WfPodcastSpotifySyncStale`) and, since a workforce
  feed post is cheap and this is exactly the kind of "op needs to look at
  the Spotify dashboard" case, `podcast-pipeline.yml`'s report step names
  the stale slug(s) so they surface the same way a failed leg does (mirrors
  the honesty pattern PR #692 just added to the performance-refresh job —
  a degraded leg is annotated, never silently absorbed).
- **Write-back**: on a confirmed exact match, `PATCH` the article's Notion
  row's `spotifyUrl` property (URL type, unchanged shape) via the existing
  Notion egress the Lambda already holds (the shared
  `wf/projects/agent-workforce/notion.integration_token` secret — no new
  Notion credential). `podcastStatus` is **not** touched by this route (per
  the "do not automate the status flip" half of the Decision above — it is
  already automated by the existing `publish.mjs` step at feed-rebuild time,
  before `spotifyUrl` exists, per ADR-0016's status machine).
- **New credential type: `spotify.token`.** Shape `{client_id, client_secret}`,
  stored at `wf/projects/agent-workforce/spotify.token` per R-N3 (single
  secret store, `wf/` namespace) and `project.json:credential_types[]`
  (mirrors how `notion.integration_token` is declared). **Provisioning is a
  §5 B-authority action** (a new Spotify Developer app + Secrets Manager
  write) — this ADR proposes the credential type and its shape; it does not
  provision the actual app or secret, which is an operator step outside a
  Claude Code session's authority (registering a third-party developer app
  is an identity-bearing action).
- **New external egress, explicitly declared** (the same discipline
  ADR-0016 §3 used for Polly/S3): this is the first time the workforce calls
  an external (non-AWS, non-Notion, non-GitHub) third-party API from a
  Lambda. It is read-only (`GET /search`) plus the token-mint `POST`; no
  workforce data is sent to Spotify beyond the search query string (the
  episode title, which is already public in the RSS feed). No new reasoning
  surface — the match logic above is deterministic string/GUID comparison,
  not an LLM call, so R-N1's "no other reasoning surfaces" clause is
  unaffected, exactly as ADR-0016 reasoned for Polly.

### (b) Human-gate retirement — criteria (not a flip)

The issue's own candidate ("auto-advance `script-ready → approved` on a
`PASS` verdict, keep `FLAG: …` as the only stop") is **not implemented or
enabled by this ADR**. It proposes the bar a track record must clear before
an operator enables it, and the mechanism shape so the eventual flip is a
config change, not a code change:

- **Track-record bar** (mirrors the precedent Epic-022's own curation gate
  set for itself — "the gate earns autonomy only after ~4 clean weeks"):
  auto-advance may be proposed for operator enablement once **(i)** at least
  15 episodes have passed through the manual gate with a recorded `PASS`
  verdict, **(ii)** zero of those `PASS`-verdict episodes were reversed,
  corrected, or flagged as a citation/verbatim problem after publication,
  and **(iii)** at least 4 consecutive weeks have elapsed since Phase 1 went
  live with no `FLAG` episode slipping past the human gate (i.e. the human
  gate has never been the thing that caught a real problem AND the panel
  never produced a false PASS on that data). Falling short of any one
  clause keeps the gate manual — the bar is conjunctive, not "any one is
  enough."
- **Mechanism, once earned.** A single boolean config value (proposed name:
  `bindings[].config.auto_advance_on_pass` on the `podcast-script` binding,
  following the existing `binding_config` overlay pattern other skills use,
  e.g. `issue-design`'s own `max_issues_per_run`), read by
  `podcast-script/publish-notion.mjs`: when `true` **and**
  `complianceVerdict === "PASS"` (exact string match — no partial credit),
  the write sets `podcastStatus = approved` directly instead of
  `script-ready`; any `FLAG: …` verdict is **always** routed to
  `script-ready` regardless of the flag's value, so the human gate on a
  flagged episode is never removable by this mechanism. Flipping the config
  is a §5 B-authority action (loosening an approval gate) — an operator
  `PATCH /agents/{slug}` action, not a merge.
- **What does not change even once earned.** The `FLAG: …` stop is
  permanent — this ADR never proposes auto-advancing a flagged episode. The
  Media Rights & Compliance Coordinator's (Idris's) verdict remains the
  compliance authority; automating the *routing* on a `PASS` does not
  automate the *judgment*.

## Alternatives considered

- **Automate `spotifyUrl` via a CCR Cadence (LLM call) instead of a Lambda
  route.** Rejected: the Spotify lookup is a deterministic search-and-match
  (title/GUID string comparison), not judgment. Routing it through a Cadence
  would introduce LLM reasoning — and its token cost — for pure API
  plumbing, the same reasoning ADR-0016 used to keep Polly/RSS off the
  Cadence surface. Consistent with R-N1: reasoning surfaces are declared and
  bounded, not grown by convenience.
- **Full Spotify Authorization Code (user OAuth) flow instead of Client
  Credentials.** Rejected: the search-and-match use case needs no
  user-scoped data (no playlists, no listening history) — Client Credentials
  gives read access to public catalog search with a single non-expiring app
  secret, avoiding a refresh-token custody/rotation problem for no
  functional gain.
- **Poll Spotify synchronously inside the RSS-publish step until the
  episode appears.** Rejected: indexing lag is unbounded in practice (can
  exceed a CI job's timeout), and would either block `podcast-pipeline.yml`
  or force a guessed timeout. The daily-retry route (mirroring the
  synthesize kickoff+poll split) is bounded, idempotent, and fails loud only
  after a stated 14-day staleness window instead of guessing.
- **Best-effort / fuzzy title match to reduce "stuck" episodes.** Rejected:
  a wrong `spotifyUrl` is worse than a slow one. An empty `spotifyUrl` for
  14 days is a visible, cheap-to-fix staleness alarm; a *wrong* URL under a
  byline is a silent correctness defect a reader could hit before anyone
  notices. Exact-match-or-throw is the deliberate trade.
- **Auto-advance the gate immediately (no track record).** Rejected outright
  by the issue's own Authority line and by the "Depends on" clause naming
  "a few weeks of the human gate + compliance-verdict data." Shipping
  auto-advance with zero data would remove the only human read on every
  episode, including ones the panel gets wrong, based on trust that hasn't
  been earned yet.
- **Retire the gate entirely, including the `FLAG` path.** Rejected: would
  remove the last human backstop on the highest-risk case (a flagged
  compliance issue), the one case the gate most needs to catch. Not
  considered further.

## Consequences

**What becomes possible.** Once #385 closes (Phase 1 verified) and this ADR
is Accepted, the `spotifyUrl` capture leg (§a) is Authority-A and
implementable as a normal PR: a `wf-podcast` route + a `podcast-pipeline.yml`
step + the credential provisioned by the operator. It removes the last
manual touch in the Phase-1 publish path named in Epic-017's Phase-2 problem
statement.

**What stays manual, and why that's a feature, not a debt.** The human
approval gate (§b) stays manual **until the stated track record exists** —
this ADR is explicit that "file as design/ADR" is not the same act as
"approve the loosening," matching the same "citing X isn't satisfying X"
pattern the drafting persona (dario) has flagged elsewhere. A future PR that
flips `auto_advance_on_pass` still needs to cite this ADR's §b criteria and
show the track record met them — that citation is the mechanical gate that
keeps a future PR from re-deciding "should we trust the panel yet" on the
fly.

**Cost.** No new W-3 (token-budget) cost — both changes are deterministic
Lambda/config work, not new LLM calls. New *external* cost: a Spotify
Developer account/app to register and its client secret to rotate under
R-N3 discipline (currently zero such non-AWS third-party credentials exist
in the workforce; this is the first). Removing the manual `spotifyUrl` step
saves the operator one Notion edit per episode; removing the approval gate
(when earned) saves one click per episode but removes the one universal
human read every episode currently gets — the real cost of §b, stated
plainly rather than only as "faster."

**Kill-line interaction.** Epic-017's kill criterion (≥8 published episodes,
Spotify CTR <2% → kill) is unaffected by either change here — this ADR
governs *how* `spotifyUrl` gets set and *when* the gate loosens, not
whether the surface continues. If the kill line fires first, both
automations become moot (the pipeline stops producing new episodes) before
either needs to be reversed.

**Reversal.**
- **(a)** Remove or feature-flag off the `spotify-sync` step in
  `podcast-pipeline.yml`; the route stops being invoked, `spotifyUrl` reverts
  to the Phase-1 manual process (runbook §6, unchanged, still works). No
  schema migration — `spotifyUrl` is the same plain Notion URL property
  either way; nothing written by the automated path needs to be undone,
  since a write only happens on an exact match.
- **(b)** Flip `auto_advance_on_pass` back to `false`. Episodes already
  auto-advanced stay `approved` (or are individually reverted by the
  operator if a specific one is in question); new `script-ready` rows again
  require manual review. No data loss either direction — the compliance
  verdict is still recorded regardless of which state it routes to.

**What would tell us it was wrong.**
- **(a)** Any observed case of a published `spotifyUrl` pointing to the
  wrong episode or show — a single confirmed mismatch is disqualifying
  (per the "exact-match-or-throw, never best-effort" design above; a
  mismatch would mean the match discipline itself has a bug, not that the
  bar was merely imperfect) and triggers immediate reversal + a post-mortem
  (dario's own retro pattern: root-cause it, add the mechanical check that
  would have caught it, then re-propose).
- **(b)** Any `FLAG`-worthy compliance issue in an auto-advanced episode
  that reaches `published` before a human catches it, or an operator spot
  audit of auto-advanced episodes surfacing a citation/verbatim-reproduction
  problem the panel missed — either triggers immediate reversal and the
  same post-mortem discipline.

## Out of scope

- **Implementing the `spotify-sync` route, the credential provisioning, or
  the `auto_advance_on_pass` config plumbing.** This ADR is the decision
  document; none of the above ships in this PR. Follow-up implementation is
  tracked on #400 once (a) this ADR is Accepted and (b) #385 (Phase 1) is
  closed with its own acceptance criteria met.
- **Multi-voice / dialogue** (#400's third candidate scope) — no acceptance
  criteria were ever written for it; not addressed here.
- **Any change to the `FLAG: …` routing** — a flagged episode always
  requires manual review, with or without §b's auto-advance enabled.
- **Full Spotify user OAuth** — not needed for search; not proposed.
- **Retroactively backfilling `spotifyUrl` for already-published episodes**
  outside the new route's normal daily sweep — the sweep covers this by
  construction (any `published`/`audio-ready` row with an empty
  `spotifyUrl` is in scope every run), so no separate backfill script is
  proposed.
