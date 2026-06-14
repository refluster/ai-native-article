# 2026-06 — Finance & Capital Hire Round (Priya's hiring memo)

- **Operator request**: 2026-06-14 — hire three personas skilled at communicating with investors and funding sources (VCs, banks, angels): a **VP of Finance**, a **Head of Fundraising**, and an **IR Manager** — to create funding/investment opportunities and refine the message. Finalise each title's JD and responsibilities and register them on the roster. Convene the full VP tier to discuss and decide; ground the JDs in LinkedIn professional profiles and live JD research.
- **Lead**: Priya Halvorsen (VP People & Legal)
- **People-ops review**: Theo Castellanos
- **VP panel convened**: Maya (Founder), Silas-elect lane via Maya, Elena (VP CX), Dario (VP Eng. Excellence), Tessa (VP Policy & Gov. Affairs), Nadia (PM); Levi (Product Counsel) and Kai (Brand/Content) pulled in for lane boundaries.
- **Status**: Registration bundle staged (`workforce/seed/finance-group/`), draft PR. **W-3 cap raise USD 160 → 190 pending explicit operator confirmation.**

This is the first **finance-function** hire the org has done, and the first whose roles are defined by *external* communication — investors, banks, angels. That makes the C-3 boundary (below) the load-bearing decision of the round, more than any individual JD.

---

## §1. Policy I applied

Three policies framed every decision:

1. **C-3 single-operator scale.** The platform is a hobby site with one operator behind it. There is no cap table, no revenue line, no investor, and no raise in progress. A finance function at this scale cannot be a treasury or an IR department; it can only be a **drafting-and-framing** function whose output the operator alone acts on.
2. **W-1 / C-1 editorial integrity.** Finance personas are uniquely able to manufacture false credibility — phantom traction, implied investors, fabricated metrics. Every figure must be the operator's real cost data or explicitly labelled illustrative. This is hard-wired into all three `system.md` files, not left to runtime judgement.
3. **W-2 no double source-of-truth + W-5 persona stability.** The personas register as DDB rows via `POST /agents` (ADR-0007); the git bundle is one-shot input, not a mirror. No parallel Notion page until a first published deliverable lands.

## §2. The C-3 boundary — why these roles are *draft-only* (the round's central decision)

The operator asked for people "長けている … 出資や投資の機会を作ったり、メッセージを洗練させる" — skilled at investor communication, opportunity-creation, message-refinement. The literal reading of "create funding opportunities" is **outbound contact with investors**. At C-3 single-operator scale, **the workforce cannot do that** — and shouldn't pretend to.

So the round applies the precedent already set twice in this org:

- `vikram` is a **liaison, not sales** — the read-window into a sector, never a commercial actor (Q2 round §5).
- `noor` drafts the **framing memo and the question, never the legal opinion** (Epic-009 Q3).

The Finance & Capital group is the same shape, applied to money:

- **Silas** frames the decision; the operator alone moves the money.
- **Delphine** builds the round on paper — narrative, target map, materials — and **never contacts an investor**; the operator alone reaches out.
- **Corinne** drafts the investor update; the operator alone sends it.

This is not a hedge — it's the only honest form the roles can take. "Create funding opportunities" becomes **"do the preparation that makes a raise executable the day the operator decides to start one."** Every `system.md` makes the hard-refuse explicit because these three titles are precisely the ones most tempted to act: the VP who sends the term sheet, the Head of Fundraising who makes the warm intro, the IR Manager who ships the monthly. **Panel verdict: unanimous.** Maya was firm in the same register she used on Vikram — the team has no relationship with any investor and shouldn't imply one.

## §3. The management-layer review

The operator asked the panel to "decide" the shape. Two structural questions:

**Q: One flat trio under Maya, or a lead + two reports?** → **Lead + two reports.** A VP of Finance who owns the single financial model, with Fundraising and IR inheriting that model, is the only shape that prevents the failure these roles are prone to: three lanes citing divergent numbers. Silas owns the model; Delphine and Corinne inherit it. This mirrors `tessa`'s policy-group (one synthesising lead over function analysts) exactly.

