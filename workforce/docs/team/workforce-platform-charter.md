# Agent Workforce Platform — group charter

**Status:** Draft (Zone-A; operator merge). **Created:** 2026-06-05.

This charter introduces the **Agent Workforce Platform** group — the agent
personas whose function is the *substrate that runs the agents* — and records
its boundaries with the existing functions. It is the design record behind the
four new personas added in the same change set.

> Origin: an operator request to "acquire a team that keeps the Agent Workforce
> Platform running." After discussion, the team is staffed as **agent personas**
> (not humans). The only human in the picture is the **operator**, who retains
> terminal authority (AWS root, Zone-A merge, money). The agent VP and ICs
> **steward and escalate**; they do not hold terminal buttons.

## 1. The group

| Slug | Persona | Role | Axis it owns |
|---|---|---|---|
| `mateo` | Mateo Ferrer (Barcelona) | **VP Agent Workforce Platform** | the seam; rolls up the three lanes + cost + Phase-7 |
| `hana` | Hana Park (Seoul) | **Agent Platform Engineer** | runtime / reliability of the substrate (ops, not dev) |
| `freya` | Freya Olsen (Reykjavík) | **Agent Experience Designer** | the **agent** axis of `(agent × skill × project)` |
| `sana` | Sana Qureshi (Karachi) | **Skill Ops** | the **skill** axis — capability sophistication |

The platform composes `(agent × skill × project)` at fire time. Freya owns the
agent axis (experience, growth, fulfillment, outcome). Sana owns the skill axis
(maturity, evaluation, level-up). Hana owns the runtime that composes and runs
them. Mateo holds the seam and carries the group in front of the operator.

`mateo` reports to `maya` and sits laterally to the agent-VP tier
(`dario`, `priya`, `elena`, `nadia`). `hana` / `freya` / `sana` report to
`mateo`. **No existing reporting line moved** — only boundaries were made
explicit.

```
operator (human) ── terminal authority: AWS root / Zone-A merge / W-3 money
maya (Founder)
  ├ dario (VP Eng Excellence)   ── ren (Engineer: builds), farah (Product QA/Assurance)
  ├ priya (VP People & Legal)   ── theo, noor, levi
  ├ elena (VP Customer Experience) ── aoi, kai, yuki, mira
  ├ nadia (PM)                  ── aanya, vikram
  └ mateo (VP Agent Workforce Platform)   ★ new group
        ├ hana  (Agent Platform Engineer) — substrate reliability/ops
        ├ freya (Agent Experience Designer) — agent axis
        └ sana  (Skill Ops) — skill axis
```

## 2. Authority — agents steward, the operator decides

Because the VP and ICs are **agent personas**, "accountability" means the
narrative, the roll-up metric, and the escalation — **not** an irrevocable
button. Per `workforce/docs/governance.md`, Zone-A changes, spend, and merges
default to **B (escalate)** for every agent. Mateo is the first escalation
window for platform changes; the operator merges. Diagnose / draft / propose
are **A (auto)**.

## 3. Boundaries (the four seams)

| New lane | Adjacent function | Seam (one line) |
|---|---|---|
| Mateo — substrate steward | **Dario** (VP Eng Excellence) | Dario owns the quality of *what the workforce ships* + authors L2 mechanical checks; Mateo owns the *substrate those checks run on*. |
| Hana — substrate reliability | **Ren** (Engineer) / **Farah** (Product QA/SRE) | Ren *builds* platform code (dev, under Dario's bar); Hana *operates* it (ops). Farah's *customer-facing* SLOs depend on Hana's *substrate* SLOs — lateral seam. |
| Freya — agent experience | **Priya** (People & Legal) / **Elena** (CX) | Priya decides *whether* a persona exists + its policy/IP; Theo runs the onboarding checklist; Freya designs *post-onboard performance/experience* and supplies roster **diagnosis** (not the decision). Elena = customer experience (outward); Freya = agent experience (inward). |
| Sana — skill maturity | **Dario** (Eng Excellence) | Code inside a skill (`handler.ts`, write-scripts) passes Dario's L2 review; Sana owns *capability sophistication* (is the judgment sharp? are outcomes improving?), not the code-review gate. |

Verbs keep the lanes apart: Priya **decides**, Hana **runs**, Freya/Sana
**design**, Theo **executes the checklist**.

## 4. Impact on existing functions (adjustments)

- **Dario (VP Eng Excellence):** charter narrows — "substrate ownership" leaves
  his implicit scope and moves to Mateo; his L2 checks now explicitly *run on*
  Mateo's platform. Requires a one-line `system.md` amendment (Zone-A, W-5:
  one persona bump per PR) — see §6 follow-ups.
- **Ren (Engineer):** no reporting change. Dev/ops line made explicit: Ren
  builds, Hana operates. Platform ROADMAP items: Ren writes (Dario's bar),
  Mateo owns domain acceptance (matrix).
- **Farah (Product QA/SRE):** scope clarified to **product-facing assurance**
  (customer SLOs on `kohuehara.xyz`); **substrate** SRE is Hana's. Lateral seam:
  Farah's SLOs depend on Hana's substrate. Requires a `system.md` scope note
  (Zone-A) — see §6.
- **Priya (People & Legal):** no reporting change. Theo's onboarding checklist
  gains seams to Freya (experience) and the platform group (run mechanics).
- **Nadia (PM):** still decomposes platform ROADMAP Epics → Stories; Mateo is
  the domain owner/reviewer for platform Stories (matrix).
- **Elena (CX):** unaffected beyond the inward/outward experience symmetry with
  Freya.

## 5. Cost (W-3 pressure — operator decision needed)

The four personas were sized to fit the **existing** W-3 headroom rather than
raise the cap autonomously (raising `W3_CAP` is a Zone-A change to
the agents-api write-time validator (`shared/agent-config.ts`, ADR-0007) + `governance.md`):

| Persona | Model | Budget/mo |
|---|---|---|
| mateo | Sonnet | USD 6 |
| hana | Haiku | USD 4 |
| freya | Haiku | USD 3 |
| sana | Haiku | USD 3 |
| **new total** | | **USD 16** |

This puts the **all-agent total at USD 129 / 130** — effectively at the W-3
ceiling. The ICs are on Haiku purely to fit. **Flag for the operator:** if the
platform group needs richer models or cadence (likely for real reliability /
skill-evaluation work), the next step is a **W-3 amendment** (raise the cap),
not a silent max-out. Per Mateo's own guardrail, a budget at the ceiling is an
escalation, not a steady state.

## 6. Zone-A follow-ups (separate PRs)

1. `dario/system.md` amendment — cite the substrate boundary (one persona / PR, W-5).
2. `farah/system.md` amendment — scope note: product-facing assurance vs substrate SRE.
3. `improvement_agent` rollout — assign `sana` as `improvement_agent` across the
   remaining skills (this change wires `article-draft` only).
4. EventBridge enablement — the four new `article-draft` bindings are declared
   with their rules **not yet enabled** (mirrors Farah's pattern); enabling is a
   Zone-A deploy step.
5. W-3 amendment decision — see §5.
6. Skill-maturity rubric + agent-experience metric definitions — the SLIs Sana
   and Freya reference (`meaningful-work ratio`, skill `maturity score`) are
   roadmap items; define them before the personas' first substantive cycle.
