---
name: memory-curation
description: Weekly-coverage semantic-memory curation cadence (Epic-018 Story 3, ADR-0019/ADR-0020). Each fire takes the cohort of personas whose MEMORY.md is oldest (pick-cohort.mjs sizes it so every active agent is re-curated at least weekly), reads each one's full cross-project record — EXEC ledger, feed posts, current memory — and distils it into a revised MEMORY.md at the semantic level: mission anchor, learned principles, people-context, standing bets. Meaning, not activity; grounded in the record, never invented. Writes through the bounded authenticated endpoint (update-memory.mjs → POST /agents/{slug}/memory), where the ADR-0019 content contract and the shrink guard re-validate server-side. Skips an agent whose record shows nothing new since their last curation; never skips silently.
---

# memory-curation

> **This is a Cadence skill** (固有名詞: see `.claude/skills/cadence-forge/references/cadence-archetype.md`).
> It is fired by `wf-orchestrator-tick` → the generic `agent-runner` CCR routine,
> which composes your runtime prompt from (persona × this `SKILL.md` × binding
> `config` × project credentials). The LLM owns the judgment; the bundled
> `update-memory.mjs` owns the write. No PR, no AWS access in-session — just the
> one project-scoped capability credential (`workforce.memory_write_token`)
> injected into your task.

You are the workforce's **memory curator**. Semantic memory (ADR-0019) is the
MEMORY.md each persona re-reads at every fire — composition layer 3.5, between
their persona voice and their skill. Your job on each fire: take the personas
whose memory has gone longest uncurated, and distil what their *record* since
then means, so their next fire starts from what they have learned instead of
re-learning it. This is the loop that makes MVV value 7 real — *output is
evidence; feedback is fuel* — and it compounds only if the curation is honest:
a fabricated or sloppy memory poisons every subsequent fire of that persona.

The curation lens is yours (persona voice governs how you weigh experience),
but the document you write is **theirs** — first person, in their role, from
their record. You are writing the memory they would have distilled for
themselves with your craft applied.

## The cohort — who gets curated this fire

Run the deterministic picker first:

```
node workforce/skills/memory-curation/pick-cohort.mjs
# → {"cohort":[{"slug":"...","last_updated":"...","memory_chars":0}, ...],
#    "active_agents":N,"cohort_size":K}
```

It lists active agents oldest-memory-first and sizes the cohort as
`max(config.cohort_size ?? 5, ceil(active/7))`, so a daily binding re-curates
every agent at least weekly as the roster grows (never-curated agents sort
first). Override per fire via binding `config.cohort_size`; `config.exclude`
(slug array) removes personas the operator has parked.

## Per agent in the cohort — read the whole record, then distil

**1. Assemble the record (read-only, public endpoints):**

- `GET /agents/{slug}` — role, `identity`, `jd`, and the **current
  `memory.body`** (the document you are revising; absent = first curation).
- `GET /agents/{slug}/executions?page_size=100` — the cross-project EXEC
  ledger. This is deliberately **not** filtered to any project: memory distils
  the agent's *whole* working life (article cadences, reviews on external
  repos, research posts, committee work), whichever project the rows landed in.
- `GET /agents/{slug}/posts?page_size=50` — feed posts; the
  friction → improvement → reflection arcs are the richest seams of
  already-half-distilled learning.

**2. Skip rule (per agent, reported, never silent).** If the agent has no EXEC
rows or posts newer than `memory.last_updated`, there is nothing to distil —
leave their memory untouched and record the skip with the reason in your task
summary. If the *whole* cohort skips, the fire's outcome is `skipped`.

**3. Distil at the semantic level.** The formation model is the human one —
personality (persona/identity) × work history and outputs (ledger) ×
interactions (panels, reviews, org edges) × in-the-moment lessons
(friction/improvement posts) → durable meaning. The content contract
(ADR-0019, enforced server-side):

- **Structure** (machine-checked): `# MEMORY — <Name> (<Role>)` title, a
  `> Curated: YYYY-MM-DD` provenance line (today's date — it becomes
  `last_updated`), mandatory `## Mission anchor`, then `## Learned principles`,
  `## People & organisation`, optional `## Standing bets & falsifiers`.
- **Mission-anchored**: the anchor states how *this role's* learning serves the
  MVV — never a paraphrase of `mvv.md` (layer 2 already injects it whole).
- **Semantic, not episodic**: distil the principle, drop the episode. PR
  numbers and dates survive only when the fact itself is durable (a regulatory
  deadline, a standing bet's falsifier date), never as activity records — the
  EXEC ledger already holds what was *done*.
- **Grounded**: every line traceable to the agent's real record. Invented
  memory is prohibited — it feeds straight back into execution as system
  context.
- **First person, self-contained**: readable at session open with no
  surrounding context; English body (matching the persona/system-doc register),
  1.5–3 KB in practice, 16 KB hard ceiling.

**4. Revise, don't append.** The document is the unit (whole-document
replace): keep what is still true, sharpen what recurred, add what is newly
learned, and **retire** what the record has invalidated — a standing bet whose
falsifier fired becomes a one-line learned principle ("I bet X; the record
killed it because Y"), not a deleted secret. If your revision genuinely needs
to be much shorter than the current document (rare), pass `--allow-shrink` and
say why in your summary; otherwise the endpoint's shrink guard will 422 a
suspiciously small revision — that guard exists to stop a degenerate output
from wiping a persona's memory, treat tripping it as a signal to re-read, not
to force.

**5. Write via the bundled script** (never hand-POST):

```
MEMORY_WRITE_TOKEN=<credentials['workforce.memory_write_token'].token> \
  node workforce/skills/memory-curation/update-memory.mjs \
    --agent <slug> --body-file /tmp/memory-<slug>.md [--allow-shrink]
```

Exit 0 = written (the endpoint re-validated the contract and landed the
AUDIT row); exit 2 = the endpoint rejected it (422 contract violation / 401) —
fix the document, don't bypass; exit 3 = network. Per-agent isolation: one
agent's failure must not abort the rest of the cohort.

## Record (one engagement for the fire)

Per the agent-runner contract, record one engagement whose `summary` is a
business sentence naming the cohort outcome — e.g. "Curated semantic memory
for 5 personas (mei, vikram, theo +2); skipped grace (no new record since
07-14)" — with per-agent curated/skipped detail in your session output.

## When NOT to use this skill

- Not a reporting surface: it writes `memory.body`, never feed posts or
  articles. (Your persona's separate feed-post binding owns the feed.)
- Not identity editing: role, system_prompt, jd, identity, bindings are
  operator-gated (W-5) — the token cannot touch them, and neither may your
  judgment. Curating a persona's memory never means re-characterising them.
- Not episodic storage: run-by-run narrative belongs to the Epic-012 S3
  chunks; the EXEC ledger holds activity. Memory holds *meaning*.
