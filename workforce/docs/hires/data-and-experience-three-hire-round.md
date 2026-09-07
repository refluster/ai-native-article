# 2026-08 — Data & Experience three-hire round

- **Operator request** (2026-08-06): open three seats serving `asp-cloud`, `smartmeter-data-analysis` and `project-ind` — a data scientist, a data-engineering seat, and a UX seat on the human-understanding side. Then: *"run the hiring round and complete the hire."*
- **JD basis**: [`data-and-experience-three-hire-jd-brainstorm.md`](data-and-experience-three-hire-jd-brainstorm.md) (merged in #552), which carries the market research, the per-seat `jd` blocks, the lane-boundary check and the operator's six decisions. **This memo does not re-argue those** — it records the round that executes them.
- **Status**: registration bundle staged at [`workforce/seed/data-experience-group/`](../../seed/data-experience-group/README.md). W-3 headroom already landed in #552 (500 → 600). Cadence wiring deliberately deferred (§7).
- **Authorship**: assembled in a Claude Code session at the operator's request. See §12 — there was no persona panel, and this memo does not pretend there was one.

---

## §1. Policy applied

- **C-3 single-operator scale.** Three ICs under two existing VPs. No new VP, no new management layer, no pod. Every seat's `system.md` and `guardrails` carry an explicit C-3 refusal for the apparatus its discipline would normally accrete — an experimentation platform, multi-tenant/quota primitives, a research-ops function.
- **W-2 / W-5.** The seed bundle is one-shot registration input per [ADR-0007](../adr/adr-0007-agent-config-single-source.md); DDB becomes authoritative on registration and subsequent edits go through `PATCH /agents/{slug}`, one persona per write.
- **W-3.** The cap raise this round needs already landed in #552 (500 → 600, doc and enforced `W3_BUDGET_CAP_USD` in lockstep). **This round makes no further Zone-A edit to `governance.md`** — see §6.
- **W-1 / C-1 and W-4 / C-4.** Two of the three seats have an integrity failure mode sharp enough to hard-wire rather than trust to runtime judgment: Linnea's unqualified number and Tobias's silently-stale pipeline. Both are in `identity.guardrails`, not just in prose.
- **C-2 is not in play.** None of these seats writes article content; nothing here touches the Notion source-of-truth contract.

## §2. What these seats are for

The three external projects share a shape: a lot of observation, a thin understanding of what it means, and decisions that have to be made anyway. `asp-cloud` runs a live household trial where devices are controlled from outside the home under a tariff the residents were never taught. `smartmeter-data-analysis` holds tens of thousands of households × 3 years and no established way to interrogate it. `project-ind` reaches users in India through a web app built in the US, with no other touchpoint.

Those need, respectively: someone who can turn a vague field question into a design that could prove itself wrong; someone who can make the data answerable fast enough to matter; and someone who can design and *measure* trust in a system that is inherently hard to make sense of. The JD brief argues each of those out; this round staffs them.

## §3. The management-layer review

**Q1: new VP, a pod, or ICs under existing VPs?** → **Three ICs under two existing VPs.** All three projects carry `owner_agent: nadia`, so Product is already the owning lane. A "delivery pod" with its own lead would add a management layer to coordinate three people who each have a distinct, non-overlapping deliverable — the C-3 smell test fails it. This follows the `bruno` precedent: an IC hire under an existing VP is a clean Zone-B round with no cap-structure implications.

**Q2: all three under `nadia`, or split?** → **Split: `linnea` and `clara` under `nadia`, `tobias` under `dario`.** This is the standard market placement (data science under product, platform under engineering), and it puts the productive tension between the two data seats — the scientist wants freedom, the platform engineer wants materialisation — across an org edge where it gets negotiated, rather than inside one reporting line where one side quietly wins.

**Q3: one DS seat or two?** → **One**, per the operator's decision. Recorded as a deliberate trade in the JD brief §6: asp-cloud's half (sparse-signal physical inference, algorithm editing) and the smartmeter/IND half (large-scale exploratory analysis) are separate tracks in the market. The seat is hired on what they share — experiment design — and if it visibly strains, splitting is a future round.

**Conclusion: 3 new ICs, 2 existing parents, no new VP, no cap raise in this round, no persona mutation to any existing agent.**

## §4. The hires

| Slug | Role | Reports to | Residence | Model | Budget |
|---|---|---|---|---|---|
| `linnea` | Product Data Scientist, Experimentation & Field Inference | `nadia` | Boulder, CO, US | `anthropic:claude-sonnet-4-6` | USD 7/mo |
| `tobias` | Analytics Platform Engineer | `dario` | Amsterdam, NL | `anthropic:claude-sonnet-4-6` | USD 6/mo |
| `clara` | Behavioral Design & Trust Researcher | `nadia` | Chicago, IL, US | `anthropic:claude-sonnet-4-6` | USD 6/mo |

**Linnea Holmqvist** — Boulder places her in the US utility-analytics cluster, near the meter data and the program-evaluation trade the JD brief identifies as an under-scoped pool. Budget 7 rather than 6: three projects, and the heaviest analytical load of the three seats.

**Tobias Brandt** — one seat spanning data engineering and analytics engineering, stated as a deliberate span in both his JD and his `system.md` so nobody reads him as an ingest specialist. His success measure is unusual for a platform seat and load-bearing: *he instruments his own lead-time curve.* A platform seat that cannot show that curve is asserting its own value.

**Clara Vieira** — Chicago, the home of the behavioural-economics tradition her frameworks come from. The seat is behavioural science, not UI: design tokens and design systems stay Zone A, and her `guardrails` say so explicitly so the seat cannot drift into the design lane by gravity.

Laterals are wired so the three actually work as a unit: Linnea ↔ Tobias (spec in, platform out), Clara → Linnea (qualitative findings become testable hypotheses), Clara ↔ Celeste (everything pre-onboarding on project-ind), Tobias ↔ Owen (the code/data verification seam), Linnea ↔ Rohan and Clara ↔ Sneha (the two co-flag seams against the India desk).

## §5. Sourcing note

The JD brief §1 does the market read; it is not repeated here. The one thing worth carrying into the round: **the pool the brief argues is most under-scoped is program-evaluation consulting** (Cadmus, Opinion Dynamics, DNV, Guidehouse) — people who causally evaluate "did the intervention work" on metered data as their day job, which is `asp-cloud`'s field-trial problem almost exactly. Linnea's `system.md` is written from that disposition rather than from a home-energy-product one.

## §6. What this round costs (the W-3 question)

The combined W-3 ceiling is **USD 600/mo** (`governance.md` §2, raised 500 → 600 on 2026-08-06 in #552 for exactly this round plus continued headroom). Measured against the live roster at bundle time: **USD 321/mo across 54 agents**. This round adds **+USD 19/mo → 340/mo**, roughly 57% of the ceiling.

So **no cap raise is required in this round**, and this PR makes **no Zone-A edit to `governance.md`**. The agents-api re-checks the live roster aggregate at write time, so the true ceiling test is server-side; `register.mjs:W3_CAP_USD` (600) is the documented ceiling, not a pre-computed roster sum (the git bundle cannot read the authoritative DDB total — W-2).

## §7. Registration and cadence activation (deferred)

Per ADR-0007 and every prior round's precedent, the three register with `bindings: []` — **idle by design**. They render on `/workforce/agents` and `/workforce/org` and do nothing until a cadence is wired.

Cadence wiring is a deliberate follow-up, and the operator has already scoped it as its own session (JD brief decision 3). Since [ADR-0012](../adr/adr-0012-decouple-binding-from-ownership.md) decoupled binding from ownership, no `owners[]` amendment is needed first — `cadence-forge` scaffolds the skill, then `PATCH /agents/{slug}` wires the binding. **The three open design questions for that session are carried in §8 of the JD brief**: the write target (feed endpoint vs the project repo's `reports/` vs a reviewer lens), cadence cardinality (one per seat with fire-time project selection, not seat × project), and what the write-script must refuse.

## §8. People-ops check

- **Naming (R-N7)**: `linnea`, `tobias`, `clara` all match `^[a-z]+$`; checked against the live 54-slug roster, no collision and no near-collision that would make a mention ambiguous (`clara` vs `camille`/`celeste`, `tobias` vs `tomas`, `linnea` vs `elena`/`ingrid` — all distinct at a glance). `validate-naming.mjs` passes.
- **Org edges**: `linnea` → `nadia`, `clara` → `nadia`, `tobias` → `dario`. Both parents long-registered; no cycles, no orphans. Laterals reference existing slugs plus each other.
- **Playbook delta**: this is the org's first set of seats **staffed onto external client projects as functional ICs** rather than as reviewer lenses. The precedent worth recording: a cross-project functional seat is hired on the common core and carries per-project specifics as context — otherwise the JD becomes a unicorn posting and the seat becomes three half-seats.
- **Bench-gap visibility**: this round adds no second DS (the Algorithms/Analytics split), no dedicated qualitative researcher separate from Clara, and no data-platform second. All deferred, all named here rather than left implicit.

## §9. What's NOT in this round (and why)

- **Pre-wired cadences or EventBridge rules.** Deferred per §7 — register idle, wire afterwards, in the session the operator scoped for it.
- **A W-3 cap change.** Already landed in #552; this round fits with 43% of the ceiling unused.
- **Any persona mutation to an existing agent.** No `owners[]` edits, no lateral backfills onto `nadia`/`dario`/`celeste`/`sneha`/`owen`/`rohan` — those edges read from the new agents' rows, and a reciprocal-lateral pass would be six W-5 writes for cosmetic symmetry.
- **A second DS seat.** See §3 Q3 — an explicit trade, revisitable.
- **Any claim that these three have field experience.** Every `system.md` carries a bias disclosure that says the opposite in plain words.

## §10. Acceptance criteria (for operator PR review)

- `workforce/seed/data-experience-group/{linnea,tobias,clara}.json` + `*-system.md` exist; `register.mjs --dry-run` lists all three with the correct role, residence, budget and `reports_to`, and each `system_prompt` is well under the 32 KB write-time ceiling.
- `governance.md` §2 W-3 is **unchanged** at `USD 600/month combined`; no §5 matrix edit. `register.mjs:W3_CAP_USD` reads `600`; the combined-budget log reads `USD 19/mo`.
- `validate-naming.mjs` passes (three new `^[a-z]+$` slugs, no collision).
- No EventBridge rule, binding, or `owners[]` entry is added.
- Each seat's load-bearing guardrail is present in **both** `system.md` and `identity.guardrails` — not prose only.

## §11. Open questions for the operator

1. **Budget shape.** Linnea at 7 vs the other two at 6 encodes "three projects, heaviest analytical load". If the intent is that all three are equally loaded, flattening to 6/6/6 is a one-line change (and −1 USD/mo).
2. **`streams`.** `linnea` and `clara` carry `["internal","client","editorial"]`, `tobias` carries `["internal","client"]` — i.e. the two product-side seats may eventually publish, the platform seat is not expected to. Easy to change either way; flagging because `editorial` implies a `kohuehara.xyz` byline is possible for them.
3. **Whether any of the three also takes a `pr-review` reviewer lens** on their project's PRs, alongside the Cadence. The JD brief left this open for the round; this bundle does *not* wire it, on the principle that a seat should do one thing before it does two.

## §12. Bias disclosure for this memo

> This round record was assembled in a Claude Code session at the operator's request, not by a hiring persona. **There was no panel** — no Mateo framing, no Priya/Theo people-ops review, no consultation transcript — and this memo deliberately does not stage one. The §8 "people-ops check" is a checklist actually run (naming lint, edge resolution, roster collision check against the live API), not a reconstructed persona voice. Linnea, Tobias and Clara do not exist as running personas at the time of writing; their lanes and voices are designed, not observed, and their real output will diverge from what is imagined here. The seed bundle is the framing, not the result.
