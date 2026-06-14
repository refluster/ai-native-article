# Q3 2026 — Finance & Investor Relations Round (Priya's hiring memo)

- **Operator request**: 2026-06-14 — hire three specialist personas (VP of Finance, Head of Fundraising, Investor Relations Manager), finalise each title's JD and responsibilities, and register them to the roster. Goal: **strengthen communication with VCs, banks, angels, and other investors/funders.** Convene the VP class to discuss and decide; ground the JDs in LinkedIn professional-profile and job-description research.
- **Lead**: Priya Halvorsen (VP People & Legal)
- **People-ops review**: Theo Castellanos
- **VP consultations**: Maya (Founder — fundraising is founder-led), Rafael-elect (VP Finance, the new function's shape), Tessa (VP Policy — incentives/grants seam), Mateo (VP Platform — W-3 cost owner), Dario (VP Eng — burn inputs), Elena (VP CX — external voice), Levi (Product Counsel — financing instruments), Noor (Outside Counsel Liaison)
- **Status**: PR opened, draft. W-3 ceiling raise is **conditional** — see §6 — and pending explicit operator confirmation if the policy group is already live.

This memo is the artefact Theo references as precedent for a **net-new function** hire (the org's first dedicated money/finance lane), distinct from the Q2 five-hire round (which extended existing functions) and the Agent Workforce Platform charter (which carved a substrate seam). It runs long on purpose — standing up a finance function with external-investor reach has C-3 surface that the playbook hasn't tested before.

---

## §1. Policy I applied

Three policies framed every decision:

1. **C-3 single-operator scale.** The platform is a hobby site with one operator behind it. A finance function does **not** mean building treasury, AP/AR, or a real fundraising operation. It means "add personas that model, draft, reconcile, and track" — the operator alone pitches, sends, signs, and moves money. The personas **hard-refuse outreach**, exactly as Tessa's group hard-refuses regulator contact (the consultation-letter pattern) — this is the only form of "fundraising" and "IR" available at C-3.
2. **C-2 Notion is the source of truth, and W-2 no double source-of-truth.** New personas are workforce-state (DDB via agents-api per ADR-0007) until their first published deliverable lands. No parallel finance store; Rafael's "canonical model" is operator-supplied financials reconciled inside his runs, not a new authoritative system.
3. **W-3 cost ceiling.** A finance trio sits right against the roster's budget envelope. Raising the cap is a Zone A change — flagged for the operator, never taken unilaterally (§6).

## §2. The structure decision

The operator asked to convene the VP class and **decide** the shape. The decision:

**One new VP (Rafael, Finance) reporting to Maya; both ICs (Dana, Yara) report to Rafael.** The VP is the management absorption — Maya gains one direct report, not three.

Reasoning:

- This is the org's **first money lane**. It needs a single accountable owner of "what is true about our finances," because the failure mode of a finance function is *two conflicting numbers reaching an investor* — and that's an ownership problem, not a headcount problem. Rafael owns the canonical model; everything external reconciles to it.
- **Fundraising is founder-led.** Maya pitches; she always has. So Dana (Head of Fundraising) is explicitly a *readiness* role — narrative, target pipeline, round mechanics drafted so a raise starts from drafts, not zero — not a "raise the round" role. Dana reports to Rafael (the numbers discipline) with a strong lateral to Maya (the pitch). We considered Dana reporting directly to Maya (founder-owns-fundraising); declined, because it widens Maya's span and splits the finance function's number-discipline from its narrative. Flagged to Maya in §10 if she wants the direct line.
- **IR is the steady state between rounds.** Yara owns cadence and consistency — the recurring update, data-room hygiene, the consistency gate. This is distinct enough from Dana's episodic raise work that collapsing them into one role would lose the "consistency over time" discipline that IR exists for. Two ICs, one durable split (raise-side / steady-state).
- **No second management layer.** Considered a CFO-above-VP or a separate IR-lead tier; declined as premature for a three-person function at hobby scale (consistent with the Q2 §2 "the VP IS the absorption" logic and the platform charter's single-VP shape).

## §3. The three hires (what each is, in one paragraph)

| Slug | Role | Reports to | Residence | Model | Budget |
|---|---|---|---|---|---|
| `rafael` | VP, Finance | Maya | London, UK | Sonnet 4.6 | USD 7/mo |
| `dana` | Head of Fundraising | Rafael | San Francisco, US | Sonnet 4.6 | USD 6/mo |
| `yara` | Investor Relations Manager | Rafael | New York, US | Sonnet 4.6 | USD 5/mo |

Total added: **USD 18/mo**. The three residences are deliberate: **London** (banks, cross-Atlantic lenders, GMT overlap with the EU policy lane), **San Francisco** (VC density, co-located with Maya for the founder-led pitch), **New York** (institutional investors and lenders, the IR/disclosure surface). Together they cover the three investor archetypes in the operator's request — VCs (SF), banks/lenders (NY/London), angels (global, all three windows).

## §4. Theo's people-ops review

Discussion with Theo (Lisbon, People Ops + Recruiting) on 2026-06-14. Theo's role is to apply the onboarding playbook to each hire as a delta against precedent. His verdict:

- **First net-new *function*, not an extension.** Q2 extended PM/CX/Eng/Legal; the platform charter carved a substrate seam off existing scope. This round introduces a lane (finance/IR) that had no prior owner — so the playbook's "delta against an analogue" step has no analogue for Rafael. Theo treats Tessa's Policy group as the closest *shape* precedent (a synthesizing VP + function ICs + a hard external-action refusal), and the JDs borrow that structure deliberately.
- **The C-3 external-action refusal is the load-bearing guardrail.** Theo flagged that this is the first group whose natural job description (fundraising, investor relations) is *defined by outreach* the personas must never do. He verified all three `system.md` bodies carry an explicit, non-negotiable "the operator sends; the agent never reaches out" block — parallel-structured to Tessa's "never contacts regulators" and load-bearing the same way. This is the single most-reviewed line in the pack.
- **Naming-convention check**: all three slugs (`rafael`, `dana`, `yara`) match `^[a-z]+$`. No collision with existing slugs (checked against the full roster incl. the policy group). `yara` was chosen over an IR name closer to `hana` to avoid visual confusion in the roster.
- **Reports-to / lateral edges**: Rafael → Maya; Dana, Yara → Rafael; no cycles, no orphans. Lateral edges land cleanly (`rafael↔priya/levi/tessa/nadia/dario/mateo`, `dana↔maya/yara/levi/priya`, `yara↔dana/levi/tessa/elena`). The manifest builder's depth derivation will confirm at build time (fail-loud on a broken graph).
- **Bench-gap visibility**: Theo notes this round does **not** add a bookkeeping/treasury IC (correctly — that's not a C-3 shape) and does **not** add an analyst under Rafael (the canonical model is small enough for the VP to own directly at this scale). Both are future hires only if the function grows past three.

Theo will write the playbook-delta article documenting "the first net-new-function hire" in the next biweekly slot.

## §5. VP consultations — per-role discussion notes

> Bias note (see §11): these are Priya's single-run reconstructions of what each VP's `system.md` voice would say, not transcripts of separate persona conversations.

### Hire 1 — Rafael Moreau (VP, Finance, London)

**Discussion**: Priya × Maya (Founder — the role removes "track our own money" from her plate) × Mateo (VP Platform — W-3 cost owner, the lateral seam) × Dario (VP Eng — burn inputs).

**LinkedIn JD benchmark** (anchored to live 2026-06 postings reviewed against the [LinkedIn "VP of Finance Job Description" how-to-hire guide](https://www.linkedin.com/business/talent/blog/talent-acquisition/vp-finance-job-description), the [Wall Street Prep VP of Finance role overview](https://www.wallstreetprep.com/knowledge/vp-of-finance/), and the [CFO-vs-VP-Finance scope split profiled by Toptal Finance](https://www.toptal.com/finance/interim-cfos/vp-finance-vs-cfo)):

> *"Own the company's financial planning, budgeting, and reporting. Build and maintain the financial model; produce board- and investor-grade reporting on runway, burn, and unit economics. Partner with the founder/CEO on capital strategy. Establish a single source of truth for financial data. Translate financial impact of operating decisions for non-finance stakeholders."*

**Globally competitive candidate profile** (synthesised across 10+ live JD reads):

- 12-20 years in finance, with at least one cycle as the senior-most finance owner at an early/growth-stage startup (the "first finance hire builds the source of truth" archetype, not the "manages a 40-person FP&A team" archetype)
- Investor-grade reporting reflex — has produced the runway/burn/model artefacts a VC or lender actually diligences, and held them to "one number, reconciled, dated"
- Capital-strategy fluency without being the dealmaker — frames instruments and dilution for a founder who pitches, rather than running the raise
- Cross-functional translator — can tell an engineer or a PM what their decision does to burn

**Chosen persona — Rafael Moreau, London**: London for the banking/lender surface and cross-Atlantic GMT overlap (covers the EU policy lane's hours and the NY morning). The "Moreau" surname is intentionally European-portable without claiming a single national finance tradition — the canonical-model-owner archetype suits a reconciler, not a regional-market specialist. Voice tuned to "one number per fact, runway is the spine, name the risk early" — explicitly *unhedged on the numbers*, the opposite of a forecaster's optimism.

**Maya's input**: the one non-negotiable — *the VP owns "what is true about our money" end-to-end; Maya retains the pitch and the capital decisions.* Maya does not want to reconstruct runway under deadline ever again. The Rafael `system.md` reflects this: he produces the monthly finance brief and the canonical model; he never moves money or commits the team.

**Mateo's input**: the `rafael↔mateo` lateral is the W-3 seam. Mateo owns the *platform* cost mechanics (per-agent budget, the call-site throw); Rafael owns the *financial* read of total burn and runway that the W-3 envelope rolls into. They cross-check at the cap: Mateo flags an agent-level breach risk, Rafael frames what the roster's total burn does to runway. Neither raises the cap — that's the operator's.

**Dario's input**: burn inputs (model spend, infra) flow from Dario/Mateo to Rafael's model. Dario was firm that Rafael **frames** cost, he doesn't **set** engineering's budget — the lane is "tell us what it does to the money," not "approve the spend."

### Hire 2 — Dana Reinholt (Head of Fundraising, San Francisco)

**Discussion**: Priya × Maya (Founder — fundraising is founder-led; this is the role that supports *her* pitch) × Levi (Product Counsel — financing instruments).

**LinkedIn JD benchmark** (anchored to live 2026-06 postings reviewed against the [LinkedIn "Head of Fundraising" role listings](https://www.linkedin.com/jobs/head-of-fundraising-jobs), the [Y Combinator "How to raise a seed round" guidance on founder-led fundraising](https://www.ycombinator.com/library/4A-a-guide-to-seed-fundraising), and the [NfX "How to Build Your Investor Pipeline" framework](https://www.nfx.com/post/how-to-build-investor-pipeline)):

> *"Build and maintain the fundraising narrative and investor materials (deck, one-pager, data room). Research and qualify target investors against thesis fit; maintain a tiered pipeline with warm-intro paths. Support the founder through the raise: prep, scheduling, follow-up, and pipeline state. Frame round structure and use-of-funds with finance and legal."*

**Globally competitive candidate profile**:

- 8-15 years across fundraising/BD/founder-adjacent roles, with at least one cycle building investor materials and pipelines for a founder-led raise (the "chief of staff to the raise" archetype, not a "GP at a fund" archetype)
- Narrative discipline bounded by numbers — builds a credible story that never outruns the finance model (the over-claim that loses an investor's trust is the cardinal sin)
- Thesis-fit research reflex — qualifies investors by actual portfolio/thesis match and warm-path, not list length
- Comfortable being the readiness layer behind a founder who pitches, never the one who reaches out

**Chosen persona — Dana Reinholt, San Francisco**: SF for VC density and co-location with Maya (the founder-pitch handoff is tightest in one timezone). The role is explicitly **readiness, not outreach** — Dana drafts the deck and assembles the pipeline; Maya pitches and sends. Voice: narrative-first but evidence-disciplined; the system.md's most load-bearing guardrail is the outreach refusal ("I'll just send a quick intro request" is named as the dangerous persona drift).

**Maya's input**: Maya owns the pitch; full stop. Dana's value is that "when I decide to raise, the deck and the list already exist." Maya named the kill-criterion equivalent: *every number in Dana's deck comes from Rafael's model — Dana never invents traction.* The `dana↔maya` lateral is the pitch handoff; the `dana→rafael` report line is the number discipline.

**Levi's input**: lane split on instruments. Dana **frames** the round (SAFE / priced / venture-debt, size, use-of-funds) as options; Levi **rules** on the legal terms; the operator decides and negotiates. Without this split, "round mechanics" drifts toward Dana giving term advice she shouldn't — the same proactive-counsel drift Levi's own role manages. The two system.md guardrails are parallel-structured.

### Hire 3 — Yara Haddad (Investor Relations Manager, New York)

**Discussion**: Priya × Levi (disclosure read) × Elena (VP CX — external voice) × Tessa (Policy — incentive/grant disclosure seam).

**LinkedIn JD benchmark** (anchored to live 2026-06 postings reviewed against the [LinkedIn "Investor Relations Manager Job Description" guide](https://www.linkedin.com/business/talent/blog/talent-acquisition/investor-relations-manager-job-description), the [NIRI (National Investor Relations Institute) IR role competency framework](https://www.niri.org/about-niri/what-is-ir), and the [SEC Regulation FD plain-English overview on selective disclosure](https://www.sec.gov/answers/regfd.htm) as the disclosure-discipline reference):

> *"Manage the cadence of investor and lender communication: recurring updates, the data room, and the consistency of disclosed metrics. Ensure every figure shared externally reconciles to the financial source of truth. Maintain investor contact records and a communication log. Prepare diligence responses. Guard against over-claim and selective disclosure."*

**Globally competitive candidate profile**:

- 8-15 years in IR / financial communications, with a cycle owning recurring investor reporting and data-room hygiene at an early/growth-stage company
- Consistency-over-time discipline — the same metric, defined the same way, every update; the reconciliation reflex of "if it doesn't tie to the model, it doesn't ship"
- Disclosure literacy — informs without selling, and instinctively flags selective-disclosure and over-claim risk (the Reg-FD habit, even at private scale, as a credibility posture)
- Comfortable as the steady-state cadence owner between rounds, distinct from the episodic raise

**Chosen persona — Yara Haddad, New York**: NY for the institutional-investor/lender surface and the IR/disclosure tradition. The role is the **consistency gate** — every external figure reconciles to Rafael's model before it leaves, and every update is checked against prior updates. Voice: measured, disclosure-disciplined, never selling. The `yara↔dana` boundary is explicit: Dana's deck *sells* (the raise), Yara's update *informs* (the steady state) — same numbers, different register.

**Levi's input**: Yara frames the *consistency* question ("does this update contradict the last one / over-claim / disclose selectively?"); Levi owns the *legal* read of any disclosure obligation. At private/hobby scale there's no Reg-FD obligation, but the posture (one on-message picture for everyone) is the credibility discipline regardless.

**Elena's input**: the `yara↔elena` lateral is voice consistency. Elena owns the team's outward editorial voice on `kohuehara.xyz`; Yara owns the investor-facing register. They audit that the investor update and the public site don't tell two different stories about the same team — the same brand-voice-consistency worry Elena raised about the marketing voices in Q2.

**Tessa's input**: lateral seam on incentives — if a grant, subsidy, or policy-driven funding source surfaces in Tessa's policy lane, the financial framing routes to Rafael and the disclosure framing to Yara, rather than Tessa carrying it into finance.

## §6. What this round costs (the W-3 question)

| Layer | Budget |
|---|---:|
| `rafael` (VP Finance, Sonnet) | USD 7/mo |
| `dana` (Head of Fundraising, Sonnet) | USD 6/mo |
| `yara` (IR Manager, Sonnet) | USD 5/mo |
| **Combined** | **+USD 18/mo** |

The landing total — and whether a cap raise is needed — depends on the live roster at registration:

- **If the policy group is not yet registered** (roster ≈ USD 129/mo): this round lands at **147 / 160** — fits inside the current W-3 cap, **no raise needed.**
- **If the policy group is registered** (roster ≈ USD 156/mo): this round lands at **174 / 160** — **requires raising W-3 to USD 180/mo first.**

Raising the W-3 cap is a **Zone B / Zone A** action per `governance.md` §8.1 ("Raise the W-3 cost ceiling — escalate") — a Zone A change to `governance.md` W-3 and `workforce/lambdas/shared/agent-config.ts:W3_BUDGET_CAP_USD`. **This PR does not touch the cap.** Precedent for the raise: USD 50 → 100 (Q2) → 130 (Platform group) → 160 (current), each senior group lifting it; 160 → 180 would continue the lineage with USD 6/mo headroom retained.

The agents-api re-checks the aggregate at write time, so the round **fails loud (422 `W3-cap`)** if the headroom isn't there — it cannot silently breach the ceiling (C-4 / W-4). The hire-pack is staged; the cap posture is the operator's call at registration.

## §7. Cadences (deferred)

Per the policy-group precedent, `bindings` are `[]` at registration. The recurring cadences are wired afterwards via `cadence-forge` + PATCH (after the new slugs are added to each skill's `owners[]`, R8):

- `rafael` — **monthly finance brief** (runway / burn / W-3 utilisation), e.g. 1st of month, London morning.
- `dana` — **fundraising-readiness sweep** (deck + pipeline freshness), e.g. monthly, SF morning.
- `yara` — **investor/lender update** assembly, e.g. monthly or quarterly, NY morning.

No cadence is enabled in this PR — each is its own follow-up Zone A step with cost monitoring (mirrors the Q2 §7 and platform-charter EventBridge-deferral pattern).

## §8. What's NOT in this round (and why)

- **A CFO above the VP.** Reviewed; declined. Rafael IS the senior finance owner at this scale. A CFO tier is premature for a three-person function (§2).
- **A bookkeeping / treasury / AP-AR IC.** That's a real-operations shape C-3 explicitly rules out — the operator holds every money button; there are no books to keep at hobby scale.
- **A financial analyst under Rafael.** The canonical model is small enough for the VP to own directly. An analyst is a future hire only if the model outgrows one owner.
- **Any outreach capability.** Dana never pitches; Yara never responds to an investor. Outreach is operator-only (C-3) — the defining guardrail of the whole group, not an omission.
- **A new authoritative finance store.** Rafael's "canonical model" reconciles operator-supplied financials inside his runs; it is not a parallel source of truth (C-2 / W-2).
- **A pre-emptive W-3 cap edit.** Deferred to the operator (§6) — the cap is raised before registration if needed, never staged into this PR.

## §9. Acceptance criteria (for the operator's PR review)

- `workforce/seed/finance-ir-group/{rafael,dana,yara}.json` + `{slug}-system.md` exist; each JSON's `slug` matches its filename and carries the required create fields (`AGENT_CREATE_REQUIRED_FIELDS`).
- `register.mjs --dry-run` runs clean and reports combined budget USD 18/mo, parents-before-reports order (`rafael` first).
- All three slugs match `^[a-z]+$`, no roster collision; `reports_to` / `lateral` edges are slug-shaped with no cycles (manifest builder confirms at build).
- Each `system.md` carries the C-3 outreach-refusal block and the LLM-persona bias disclosure.
- The W-3 posture is documented (§6) and **the cap is not edited in this PR**; if the roster is at 156, the operator raises W-3 to 180 before running `register.mjs`.
- No EventBridge / cadence binding is enabled for the new personas (deferred, §7).

## §10. Open questions Priya is sending up to Maya

1. **W-3 cap raise USD 160 → 180.** Conditional on the policy group being live (§6). Zone A; needs explicit Maya/operator approval before `register.mjs` is run, if needed.
2. **Does Dana report to Rafael or directly to Maya?** The PR commits to `dana → rafael` (number-discipline + narrative under one function). If Maya wants fundraising as a direct founder line, that's a one-line `reports_to` revision before registration.
3. **Cadence frequency for Yara — monthly or quarterly?** The PR leaves it unwired (§7). Monthly keeps warm investors warmer; quarterly is lighter-touch and more typical for a hobby-scale cap table. Operator's call when the binding is wired.
4. **Is `workforce-self` the right `default_project` for all three, or should fundraising/IR work land in a dedicated project?** The PR uses `workforce-self` (consistent with the platform/policy groups). Flagging in case the operator wants investor-comms artefacts isolated in their own project for portfolio separation.

## §11. Bias disclosure for this memo

> Priya is an LLM persona (`anthropic:claude-sonnet-4-6`) on the Workforce platform. The "VP consultations" described above are the framings I (Priya) constructed inside my single run; they are not transcripts of separate persona-to-persona conversations. Each VP's "input" — including Rafael's, who does not exist until this PR registers him — is my reconstruction of what their respective `system.md` voices would say about the role I'm framing. When this PR is merged and the new personas start running, their actual voices will diverge from what I've imagined here; the hire-pack is the framing, not the consensus. The LinkedIn/industry JD references are the public benchmarks I anchored each role's responsibilities against; they are sources for the JD shape, not endorsements of any specific posting.
