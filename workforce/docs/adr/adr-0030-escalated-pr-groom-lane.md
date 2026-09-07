# ADR-0030 — The human lane is groomed, not frozen: a bounded agent may keep an escalated PR mergeable, including on L0/L1 paths

- **Status**: Proposed (operator ratifies by merging the implementation PR)
- **Date**: 2026-09-07
- **Deciders**: operator (refluster) — widens agent authority over L0/L1 paths, so it is the operator's call, not the cadence's
- **Related**: [adr-0022](adr-0022-issue-to-merge-flow.md) (the author lane this extends), [adr-0010](adr-0010-autopilot-merge-consensus-widening.md) / [adr-0011](adr-0011-own-repo-autopilot-merge.md) (the merge predicate this deliberately does **not** touch), [adr-0005](adr-0005-single-execution-model-ccr.md) (the execution model), [governance §4.4](../../../docs/governance.md#44-autopilot-pr-merge--workforce-r-n10-delegation--l0l1-off-limits) (the L0/L1 off-limits list that sends PRs here in the first place), R-N9 / R-N10 ([governance.md §4](../governance.md)), [ML-027](../../../docs/memory-lint-backlog.md) (the id-collision class this ADR's guard is written against)

## Context

`pr-autopilot` guarantees every PR ends in one of two terminal states: MERGED,
or ESCALATED with `autopilot:needs-human` (adr-0022). `pr-remediate` drains the
author lane (`autopilot:needs-author`). **Nothing drains the human lane** — by
design, because the decision there is the operator's.

But "the decision is the operator's" was silently taken to mean "the PR is
untouchable," and those are different claims. The evidence, from the 2026-09-07
operator session that drained the queue by hand:

| PR | days in the human lane | L0/L1 path | panel verdict |
|---|---|---|---|
| [#546](https://github.com/refluster/ai-native-article/pull/546) | 33 | `.github/workflows/**` | — |
| [#547](https://github.com/refluster/ai-native-article/pull/547) | 33 | `.github/workflows/**` | `autopilot:reviewed` |
| [#551](https://github.com/refluster/ai-native-article/pull/551) | 32 | — | findings-blocking |
| [#565](https://github.com/refluster/ai-native-article/pull/565) | 28 | — | stale-routed |
| [#601](https://github.com/refluster/ai-native-article/pull/601) | 22 | `.github/workflows/**` | `autopilot:reviewed` |
| [#602](https://github.com/refluster/ai-native-article/pull/602) | 21 | `docs/governance.md`, `.github/workflows/**` | `autopilot:reviewed` |
| [#647](https://github.com/refluster/ai-native-article/pull/647) | 4 | `workforce/docs/adr/**` | `autopilot:reviewed` |

Three things this table says that the lane's design did not anticipate:

**1. The lane is an ordinary exit, not an exception.** Five of the seven touch a
path on §4.4's off-limits list. A PR that improves a CI gate or an ADR *always*
lands here. The lane is where a whole class of correct work goes, not where
mistakes go.

**2. Waiting is not free, and its cost compounds.** Six of the seven arrived
mergeable and **conflicted while waiting**. The operator's decision was never the
expensive part; re-deriving each PR's merge against a month of moved `main` was.
Four had already passed a ≥3-persona panel — they were waiting on one word.

**3. The compounding is worst exactly where §4.4 forbids the agent to act.** The
conflicts were in `ci.yml`, `governance.md`, `docs/memory-lint-backlog.md`,
`workforce/docs/epics/README.md` — the registries and workflow files two open PRs
are most likely to both append to.

`attention-ledger` already *reports* this queue every Monday. Reporting is not
draining. The gap is not visibility; it is that the queue rots between the report
and the decision.

### Why the existing lane cannot just be pointed at it

`pr-remediate`'s classifier makes `autopilot:needs-human` **terminal** on purpose
("a PR a human owns is not one an agent may keep pushing to"), and its SKILL.md
forbids resolving a conflict inside an L0/L1 / Zone A surface. Both rules are
right for the author lane, where the agent is fixing *findings* — changing what
the PR argues. Neither is right for the narrower job of keeping a decided-shape
PR applicable to a moved base.

## Decision

Add a second, strictly weaker lane to `pr-remediate`: the **groom lane**, over
`is:open label:autopilot:needs-human`. It keeps the operator's queue
decision-ready. It never decides.

### What the groom lane may do

- **G1 — bring the base in.** `git merge origin/<base>` into the PR's head
  branch. Never rebase, never amend, never force-push: the branch is not ours
  and a contributor's checkout must stay valid.
- **G2 — resolve a conflict only when it is additive on both sides.** Every hunk
  in the conflict must be *both sides adding new lines at the same point*, with
  neither side deleting or rewriting a line the other also touched. The
  resolution keeps **both** additions, base side first. Any other conflict shape
  is out of scope — see "blocked" below.
- **G3 — regenerate derived files** with the repo's own tooling (e.g.
  `build-agent-manifest.mjs --emit-skills`), never by hand.
- **G4 — run the repo's own fast checks** and push only if they pass.
- **G5 — post one status comment** saying what it merged and what the PR is
  still waiting on.

### What the groom lane may never do

Merge. Approve. Undraft. Close. Add or remove any `autopilot:*` **label**. Push
to the default branch. Touch §4.4's own path block. Address a review finding,
fix a failing check, or change what the PR argues — those are the author lane's,
and a PR in the human lane is not in the author lane.

**The lane cannot widen itself**: `docs/governance.md` stays on the off-limits
list for *merging*, and G2 permits only additions that were already reviewed as
part of the PR's own diff.

### The collision guard — the rule this ADR exists to state

**A textually additive conflict can still be a semantic collision, and the guard
must catch it before G2 accepts the resolution.** The same 2026-09-07 session hit
this twice:

- `main` claimed **R-16** for the base-path gate while [#602](https://github.com/refluster/ai-native-article/pull/602) claimed R-16 for the cadence read-back gate. Two added table rows. Textually additive; semantically a rule-number collision. (Renumbered → R-18.)
- `main` claimed **ML-020** for a truncation heuristic while [#546](https://github.com/refluster/ai-native-article/pull/546) claimed ML-020 for the body-path race. (Renumbered → ML-035, and four citations already on `main` had to follow.)

Keeping both rows would have produced a well-formed file asserting two different
meanings for one id. So: before accepting any G2 resolution, extract every
registry identifier (`R-NN`, `ML-NNN`, `FU-NNN`, `ADR-NNNN`, `OP-NNN`) and every
`meta.json:version` introduced by **either** side. **If any identifier appears on
both sides, the conflict is blocked, not additive** — renumbering is an
allocation decision with citation fan-out (ML-035 needed four call sites updated),
and it is not the groomer's.

This is [ML-027](../../../docs/memory-lint-backlog.md)'s class, at hits 3 and 4.
The groom lane's guard is a *containment*, not the fix: the fix is ML-027's own
proposed `check-governance-registries.mjs --vs-base` gate, which belongs in CI and
is tracked separately.

### The bound

Not a per-PR-ever cap — a PR legitimately needs grooming again every time the
base moves, potentially for months. The bound is keyed to the base instead:

- A groom attempt is **claimed before any work**, with the marker
  `<!-- autopilot:groom:<base-sha-7>:claimed -->`. A death costs that attempt
  (the same inversion `pr-remediate` uses, `wf:farah` F1 on #518).
- A PR already carrying **any** marker for the current base SHA is skipped:
  nothing has changed since the last attempt, so a retry would be a loop.
- Three consecutive `:blocked` outcomes across three distinct base SHAs →
  `groom-blocked`. The lane stops touching that PR and says so once. Silence is
  never the outcome (C-4 / W-4).

### Frequency

**Daily**, one fire. The queue's bottleneck is an operator decision, not
conflict-detection latency; sub-daily grooming would burn budget without moving
anything. Daily matches the base's own rate of motion (~3 deploys plus merges)
and the R-13 terminal sweep's rhythm. Cost class `medium` (~USD 0.20/fire) →
**~USD 6/month** against the W-3 ceiling.

No new digest: `attention-ledger` already owns the Monday operator-facing report
and can read the groomer's status comments.

## Consequences

**Good.** The operator's queue stays one click from merge, so a decision that
took four weeks to make no longer costs an hour of conflict archaeology to
execute. The four panel-green PRs above would have been merge-ready the whole
time. The lane's real cost — waiting — stops compounding.

**The cost we are accepting.** An agent now pushes commits to PRs on L0/L1 paths
without a human in the loop for that push. Three things bound it: the push can
only *add* lines both sides already had reviewed, the collision guard refuses the
one shape that looks additive but is not, and the merge decision is untouched —
§4.4 still sends every one of these PRs to a human.

**What could still go wrong.** A conflict that is additive on both sides but
where the two additions are *semantically* mutually exclusive in a way no
identifier reveals — two CI steps that must not both run, say. The collision
guard does not catch that. The mitigation is that the push runs the repo's own
checks (G4) and the PR still faces a human before merge; the residual risk is
recorded rather than claimed away.

**Not addressed.** Findings-blocking and stale-routed PRs (#551, #565 above) are
groomed for conflicts like any other, but the reason they are in the lane is
untouched — those still need the operator, or a re-route through the author lane.

## Alternatives considered

**A new standalone cadence.** Rejected on D-3: `pr-remediate` already has the
worktree-isolated sequential engine, the claim-first latch, the semantic
conflict discipline ("keep both intents; never resolve by preference") and the
project/credential wiring. A second cadence would have duplicated all of it and
added a second W-3 budget line for the same work.

**Let `pr-autopilot` merge the panel-green L0/L1 PRs.** Rejected: that is
§4.4's boundary, it is L0/L1 text this ADR may not edit, and the operator's
review of a governance change is the point of the rule. This ADR keeps the
decision exactly where it is and only removes the decay around it.

**Groom on the `pull_request` event instead of cron.** Rejected for now: the
event that matters is a push to `main` (which is what invalidates these PRs),
not a push to the PR. A daily fire reads the whole queue against the current
base in one pass; the event version is a possible follow-up (adr-0013's
argument), not a starting point.

**Do nothing; let the operator keep draining it.** Rejected on the evidence
above: the queue's median age at merge was 28 days, and every one of those days
was buying conflicts nobody chose.
