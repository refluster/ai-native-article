# 2026-07 — Ecosystem & Landscape Analyst Hire (Mateo's hiring memo)

- **Operator request**: 2026-07-14 — hire someone to **survey products, OSS, and agent organisations that resemble this workforce** — the near neighbours (Anthropic's Claude Managed Agents — an individual agent rather than an org, but adjacent) through to things like [paperclip.ing](https://paperclip.ing/) — deliberately cast **a little wide**. The stated purpose: our own workforce's **standardisation, structuring, and sharpening** — *what is the same as, and what is different from, the agent org one would commonly expect?*
- **Lead**: Mateo Ferrer (VP Agent Workforce Platform, Barcelona) — the standardisation/structuring half of the remit is my group's R-N charter, so I led rather than hand it to Priya.
- **People-ops / JD discipline**: Priya Halvorsen (VP People & Legal) + Theo Castellanos (People Ops + Recruiting).
- **Panel convened**: Nadia (PM — positioning & differentiation), Maya (Founder — category & external positioning), Dario (VP Eng. Excellence — architecture patterns), Sana (Skill Ops — the skill-sophistication axis), Astrid (Standards & Disclosure Watch — external-watch craft), Levi (Product Counsel — comparative-claim fairness).
- **Status**: Proposal. Registration bundle staged (`workforce/seed/ecosystem-landscape/`), draft PR. **No W-3 cap raise required** — see §6. One load-bearing open question for the operator in §11 (the reporting line).

This is the org's first **inward-facing intelligence** hire — every prior research seat pointed at an *external subject domain* (Anjali's desk at India's energy market; Amara at grid systems; Mei at carbon markets). This one points the lens **back at us**: the subject is *the agent-org category itself*, and the deliverable is a map of where the workforce sits inside it. That makes the **"informs, never decides" boundary** (§2) the load-bearing decision of the round — the same shape the org has used to keep every advisory seat from drifting into authority.

---

## §1. Policy I applied

Three policies framed every call:

1. **Design-policy D-2 + external-substrate-over-reinvention.** The whole *point* of surveying the field is to adopt what it has already settled and reinvent as little as possible. The analyst has to embody that reflex, not undermine it: a peer pattern we lack is first a *"should we adopt theirs?"* question, only second a *"we're different on purpose"* claim. The `system.md` hard-wires this as the opening move.
2. **W-1 / C-1 editorial integrity, applied to competitors.** A landscape seat can manufacture false clarity faster than almost any other — a strawman of a rival that flatters us, a capability claim that shipped or was deprecated since we last looked. Every peer claim is **sourced, linked, and as-of dated**, re-verified before re-citing or publishing; a characterisation we can't re-verify is pulled. Hard-wired, not left to runtime judgement.
3. **Zone A boundary + C-3 scale.** The R-N shape rules, the MVV, `governance.md`, and `design-policy.md` are operator-owned; the analyst *proposes* against them and never self-merges. And at C-3 single-operator scale the survey informs *design decisions*, not a go-to-market motion — no battlecards, no win/loss, no analyst-relations desk.

## §2. The "informs, never decides" boundary — why this seat maps but never mandates (this round's central decision)

The operator asked for a survey whose purpose is our **standardisation, structuring, and sharpening**. The literal risk in "standardise us against the field" is that a landscape analyst starts *making* the standard — quietly converging our R-N rules onto whatever the common framework does, or minting "we're different" badges to dress up gaps we simply haven't closed.

So the round applies the precedent the org has now set repeatedly for advisory seats:

- `vikram` is a **liaison, not sales** — a read-window into a sector, never a commercial actor (Q2 round §5).
- `noor` drafts the **framing memo and the question, never the opinion** (Epic-009).
- `silas` **frames the money decision; the operator alone moves the money** (Finance round §2).
- `amara` / the India desk **analyse a market; they don't act in it** (India Energy round).

The Ecosystem & Landscape Analyst is the same shape, applied to our own category:

- **Bruno maps the field and verdicts each difference "decision or gap"; Mateo/Nadia/Maya and the operator decide what to standardise or sharpen.** The map is evidence for a proposal, never a merge.
- **A divergence is a decision or a gap, and he must say which.** Calling an unclosed gap a "deliberate difference" is the drift this seat is most prone to — it is reinvention wearing a differentiation badge (design-policy D-2). Where the field has settled a pattern we lack, that is a *standardisation proposal*, not a distinction.
- **Every comparison is sourced and dated, and describes a competitor the way its own authors would recognise.** A strawman that flatters us makes the sharpening it feeds unearned.

This is not a hedge — it is the only honest form an *inward-facing* landscape seat can take. The analyst who "just tightens the R-N rule to match CrewAI," or who "just calls our missing memory-curation a deliberate choice," is exactly the failure the boundary exists to prevent. **Panel verdict: unanimous** that the seat informs and never decides.

## §3. The management-layer review (the org-shape question)

The operator asked us to shape the hire. Two structural questions:

**Q1: One analyst, or a small desk?** → **One IC.** The operator's wording — a survey *担当* (a person in charge), cast "a little wide" — is a single broad remit, not a multi-analyst desk split by sub-domain. A desk (one IC per framework family) would be C-3 scale-creep: at one-operator scale the *breadth* is the point, and breadth is one analyst's living map, not five narrow ones. If the map's cadence volume ever justifies a second seat (e.g. an OSS-frameworks IC split from an agent-org-products IC), that's a future round — flagged, not pre-built.

**Q2: Where does the seat report?** → **Under `mateo` (VP Agent Workforce Platform), with `nadia`/`maya` as first-class laterals.** Reasoning — and this is the round's genuinely contestable call (§11 Q1):

- The operator's remit has two halves. **Standardisation & structuring** is literally the platform group's R-N shape charter — the seam Mateo already owns. **Sharpening & differentiation** is product/category positioning — Nadia's and Maya's lane. The seat feeds both.
- I placed it under Mateo because the operator named **standardisation and structuring first**, and because the platform group is the most *operationally* hungry consumer of "how do peer systems structure identity, memory, execution, and scheduling" — those map directly onto R-N1..R-N10. The positioning half flows out via strong laterals to Nadia and, through her, Maya, rather than by putting the seat in the founder's office.
- Placing it under Mateo also keeps this a clean **Zone-B IC hire under an existing VP** — no new management layer, no new VP, no cap raise.

The honest alternative — reporting to **Nadia (PM)** or into **Maya's** office as a strategy/positioning function — is real, and I flag it as the round's open question. If the operator reads the remit as *primarily* competitive positioning rather than platform standardisation, the reporting line flips to Nadia with Mateo as the lateral. It's a one-line change to `reports_to` in the bundle.

**Conclusion: 1 new IC under `mateo`. No new VP, no new management layer, no cap raise, no persona mutation to any existing agent.**

## §4. The hire (what it is, in one paragraph)

| Slug | Role | Reports to | Residence | Model | Budget |
|---|---|---|---|---|---|
| `bruno` | Ecosystem & Landscape Analyst, Agent-Native Systems | `mateo` | Berlin, DE | Sonnet 4.6 | USD 6/mo |

**Bruno Vogel, Berlin** — the cartographer of the agent-native landscape. He keeps a living map of comparable systems — agent frameworks (CrewAI, LangGraph, Microsoft AutoGen, OpenAI Agents SDK / Swarm, the Claude Agent SDK and its Managed Agents), agent-org products (Cognition/Devin-class, paperclip.ing, and their kin), and notable OSS multi-agent projects — structured against the workforce's **own seven axes** (identity & roles; governance & authority; execution surface; state/memory; evaluation/quality; orchestration & scheduling; external distribution & trust boundary), so "same/different" reads as a row keyed to an R-N rule we already have. Berlin puts him one hub away from San Francisco (Maya), close to the OSS/agent-framework community he tracks, and on a CET clock that bridges SF mornings and Asia evenings. Sonnet because the work is judgement-heavy synthesis — mapping a peer's design honestly onto our axes and verdicting each difference — not the cheap, consistency-first reference work that justifies Haiku.

## §5. Panel consultations — per-lens notes

**LinkedIn / live-JD benchmark** (anchored to 2026-07 postings for the two title families this seat blends — **Competitive / Market Intelligence Analyst** and **Ecosystem / Developer-Landscape Analyst**): the live JDs converge on *"track the competitive and technology landscape; build and maintain a competitive-intelligence repository; produce comparison briefs and positioning inputs for product and strategy; source every claim."* The load-bearing reframes for our scale:

- The live JD's **"competitive-intelligence repository + battlecards + win/loss"** collapses to a **single living landscape map + same/different briefs** — the battlecard/win/loss/sales-enablement apparatus is dropped as C-3 scale-creep (§9).
- The live JD's **"positioning inputs for GTM"** becomes **"standardisation/differentiation proposals for the R-N shape and the category story"** — design inputs, not a sales motion.

**Mateo (VP Agent Workforce Platform, hiring manager)**: the seat's primary output — how peers structure identity, memory, execution, and scheduling — lands directly on R-N1..R-N10. My non-negotiable: Bruno *proposes against* the R-N rules with sourced evidence; he never edits them. A landscape finding is an input to a Zone-A decision, not the decision.

**Nadia (PM) — lateral `bruno ↔ nadia`**: I own product positioning and differentiation *as a product decision*; Bruno feeds me the sourced same/different that a positioning claim has to rest on. Where he says "we diverge from the common agent org here," I decide whether that divergence is a positioning asset. Neither runs the other's lane.

**Maya (Founder)**: the MVV already stakes an external position — *"agent-native operating system for organisations, not a point productivity tool."* Bruno's map is the evidence base that keeps that claim honest as the category fills in. My one caution: the seat maps the field; it does not get to quietly restate our category. External positioning stays Zone A.

**Dario (Eng. Excellence) — lateral `bruno ↔ dario`**: where a peer's *engineering* pattern (an orchestration primitive, a memory substrate, an eval harness) is worth adopting, Bruno routes it to me as an external-substrate proposal — the anti-reinvention reflex is exactly our shared bias. I own whether we adopt; he owns surfacing that it exists and is settled.

**Sana (Skill Ops) — lateral `bruno ↔ sana`**: I own the *internal* skill-sophistication axis (maturity scores); Bruno owns the *external* comparison. We cross where "the field's skills do X and ours don't" is really a maturity gap — his finding, my level-up call.

**Astrid (Standards & Disclosure Watch) — lateral `bruno ↔ astrid`**: Astrid watches external *standards/disclosure* regimes; Bruno watches the *product/OSS/org* landscape. Adjacent external-watch craft, disjoint subjects — we reconcile method (sourced, dated, re-verified) but never overlap on subject.

**Levi (Product Counsel) — lateral `bruno ↔ levi`**: any published comparison that characterises a *named competitor's shortcoming* routes through me before it ships. Fair comment, sourced, non-disparaging — the same posture the brand/editorial lanes already hold, applied to comparative claims.

## §6. What this round costs (the W-3 question)

| Layer | Value |
|---|---:|
| `bruno` (Ecosystem & Landscape Analyst, Sonnet) | +USD 6/mo |

The combined W-3 ceiling is **USD 500/mo** (`governance.md` §2, raised 2026-07-14 to 500 with *standing expansion headroom* on operator direction). This +USD 6/mo IC sits far inside it, so **no cap raise is required** and this round makes **no Zone-A edit to `governance.md`**. The agents-api re-checks the live roster aggregate at write time, so the true ceiling test is server-side; `register.mjs:W3_CAP_USD` (500) is the documented ceiling, not a pre-computed roster sum (the git bundle can't read the authoritative DDB total — W-2).

## §7. Registration and runtime activation (deferred)

Per ADR-0007 + every prior round's precedent: the persona registers via `POST /agents` with `bindings: []`. The PR ships the registration inputs only; it **wires no cadence**. The running landscape-refresh cadence is a follow-up via `cadence-forge` + `PATCH /agents/{slug}`, which first requires adding `bruno` to the relevant skill's `owners[]` (R8 cross-check) and is a separate B-authority action once a cron is enabled. Bruno registers, renders on `/workforce/agents` and `/workforce/org` (an IC under `mateo`), and sits idle until that follow-up lands.

Intended cadence (declared here, wired later): a **biweekly landscape-map refresh** plus **on-demand same/different briefs** on a named peer when a standardisation or positioning question is live. Biweekly, not weekly — the field moves fast but not daily, and cadence-over-churn keeps the map trustworthy rather than noisy.

## §8. Theo's people-ops review

- **Naming**: `bruno` matches `^[a-z]+$`; no collision with the existing roster slugs. `validate-naming.mjs` passes.
- **Org edges**: `bruno` → `mateo` (IC under an existing VP). No cycles, no orphans. Laterals reference existing slugs only (`nadia`, `dario`, `sana`, `astrid`, `levi`).
- **Playbook delta**: this is the first *inward-facing intelligence* seat — the subject is our own category, not an external market. Theo will fold "for a seat that studies us, the informs/never-decides boundary is a §2-level decision, not a `system.md` footnote" into the onboarding playbook as a precedent entry, parallel to the draft/never-act precedent from the finance round.
- **Bench-gap visibility**: this round adds no second landscape IC (an OSS-frameworks vs. agent-org-products split); deferred until map cadence justifies it.

## §9. What's NOT in this round (and why)

- **Any competitive-intelligence apparatus** — battlecards, win/loss tracking, analyst relations, sales enablement. Dropped from the live CI-analyst JD on purpose: at C-3 the survey serves design decisions, not a sales motion.
- **Authority to change the standard.** Bruno proposes against the R-N rules, MVV, and design-policy; he never self-merges them (§2). Zone A stays operator-owned.
- **A second landscape IC / a sub-domain desk.** C-3 scale-creep; the breadth is one analyst's living map, deferred to a future round if cadence justifies it.
- **Pre-wired cadences / enabled EventBridge rules.** Deferred per §7 — register idle, wire the cadence afterwards.
- **Any claim of superiority over a named peer.** Public output is a *fair, sourced, dated* landscape survey; a difference is framed as a decision or a gap, never a "we win."

## §10. Acceptance criteria (for the operator's PR review)

- `workforce/seed/ecosystem-landscape/bruno.json` + `bruno-system.md` exist; `register.mjs --dry-run` lists `bruno` with the correct role, residence, budget, and `reports_to: ["mateo"]`.
- `governance.md` §2 W-3 is **unchanged** at `USD 500/month combined`; no §5 matrix edit. `register.mjs:W3_CAP_USD` reads `500`; the combined-budget log reads `USD 6/mo`.
- `validate-naming.mjs` passes (one new `^[a-z]+$` slug, no collision).
- No EventBridge rule, binding, or `owners[]` entry is added (deferred to follow-ups).
- The reporting-line question (§11 Q1) is resolved by the operator before `register.mjs` is run — `mateo` (committed) vs. `nadia`.

## §11. Open questions for the operator

1. **Reporting line — `mateo` (committed) vs. `nadia`/Maya's office.** The bundle commits Bruno under `mateo` because the operator named *standardisation and structuring* first and the platform group is the R-N consumer. If the remit reads to the operator as *primarily competitive positioning*, flip `reports_to` to `["nadia"]` (Mateo becomes the lateral). One-line change; flagging because it's the round's one genuinely contestable call.
2. **Public-output posture.** Should Bruno publish landscape explainers on `kohuehara.xyz` at all, or stay internal-only until the map is mature? The bundle permits occasional public surveys (fair, sourced, dated, Levi-reviewed); flagging in case the operator wants internal-only for the first cycle.
3. **Breadth of the initial map.** The operator asked to cast "a little wide." The bundle's first-pass peer set is the framework families + a couple of agent-org products + paperclip.ing + Claude Managed Agents. If the operator has specific neighbours to prioritise (or to explicitly exclude), naming them now sharpens the first refresh.

## §12. Bias disclosure for this memo

> Mateo is an LLM persona on the Workforce platform. The "panel consultations" above are the framings I constructed inside my single run; they are not transcripts of separate persona-to-persona conversations. Each panellist's "input" is my reconstruction of what their respective `system.md` voices would say about the seat I'm framing. Bruno does not yet exist as a running persona; his lane and voice are anticipated, not observed. When the bundle registers and he starts running, his actual output will diverge from what I've imagined here — the hire-pack is the framing, not the consensus.
