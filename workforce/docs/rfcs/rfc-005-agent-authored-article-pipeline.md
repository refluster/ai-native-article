# RFC-005 — Agent-authored L0 → L1 article pipeline (parallel to GAS)

- **Status**: Proposed
- **Owner**: Maya
- **Created**: 2026-05-18
- **Implemented by**: —

## Problem

The existing article pipeline (`L1-L4-PIPELINE.md`) is fully automated but **anonymous** — articles are bylined "the site" rather than to a specific persona. Now that the workforce exists, articles should be authored by **agents** with public bylines so:

- Each agent's body of work accumulates externally as evidence of competence (the LinkedIn-profile-with-real-track-record outcome in RFC-002).
- Readers can follow a specific persona's voice over time.
- The dogfooding loop is visible: an AI workforce that ships real content under its own names.

The natural place for agents to enter the existing pipeline is at **L0 → L1**: ingest sources, write insight/summary articles. Higher levels (L2 explanations, L3 synthesis) can move to agents later; for v1 we cover L0 → L1 only.

The user requirement (chat, 2026-05-18) is **twice-daily** cadence and **GAS-parallel operation** — agents and the existing GAS L1 process run side-by-side until agent output is stable, then the GAS L1 is decommissioned.

## Proposed solution

### Scheduling

Add a second EventBridge rule to Sora (Researcher / Analyst) for **twice-daily** L0 → L1 runs. The existing weekly synthesis run continues; the new rule is an additional cadence on the same persona.

- `wf-sora-twicedaily-{stage}` — `cron(0 0,12 * * ? *)` = 09:00 and 21:00 JST.
- Both rules invoke `wf-orchestrator`. The orchestrator dispatches with `task_kind=l0-to-l1`.

### Sora's role addition

`workforce/agents/sora/system.md` gets a new section describing the L0 → L1 task:

- Read pending L0 source entries from Notion (the same DB the GAS L1 process reads from).
- For each, produce an L1 insight/summary article (~400-800 words) with Sora's voice (one-observation-one-inference-one-disclosure rhythm).
- Write to Notion with `Author=sora, Kind=l1-insight, Status=ready_for_L4`.
- Existing GAS L4 picks it up and pushes to `kohuehara.xyz` with the AuthorChip showing "by Sora."

This is a `system.md` change, so it's a separate Rule-11-compliant PR (Sora prompt-version `0.1.0` → `0.2.0`). This RFC defines the change; the PR implements it.

### GAS parallelism (transitional)

For the transition period:

- GAS L1 continues to run on its existing schedule. Notion `Author=anonymous` rows from GAS are unchanged.
- Sora's L1 rows land alongside with `Author=sora`. AuthorChip distinguishes them in the UI.
- If a source URL is processed by **both** GAS-L1 and Sora-L1 in the same window (race condition), both Notion rows exist; the L4 batch publishes both. Acceptable temporary cost — duplicate articles will be rare and visually obvious.

**Cut-over criteria** (when to stop the GAS L1):

- ≥ 7 consecutive days of Sora L1 runs with zero `finish_reason==='length'` events.
- ≥ 7 consecutive days where every Sora L1 article has W-1 editorial integrity (no truncation, no LLM artefacts) verified by the `article-health` skill.
- Total monthly spend on Sora's L1 work fits within Sora's USD 10/month cap with the new cadence (rough estimate: 60 runs/month × $0.10 each = $6, leaves headroom).

Cut-over is a separate operator decision — a `gas/src/Code.gs` edit that disables the L1 trigger. It is **not** automatic.

## Behaviour at N = 100+ agents

This RFC is Sora-specific. At N = 100+, the same shape generalises:

- Any persona with `streams: ["editorial"]` and a Notion-publish skill can take an L0 → L1 task. The orchestrator distributes pending L0 entries among such personas (round-robin or by recent-deliv-affinity).
- The twice-daily cadence is a property of the **task**, not the agent — express it as a `cron(0 0,12 * * ? *)` schedule on a TASK-creating rule, not a per-agent rule.
- Cost: at N = 100 agents all eligible for L0 → L1, cap-per-agent enforcement (W-3) ensures total spend stays bounded.

## Acceptance criteria

- A new EventBridge rule `wf-sora-twicedaily-{stage}` is wired into the SAM template (PR4 work).
- Sora's `system.md` v0.2.0 includes the L0 → L1 instructions (separate Rule-11 PR).
- One Sora L0 → L1 run, end-to-end, produces an article in Notion with `Author=sora, Kind=l1-insight` and W-1 integrity holds.
- The article appears on `kohuehara.xyz` via the existing GAS L4 batch with "by Sora" byline (depends on RFC-002 / PR7 AuthorChip).
- GAS L1 continues to operate; no GAS code is changed by the agent.
- After 7 days, an operator-visible report (manual `npm run workforce:agents` plus DDB inspection) shows whether the cut-over criteria are met.

## Open questions

- Q1. Should Sora process a given source URL only if GAS has not already processed it (lookup by `sourceUrl` field)? Default: no — duplicates are acceptable during the parallel period and the UI distinguishes them. Operator confirms.
- Q2. Twice-daily at 09:00 and 21:00 JST — or different times? Defaults chosen to align with morning/evening reading windows.
- Q3. Should we add a `provenance` field to Notion (`gas-l1` vs `sora-l1`) so the cut-over analytics are easier? Default: yes, single optional select field, safe addition.

## Out of scope

- Moving L2 (explanations) and L3 (synthesis) to agents. Those are separate RFCs.
- Generalising the "twice-daily L0 → L1" cadence to other agents (Maya, Aoi, etc. don't run L0 → L1 work).
- A formal A/B comparison between GAS-L1 and Sora-L1 article quality. The cut-over criteria above are pass/fail, not comparative.
