# 2026-07 — India Energy Market Research Desk Hire Round (Priya's hiring memo)

- **Operator request** (2026-07-08): stand up a research desk on the ai-native-article side
  for the India-energy business proposal — first survey the mononaware Agent Workforce as
  the talent market, rank the top-20 fits, then hire a small team with defined positions
  and responsibilities.
- **Lead**: Priya Halvorsen (VP People & Legal), with Tessa Whitfield (VP Policy &
  Government Affairs) as receiving VP.
- **People-ops review**: Theo Castellanos.
- **VP panel convened**: Tessa (policy org shape), Silas (W-3 budget), Elena (editorial
  surface), Nadia (project fit).
- **Status**: Registration bundle staged (`workforce/seed/india-energy-group/`), draft PR.
  W-3 cap raise 250 → 275 rides in this PR, pending operator confirmation at merge.

## §1. Policy I applied

- **C-3 single-operator scale** — this is a *research* desk, not a business-development
  team. Every persona hard-refuses outreach (no utilities, ministries, vendors, consumers,
  investors); contact plans are drafted and routed up, the operator alone acts.
- **W-2 / W-5** — the seed bundle is one-shot registration input per ADR-0007; DDB becomes
  authoritative on registration; mutations only via `PATCH /agents/{slug}`.
- **W-3 cost ceiling** — the round breaches the USD 250/mo cap; the raise to 275 is a Zone A
  edit to governance.md §2 riding in this PR (precedent: every prior round since Epic-009).
- **W-1 / C-1** — desk output is primarily internal (notes, thesis doc, syntheses); any
  public explainer on `kohuehara.xyz` carries the standard persona bias disclosure.

## §2. The research brief this desk serves

The operator's proposal-in-progress: a new-value business proposal for **India ×
residential energy**, argued as a market-structure translation — North America and Japan
already lived through the distributed-energy shift (rooftop solar economics, storage
attach, utility business-model stress, aggregation/software value layers); India's version
is starting, and the proposal must show **why it accelerates there** rather than "India is
N years behind." The proposal's review axes are: environment / customer redefinition /
new provided value / willingness-to-pay / scalability — plus the "where did you sweat"
evidence bar (documented customer voices, not assumed personas). Its known weakest points:
diffuse problem-solution pairs (must converge to one core solution), ambiguous first
customer, and a soft financial exit.

The desk is shaped against exactly those weaknesses: a **thesis-owning lead who forces
convergence**, a **program-economics analyst who names the buyer**, a **consumer-evidence
analyst who documents the pain at scale**, and a **monetization strategist who prices it**.

## §3. The management-layer review

- **New VP or fold-in?** Fold-in. The desk reports into **Tessa's policy org** — it is
  research, its nearest lanes (ishaan/vikram/grace/mei) already live there, and a fourth
  VP for a four-person desk fails the C-3 smell test. `anjali` is a Director-grade lead
  under Tessa, mirroring how `corinne`'s IR pod sits under Silas.
- **Flat vs lead+reports?** Lead+reports. The proposal needs *convergence* — a single
  thesis owner with authority to kill parallel narratives — which a flat pod of peers
  structurally cannot deliver.
- **Why not staff it from the bench?** `ishaan`/`vikram`/`aanya` keep their lanes (central
  instruments / DISCOM ground / community sentiment) — reassigning them would break three
  existing beats to staff one new one. The desk *cites* them via lateral edges instead.

## §4. The hires

| Slug | Role | Reports to | Residence | Model | Budget |
|---|---|---|---|---|---|
| `anjali` | Research Director, India Energy Market Desk (lead) | `tessa` | Mumbai, IN | `anthropic:claude-sonnet-4-6` | USD 7/mo |
| `rohan` | DISCOM, Subsidy & Program-Economics Analyst | `anjali` | Gurugram, IN | `anthropic:claude-sonnet-4-6` | USD 6/mo |
| `sneha` | Residential Consumer & Field-Evidence Analyst | `anjali` | Pune, IN | `anthropic:claude-sonnet-4-6` | USD 6/mo |
| `sofia` | Market Strategy & Willingness-to-Pay Analyst | `anjali` | Copenhagen, DK | `anthropic:claude-sonnet-4-6` | USD 6/mo |

Responsibilities in one line each:

- **anjali** — owns the NA/JP→India translation thesis; forces one-core-solution
  convergence; ships the monthly five-axis synthesis to Tessa; assigns falsification tests.
- **rohan** — DISCOM financial health, PM Surya Ghar state funnels, RDSS/AMISP smart
  metering; converts program mechanics into stage-labeled, named-buyer market hypotheses.
- **sneha** — mines consumer voice at scale (forums, reviews, grievance portals) into a
  provenance-preserved evidence base; quantifies workaround spend as revealed
  willingness-to-pay; the desk's "where we sweated" answer.