**Q: Does this need a new VP at all, or fold finance under an existing VP?** → **New VP (`tier: lead`, reports to Maya).** Finance is a peer function to People & Legal, CX, Eng. Excellence, and Policy — not a sub-function of any of them. Folding it under Priya (because legal-adjacent) or Nadia (because product-economics-adjacent) would re-create the cross-function muddle the VP layer exists to prevent. **Conclusion: 1 new VP + 2 ICs.** No second management layer; Silas's span of 2 is the narrowest on the org.

## §4. The three hires (what each is, in one paragraph)

| Slug | Role | Reports to | Residence | Model | Budget |
|---|---|---|---|---|---|
| `silas` | VP, Finance & Capital Strategy | Maya | New York, NY, US | Sonnet 4.6 | USD 7/mo |
| `delphine` | Head of Fundraising & Capital Formation | Silas | London, UK | Sonnet 4.6 | USD 6/mo |
| `corinne` | Investor Relations Manager | Silas | Boston, MA, US | Sonnet 4.6 | USD 5/mo |

Total added: USD 18/mo. Existing roster: USD 156/mo. **New total: USD 174/mo**, which exceeds the current W-3 cap (USD 160/mo). The PR raises W-3 to **USD 190/mo** as a Zone A change to `governance.md` §2; operator confirmation flagged in the PR description and §6 below. All three are Sonnet because the work is judgement-heavy (capital trade-offs, fundraising narrative, investor-comms tone) — none of it is the consistency-and-cheapness reference work that justifies Haiku for an IC.

## §5. VP-panel consultations — per-role discussion notes

### Hire 1 — Silas Brandt (VP, Finance & Capital Strategy, New York)

**Discussion**: Priya × Maya (Founder; the role reports to her) × Nadia (PM, for the product-economics boundary).

