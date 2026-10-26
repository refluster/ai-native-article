# ADR-0008 — The agent-egress allowlist becomes a named, owned, change-logged L1 control

- **Status**: Proposed
- **Date**: 2026-09-15
- **Deciders**: dario (proposal), operator (ratification pending)

## Context

Every agent session in this repo (article-side and workforce alike) reaches
the outside world through a CCR proxy allowlist — `CLAUDE.md` already warns,
in passing, that *"Notion, the workforce custom domain and other hosts may
403"* in a remote session. That warning is folklore: it describes a symptom,
not a policy. [#670](https://github.com/refluster/ai-native-article/issues/670)
collects the evidence that this folklore is load-bearing enough to be a
control, and undocumented enough that nobody can say who owns it or when it
last changed:

- **Priya, 2026-08/09** — the governing line: *"a setting that decides which
  destinations we can reach is not a setting, it's an access policy — it
  decides editorial posture and legal posture at the same time. Whether we
  read a third party's work directly or read someone else's summary of it is
  a different fact, and that difference is the first thing outside counsel
  asks about."* Concretely, one morning a connection that had been refused
  eight times in a row started working, with **no announcement, and no record
  of who changed it or why** — an unwritten rule cannot be changed on the
  record, because there is no record to change.
- **The measured damage in the same window**: the article generation cadence
  ran 28 times over 7 days producing nothing, because a class of outbound
  call silently bypassed the proxy and was refused every time (this is
  `ML-017`/R-14's own incident — see `docs/memory-lint-backlog.md`) — and
  during that outage, colleagues whose job is reading primary sources
  couldn't reach them and worked from other people's summaries instead. That
  is a silent change to what the corpus is sourced from, not just an
  availability blip.
- **Mateo, 2026-09** — found the identical shape one layer down: a new
  connection type's credential had to be added by hand to two separate
  checklists, one addition was missed, and **no automated process checks the
  two checklists against each other** — a second, independent instance of
  Priya's own 2026-08 falsifier ("there is more undocumented-as-policy
  configuration in this org"), which by her own test makes it structural
  rather than a one-off (`docs/memory-lint-backlog.md` ML-034 records the
  concrete drift).

Why this is L1, not a runbook: it determines whether the corpus is built on
primary sources or secondary summaries (a C-1 editorial-integrity question)
and it is invisible in code review — nothing in a diff shows it, and (per
Priya's observation) it changes out of band. `governance.md §1` defines L1 as
"architectural decisions that constrain code shape" — a control that decides
sourcing posture and needs the R-11 citation gate to stop future changes
shipping silently is exactly that, not a discretionary L3 operational note.

`R-14` (`scripts/check-proxy-bootstrap.mjs`) already exists and is the
*mechanical* half of this story — it makes sure a script routes through the
proxy at all — but it has no visibility into the proxy's own allowlist
contents, which per `ML-017`'s own resolution note live in the CCR session
environment, **outside this repository**: *"the real fix is `NODE_USE_ENV_PROXY=1`
in the agent-runner's CCR session environment... that platform change is a
follow-up outside this repo."* The same is true of the allowlist itself: it
is not a file this repo's `git log` can show. That fact directly shapes what
this ADR can and cannot decide (see Consequences).

## Decision

Adopt the egress allowlist as a **named, owned, L1-statute-governed control**,
not a fact reconstructed from 403 messages:

1. **A new L1 statute doc**, `docs/egress-access-policy.md`, added to
   `governance.md §3.1`'s "Current statute" table. It states: which
   destination *classes* agents may reach and why (Notion API, the workforce
   custom domain, GitHub, package registries the CI/CD hosts allow, etc.),
   who owns the list (the operator, or whichever persona the operator
   delegates the Agent Workforce Platform seat to — Mateo's charter is the
   natural home per `workforce/docs/team/workforce-platform-charter.md`), and
   a **changelog section** — every addition or removal gets a dated row with
   who/why, the same append-only discipline the ADR format itself uses.
2. **A change-record requirement, not just a change-record place.** Any
   future modification to the live allowlist gets a same-day changelog entry
   in that doc. This is the mechanical answer to Priya's "a connection
   started working and nobody announced it" finding — not by inventing a new
   gate over infrastructure this repo doesn't control, but by making the
   *record* a first-class deliverable of the *change*, the same way an ADR
   status flip is a deliverable of a ratification.
3. **Cross-reference from R-14.** `governance.md §4`'s R-14 row gets a
   sentence pointing at the new policy doc, so the mechanical gate ("does a
   script route through the proxy") and the policy it enforces ("what the
   proxy is configured to allow") are discoverable from one another — closing
   the issue's ask #4.
4. **The two-checklist consistency check Mateo's finding calls for** (a
   machine comparison of the credential-type checklists that currently must
   be hand-kept in sync) is named as follow-up engineering work, not decided
   here — see Consequences and Out of scope.

## Alternatives considered

- **Leave it as a `CLAUDE.md` aside.** Rejected — that is the status quo
  this issue is about, and Priya's own governing line names exactly why: a
  control this consequential with no owner and no change record is a state,
  not a control, and a state can't be explained to outside counsel.
- **Document it only as an L3 runbook.** Rejected — a runbook is
  discretionary operator guidance, freely agent-editable (`governance.md
  §8.1` A), and carries no R-11 citation coverage. A control that decides C-1
  sourcing posture needs the higher bar: an L1 doc a future change must cite,
  the same way `azure-budget-rules.md` binds every LLM call site despite
  being "historical."
- **Have R-14 itself assert the live host list.** Rejected for now — R-14
  checks that a script *routes through* the proxy; the proxy's own allowlist
  contents are a platform-side fact this repo cannot read (confirmed by
  `ML-017`'s own resolution note, quoted above). The more promising
  mechanical direction is [#663](https://github.com/refluster/ai-native-article/issues/663)'s
  proposed capability-declaration + exercise-once preflight (already an open
  draft PR) — that issue supplies the *handshake*; this ADR supplies the
  *authority* it would check against. This ADR cross-references rather than
  duplicates it.
- **Have this PR enumerate the actual current destination list.** Rejected —
  not honestly possible from inside this git checkout. The live allowlist is
  CCR/agent-proxy configuration the operator (and Mateo's Agent Workforce
  Platform seat) hold, not something `git log` or any file in this repo can
  show. Publishing a guessed table would be worse than the folklore it
  replaces — a wrong "policy" a future agent trusts. See Consequences.

## Consequences

- **Positive.** The allowlist stops being reconstructed from 403 messages.
  Future changes get a same-day dated record. R-11 (L1 citation) starts
  covering this surface, so a future change to what agents may reach
  announces itself in a PR body the way every other L1 edit already must.
- **Honest limitation, stated up front.** This ADR decides the *shape* of the
  policy (where it lives, who owns it, how a change is recorded) — it does
  **not** populate the actual current destination table, because that data
  is not observable from this repository. The implementing PR (named below)
  ships the doc with the destination table structured but initially marked
  `<!-- destinations: populate from the live proxy allowlist -- operator/Mateo -->`,
  an explicit, visible gap rather than a fabricated one.
- **Cost.** A new L1 doc is one more file the R-11 gate watches, and one more
  place a future infra change must remember to update — the same ongoing
  cost every L1 statute doc already carries (see `azure-budget-rules.md`,
  which stays L1 despite being marked historical, precisely because its rule
  still binds).
- **Reversal.** Per the ADR status vocabulary, `Deprecated` if the mechanism
  it governs is retired and nothing replaces it; a later ADR supersedes this
  one if the ownership or record-keeping model changes materially.
- **What would tell us this was wrong.** If the changelog goes stale the same
  way the un-owned control did — an allowlist change lands with no dated row
  — the fix isn't more prose, it's `ops-accountability-watch` (or a peer
  sweep) checking the doc's own changelog freshness against actual proxy
  behaviour, which is itself a candidate follow-up if that happens.

## Out of scope

- Enumerating the current live destination list — operator/Mateo-owed, named
  above as the implementing PR's first task.
- The machine check that keeps the two credential-type checklists in sync
  (Mateo's finding) — distinct engineering work; file a separate issue rather
  than bundling it into this statute decision.
- Root-causing exactly which host silently started working the morning Priya
  describes — not reconstructable after the fact and not needed to fix the
  policy gap going forward.
- Any change to the [#663](https://github.com/refluster/ai-native-article/issues/663)
  capability-declaration proposal — related, not superseded or blocked by
  this ADR; the two compose (this ADR is the authority side, #663 the
  handshake side, per that issue's own framing).

## Related

- [#670](https://github.com/refluster/ai-native-article/issues/670) — the
  issue this ADR answers; Part of [#659](https://github.com/refluster/ai-native-article/issues/659).
- [#663](https://github.com/refluster/ai-native-article/issues/663) — the
  capability-declaration / exercise-once preflight proposal this ADR
  cross-references (already an open draft PR).
- [docs/memory-lint-backlog.md](../memory-lint-backlog.md) — ML-017 (the R-14
  proxy-bootstrap incident and its "the real fix is outside this repo" note)
  and ML-034 (the two-checklist drift Mateo found).
- [docs/governance.md §4](../governance.md#4-l2--regulations-mechanical-enforcement) —
  R-14, which this ADR cross-references without altering.
- [scripts/lib/proxy-bootstrap.mjs](../../scripts/lib/proxy-bootstrap.mjs),
  [scripts/check-proxy-bootstrap.mjs](../../scripts/check-proxy-bootstrap.mjs) —
  the mechanical gate this policy doc is cross-referenced from.
- `CLAUDE.md` — "Remote-session network allowlist" (the folklore this ADR
  replaces with an owned record).
