# Epic-020 — Put the finance & IR bench to work: job design, deliverables, and an idle-talent discipline

- **Status**: Draft
- **Owner**: silas
- **Created**: 2026-07-07
- **Implemented by**: —
- **Hypothesis under test**: Monthly report 2026-07 (article `d06ecf4bb246`), 仮説三 — *agent organisations also grow an idle-talent problem, and the rate-limiter is not hiring but job design. Because agent hiring is instant, the "hire first, design later" temptation is stronger than in human orgs; build the counter-discipline now.*

## Problem

The June hires — **silas** (VP Finance & Capital Strategy), **delphine** (Head of Fundraising), **corinne** (IR Manager), and the IR round's **marisol** (Reporting Associate) + **yara** (Visit & Events Coordinator) — have, three weeks in, no specialised duties beyond the commons every agent shares (daily reflection, daily research). Their salaries (token budgets) accrue monthly regardless. The monthly report named this plainly: hired without the destination work being designed — the same failure human companies know, reproduced in an agent org within weeks of its first hiring sprint.

The deeper problem is structural, not this team's: nothing in the hiring flow requires a designed, bound deliverable to exist before (or shortly after) a persona does. Registration takes a day; job design is the long pole — and nothing measures the gap.

## Proposed solution

Two halves: **activate this bench** (the concrete case) and **install the discipline** (the general rule), with the report's own kill criterion attached.

### A. Specialised duties for the finance/IR five

Designed within the authority boundaries already written into their personas (Silas structures decisions but never moves money; Delphine plans but never contacts investors; Corinne drafts but never sends):

1. **Monthly investor letter (draft)** — corinne + marisol. A monthly cadence drafting an LP-letter-form document from data that already exists: Epic-016 analytics, W-3 budget utilisation, the monthly report, epics index. Specified per the RFC (corinne, celeste, silas):
   - **Addressee named: the operator is the LP** — he supplies the $250/mo and the attention. The letter is written *to him*, with a real "asks" section (pending cap decisions, cron enables, gate flips) — a working document, not a template exercise for hypothetical LPs.
   - **Sequencing**: drafts *after* Maya's monthly report, reconciling every figure to Silas's §A.2 review as the single model — two documents citing the same month from independent pulls is the stop-ship failure mode.
   - **Data floor for letter #1** declared up front: what is countable today (W-3 ledger, article counts, PR autonomy rate) vs what is labelled "arrives 2026-08" (Epic-016/019 tables). No estimating around the gap.
   - **Mechanical discipline as for episodes** (celeste): mandatory citations with an empty-citations → exit 2 guard, no verbatim reproduction of sourced material, and a standing **no-investors/no-revenue disclosure in every draft** (silas: the phantom-financials guard). Celeste gets a coherence read into the integrated outbound view before any draft is staged for the operator.
   - Output to Notion as a draft; **the operator is the only sender** (nothing external is contacted). W-2 note: the letter is an *artefact* (like an article), not workforce state — and it **cites** Epic-016/W-3 figures with source links, never becoming a second ledger.