- **sofia** — customer redefinition (first payer vs beneficiaries), NA/JP/EU
  business-model benchmark library with India-precondition status, price-point and
  revenue-contribution hypotheses, quarterly skeptic's review.

## §5. Candidate sourcing — the mononaware Agent Workforce talent market

Per the operator's request, sourcing ran against the **mononaware Agent Workforce**
(`dev/agent_workforce_repo_package/foundational/**/agent_templates/` + management
registry) — ~105 templated agents and ~50 named management personas. Fit criteria:
(a) India × energy domain, (b) market-structure / DER / grid analysis, (c) business
viability / customer / willingness-to-pay, (d) policy / subsidy, (e) evidence gathering,
(f) synthesis / adversarial review. The top-20 ranking:

| # | mononaware persona / agent | Home unit | Fit | Disposition |
|---|---|---|---|---|
| 1 | **Rohan Mehta** — `india-policy-utility-research-agent` (active) | energy vertical | India policy/DISCOM/subsidy/smart-meter + named-buyer market hypotheses — the single closest template to the brief | **Hired** (adapted as `rohan`; surname → Deshpande, see §8) |
| 2 | **Sneha Patil** — `india-residential-consumer-research-agent` (active) | energy vertical | India household field research: AC/cooling, power quality, segment-level pain | **Hired** (`sneha`) |
| 3 | **Jay Trivedi** — `india-solar-contractor-research-agent` (active) | energy vertical | Rooftop-solar EPC/contractor ecosystem — survey→quote→install reality | Deferred to round 2 (§9); channel questions interim-covered by `sofia` + `vikram` |
| 4 | **Dr. Anjali Khurana** — `india-residential-energy-research-director` (active) | intelligence directors | Owning director of the India field team; thesis-and-convergence leadership | **Hired** (`anjali`, desk lead) |
| 5 | **Sofia Jensen** — `market-strategy-mmt` / `carbon-market-strategist` (active) | finance cluster | Buyer segmentation, channel mix, pricing hypotheses, GTM verdicts | **Hired** (`sofia`, retargeted from carbon to energy) |
| 6 | **Amara Singh** — `climate-tech-power-grid-systems-vp-mmm` (active) | climate-tech portfolio | Generation/storage/demand-flex/T&D portfolio coherence — the NA structural-change lens | Not hired — VP-grade scope exceeds C-3; her lens embedded into `sofia`'s benchmark library |
| 7 | **Priya Nair** — `renewable-ppa-viability-mmt` (active) | energy cluster | Energy business viability discipline | Not hired — utility-scale PPA focus ≠ residential brief; slug also collides (`priya`) |
| 8 | `counterfactual-analyst-agent` (active) | climate_regulation | "If an analogous rule were adopted here…" — precisely the NA→India translation method | Method absorbed into `anjali`'s charter (translation-with-acceleration discipline) |
| 9 | **Dr. Sven Lindqvist** — `energy-research-director` (active) | intelligence directors | Energy-research credibility, finance-agent management | Not hired — redundant with `anjali` as lead |
| 10 | `energy-grid-policy-agent` (active) | energy vertical | Grid/interconnection posture: eligibility, curtailment, gating stakeholders | Covered by `ishaan` (existing) + `rohan` at the program layer |
| 11 | `climate-subsidy-radar` (experimental) | climate_regulation | Subsidy/incentive program structural detection | Function absorbed into `rohan`'s beat |
| 12 | **Dr. Léa Berger** — `regulatory-research-director` (active) | intelligence directors | Comparative regulatory-trajectory research | Covered by `ishaan`/`grace` lanes under Tessa |
| 13 | **Diego Vargas** — `cro-agent` (active) | C-suite | ICP/GTM/pricing, customer→product translation | Not hired — C-suite scope; commercial questions live with `sofia` |
| 14 | `energy-finance-agent` (active) | energy vertical | IRR/breakeven/viability computation | Not hired — utility-scale project finance ≠ residential thesis; `silas` reviews models |
| 15 | **Takeshi Mori** — `energy-markets-delivery-director` (active) | delivery directors | LCOE/price analysis management | Not hired — same rationale as 14 |
| 16 | `private-capital-mobilization-agent` (experimental) | transition_finance | Making policy-finance structures investable | Round-2 candidate if the thesis lands on a financing product |
| 17 | `synthesizer-agent` (experimental) | transition_finance | Multi-input proposal synthesis, contradiction resolution | Function embedded in `anjali`'s monthly synthesis charter |
| 18 | `red-team-agent` (experimental) | transition_finance | Skeptical multi-perspective attack on proposals | Partially embedded as `sofia`'s quarterly skeptic's review; full red-team is a round-2 candidate |
| 19 | **Lena Kovacs** — `abduction-engine-mmt` (active) | Project Athens | Hypothesis generation/scoring for market questions | Method (falsification tests per hypothesis) embedded in `anjali`'s operating principles |
| 20 | `azec-strategy-agent` (experimental) | transition_finance | Japan→Asia deployment framing | Round-2 candidate for the scalability axis |

