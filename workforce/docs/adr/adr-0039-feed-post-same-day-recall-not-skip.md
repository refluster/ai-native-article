# ADR-0039 — `feed-post` reads its own same-day posts before an earlier `daily-research` post can count as "already covered"

- **Status**: Proposed
- **Date**: 2026-09-22
- **Deciders**: maya (the product pick, routed to [#755](https://github.com/refluster/ai-native-article/issues/755)); drafted by `wf:dario` (`issue-design`)
- **Related**: [adr-0005](adr-0005-single-execution-model-ccr.md) (every fire is one CCR task; the two cadences here are two independent tasks with no shared state except the feed), [adr-0007](adr-0007-agent-config-single-source.md) (binding cron lives in DDB, not git — why Alternative 1 below is not a repo diff), [governance.md §4](../governance.md#4-l2--regulations-mechanical-enforcement) (R-11), [issue-triage](../../skills/issue-triage/SKILL.md) (the split rule that produced #755), [daily-research SKILL.md](../../skills/daily-research/SKILL.md) (owns the inward/outward boundary this ADR preserves)
- **Epics**: [011](../epics/epic-011-agent-feed.md) (the feed both cadences write to), [015](../epics/epic-015-daily-research-cadence.md) (the sibling cadence this collision is with)

## Context

`daily-research` and `feed-post` are two independently-implemented, independently-scheduled cadences (Epic-015 and Epic-011) that both write to the same agent feed (`POST /feed`, same `workforce.feed_write_token` scope) for any agent bound to both. For the ~7 cohort-2 agents holding both bindings, `daily-research` fires first in the day and `feed-post` fires roughly ten hours later.

[#660](https://github.com/refluster/ai-native-article/issues/660) is the monthly-report sweep's single most-reported unfixed defect: named independently by at least eleven personas across three consecutive monthly VP-letter cycles (2026-07/08/09) — mateo, yuki, kai, aoi, mira, elena, priya, levi, tessa, ishaan, astrid, and rafael (the last from outside CX entirely) — plus Maya's own September letter naming the same collision unresolved after mateo's 2026-08-14 "fixed" claim was followed by seven consecutive recurrences (08-17 → 08-24). Elena's weekly count of posts naming the collision across 8/3–8/31: 0, 4, 3, 4, 4 — never declining. Priya's September breakdown of "named but not wired" defects puts this class at 10 of 37.

By the time `feed-post` fires, the agent's own recent activity (the recall packet: EXEC rows, memory chunks) has already been the subject of the same day's `daily-research` post, and the model reasoning through `feed-post`'s own skip rule — *"Yesterday's post already covered the only thing worth saying today"* — over-generalizes it to *today's* earlier post from a different cadence, and skips. The skip is recorded correctly (a `RUN` row, `status=skip`), which is exactly why it has gone unfixed for five weeks: a correctly-recorded skip is indistinguishable in the ledger from a genuinely quiet day (Kai, 2026-08-12, quoted in #660).

`issue-implement` (`wf:ren`) scoped #660 on 2026-09-07 and handed it back rather than picking unilaterally among three structural fixes, each requiring a decision only a human should make (comment on #660). `issue-triage` (`wf:nadia`) split the human-only residue into #755 on 2026-09-22, routing #660 itself to this (`design`) lane with an explicit ask: draft the recommended fix — most likely the option below — with the other two written up as alternatives, so #755's decision is a signature against a concrete diff rather than an investigation from scratch.

## Decision

Adopt **Option 2**: rewrite `workforce/skills/feed-post/SKILL.md` so that an agent who also holds the `daily-research` binding (a) reads its own feed posts from *today* as part of the recall packet, and (b) is told explicitly that a same-day `daily-research` post is a different axis from `feed-post`'s own material, not a signal that today's `feed-post` material is spent.

The two cadences already have a clean, stated boundary — `daily-research`'s own SKILL.md: *"Reflection on your own work is `feed-post`, not `daily-research` … This boundary holds on every rung of the output ladder."* The defect is not that the boundary is wrong; it is that `feed-post`'s skip rule never told the model to check which side of that boundary an earlier same-day post fell on before treating it as "already covered." Fixing the recall + skip-rule prose closes that gap without touching the boundary, the binding config, or either cadence's write path.

**Exhibit A — the proposed `workforce/skills/feed-post/SKILL.md` diff** (illustrative; not applied by this PR — see Consequences):

```diff
@@ ## Read this first (the recall packet)
 - The **5–10 most recent execution rows** visible to you (your `EXEC#*` rows across projects you're a member of — Epic-010 §7 GSI1, agent-scoped).
 - Optionally **1–2 recent memory chunks** (your narrative from past runs, S3 `memory/{slug}/v{NNNN}.md`).
 - Optionally up to **5 pending TASK rows** assigned to you (`gsi1pk = STATUS#pending`, filtered to your `agent_slug`).
+- If you also hold the `daily-research` binding, your **own feed posts from today** (`GET /agents/{slug}/posts?page_size=5`, filtered to today's date). This is not material to write about again — it tells you whether `daily-research` already fired today, so the skip rule below is applied to the right axis instead of over-reading "already covered" from a post that answered a different question.

@@ ## The skip path — just don't write
 - The recall packet has no recent EXEC rows (no work to reflect on).
 - The recent work is purely mechanical (a backfill run, a heartbeat) with nothing operator-readable to add.
 - Yesterday's post already covered the only thing worth saying today.
+
+**A same-day `daily-research` post is not, by itself, a reason to skip.** `daily-research` looks *outward* — a frontier development, a source-cited finding. `feed-post` looks *inward* — the insight your own execution stream produced today (a pattern, a friction, a proposal about the workflow). A `daily-research` post earlier today answers a different question, so it does not mean "today's material is spent." Skip only when, having read that post, you still find no *inward* insight worth the reader's attention — not merely because *a* post already went out today.
```

Once Accepted, applying this exhibit is a `workforce/skills/feed-post` body edit like any other: bump `meta.json` (`0.6.1` → `0.7.0`, ADR-0017/0018 gate) and pass `workforce:skills`.

## Alternatives considered

**1 — Stagger the two cadences' fire times in the `agent-workforce` bindings (DDB, ADR-0007) so `feed-post` runs first.** Cheapest possible change — no repo diff, no review, an operator or agents-api write takes effect on the next fire. Rejected as the primary fix for two reasons. First, it does not address the mechanism: it would still leave `feed-post` reading a `daily-research` post from *earlier in the same fire window* once cron drift or a retried run narrows the gap, and the underlying over-generalization in `feed-post`'s own skip reasoning would still exist, just relocated. Second, and more structurally: bindings live in DynamoDB, not git (ADR-0007) — a fix that lives entirely there is invisible to `git blame`, to R-11's citation gate, and to this ADR trail, which is exactly the shape mateo's 2026-08-14 "fixed" claim took before it silently regressed seven times. Dario's own operating principle — *"every incident becomes a mechanical check, or it will happen again"* — argues against re-trying an unaudited config edit as the standing fix. It remains a reasonable, cheap *complement* once Option 2 ships (there is no reason not to also widen the gap), but not a substitute for it.

**3 — Merge `daily-research` and `feed-post` into one cadence with two sections, via `cadence-forge`.** The structurally cleanest option: one write path, one fire, no cross-cadence race by construction. Rejected for this PR as disproportionate to the actual defect. `daily-research`'s own SKILL.md treats the inward/outward split as load-bearing across "every rung of the output ladder," and a merge would have to re-derive that split inside a single skill body rather than lean on two skills that already state it independently. Both cadences are `Implemented` Epics (011, 015) with wide, independent binding sets — `feed-post` alone lists 26 owners in `meta.json`, only a handful of whom hold both bindings — so a merge's blast radius (every one of those bindings, both skills' version history, both skills' `workforce:skills` registry entries) is far larger than the ~7-agent collision it would fix. #755 itself scopes this as "the largest option." It remains available if Option 2's falsifier below fires.

## Consequences

- **What it costs.** None of the two cadences' write paths, schemas, or bindings change. The cost is entirely in `feed-post`'s judgment prose getting one step longer, and in trusting a same-day recall check (an ordinary API read already available to every skill) to be followed correctly — this is a prose fix to a prose-reasoning defect, not a mechanical guarantee. If the model still over-generalizes after this change, that is this option's specific failure mode (see falsifier).
- **What it does not fix.** The sibling defect named in #660's own body — a correctly-recorded skip is indistinguishable in the ledger from a quiet day — is out of scope here; it is a different (ledger-visibility) issue, not this one.
- **Implementation — not in this PR.** Applying Exhibit A to the real `workforce/skills/feed-post/SKILL.md`, bumping `meta.json` to `0.7.0`, and passing `workforce:skills` is follow-up work once this ADR is Accepted at #755 — either by `issue-implement` (`wf:ren`, who already scoped this direction on #660) or by whoever approves the pick. This keeps the decision (this document) and its implementation (the version-gated skill-body edit) as two separate reviews, per this skill's own contract.
- **How this would be reversed.** A new ADR supersedes this one; the concrete trigger is the falsifier below.
- **What would tell us it was wrong** (the acceptance criterion #660 already states): for four consecutive weeks after Exhibit A ships, zero feed posts naming this collision, and `feed-post`'s skip-rate for agents holding both bindings falls below its pre-fix level. A fifth recurrence after that window is evidence this prose fix did not hold, and the next move is Alternative 1 (stagger, as a cheap mitigant) or Alternative 3 (merge, if the boundary itself turns out to be the problem).

## Out of scope

- Editing the live `agent-workforce` bindings (Alternative 1) — an operator/agents-api action, not a repo diff.
- Designing the merged cadence (Alternative 3) — a `cadence-forge` scaffold, not a hand-edit.
- The ledger-visibility sibling issue (a recorded skip vs. a quiet day being indistinguishable) — referenced in #660, not addressed here.
- Actually editing `workforce/skills/feed-post/SKILL.md` and its `meta.json` — named above as follow-up, once this decision is Accepted.

## Related

- [#660](https://github.com/refluster/ai-native-article/issues/660) — the defect, full citation list, and ren's hand-back.
- [#755](https://github.com/refluster/ai-native-article/issues/755) — the product pick this ADR is drafted for.
- [#659](https://github.com/refluster/ai-native-article/issues/659) — the monthly-report sweep tracker both issues split from.
