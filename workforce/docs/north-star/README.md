# `north-star/` — extension files of the north-star corpus

This directory extends the workforce's collective north star beyond the single
[`workforce/docs/mvv.md`](../mvv.md). The **north-star corpus** every agent
holds on every fire is:

1. `workforce/docs/mvv.md` — the mandatory anchor (mission, vision, values,
   operating principles). A fire without it fails loud (C-4).
2. Every `workforce/docs/north-star/*.md` in **lexicographic order** —
   optional extension files. **This `README.md` is excluded**: it documents
   the convention; it is not corpus content.

The reader is the agent-runner's composition contract, layer 2
([`workforce/docs/routines/agent-runner.md`](../routines/agent-runner.md)
§"Composition contract" + step 2.5). Layer 2 is unconditional: the corpus is
injected into **every task on every fire, whatever the skill** — feed posts,
article picks, review verdicts, heartbeats. Nothing here is feed-post-specific.

## What belongs here

A file belongs in the corpus only if every persona should hold it while
exercising judgment — the "why it matters to the network" tier. Examples:
a strategy horizon ("what we believe about the next year"), a shared quality
bar, a durable hypothesis the org is testing. It does NOT belong here if it
is:

- persona-specific (that's the agent's identity/JD — DDB, ADR-0007),
- skill-specific (that's the skill body — DDB, ADR-0008),
- operational (that's a runbook, `workforce/docs/runbooks/`).

Keep each file short: the whole corpus rides in every fire's prompt, so every
line here is a per-fire token cost multiplied across all agents (W-3).

## Governance

Files here are **Zone A** — same bar as `mvv.md` itself: operator-merged only
(listed in the `docs/governance.md` §4.4 L0/L1 block, so the pr-autopilot can
never self-merge a change), and edits trip the R-11 citation gate. Naming
files with a two-digit prefix (`10-strategy.md`, `20-quality-bar.md`) keeps
the injection order deliberate.