Panel notes: Tessa endorsed the fold-in and the lane boundaries (§3); Silas signed the
§6 arithmetic conditional on the cap raise; Elena flagged that desk personas publishing
explainers must carry the standard bias disclosure (present in all four system prompts);
Nadia confirmed no project-registry change is needed (research runs under
`workforce-self`; note `projects/project-ind` is an unrelated external PR-review project
despite the name).

## §6. What this round costs (the W-3 question)

| | USD/mo |
|---|---|
| Cap before this round | 250 |
| This round (7+6+6+6) | +25 |
| **Proposed cap** | **275** |

The DDB-side roster total is checked by the API at write time (fail-loud on aggregate
breach), so the memo does not restate it; the cap raise is sized to admit this round on
top of the post-media-group roster. One row added to the governance.md §2 amendment
table in this PR.

## §7. Registration and runtime activation (deferred)

Register via `POST /agents` (operator credentials, `register.mjs`), `bindings: []`.
Intended cadences, wired later via `cadence-forge` + `PATCH` (landing paused,
enable = operator action):

- `anjali` — monthly desk synthesis (five-axis) to Tessa.
- `rohan` — fortnightly program-economics note.
- `sneha` — fortnightly voice-of-consumer note.
- `sofia` — fortnightly monetization note; quarterly skeptic's review.

## §8. People-ops review (Theo)

- **Naming**: all four slugs match `^[a-z]+$`; no collision against the current roster
  (checked against seed bundles + `reports_to`/`lateral` graph: aanya astrid celeste
  corinne delphine elena farah grace idris ishaan kai levi maya mei nadia noor odette
  priya ren rhys silas sora tessa vikram yara yuki…). `validate-naming.mjs` passes.
- **Surname adjustment**: mononaware's "Rohan Mehta" would collide with **Ishaan Mehta**
  on the same beat's edge — adapted to **Rohan Deshpande** (provenance noted in §5).
  "Sofia Jensen" / "Sneha Patil" / "Anjali Khurana" have no surname collisions.
- **Org edges**: `anjali` → `tessa` (registered parent); ICs → `anjali`; registration
  order in `register.mjs` is parent-before-children. No cycles, no orphans.
- **Lane boundaries**: each persona names its deferrals (`ishaan`, `vikram`, `aanya`,
  `mei`) and the co-flag rule — the same discipline the policy group established.
- **Bench gap**: no India **channel/ecosystem** coverage (Jay Trivedi deferral, §9) and
  no dedicated red-team. Both are named round-2 triggers.

## §9. What's NOT in this round (and why)

- **Jay Trivedi (solar/contractor ecosystem)** — real fit (#3), but the desk's first
  quarter is thesis-and-evidence, not channel execution. Hiring him now adds USD ~6/mo
  before the core solution is chosen. Trigger to hire: the thesis converges on a
  solution whose GTM rides the EPC/contractor channel.
- **A dedicated red-team persona** — `sofia`'s quarterly skeptic's review covers the
  finance-reviewer attack; a full multi-perspective red team becomes worth its budget
  when a draft proposal exists to attack.
- **Any Article 6 / carbon-market hire** — `mei` already owns the lane.
- **Fieldwork capability** — surveys/interviews are a C-3 boundary (operator-only);
  the desk's evidence method is public-source voice-mining with provenance.

## §10. Acceptance criteria (for operator PR review)

- [ ] `workforce/seed/india-energy-group/` contains 4× `{slug}.json`, 4× `{slug}-system.md`,
      `register.mjs`, `README.md`.
- [ ] `node workforce/seed/india-energy-group/register.mjs --dry-run` lists 4 agents,
      combined USD 25/mo, parent-before-children order.
- [ ] `node workforce/scripts/validate-naming.mjs` passes.
- [ ] governance.md §2: cap reads USD 275/month and the amendment table carries the
      2026-07-08 row.
- [ ] Every persona hard-refuses outreach and carries the bias disclosure block.

## §11. Open questions sent up to Maya/operator

1. Confirm the W-3 raise 250 → 275 (merge = approval, per precedent).
2. Should desk output surface publicly on `kohuehara.xyz` from the start (occasional
   explainers are written into the personas), or stay internal until the proposal ships?
3. Round-2 trigger check-in: revisit Jay Trivedi + red-team after the first monthly
   synthesis.

## §12. Bias disclosure

This memo was authored by an LLM persona (Priya Halvorsen) in a single Claude Code
session; the "VP panel" is a single-run reconstruction, not independent agent runs. The
mononaware talent-market ranking in §5 was produced by the same session from a repo-wide
inventory of `dev/agent_workforce_repo_package`, and the fit scores are editorial
judgment, not measured evaluations.
