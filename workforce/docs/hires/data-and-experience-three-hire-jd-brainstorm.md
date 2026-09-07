# 2026-08 — Data & Experience three-hire round: JD brief

- **Status**: **Pre-round JD brief.** The round proper — seed bundles, panel, registration — is not started. This document fixes *what the three seats are* so the round can be written against a settled JD.
- **Operator request** (2026-08-06): open three seats serving `asp-cloud`, `smartmeter-data-analysis` and `project-ind` — a data scientist, a data-engineering seat, and a UX seat on the human-understanding side rather than the industrial-design side. "Clarify the JDs first, researching LinkedIn as you go."
- **Operator decisions** (2026-08-06, recorded in §6): cross-project functional seats · one DS seat, not two · a new Cadence for the output form (separate session — handoff context in §8) · W-3 ceiling raised 500 → 600 · the behavioural seat ships as **Behavioral Design & Trust Researcher**.
- **Projects**: all three of `workforce/projects/{asp-cloud,project-ind,smartmeter-data-analysis}/project.json` carry `owner_agent: nadia`, with Dario / Ren / Aoi as reviewer lenses.

---

## §0. The three things that shape these JDs

**1. The data-engineering description contains two market roles, not one.** The operator's brief puts both *"design the analysis pipeline"* and *"get the DS, the PdM and the EM to a state where they can decide"* on the same seat. In the 2026 market those are **data engineer** (ingest, raw & staging, orchestration, platform) and **analytics engineer** (the modeled and marts layer, metric definitions, data tests, the semantic layer). At C-3 scale one seat carries both — but the JD has to **say so out loud**, or it reads as a Spark-operator posting and attracts one.

The brief's own phrase — *"separating intermediate data from a flexible analysis front-end"* — is a restatement of the medallion-plus-semantic-layer shape (`Raw → Staging → Facts & Dimensions → Semantic Layer → Metrics → Decisions`). Using the market's words for it is the difference between a candidate recognising themselves in the posting and scrolling past. **Title: Analytics Platform Engineer.**

**2. The UX seat is not a designer seat, and the title decides the pool.** Cognition, emotion, memory, trust formation, psychology, behavioural economics — that is the **behavioural scientist** / mixed-methods **UX researcher** vocabulary. Behavioural science is generally treated as *a specialisation rather than a job title*, and psychology PhDs flow into postings under several titles — which cuts both ways: `UX Designer` pulls a UI pool, `UX Researcher` pulls a generalist pool. **Title: Behavioral Design & Trust Researcher** (operator-confirmed).

The asp-cloud problem also has an existing research literature to stand on. Acceptance of dynamic pricing turns on perceived **procedural fairness** and **benevolent intent**; transparency and perceived fairness mitigate negative behavioural responses *even when the price outcome itself is unfavourable*, while absent transparency customers report feeling manipulated. The same holds for automation generally — reliable and transparent agents earn higher *behavioural* trust. That research is what lets the JD's success measures be **behavioural trust proxies** (opt-out rate, manual-override rate, the distribution of inbound questions, reach-through to the explanation, churn after an adverse price event) instead of a satisfaction score. This is the concrete form of "can talk science and communication in the same breath."

**3. Written across three projects, each JD drifts toward a unicorn.** Every seat is asked for a different archetype per project. The fix is to state the **common core** — that is the hiring bar — and demote the per-project specifics to context.

