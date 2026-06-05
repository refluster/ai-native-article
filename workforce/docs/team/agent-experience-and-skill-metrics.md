# Agent Experience & Skill metrics — design

**Status:** Draft (Zone-A doc; **definitions only** — no computation harness yet). **Created:** 2026-06-05.

Follow-up #6 from the [Agent Workforce Platform charter](./workforce-platform-charter.md). The two new platform-group ICs reference SLIs in their `system.md` that do not yet exist as computed metrics:

- **Freya (Agent Experience Designer)** — `meaningful-work ratio` (the agent axis).
- **Sana (Skill Ops)** — skill `maturity score` (the skill axis).

This doc defines both so they are falsifiable before either persona's first substantive cycle. Per their bias disclosures, until the harness ships (§5) both are computed narratively from observable rows, flagged as inference.

## 1. What we can observe (data sources)

All derived from existing state — no new write path (W-2):

| Source | Field(s) | Doc |
|---|---|---|
| `PROJECT#{id}/EXEC#{ulid}` / `AGENT#{slug}/RUN#{ulid}` | skill, status (ok/threw), tokens, cost_usd, deliverable ref, `ticked_at` | [data-model.md](./../data-model.md) |
| orchestrator dispatch | dispatch vs skip + skip reason (`dedup`, `binding_missing_cron`, `cron_parse_error`) | `workforce/lambdas/orchestrator/handler.ts` |
| W-1 editorial integrity | published vs truncated/empty/artefact | governance §2 W-1 |
| activity feed | `POST#{ulid}` per agent | [data-model.md](./../data-model.md) |

A **dispatched run** is one the orchestrator actually fired into the runner. A **no-op** is a tick that resolved to a skip (dedup window, missing cron) — it consumed a scheduling slot but produced nothing.

## 2. meaningful-work ratio (Freya — agent axis)

**Definition.** Over a trailing window (default **28 days**), the fraction of an agent's *dispatched* runs that produced a **new, W-1-clean deliverable**.

```
meaningful_work_ratio(agent, 28d)
  = meaningful_runs / dispatched_runs

meaningful_run  := status=ok
                   AND produced a deliverable (article | memo | PR | feed post)
                   AND deliverable is W-1-clean (not truncated/empty/artefact)
                   AND not a re-emit of an unchanged prior deliverable
dispatched_runs := runs the orchestrator fired (excludes dedup/missing-cron skips)
```

**Bands** (per agent, interpreted against the binding's expected cadence — not absolute):

| Band | Reading | Action |
|---|---|---|
| healthy | most dispatched runs land clean deliverables | none |
| **low (churn)** | dispatched often, few meaningful — dedup thrash, repeated empty/truncated, re-emits | investigate recall packet / binding cadence / skill (could be skill-side, see §4) |
| **idle** | rarely dispatched at all (cron too sparse, agent paused) | binding/cadence review |

The ratio is deliberately **agent-relative**: a biweekly agent and a 2-hourly agent are judged against their own intended cadence, not a shared threshold. Freya surfaces the *diagnosis*; roster decisions stay with Priya/operator (charter §3).

## 3. skill maturity score (Sana — skill axis)

**Definition.** A per-skill level **L0–L5**, composed of measurable dimensions over the same 28-day window plus static spec checks. Each dimension scores 0–1; the level is the rounded weighted sum mapped to L0–L5.

| Dimension | Source | Signal |
|---|---|---|
| **Outcome quality** | W-1 rate of runs using the skill | clean-publish rate |
| **Success rate** | EXEC status ok / total | does it complete without throwing (W-4) |
| **Cost efficiency** | cost_usd per successful deliverable vs `meta.cost_class` budget | is it within its declared cost shape |
| **No-op rate** | dedup/skip fires attributable to the skill's cadence | is the cadence honest or thrashing |
| **Spec sharpness** (static) | SKILL.md has an explicit skip-rule; `requires[]` resolves; bundled write-script present for `archetype=cadence`; ≥1 worked example | is the judgment contract sharp |

```
maturity_score(skill, 28d) = round( Σ wᵢ · dimᵢ )  → L0..L5
```

- **L0–L1**: unevaluated / failing outcomes / no skip-rule — retire/merge candidate (proposal escalates).
- **L2–L3**: works, within cost, spec present — the steady state.
- **L4–L5**: high clean-rate, sharp spec, improving trend.

Sana is the `improvement_agent` of record (set across skills in the rollout PR) and drives low-scoring skills upward; **retire/merge is a proposal, the decision escalates** (charter §2).

## 4. How they compose (triangulation)

The platform composes `(agent × skill × project)`. A low `meaningful_work_ratio` for an agent has two candidate causes, and the two metrics disambiguate:

- **agent-side** — recall packet thin, binding cadence wrong → Freya's lane.
- **skill-side** — the skill itself produces no-ops / low-clean output (its `maturity_score` is low for everyone who holds it) → Sana's lane.

If a skill's maturity is healthy but one agent's ratio is low, it's agent-side; if the skill is low across all its owners, it's skill-side. Mateo holds the seam.

## 5. Implementation status & proposed harness

**Not yet computed.** Both metrics are definitions today. Proposed implementation (separate B-authority PR, Hana + Sana):

- Extend the existing **`wf-audit` daily tick** (`wf-audit-${Stage}`, already scans `WfTable` for FU-021 truncation/orphan/leak signals) to also emit:
  - `Workforce/Experience` namespace: `MeaningfulWorkRatio` per agent.
  - `Workforce/Skill` namespace: `MaturityScore` per skill + its component SLIs.
- No new state store (R-N2) and no new observability stack (R-N5) — reuse CloudWatch.
- Until the harness ships, Freya's `ax-note` and Sana's `skill-maturity-report` compute these by hand from EXEC rows and flag the numbers as reconstructed inference (their bias disclosures already say so).

**Acceptance for the harness PR:** every agent has a `MeaningfulWorkRatio` datapoint and every registered skill a `MaturityScore` datapoint, both traceable to the EXEC rows they summarise (no un-linkable numbers — W-1/W-4 discipline applied to metrics).
