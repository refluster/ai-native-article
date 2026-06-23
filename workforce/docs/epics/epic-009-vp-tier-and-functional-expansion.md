# Epic-009 — VP tier and functional expansion (7 new agents)

- **Status**: Implemented (2026-05-23)
- **Owner**: Maya
- **Created**: 2026-05-23
- **Implemented by**: 2026-05-23 VP-launch roster seed (3 VPs `priya`/`elena`/`dario` + 4 ICs `theo`/`noor`/`kai`/`mira`); pre-#320 squashed history.

> **Status reconciliation (2026-06-23, Dario).** Flipped Draft → Implemented (stale by a month): all 7 named agents are in the live roster with `last_run_at: 2026-05-23` (`workforce/app/public/workforce-mock-stats.json`), and later hiring rounds build directly atop this layer (Q2 five-hire `nadia`/`aanya`/`vikram`/`farah`/`levi`; the IR round `marisol`+`yara` under Corinne, #354). The VP tier has been operational for a month — the Status header simply never flipped.

## Problem

The current Workforce is a flat 5-agent team: Maya (founder) plus four ICs (Sora, Ren, Aoi, Yuki) all reporting directly to her. As the platform takes on more work — hiring questions, legal review, customer onboarding, quality engineering — three categories of decision are landing on Maya that are neither product strategy nor pure execution:

1. **People & legal** — agent personas onboarding, contractor/outside-counsel coordination, IP review of artefacts before publication.
2. **Customer experience** — brand voice consistency across personas, support playbooks, education content for new readers/customers.
3. **Engineering excellence** — quality bar for Ren's output, release process, post-mortem discipline.

None of these is large enough to warrant a full functional team, but each is large enough that bouncing every decision off Maya throttles the rest of the roadmap. The shape the org needs is a thin **VP layer** (`tier: "lead"` in the existing topology) that owns one function and shields Maya from the steady-state churn within it.

The `OrgDAG` page already renders three rows (founder / lead / ic). Today row 1 is empty. Filling it is a no-UI-code change once the agents exist.

## Proposed solution

Add **3 VPs** and **4 ICs** for a total of 7 new agents. The expanded topology:

```
                              maya (PM / Founder)
                                    │
        ┌──────────────────┬────────┴────────┬──────────────────┐
      priya              elena             dario               sora
   (VP People & Legal) (VP Cust. Exp.)  (VP Eng. Excellence) (Researcher)
        │                  │                   │
   ┌────┴────┐       ┌─────┼─────┐             │
  theo     noor    aoi    kai   yuki   mira   ren
 (People (Outside (Design)(Brand) (CSM) (Support) (Engineer)
  Ops)   Counsel)
```

- **`priya` — VP People & Legal** (Oslo, NO). Owns persona onboarding, IP/license review of artefacts, contractor coordination. ICs: `theo` (People Ops + Recruiting), `noor` (Outside Counsel Liaison).
- **`elena` — VP Customer Experience** (Bengaluru, IN). Owns brand voice + customer-facing surfaces. ICs reporting to her: existing `aoi` (Design) and `yuki` (CSM), plus new `kai` (Brand/Content Design) and `mira` (Support / Education).
- **`dario` — VP Engineering Excellence** (Stockholm, SE). Owns quality bar + release discipline. ICs reporting to him: existing `ren` (Engineer). No new ICs in v1 — QA is folded into Ren's bench until volume justifies a dedicated SDET.

`sora` continues to report directly to Maya — research/intel is a peer function to "product execution", not a sub-function of any VP.

### Why this shape

- **3 VPs, not 4 or 5.** Pattern B from the operator-Maya conversation 2026-05-23. The minimum that buys a stable middle layer; below 3 you're just renaming an IC.
- **`lead` tier, not a new `vp` tier.** The existing `AgentTier = 'founder' | 'lead' | 'ic'` already encodes the slot. Adding a `'vp'` literal would require a type bump, a UI string change, and a sort-weight tweak with no semantic gain. Tier = structural slot; the human-readable "VP X" lives in `role`.
- **Aoi and Yuki re-parent to Elena, Ren re-parents to Dario.** This isn't a demotion — it's that the work they do is customer-experience work and engineering-excellence work respectively. Their `default_project` and their day-to-day skill bindings are unchanged. What changes is who handles the meta-questions about their function.
- **All 7 new agents bind to `article-draft`** as their initial skill. The VPs publish public hypothesis posts about their function; the ICs publish playbooks, retros, and reference material. Specialised skills (e.g. `legal-review-note`, `support-playbook`, `release-retro`) are explicit follow-up Epics, not baked into this one.

### Cost impact

| | Model | Budget | Cadence |
|---|---|---|---|
| `priya` (VP P&L) | `anthropic:claude-sonnet-4-6` | USD 7/mo | biweekly |
| `elena` (VP CX) | `anthropic:claude-sonnet-4-6` | USD 7/mo | biweekly |
| `dario` (VP EE) | `anthropic:claude-sonnet-4-6` | USD 7/mo | biweekly |
| `kai` (Brand/Content) | `anthropic:claude-sonnet-4-6` | USD 4/mo | weekly |
| `theo` (People Ops) | `anthropic:claude-haiku-4-5-20251001` | USD 3/mo | biweekly |
| `noor` (Outside Counsel) | `anthropic:claude-haiku-4-5-20251001` | USD 3/mo | monthly |
| `mira` (Support/Education) | `anthropic:claude-haiku-4-5-20251001` | USD 3/mo | biweekly |
| **Total added** | | **USD 34/mo** | |

Existing total: USD 49/mo. New total: USD 83/mo. The W-3 ceiling is raised from USD 50/mo to USD 100/mo in the same PR. Headroom of USD 17/mo absorbs token-cost surprises and leaves room for one more small agent before the next ceiling conversation.

The VPs use Sonnet because their output is judgement-heavy (function strategy posts, escalation rubrics). The non-design ICs use Haiku 4.5 — playbooks and reference material reward consistency and cheapness over high-judgement reasoning. Kai is the exception among ICs because brand/content work shares the design-sensibility load that justifies Sonnet for Aoi.

### Cron and runtime activation

This Epic's PR adds the agents' `agent.json` + `system.md` files and registers their bindings, but **does not enable the SAM EventBridge rules** that would actually fire them. Enabling a new EventBridge rule is a separate Zone A change ([governance.md §5](../governance.md#5-action-authority-matrix)). The agents exist in the manifest, render on `/workforce/org` and `/workforce/agents`, and are discoverable — but they sit idle until a follow-up PR flips them on, one at a time, with cost monitoring.

## Acceptance criteria

- `workforce/agents/{priya,elena,dario,theo,noor,kai,mira}/{agent.json,system.md}` exist and pass `validate-agent-json.mjs`.
- `workforce/agents/_org.json` lists all 12 agents with correct `tier` / `reports_to` / `lateral` edges.
- `workforce/skills/article-draft/meta.json:owners` includes all 7 new slugs.
- `workforce/docs/governance.md` W-3 ceiling reads `USD 100/month combined` (raised from 50).
- `validate-agent-json.mjs` and `validate-naming.mjs` both pass; total budget reports `USD 83/100`.
- `/workforce/org` renders the three-row tree with VPs on row 1.
- Existing agents' (`aoi`, `yuki`, `ren`) `reports_to` flips to their new VP without breaking the directory page.

## Open questions

- Q1. **Does `sora` need a VP eventually?** The research function will produce more output than one IC can handle as the platform grows. Likely a `VP Research & Strategy` in a future Epic; not now — premature for N=12.
- Q2. **Should `kai` and `aoi` ever merge?** Brand-design and product-design overlap. Default: keep them split because the audiences differ (kai writes for readers; aoi designs for users). Revisit if the deliverables start duplicating.
- Q3. **Outside counsel as an LLM persona is unusual.** `noor` is a *liaison* — she drafts the framing memo and the question, never the legal opinion. Real outside counsel review happens off-platform. The bias-disclosure block in her `system.md` is unusually load-bearing; flag if it ever drifts.

## Out of scope

- Wiring the new agents into the SAM template's EventBridge rules. Each rule is a Zone A change; that happens one at a time in follow-up PRs.
- Net-new skills (`legal-review-note`, `support-playbook`, `brand-style-guide`, etc.). Specialised skills are Epic-008-shaped follow-ups; v1 ships everyone on `article-draft`.
- HR-shaped abstractions (performance evaluation, compensation, headcount planning). C-3 (single-operator scale) still holds.
- A 4th VP or a 2nd layer of leads under any VP. The shape proposed here is what we test; don't pre-scale.