| Seat | asp-cloud | smartmeter-data-analysis | project-ind | **Common core (this is the bar)** |
|---|---|---|---|---|
| DS | sparse IoT signal → physical-world inference + algorithm editing (Airbnb's *Algorithms* end) | large-scale exploratory analysis / load research (*Analytics*) | product analytics + large-scale social text (*Analytics* + NLP) | **hypothesis → measurement design → verification → decision.** The brief's "separate the whole into constants and variables" is confound control. |
| AE | read high-volume IoT so DS can hypothesise and Nadia/Dario can decide | 10^9-row intermediate-layer design, MapReduce-shaped decomposition | web-usage logs + external social data ingestion | **designing decision latency** — trading pre-aggregation cost against analyst lead time, explicitly. |
| UX | trust formation and maintenance under external automation + a tariff nobody has explained | (indirect — interpretation support) | pre-arrival reassurance across a US-provider / India-user gap | **holds frameworks for cognition, emotion and trust, and can turn them into something measurable.** |

---

## §1. Market read (how these roles are actually named and split)

Word choice in a JD determines the pool it reaches, so this section is about **searchable vocabulary**, not phrasing taste.

### 1-1. Data scientist

- **How the job family splits.** Airbnb divides data science into **Analytics / Inference / Algorithms** — Analytics turning analysis into strategic decisions, Inference statistics-and-causal (economics/statistics doctorates), Algorithms writing and shipping ML systems. Netflix puts **experimentation and causal inference** at the centre of the discipline, with data scientists leading the design, analysis and interpretation of experiments.
  → The operator's brief ("design the next A/B test", "separate constants from variables", "propose the data points that would most improve performance") is squarely **Analytics + Inference**, not Algorithms. Saying so in the JD is what makes the pool correct.
- **Domain pools reachable on LinkedIn.**
  - *Home-energy*: **Bidgely** (20+ data scientists since 2011 building disaggregation; appliance-level intelligence from low-frequency smart-meter data, ~12 loads per home, no sensors), **Uplight** (the Tendril / Simple Energy / FirstFuel merger; among the largest US utility energy-management software providers), **Sense** ($105M raised, real-time in-home energy data), **Oracle Utilities Opower**. A posting like Bliq's — *design and refine algorithms improving home battery performance, predicting consumption and production patterns, working alongside engineers and PMs* — is close to isomorphic with the asp-cloud half of this seat.
  - *Program-evaluation consultancies*: **Cadmus / Opinion Dynamics / DNV / Guidehouse**. These people causally evaluate "did the intervention actually work" on metered data as their day job. It maps onto asp-cloud's field-trial evaluation almost exactly and is **routinely missed** when scoping a DS search. Worth targeting deliberately.
- **The asp-cloud difficulty has a name.** "Read occupant behaviour and appliance state from limited IoT data" is **NILM / load disaggregation** — recognising per-appliance consumption from an aggregate signal, an active research area on low-frequency smart-meter data (FHMM, CO, Seq2Point, SGN, DAE, BiLSTM lineages).
  → Correct as a **strong plus**, wrong as a **must** — practising NILM specialists are thin worldwide. The must-have should instead probe the *disposition*: can this person form physically plausible hypotheses from sparse, incomplete observation?

### 1-2. Data engineering

- **The 2026 boundary.** Data engineers own ingest, the raw and staging layers, orchestration and the platform; analytics engineers own the modeled and marts layer, metric definitions, data tests and the semantic layer. The reference progression is `Raw → Staging → Facts & Dimensions → Semantic Layer → Metrics → Decisions`. The 2026 framing of the analytics-engineer role has moved from implementing individual models to **how the system of models behaves** — which model is source of truth for which metric, where domain boundaries fall, and how the semantic layer must be structured so downstream queries return consistent answers.
- **Scale, read honestly.** Tens of thousands of households × 3 years × 30-minute granularity ≈ **10^9 rows**. In 2026 that is not "big data", it is a **design problem**. The JD should test *"can you trade re-aggregation cost against analyst lead time"*, not *"can you run Spark"*.
- **Vocabulary.** Time-series substrate: **Amazon Timestream** (already in production on asp-cloud — see the `asp-data` skill), Timescale / ClickHouse / Druid / Influx. Processing: Spark / AWS EMR. AMI and meter-data-management pools: Itron, Landis+Gyr, Oracle MDM, Kaluza, Kraken — plus the smart-grid platform-engineering postings built around ingesting, transforming and storing high-volume AMI telemetry and event data.

### 1-3. UX (human-understanding side)

- **The title splits three ways.** **Behavioral Scientist** — applies social-science findings *upstream* of the UX team, connecting what users want to the behaviours that get them there. **UX Researcher (mixed methods)** — customer-research technique aimed at needs and pain, built into the experience. **Design Researcher**. Behavioural science reads as a specialisation more than a title, and psychology / anthropology / cognitive-science PhDs move into all of them.
- **The precedent job exists.** **Opower** founded behavioural energy efficiency in 2008 on Robert Cialdini's three decades of social-norms research, with the **normative comparison** algorithm as the product core — and has kept iterating the technique (e.g. "Efficiency Zones", comparing a household against a target band rather than against efficient neighbours). "Behavioural science × energy × communication at scale" is a real, staffed discipline with a traceable alumni pool.
- **project-ind is a different problem.** Web app as the only touchpoint, provider in the US, users in India, and trust that has to form **before the first visit**. That is cross-cultural trust and pre-onboarding expectation-setting — closer to brand communication than to usability research, which is why **Celeste (VP Marketing) is a structural lateral**, matching the operator's own note that this seat works most closely with Product and Marketing.

---

## §2. The three seats — one-line missions

| Seat | Mission in one line | **Explicitly not this seat** |
|---|---|---|
| **Product Data Scientist, Experimentation & Field Inference** | From limited observation, form hypotheses about how people live and what devices are doing, **design the verification that could refute them**, and propose which data to add next, ranked by effect. | Building, serving or operating production ML systems. |
| **Analytics Platform Engineer** | **Shorten decision latency.** Design raw → intermediate → analysis-front-end so the time between an analyst's new angle and an answer is hours, not days. | Product backend feature work; infrastructure on-call. |
| **Behavioral Design & Trust Researcher** | Against an experience that is *inherently opaque* — external automation plus a moving price — **design trust, and measure it**. | UI surfaces, design systems, design tokens (Zone A). |

---

## §3. JD drafts (in the seed-bundle `jd` schema)

Written so the round only has to add persona name (per `workforce/docs/naming.md`), residence, model and budget.

### 3-1. Product Data Scientist, Experimentation & Field Inference

```
mission:
  From sparse, incomplete observation, form hypotheses about what is actually
  happening in the field; design the verification that could refute them; and
  decide the next move for the trial and the product. Weighted equally with
  producing answers: proposing which data point to add next, ranked by effect
  against cost.

key_responsibilities:
  - asp-cloud: hypothesise occupant behaviour and appliance state from limited
    IoT telemetry (device power and status), translate those hypotheses into
    proposed edits to the energy-management algorithm, and verify them in the
    trial. Screen every inference first on whether it is physically possible.
  - Own the verification design: state what is held constant, what is varied,
    what the confounds are, and — where randomisation is impossible — which
    quasi-experiment applies (difference-in-differences, synthetic control,
    regression discontinuity). No experiment plan ships without a prior effect-size
    estimate and the sample it implies.
  - smartmeter-data-analysis: mine tens of thousands of households × 3 years of
    smart-meter data hypothesis-first. Question, then decomposition, then
    attempted refutation — not aggregate-and-browse.
  - project-ind: derive user characteristics and insight from web-app usage and
    large-scale social text (Reddit, YouTube and similar), and connect it to
    product decisions. Every socially-sourced claim carries its sampling-bias
    caveat.
  - Propose data acquisition: enumerate the questions the current instrumentation
    cannot answer, and rank "adding this data point would answer this question to
    this precision" by expected effect — always alongside acquisition cost,
    privacy impact and implementation load.
  - Deliver at the granularity Nadia (PdM) and Dario (EM) can act on: results
    arrive as decision options with the assumption each one is betting on, not
    as "implications".
  - Hand pipeline requirements to the Analytics Platform Engineer as a spec
    (intermediate-layer granularity, refresh rate, tolerable staleness). Do not
    go build the platform.

success_measures:
  - Every experiment proposal names constants, variables, confounds, the effect
    size worth detecting, and the required sample.
  - Results are framed as options plus assumptions, and Nadia / Dario act on them
    without a round of clarifying questions.
  - Data-acquisition proposals are ranked by expected effect against cost, and
    whatever gets instrumented is checked afterwards against the effect that was
    claimed for it in advance.
  - Uncertainty is quantified. No point estimate without an interval, no
    proportion without its n, no social-media analysis without its sampling caveat.
  - Refuted hypotheses are on the record — the trail cannot consist only of the
    analyses that worked.

operating_principles:
  - Sparse observation supports few claims. Saying how few is the job.
  - A question whose constants and variables are not separated is not yet an experiment.
  - Which data to add is a first-class deliverable, equal to the analysis. Missing
    data is where a proposal starts, not where analysis stops.
  - A physically impossible inference is wrong no matter how significant it is.
  - Finding a correlation is the start of the work, not the end of it.
```

**Must-have** — practised causal inference (experimental or quasi-experimental); reflexive about confounding and selection; experience with sparse, missing, irregular real-world data; a track record of translating findings into decisions.
**Strong plus** — NILM / load disaggregation; power and energy; time-series; program evaluation (causal evaluation of DR/EE programs); feature extraction from large text corpora.
**Anti-signal** — reports model accuracy as the outcome; opens with "show me all the data first"; cannot describe an experiment that failed.

### 3-2. Analytics Platform Engineer

```
mission:
  Shorten decision latency. Design and build the three layers — raw telemetry,
  intermediate data, analysis front-end — so that the time from a data
  scientist's new angle to an answer drops from days to hours. Make the
  Software-2.0 data-driven improvement cycle work from the software-stack side.

key_responsibilities:
  - smartmeter-data-analysis: for tens of thousands of households × 3 years
    (10^9-row order), design the partitioning and parallel aggregation
    (MapReduce-shaped decomposition) and the intermediate data layer. Decide the
    granularity to pre-materialise as an explicit trade of re-aggregation cost
    against analytical freedom, and leave the reasoning behind that call on the record.
  - Design the split between intermediate data and the analysis front-end: how
    far to pre-aggregate, and where analysts get to roam freely. Fix where metric
    definitions live (the semantic layer) so no metric is ever defined in two places.
  - asp-cloud: turn high-volume IoT telemetry (Timestream-class) into both the
    shape a data scientist tests hypotheses against and the shape Nadia (PdM) and
    Dario (EM) make calls against — designing on the assumption that those are
    not the same table.
  - Make data quality mechanical: freshness, row-count and distribution tests, and
    a design that fails rather than quietly serving stale values (C-4 fail loud).
  - project-ind: bring web-usage logs and external social data onto the same
    three-layer model. External sources especially carry an explicit contract
    against schema drift.
  - Take the DS seat's analysis requirements (intermediate granularity, refresh
    rate, tolerable staleness) as a spec and answer: hold it in the intermediate
    layer / compute on demand / not instrumented at all.
  - Treat cost as a design variable: know the unit economics of storage, compute
    and query, and attach an estimate to every design proposal.

success_measures:
  - The lead time from an analyst's new angle to a first answer is measured, and
    is trending down.
  - Every headline metric has one definition, and dashboards and analysis notes
    do not disagree about the number.
  - Pipeline failures surface as explicit failures, never as silent staleness.
  - Every design proposal is argued on three axes: materialisation cost,
    analytical freedom, estimated spend.
  - Scale claims are measured, not asserted — "this partitioning, this wall clock",
    not "Spark will be fast".

operating_principles:
  - Speed is decided by where the intermediate layer sits. Engine choice comes after.
  - The moment a metric is defined in two places, it is no longer trustworthy.
  - Making everything real-time is not a design, it is a deferred decision.
  - A broken pipeline must not return yesterday's number. It should fail.
  - An unused intermediate table is a liability, not an asset.
```

**Must-have** — production SQL and Python; designing and operating ELT/ETL; layered warehouse modelling (dimensional or medallion); implementing data tests and monitoring; time-series or high-volume event data.
**Strong plus** — dbt and semantic layers (MetricFlow, Cube, LookML); Spark / EMR; Timestream / ClickHouse / Timescale / Druid; AMI and smart-meter systems (Itron, Landis+Gyr, Kraken, Kaluza); demonstrated cost optimisation.
**Anti-signal** — opens with "first, let's replatform"; advocates all-streaming, all-real-time unconditionally; starts designing before asking who decides what.

### 3-3. Behavioral Design & Trust Researcher

```
mission:
  Against an experience that is inherently hard to make sense of — "appliances in
  my home are being controlled from outside it, under a pricing rule I do not
  understand" — design and measure the formation, maintenance and repair of trust.
  Translate academic frameworks of cognition, emotion, memory and trust formation
  into specific product and communication decisions.

key_responsibilities:
  - asp-cloud: own the initial communication design on the premise that at trial
    start residents do not understand dynamic pricing. What the first message and
    the first screen say — and what they deliberately do not. Design two paths in
    parallel: one that adds understanding progressively, and one that lets a
    resident disengage and still feel safe. Do not try to educate everyone.
  - Make trust measurable: not a satisfaction score but behavioural proxies —
    opt-out rate, manual-override rate, the distribution of inbound questions,
    reach-through to the explanation, attrition after an adverse price event —
    defined and then tracked.
  - Design communication on procedural fairness: what keeps trust intact when the
    price outcome goes against someone is the perception of transparency and
    fairness. Deliver "why this control happened" before and during, not only after.
  - Enumerate the moments trust breaks before they happen (unexpected control, an
    uncomfortable room, a large bill, an absent explanation) and prepare detection
    and a recovery message for each.
  - project-ind: with the only touchpoint a web app, the provider in the US and the
    users in India, design expectation-setting from *before* arrival through
    onboarding. Identify what the cross-border gap costs in trust, and work with
    Celeste (Marketing) to place the answer ahead of the site visit.
  - Connect qualitative and quantitative: combine interviews, diary studies,
    behavioural logs and experiments, and hand qualitative findings to the DS seat
    as hypotheses that can actually be tested. Do not stop at "we built personas".
  - Hold a line on applied behavioural science: designing to aid understanding and
    designing to bypass understanding and move behaviour anyway are different
    things. Do not propose the second.

success_measures:
  - Trust is defined as at least three behavioural indicators, and they are
    genuinely instrumented.
  - Every communication proposal names the framework it rests on (social norms,
    procedural fairness, trust in automation, expectancy violation) and what would
    be observed if that framework were wrong here.
  - A "where trust breaks" list exists in advance, and events during the trial are
    reviewed against it — including the ones that were not on it.
  - Qualitative findings reach the DS seat as testable hypotheses on a regular cadence.
  - Both Product (Nadia) and Marketing (Celeste) can use this seat's output as-is.

operating_principles:
  - Trust is a history, not a state. It accrues from expectations matching outcomes,
    not from one good explanation.
  - Do not try to make everyone understand. Build a path for the people who will
    and a path for the people who want to stop thinking about it.
  - Opacity breaks trust faster than an unfavourable outcome does.
  - Trust you cannot measure, you cannot design. A claim that resists
    instrumentation is not yet even a hypothesis.
  - Techniques that move behaviour around understanding work in the short run and
    cost the relationship.
```

**Must-have** — academic grounding in psychology, behavioural economics, cognitive science or HCI (a degree is not required; fluency with the frameworks is); mixed qualitative/quantitative method; a record of translating findings into product and communication decisions; having actually measured trust, acceptance or behaviour change.
**Strong plus** — energy and utilities (the Opower lineage); trust in automation and explainability; cross-cultural research; designing and testing large-scale lifecycle communication (email, notifications).
**Anti-signal** — deliverables always terminate at personas and journey maps; qualitative only, no indicators; answers "we can nudge that"; keeps steering the conversation back to UI components.

---

## §4. Lane boundaries against the existing roster

A new seat that treads on an existing lane gets stopped in review. Cleared in advance.

| Existing | Owns | Boundary |
|---|---|---|
| `dmitri` — Growth & Reader Analyst (→ `ingrid`) | reader behaviour and growth on `kohuehara.xyz` | **No overlap.** Dmitri is the newsletter; the DS seat is the three external projects. State it in the JD anyway. |
| `tomas` — Organizational Performance Scientist (→ `mateo`) | the workforce's own performance | **No overlap** — inward (the org) vs outward (the product). |
| `owen` — SDET / Verification Engineer (→ `dario`) | correctness of code | **Adjacent.** Owen verifies code; the AE seat verifies **data** (freshness, contracts, data tests). Co-flag at the seam. |
| `sneha` — Residential Consumer & Field-Evidence Analyst (→ `anjali`) | Indian residential consumer field evidence | **Closest call.** Sneha covers Indian households *as a market* (evidence for the business thesis); the UX seat covers *project-ind's actual users'* experience and trust. Write the boundary into both JDs and set reciprocal laterals. |
| `rohan` — DISCOM, Subsidy & Program-Economics (→ `anjali`) | government-side subsidy and program economics | **Adjacent.** Rohan owns the policy-side economics; the DS seat owns the causal effect of a product intervention. |
| `amara` / `grace` / `ishaan` — grid and policy | the institutional side of dynamic pricing | The UX seat owns reception and trust, not the institution. The DS seat treats the tariff regime as given. |
| `celeste` — VP Marketing (and `nico`) | external communication | Co-recipient of the UX seat's project-ind output. Lateral required. |

## §5. Reporting lines

| Seat | reports_to | lateral |
|---|---|---|
| Product Data Scientist | `nadia` (Product) | `dario`, AE seat, UX seat, `rohan` |
| Analytics Platform Engineer | `dario` (Engineering) | DS seat, `nadia`, `owen` |
| Behavioral Design & Trust Researcher | `nadia` (Product) | `celeste` (Marketing), `sneha`, DS seat |

**Rationale.** (a) All three projects carry `owner_agent: nadia`. (b) The operator placed this UX seat's closest collaborators as Product and Marketing, which is exactly `nadia` + `celeste`. (c) DS under Product and the platform seat under Engineering is the standard market placement, and it keeps the healthy structural tension between the two (the DS wants freedom, the AE wants materialisation) inside the org chart rather than inside one person.

**Rejected alternative.** Grouping all three into a new "delivery pod" under a new VP — a management layer does not pay for itself at C-3. These are ICs under existing VPs, following the `bruno` precedent.

---

## §6. Decisions taken (2026-08-06) and what is still open

| # | Question | **Decision** |
|---|---|---|
| 1 | Cross-project functional seats, or asp-cloud-dedicated? | **Cross-project functional seats** — the workforce's baseline philosophy. JDs are written on the common core (§0 table), with per-project specifics as context. Consequence: NILM stays a strong-plus, not a must. |
| 2 | One DS seat or two? | **One seat**, hired on the common core — *experiment design*. The asp-cloud (physical inference / algorithm editing) and smartmeter+IND (large-scale exploratory analysis) halves are separate tracks in the market (Airbnb's Algorithms vs Analytics); carrying both in one seat is a deliberate, recorded trade at C-3 scale, not an oversight. If the seat visibly strains against it, splitting is a future round. |
| 3 | Output form for these seats | **Cut a new Cadence.** Runs in a separate session; handoff context in §8. |
| 4 | W-3 | **Ceiling raised 500 → 600** (operator direction). Executed in this PR — see §7. |
| 5 | UX seat title | **Behavioral Design & Trust Researcher** (operator-confirmed). |
| 6 | Data-engineering seat title | **Analytics Platform Engineer** — recommended in §0/§1-2 and adopted here by default. Flagged rather than silently assumed; a one-word veto reverts it to `Data Engineer`. |

**Still open, for the round proper:** persona names, residence, model tier and per-seat budget; whether any of the three take a `pr-review` reviewer lens in addition to the Cadence; and the panel roster for the round.

## §7. W-3 (executed in this PR)

Ceiling raised **USD 500 → 600/month combined** on operator direction. The three seats at ~USD 6–7/mo each add roughly **USD 18–21/mo** and would have fit under 500; the ceiling moves with them so the round plus continued expansion does not need a per-hire amendment.

Both sides raised in the same commit, deliberately:

- `workforce/docs/governance.md` §2 W-3 — the cap sentence, a new amendment-table row, and the §5 action-authority row that quotes the default.
- `workforce/lambdas/shared/agent-config.ts` — `W3_BUDGET_CAP_USD`, the **enforced** cap.

That lockstep is the point. The 2026-07-08 raise moved the doc and left the constant at 250, which then false-rejected an in-envelope registration at 253/250; the constant's own comment records the rule that the two must never move apart. Registration for this round is server-side against the live DDB roster aggregate, so the enforced constant is the one that actually decides.

**Known stale reference, deliberately untouched:** `workforce/skills/budget-runway-review/post.mjs` quotes *"USD 500/month combined"* in a header comment. It is a comment, and the script's G6 guard specifically refuses a hard-coded cap — the figure must arrive at runtime with the document it was read from (`--cap-usd` + `--cap-source`), so the Cadence reads 600 from governance on its next fire regardless. Left alone here to avoid dragging skill co-versioning (W-5) into a governance PR; worth a one-line follow-up.

## §8. Handoff: the Cadence session (decision 3)

Context for whoever picks up "cut the Cadence", so that session can start from the design questions rather than from discovery.

**Read first.** `.claude/skills/cadence-forge/SKILL.md` and `references/cadence-archetype.md` (the archetype definition) · `workforce/skills/budget-runway-review/` as the closest-shaped worked example (a periodic *analytical* deliverable, not an article) · `workforce/skills/article-level2/` for the fire-time subject-selection pattern.

**The mechanical shape (settled — do not redesign).** EventBridge → `wf-orchestrator-tick` → the generic `agent-runner` CCR routine. The runtime prompt is composed from (persona `system.md` × `SKILL.md` × binding `config` × project credentials). The LLM owns judgment; a bundled deterministic write-script owns the write, POSTing to an authenticated endpoint with a project-scoped credential. No PR and no AWS access in-session. `meta.json` carries `archetype: "cadence"`, `cost_class`, `owners`, `requires`. `cadence-forge` scaffolds something that passes `validate-skills` by construction.

**Open design question 1 — the write target.** This is the real one. Existing cadences POST to the feed endpoint with `workforce.feed_write_token`. These three seats produce analysis notes and design proposals *about external PSVL repositories*, which carry `github.token` and run the pr-autopilot / pr-review path. Three candidate shapes:

- **(a) Feed post.** Matches the existing archetype exactly, cheapest to build — but the artefact lives away from the project it describes.
- **(b) Write into the project repo.** `project-ind`'s `project.json` already notes that *"project reports are served at runtime from this repo's `reports/` directory"* — so a precedent for repo-resident reports exists. **Probably right for the DS and Behavioral seats.**
- **(c) Reviewer lens on existing PRs.** Fits the AE seat on data-pipeline PRs; fits the Behavioral seat least.

Starting recommendation: **(b) for DS and Behavioral, (b) + (c) for AE.** Worth confirming with the operator before scaffolding, since it decides which credential the skill `requires`.

**Open design question 2 — cadence cardinality.** Three seats × three projects = nine cadences if split per project, which fails the C-3 smell test. Prefer **one cadence per seat**, selecting its project at fire time — the pattern `article-level2/pick-l1-source.mjs` already establishes (choose the subject when the cadence fires, rather than binding one cadence per subject).

**Open design question 3 — the write-script guards.** Every cadence's guards are the point, not boilerplate. Model them on `budget-runway-review`'s G1–G7, especially G5 (*empty citations → exit 2*) and G6 (*never hard-code a figure; it must arrive with the document it was read from*). The analytical analogue for these seats: **no statistic without its denominator and its source; no claim of effect without the design that produced it.** For the DS cadence specifically, that is the mechanical form of the §3-1 success measure "no proportion without its n".

**Also to settle:** fire frequency and `cost_class` per seat; whether the three cadences share one skill with a per-persona binding config or take one skill each (they differ enough in deliverable that one each is likely right); and the `owners` field, which should name the new personas once the round assigns them.

---

## §9. Interview signals and work samples (draft, for the round)

**DS.** Give anonymised minute-resolution power data for a handful of households over two weeks plus weather. (1) Infer the water-heater operating pattern. (2) Design an experiment to verify a control-algorithm change — what is held constant? (3) Name three data points you are not currently collecting that should be added, ranked by expected effect.
→ Looking for: physical common sense; sensitivity to confounding; posture toward the unmeasurable; cost/effect trade.

**AE.** Design the analysis platform for tens of thousands of households × 3 years × 30-minute data, verbally, in 30 minutes. Storage format, partitioning, how the intermediate-aggregation granularity gets decided — and the lead time when an analyst arrives with a new angle.
→ Anti-signals: starts from tool selection; pushes all-real-time; never asks who is deciding what.

**Behavioral.** asp-cloud, before the trial starts; residents do not understand dynamic pricing. What does the first email and the first screen say, and what do they deliberately withhold? Then: name three moments where trust breaks, and how you would detect and measure each.
→ Anti-signals: stops at personas; qualitative with no indicators; instant reach for nudging.

---

## §10. Sources (as of 2026-08-06)

- Airbnb's Analytics / Inference / Algorithms split — [Prepfully: Airbnb Data Scientist Interview Guide](https://prepfully.com/interview-guides/the-ultimate-airbnb-data-scientist-interview-guide)
- Netflix's experimentation / causal-inference focus — [Netflix TechBlog: Experimentation is a major focus of Data Science across Netflix](https://netflixtechblog.com/experimentation-is-a-major-focus-of-data-science-across-netflix-f67923f8e985)
- What a home-energy DS role actually contains — [Built In: Data Scientist (Bliq)](https://builtin.com/job/data-scientist/6215829)
- Bidgely's disaggregation and DS bench — [Bidgely: Disaggregation](https://www.bidgely.com/technology/disaggregation/)
- Uplight's lineage and Sense — [Canary Media: Sense raises $105M](https://www.canarymedia.com/articles/grid-edge/sense-raises-105m-to-bring-real-time-home-energy-data-to-the-masses)
- NILM on low-frequency smart-meter data — [ScienceDirect: NILM with very low-frequency data from smart meters in Switzerland](https://www.sciencedirect.com/science/article/pii/S0378778825007327), [arXiv: NILM using Deep Neural Networks — A Review](https://arxiv.org/pdf/2306.05017)
- Data engineer vs analytics engineer, and the semantic layer — [dbt Labs: The analytics engineer in 2026](https://www.getdbt.com/blog/the-analytics-engineer-in-2026-system-designer-governance-owner-ai-context-provider)
- AMI / smart-grid data-engineering postings — [Glassdoor: Data Engineer, Smart Meter LLC](https://www.glassdoor.com/job-listing/data-engineer-mid-senior-level-smart-meter-llc-JV_IC1154429_KO0,30_KE31,46.htm?jl=1010108060913), [Indeed: Smart Grid Data Engineer jobs](https://www.indeed.com/q-smart-grid-data-engineer-jobs.html)
- Opower, behavioural energy efficiency, and normative comparison (Cialdini) — [Oracle: Opower Reimagines the Home Energy Report](https://www.oracle.com/corporate/pressrelease/oracle-opower-home-energy-report-062220.html), [Rare Behavior Center: Opower — Leveraging Social Norms](https://behavior.rare.org/wp-content/uploads/2020/07/Social-Influences.-Opower.7.8.pdf), [ScienceDirect: The Promise of Behavioral Energy Efficiency in Times of Trouble](https://www.sciencedirect.com/science/article/abs/pii/S1040619020301615)
- Behavioural scientist vs UX researcher — [Connor Joyce: Similar but different — Data Science, User Experience, and Behavioral Science](https://medium.com/behavior-design-hub/similar-but-different-9d5b88c5f2f4), [Michelle Handy, PhD: Breaking into UX & Behavioral Science](https://medium.com/@michellehandy94/a-practical-guide-to-breaking-into-ux-behavioral-science-with-resources-4c602fc54b02)
- Procedural fairness and transparency in dynamic pricing — [ScienceDirect: Ethics, Transparency, and Consumer Trust in AI-Enabled Pricing](https://www.sciencedirect.com/science/article/pii/S2773032826000040)
- Behavioural trust in automation — [PMC: Reliable and transparent in-vehicle agents lead to higher behavioral trust](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10232983/)
- Academic backgrounds in UX research — [Research.com: How to Become a UX Researcher (2026)](https://research.com/advice/how-to-become-a-ux-researcher-education-salary-and-job-outlook)

---

## §11. Bias disclosure

This brief was drafted in a Claude Code session at the operator's request; the §6 decisions are the operator's, recorded here, and the round itself remains unwritten. Market research is based on public web search: most LinkedIn job bodies are not retrievable without authentication, so several claims rest on **company-official pages, academic literature and industry analysis rather than the job postings themselves** — §10 lists what was actually read. Company pool estimates (Bidgely, Uplight, the evaluation consultancies) assert that the capability exists there, not that anyone is reachable or available.
