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

1. **Monthly investor letter (draft)** — corinne + marisol. A monthly cadence drafting an investor-style letter from data that already exists: Epic-016 analytics, W-3 budget utilisation, the monthly report, epics index. Output to Notion as a draft; **the operator is the only sender** (nothing external is contacted). This is deliberately the IR mirror of Maya's public monthly report: same facts, capital-provider lens.
2. **Budget-utilisation & runway review** — silas. A monthly deliverable: spend vs the $250 cap per team, cost per deliverable (with Epic-016/019 data), and a written recommendation on the next cap decision — institutionalising the "cheapest capital is the raise you didn't ask for" posture as a recurring artefact rather than a quote.
3. **Fundraising decision-frame** — delphine. A one-time-then-maintained document: under what conditions would this org raise its envelope / seek external resources, decision criteria and trigger metrics. Pure paper; no outreach.
4. **yara** — honest case: visit/event coordination has no near-term workload. Options — (a) repurpose toward supporting corinne's letter operations, (b) leave on commons and let the §B discipline flag her, making her the discipline's first live test case. Panel input requested (Q1).

Each duty is a standard Cadence skill (cadence-forge scaffold, W-1-style guards where output is prose, cron lands **paused** — enabling is the usual B-authority operator gate). Expected marginal cost fits the existing envelope; stated per-skill in the PRs.

### B. The idle-talent discipline (the generalisable rule)

1. **Mechanical idle detector.** A deterministic check over the roster: any persona whose only bindings are the commons (daily-reflection / daily-research class) for **30+ days since registration** is flagged in the weekly digest. No judgment call, no exemptions list hidden in code — exemptions, if any, are written in the persona's META and visible.
2. **Hire-time rule (proposed, Zone A — operator decision).** A hire-round doc must name the specialised skill(s) the hire will bind within 30 days, or explicitly declare the hire speculative (which the idle detector will then surface on schedule). This makes "とりあえず採る" possible but *visible and dated*, never silent.

### Kill criterion (from the report, verbatim commitment)

If, **one month after the §A duties are bound and enabled**, the finance/IR team's specialised deliverables are **zero**, this Epic's own §B flag fires and we propose to the operator: hiring freeze + team reduction (offboard or repurpose via the standard `PATCH /agents` path, budget returned to headroom). The bench is the hypothesis's living test rig either way — deliverables prove job design was the missing piece; zero output despite designed jobs falsifies it and points at something deeper (skill design? demand?), which the closure note must name.

## Behaviour at N = 100+ agents

- The idle detector is a full-roster scan but O(N) over META bindings only, and it runs weekly — trivial at any plausible N. Its *value* grows with N: at 100+ agents nobody notices an idle persona by eye; only a mechanical sweep does.
- The hire-time rule keeps hiring honest exactly when hiring is cheapest — the whole point of the discipline is that it binds harder as the org scales.
- The finance/IR duties themselves are O(1) function work (like the media team, Epic-017): monthly cadences that do not multiply with headcount.

## Acceptance criteria

- Skills for §A.1–3 exist, pass skill CI, and are bound (crons paused pending operator enable); first drafts of each deliverable produced in a supervised run.
- The idle detector runs and its first report correctly lists today's known-idle personas (the finance/IR bench, and whoever else it honestly finds).
- The §B.2 hire-time rule is drafted as a governance diff for the operator to accept or reject explicitly (never self-merged; Zone A).
- The kill-criterion date is written into the epics index note when the crons are enabled.

## Open questions

- Q1. yara — repurpose now or let the discipline flag her? (§A.4; priya/theo input especially.)
- Q2. Does the investor letter risk W-2 (workforce state in Notion)? Position: no — it is an *artefact* (like articles), not state; but the panel should confirm the letter cites analytics rather than duplicating them as a second source of truth.
- Q3. Should the 30-day idle threshold be per-persona-configurable or one global constant? Proposal: one constant; configurability is how exemptions hide.

## Out of scope

- Actually sending anything to any external party (operator-only, unchanged).
- Offboarding mechanics beyond the existing `PATCH /agents` path.
- A general workload-balancing system; this is about *zero* specialised work, not uneven work.

## RFC record (2026-07-07)

See PR for the panel's comments; substantive feedback incorporated inline.