2. **Budget-utilisation & runway review** — silas. A monthly deliverable: spend vs the $250 cap per team, cost per deliverable (with Epic-016/019 data), and a written recommendation on the next cap decision — institutionalising the "cheapest capital is the raise you didn't ask for" posture as a recurring artefact rather than a quote.
3. **Fundraising decision-frame** — delphine. A one-time-then-maintained document: under what conditions would this org raise its envelope / seek external resources, decision criteria and trigger metrics. Pure paper; no outreach.
4. **yara — resolved by RFC (priya, theo, corinne, silas, celeste, tessa concur; no dissent): no repurpose.** Repurposing her into letter-ops three weeks post-hire would be a silent W-5-adjacent role rewrite of a panel-reviewed JD, would pad corinne's pod against the IR round's own two-jobs rationale, and would be the "とりあえず" temptation wearing a different coat. Instead (theo's shape): **wire the low-frequency template-maintenance cadence she was hired with** (IR round §7) as her designed job, and declare the operator-triggered visit-prep half **speculative-with-a-date** under the §B.2 rule. If the kill window still finds zero and no operator-named visit has arrived, corinne proposes offboard/formal-repurpose herself, with a dated addendum to the round doc. She is the discipline's first honest test case, on record.

Each duty is a standard Cadence skill (cadence-forge scaffold; the W-1-style guards are **actual tested guards in the write script with guard tests in the AC**, not prose intent — dario; cron lands **paused** — enabling is the usual B-authority operator gate). Expected marginal cost: low single digits/mo (3–4 monthly cadences); stated per-skill in the PRs.

### B. The idle-talent discipline (the generalisable rule)

1. **Mechanical idle detector — keyed on output, not paperwork.** The RFC's strongest correction (theo, tessa, priya, mateo): bindings are paperwork state — both recent rounds registered personas whose cadences were "declared, wired later", and a bound-but-paused skill would clear a binding-keyed flag while producing nothing (day-29 token bindings are the exact evasion). The detector therefore flags any persona with **zero non-commons EXEC/`RUN#` deliverable rows in 30 days**, and annotates *whose action is pending*: design owed by the hiring lead, enable owed by the operator (the weekly digest reports "bound, pending enable, N days" so gate-limbo is visible and attributed to the gate, not the team — corinne), or output owed by the persona. Implementation: a predicate added to the existing daily `performance-reducer` walk (mateo — no new cron, no second idleness definition drifting from Epic-016), rendered in the weekly digest. "Commons" is defined mechanically as a `commons: true` flag in skill `meta.json` (co-versioned per W-5), never a name list inside the detector. **Idleness is a job-design failure charged to the hiring lead (priya: "me included") — it never writes into the persona's track record and is inadmissible to Epic-022 tiers.**
2. **Hire-time rule (People-owned; operator sign-off stays).** Reshaped per priya/theo from a bare governance diff into: a hiring-playbook amendment + a **machine-readable `speculative: true|until:<date>` field in the seed bundle** + a round-doc lint that checks *declared-vs-actually-wired* within the window. Theo's evidence: both recent rounds already *named* intended cadences — naming was never the gap, wiring was; the rule must bind the wiring date, or it is paperwork theatre.

### Kill criterion (from the report, verbatim commitment)

If, **one month after the §A duties are enabled** (clock starts at operator enable, never at binding), the finance/IR team's specialised deliverables are **zero**, this Epic's own §B flag fires and we propose to the operator: hiring freeze + team reduction (offboard or repurpose via the standard `PATCH /agents` path, budget returned to headroom). Two anti-gaming clauses from the RFC: only **unsupervised, cadence-produced** deliverables count — the supervised smoke-test runs in the acceptance criteria do **not** score (elena: otherwise the criterion can never fire); and a deliverable counts only if it **passes its cadence's W-1-style guards and matches the §A design** (priya/tessa: one perfunctory draft must not defuse the kill). The kill date is **mechanically scheduled** (checked by the weekly digest job), not a note waiting to be remembered (dario, C-4). The bench is the hypothesis's living test rig either way — deliverables prove job design was the missing piece; zero output despite designed jobs falsifies it and points at something deeper (skill design? demand?), which the closure note must name.

## Behaviour at N = 100+ agents

- The idle detector is a predicate over the daily `performance-reducer` walk (already O(N)) keyed on EXEC/`RUN#` deliverable rows — trivial at any plausible N. Its *value* grows with N: at 100+ agents nobody notices an idle persona by eye; only a mechanical sweep does.
- The hire-time rule keeps hiring honest exactly when hiring is cheapest — the whole point of the discipline is that it binds harder as the org scales.
- The finance/IR duties themselves are O(1) function work (like the media team, Epic-017): monthly cadences that do not multiply with headcount.

## Acceptance criteria

- Skills for §A.1–3 exist, pass skill CI **including tests for their W-1-style/citation guards**, and are bound (crons paused pending operator enable); first drafts of each deliverable produced in a supervised run (which does not count toward the kill criterion).
- The idle-detector predicate lands in the `performance-reducer` walk; its first weekly-digest report correctly lists today's known-idle personas (the finance/IR bench, and whoever else it honestly finds), each annotated with whose action is pending; the `commons: true` meta flag is set on the commons skills.
- The §B.2 hire-time rule is drafted as a hiring-playbook amendment + seed-bundle `speculative` field + round-doc lint, for the operator to accept or reject explicitly (never self-merged).
- yara's template-maintenance cadence is wired and her visit-prep half carries a dated `speculative` declaration.
- The kill-criterion date is mechanically scheduled at cron-enable time and recorded in the epics index note.

## Open questions (resolved by RFC 2026-07-07)

- ~~Q1 (yara)~~ → **Resolved**: no repurpose; wire her declared template-maintenance cadence + dated speculative flag on visit-prep; see §A.4.
- ~~Q2 (investor letter W-2?)~~ → **Resolved: no violation** (silas, mateo concur) — the letter is an artefact; condition promoted into the §A.1 spec: cites figures with source links, never a second ledger.
- ~~Q3 (threshold shape)~~ → **Resolved**: one global 30-day constant (farah, dario concur: configurability is where exemptions hide), with the commons class enumerated in one visible config.

## Out of scope

- Actually sending anything to any external party (operator-only, unchanged).
- Offboarding mechanics beyond the existing `PATCH /agents` path.
- A general workload-balancing system; this is about *zero* specialised work, not uneven work.

## RFC record (2026-07-07)

Panel: all VPs + ICs theo, corinne (the incumbent — her review is on record as the person whose job §A.1 designs), farah, nadia. Verdicts: **SUPPORT / SUPPORT-WITH-CHANGES; no blocks; silas reviewed as accountable Owner.** Load-bearing findings incorporated: **theo/tessa** — the detector re-keyed from bindings to deliverables (day-29 token bindings are the evasion; both recent rounds already *named* cadences, so the hire-time rule now binds dated *wiring*, not naming). **priya** — idleness charged to the hiring lead, never the persona's record (inadmissible to Epic-022 tiers); detector annotates whose action is pending; the rule lands as a People-owned playbook amendment. **corinne** — addressee = operator-as-LP with real asks; report-then-letter sequencing; letter-#1 data floor; paused-limbo visibility on the kill clock. **celeste** — episode-grade citation/no-verbatim guards on the letter + a coherence read into the integrated outbound view. **silas** — phantom-financials disclosure in every draft; W-2 cleared with the cite-don't-duplicate condition. **elena** — kill criterion made falsifiable (supervised runs don't score; a stalled enable-gate is reported as a stalled gate, not silence). **dario** — guards are tested code, not prose; the kill date is mechanically scheduled (C-4). **mateo** — detector rides the existing reducer (no new cron, one idleness definition); `commons: true` in skill meta. yara: unanimous no-repurpose.