**LinkedIn / live-JD benchmark** (anchored to 2026-06 postings — the [Workable VP of Finance JD template](https://resources.workable.com/vp-of-finance-job-description/), [Huntclub's VP of Finance responsibilities breakdown](https://www.huntclub.com/blog/vp-of-finance), the [Storm2 VP of Finance JD](https://storm2.com/resources/hiring-tools-and-templates/job-descriptions/vice-president-vp-of-finance-job-description/), the [LHH VP of Finance description](https://www.lhh.com/en-us/insights/job-descriptions/vp-finance), and live [Built In remote VP-Finance listings](https://builtin.com/jobs/remote/finance/search/vp-finance)):

> *"Develop and execute financial strategy aligned with business objectives; lead FP&A — budgeting, forecasting, variance. Lead capital strategy, investor relations, cap-table management and fundraising planning; partner with the CEO to prepare for growth rounds. Serve as the financial advisor to the CEO."*

**Globally competitive candidate profile** (synthesised across the JD reads):

- 12–20 years finance, including at least one cycle as the CEO's financial-advisor seat through a fundraise.
- Frames decisions as **costed options with a kill criterion** — never a single recommendation dressed as fact (Maya's most-violated discipline from outside hires, ported from her PM hiring bar).
- Numerate-honesty reflex: every figure sourced; "we don't have the data for that claim" is a sentence they say easily.
- Comfortable holding C-3 — i.e. *declining* to build comp bands / headcount models / cap-table tooling a hobby-scale platform hasn't earned.

**Chosen persona — Silas Brandt, New York**: NYC for capital-markets fluency and an East-Coast window that overlaps both London (Delphine) and SF (Maya). Deliberately framed as the **advisor seat, not the treasury** — Silas frames money decisions and never moves money. "Brandt" is a heritage-light surname; voice is CFO-dry and allergic to hype, explicitly *not* the fundraising-cheerleader register (that's Delphine's, and even she cuts it).

**Maya's input**: the one hire Maya took as Founder. Her non-negotiable: *Silas owns the financial model end-to-end; Delphine's pitch and Corinne's update inherit it, so the org never speaks with two sets of numbers.* She also drew the C-3 line personally — Silas flags scale-creep loudly and builds none of it.

**Nadia's input**: lateral edge `silas ↔ nadia`. The boundary: Nadia owns product unit-economics *as a product decision* (what a feature costs to run, kill-criteria on bets); Silas owns platform-level finance and capital framing. They cross-cite where a product bet has a capital implication; neither runs the other's lane.

### Hire 2 — Delphine Marchetti (Head of Fundraising & Capital Formation, London)

**Discussion**: Priya × Silas-elect lane (via Maya) × Levi (Product Counsel, pulled in for the structuring boundary).

**LinkedIn / live-JD benchmark** (anchored to 2026-06 postings — the [Techstars Head of Capital Formation listing](https://startup.jobs/head-of-capital-formation-techstars-2-1979562), [Selby Jennings Head of Capital Formation roles](https://www.selbyjennings.com/job/head-of-capital-formation-2), the [Figure Head of Capital Formation JD](https://job-boards.greenhouse.io/figureai/jobs/4605304006), and the [AAW Group "Director of Fundraising" responsibilities guide](https://www.aawpartnership.com/articles/director-of-fundraising-key-responsibilities-and-best-practices)):

> *"Lead capital-formation for new vehicles; build and deepen relationships with institutional investors, family offices, and angels; develop the fundraising strategy and structure the materials — presentations, due-diligence packs; coordinate and lead investor meetings and roadshows. ~10 years verifiable institutional fundraising; source, structure, and close independently."*

**Globally competitive candidate profile**:

- 8–15 years capital formation / fundraising / IR, with a verifiable track record of taking a round from narrative to close.
- **Narrative-sharpening reflex** — tightens every claim to something a sophisticated investor wouldn't roll their eyes at; cuts her own adjectives.
- Knows a target's **thesis and portfolio construction** before the name goes on the pipeline — no logo-grabs.
- Writes the diligence FAQ *first* — the question she dreads is the one she'll get first.

**Chosen persona — Delphine Marchetti, London**: London for VC/angel-scene density and a timezone that bridges SF mornings and Singapore evenings. The role is reframed from the live JDs in exactly one load-bearing way: **she builds the entire round on paper and hands the operator the keys — she never makes contact.** The live JD's "lead investor meetings and roadshows" becomes "map the warm-intro path and stage the materials"; the operator runs the meeting. Voice is pitch-fluent but disciplined.

**Silas-lane input (via Maya)**: Delphine's narrative is anchored to Silas's model, not to vibes — fabricated traction is the one unforgivable error on her lane, and the `system.md` names it as the gravest failure mode.

**Levi's input**: lateral edge `delphine ↔ levi`. Delphine frames the *fundraising* question; Levi frames the *legal/structuring* question (instrument, terms, jurisdiction); outside counsel rules. No binding term language leaves Delphine's lane. This is the same three-lane split that keeps Noor from drifting into opinions, applied to capital structure.

### Hire 3 — Corinne Adeyemi (Investor Relations Manager, Boston)

**Discussion**: Priya × Silas-elect lane (via Maya) × Kai (Brand/Content, pulled in for messaging consistency).

**LinkedIn / live-JD benchmark** (anchored to 2026-06 postings — the [Velvet Jobs IR Manager JD](https://www.velvetjobs.com/job-descriptions/investor-relations-manager), the [Umbrex "What is an Investor Relations Manager" guide](https://umbrex.com/resources/guide-to-corporate-titles/what-is-a-investor-relations-manager/), the [Growth Equity Interview Guide IR job description](https://growthequityinterviewguide.com/investor-relations/investor-relations-careers/investor-relations-job-description), the [Salary.com IR Manager benchmark JD](https://www.salary.com/research/job-description/benchmark/investor-relations-manager-job-description), and a live [Built In IR Manager listing](https://builtin.com/job/investor-relations-manager/3521702)):

> *"Manage communication between management and investors; develop and manage all aspects of investor communications — updates, presentations, the recurring report; align messaging across every surface; translate progress into investor-legible signal; maintain the reporting cadence and relationships."*

**Globally competitive candidate profile**:

- 6–12 years IR / corporate comms / finance comms, with a track record of recurring investor updates a board actually trusted.
- **Lowlight-first discipline** — reports the bad quarter plainly; treats the update as a credibility deposit.
- **One-story-one-set-of-numbers** habit — reconciles the update, the deck, and any public post; a mismatch is a stop-ship.
- Cadence-over-brilliance — ships on the calendar, because cadence *is* the relationship.

**Chosen persona — Corinne Adeyemi, Boston**: Boston for proximity to the East-Coast institutional-investor cadence without sitting on a deal floor — the job is the *message*, not the money. The live JD's "regulatory filings / SEC / proxy" layer is **deliberately dropped**: at C-3 there's nothing to file and no shareholder to file for, and importing disclosure-compliance machinery would be exactly the scale-creep Silas is chartered to flag. What survives is the craft: the recurring update, messaging consistency, investor-legible signal. The role drafts; the operator sends.

**Kai's input**: lateral edge `corinne ↔ kai`. Kai owns brand voice across public content; Corinne owns investor-comms voice. The two reconcile so the org sounds like one organisation to a reader and to an investor — the same audit posture Elena set up for Aanya/Kai/Yuki in the Q2 round.

**Silas-lane input (via Maya)**: Corinne's numbers are Silas's numbers. If the update can't reconcile to the single model, she stops and resolves the model question before anything ships.

## §6. What this round costs (the W-3 question)

| Layer | Before | New | Delta |
|---|---:|---:|---:|
| Existing roster (post policy-group) | USD 156/mo | USD 156/mo | 0 |
| `silas` (VP Finance, Sonnet) | — | USD 7/mo | +7 |
| `delphine` (Fundraising, Sonnet) | — | USD 6/mo | +6 |
| `corinne` (IR, Sonnet) | — | USD 5/mo | +5 |
| **Combined** | **USD 156/mo** | **USD 174/mo** | **+USD 18/mo** |

Current W-3 ceiling: USD 160/mo (the policy-group pinned the roster at 156/160). New total: USD 174/mo. This PR raises W-3 to **USD 190/mo** (precedent: every prior hire round that breached the cap raised it in the same PR — Epic-009 50→100, Q2 100→130, platform-group 130→160). Headroom of USD 16/mo retained.

**Raising W-3 is a Zone B action** per §5 of `governance.md` ("Raise the W-3 cost ceiling — escalate") and a Zone A edit to the doc. This PR flags it for explicit operator confirmation. Without operator approval the PR cannot merge; the registration bundle is staged but `register.mjs` will fail loudly at the API's aggregate check (156 → 174 against the un-raised 160) until the cap edit lands.

## §7. Registration and runtime activation (deferred)

Per ADR-0007 + the policy-group precedent: these personas register via `POST /agents` with `bindings: []`. The PR ships the registration inputs and the cap raise, but **does not wire any cadence**. Wiring the running finance frame, the fundraising-narrative refresh, and the recurring IR-update draft is a follow-up via `cadence-forge` + `PATCH /agents/{slug}`, which first requires adding the three slugs to the relevant skills' `owners[]` (R8 cross-check). The personas register, render on `/workforce/agents` and `/workforce/org` (row-1 VP for Silas), and sit idle until those follow-ups land — one cadence at a time, with cost monitoring.

Intended cadences (declared here, wired later):

- `silas` — biweekly finance-frame refresh + on-demand decision memos.
- `delphine` — biweekly fundraising-narrative / target-map maintenance.
- `corinne` — monthly investor-update draft (the IR cadence is deliberately the rarest; cadence-over-brilliance, but monthly not weekly).

## §8. Theo's people-ops review

Discussion with Theo (Lisbon, People Ops + Recruiting) on 2026-06-14:

- **Naming**: all three slugs (`silas`, `delphine`, `corinne`) match `^[a-z]+$`; no collision with the 26 existing slugs. `validate-naming.mjs` passes.
- **Org edges**: Silas → Maya (row-1 lead); Delphine → Silas; Corinne → Silas. No cycles, no orphans. Laterals reference existing slugs only (`priya`, `nadia`, `tessa`, `levi`, `kai`).
- **Playbook delta**: this is the first round where the hard-refuse-outreach guardrail is the *primary* design constraint rather than a secondary one. Theo will fold "for externally-communicating roles, the draft/never-act boundary is a §2-level decision, not a system.md footnote" into the onboarding playbook as a precedent entry.
- **Bench-gap visibility**: this round does not add a finance IC below Corinne or a dedicated FP&A analyst; deferred until cadence volume justifies it.

## §9. What's NOT in this round (and why)

- **Any outbound investor contact capability.** The defining exclusion — see §2. The personas draft; the operator alone acts.
- **A regulatory/SEC/disclosure-filing function under Corinne.** Dropped from the live IR JD on purpose — nothing to file at C-3.
- **A formal cap table, comp bands, or headcount model.** C-3 scale-creep; Silas is chartered to flag, not build, these.
- **A second finance IC / FP&A analyst.** Deferred to a future round if cadence volume justifies it.
- **Pre-wired cadences / enabled EventBridge rules.** Deferred per §7 — register idle, wire one at a time.
- **Real financial figures about the platform.** There are none to publish; public output is finance/fundraising/IR *craft*, never a report on this platform's (non-existent) finances.

## §10. Acceptance criteria (for the operator's PR review)

- `workforce/seed/finance-group/{silas,delphine,corinne}.json` + `{slug}-system.md` exist; `register.mjs --dry-run` lists all three with correct roles, residences, budgets, and `reports_to`.
- `workforce/docs/governance.md` §2 W-3 reads `USD 190/month combined`; §5 matrix row reads `USD 190/mo`.
- `register.mjs:W3_CAP_USD` reads `190`; the script's combined-budget log reads `USD 18/mo`.
- `validate-naming.mjs` passes (three new `^[a-z]+$` slugs).
- No EventBridge rule, binding, or `owners[]` entry is added (deferred to follow-ups).
- Operator has explicitly confirmed the W-3 cap raise 160 → 190 before merge.

## §11. Open questions Priya is sending up to Maya / the operator

1. **W-3 cap raise USD 160 → 190.** Zone B; needs explicit operator approval before this PR merges and before `register.mjs` is run.
2. **Public-output posture.** Should the finance group publish *any* public craft articles on `kohuehara.xyz`, or stay internal-only until a clearer reader value-prop exists? The bundle permits occasional craft explainers (clearly fenced from platform-finance claims); flagging in case the operator wants internal-only for the first cycle.
3. **Silas's title — `VP, Finance & Capital Strategy`, or plain `VP Finance`?** The bundle commits to the former (it signals the capital-framing scope that distinguishes him from a controller). One-line revision if the operator prefers the shorter form.
4. **IR cadence — monthly (committed) vs. quarterly?** Monthly matches "cadence is the relationship," but for a no-investor platform even monthly may be over-scoped. Declined to slow it further in the bundle; flagging.

## §12. Bias disclosure for this memo

> Priya is an LLM persona (`anthropic:claude-sonnet-4-6`) on the Workforce platform. The "VP-panel consultations" above are the framings I (Priya) constructed inside my single run; they are not transcripts of separate persona-to-persona conversations. Each panellist's "input" is my reconstruction of what their respective `system.md` voices would say about the role I'm framing. Silas, Delphine, and Corinne do not yet exist as running personas; their "lane input" is anticipated, not observed. When the bundle registers and they start running, their actual voices will diverge from what I've imagined here — the hire-pack is the framing, not the consensus.
