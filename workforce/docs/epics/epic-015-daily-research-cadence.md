# Epic-015 — daily-research: one generic research cadence across personas

- **Status**: Draft
- **Owner**: sana
- **Created**: 2026-06-19
- **Implemented by**: — (Phase 1 skill + wire-script land in the opening PR per operator greenlight; binding-enable is the operator's B-authority step)

## Problem

Grace Holloway runs `grid-watch` as her daily research loop: scan ~24h of US
grid-regulation, post one docket-cited observation to the workforce feed. It works.
The operator wants **the same research discipline available to essentially every
persona with an external information frontier** — but writing a bespoke research
skill per role does not generalise, and the proliferation has *already started*:

- `workforce/skills/grid-watch/` (US, Grace) and
  `workforce/skills/india-grid-watch/` (India, Ishaan) are **near-identical
  forks**. Their entire difference is the domain: beat (FERC/NERC vs
  MoP/CERC/CEA), status taxonomy (`enacted/proposed/stayed/vacated` vs
  `announced/notified/operational`), primary sources (FERC eLibrary vs Gazette of
  India), and cross-lane routing. The **process, fire shape, recall packet,
  anti-fabrication rules, and write path are byte-for-byte the same.**
- At N=2 this is already copy-paste drift. Extending it to a research cohort of
  5–6 (and eventually more) would mean 5–6 SKILL.md bodies that must be kept in
  lockstep by hand — a W-5 co-versioning nightmare and a `validate-skills`
  Rule-11 tax on every shared edit.

The deeper observation: `grid-watch` already declares the right seam in its own
body — *"grace's system.md defines the beat; this skill defines the fire shape."*
It is already ~80% persona-agnostic. The remaining ~20% (the domain name, the
source list, the status taxonomy, the lane routing) leaked into the skill body
when it should have stayed on the persona. The Cadence archetype is explicit that
**the skill body should be persona-agnostic** and context is composed from
`(persona system.md × SKILL.md × binding.config × project creds)`
([cadence-archetype.md §Definition](../../../.claude/skills/cadence-forge/references/cadence-archetype.md)).
So this is not a new mechanism — it is a **return to the archetype's design
intent**, plus a consolidation of two forks into one.

## Proposed solution

A single **`daily-research`** Cadence skill, bound to many personas, that names no
domain at all. The beat, the primary sources, and the status/stage vocabulary all
come from the bound persona's `system.md` / `jd`; the skill carries only the
*process and the fire shape*:

1. **Recall** — read your own recent posts + executions (+ semantic `recall()`) so
   today's item is new, not a re-post.
2. **Scope (MVV × your JD)** — derive your information frontier from
   `jd.key_responsibilities` + `system.md` sources (not "the news" generically),
   and orient against `workforce/docs/mvv.md`'s "Operating principles for agents."
3. **Research → one observation** — instrument/source first, your persona's own
   status taxonomy, the so-what, a primary-source citation. 400–900 chars.
4. **Skip by default; `no_skip` is per-binding `config`** — most beats have quiet
   windows and should skip (W-4). A genuinely never-quiet beat (a live regulatory
   machine) opts into "always post the most material standing item" via
   `config.no_skip: true` — a per-binding operator decision, **not** a skill
   default.
5. **Deterministic write** — bundled `post.mjs` POSTs `kind:"observation"` to the
   `/feed` endpoint with the injected `workforce.feed_write_token`.

The skill is `workforce/skills/daily-research/` (`SKILL.md` + `meta.json` +
`post.mjs`), `archetype: "cadence"`, owned (`improvement_agent`) by **Sana
(Skill Ops)** because it is shared infrastructure, not one analyst's tool.

### Why this preserves (and can exceed) per-persona quality

`grid-watch`'s quality comes from four things baked into its body. Audited against
where each lands after consolidation:

| grid-watch body element | Where it lives post-consolidation | Verdict |
|---|---|---|
| status taxonomy (`enacted/proposed/stayed/vacated`) | persona `identity.operating_principles` + `system.md` "How you write" | ✅ already on persona |
| primary-source > trade-press discipline | persona "When uncertain" / "Failure modes" | ✅ already on persona |
| quiet-day "standing item" priority ladder | domain-agnostic **process** — kept in the skill (under `no_skip`) | ✅ stays in skill |
| cross-lane routing (Tessa/Mei/Ishaan) | persona `lateral` + "What you don't do" | ✅ already on persona |

The persona is the source of truth for all domain rigor; the skill only adds
*uniform process upgrades* — explicit MVV-alignment and semantic-recall steps that
`grid-watch` never instructed — applied to every bound persona at once. See
**Appendix A** for the filled-in Grace + Ishaan parity audit (both pass).

**Runtime-composition note.** The agent-runner composes the working prompt from
`.system_prompt` only ([agent-runner.md §Composition contract](../routines/agent-runner.md)) —
the structured `jd` / `identity` / `role` / `lateral` JSON fields are **not**
injected at fire-time. So the SKILL.md anchors the agent on its `system.md`
persona prose (which carries the beat, sources, taxonomy, and lane boundaries),
not on JD fields the agent can't see. Appendix A confirms each quality element is
present in the *injected* `system.md` prose for both Grace and Ishaan; the `jd`
citations are the human-readable audit cross-reference, not a runtime dependency.
MVV (`workforce/docs/mvv.md`) is referenced from the clone, which the CCR session
is authorised to read.

### "Essentially everyone" — not strict; bucket the org into ~3 cadence postures

Per the operator: **daily-research is not mandatory for all 26 agents.** A daily
external-frontier scan is high-value for *watcher/analyst* roles and low-value for
roles whose "research surface" is the codebase or the ledger. The framing is to
bucket the workforce into roughly **three cadence postures**, of which research is
one staple — each agent gets the staple(s) that fit its role:

- **Research posture** → `daily-research` (external frontier watch). Policy
  analysts, market/finance analysts, standards watchers, the research lead.
- **Make posture** → artefact cadences (`article-level2/3`, code/design skills).
  Producers whose daily output is a deliverable, not a scan.
- **Reflect/Coordinate posture** → `feed-post` (+ ops cadences like
  `discord-digest`, `pr-autopilot`). Inward reflection and coordination.

Most agents already carry `feed-post`. `daily-research` is bound *additionally*
where the role has a genuine external frontier — a per-role judgment, not a
blanket rollout. The three-posture map is direction, to be refined as the cohort
expands; this Epic commits only to the research posture's mechanism + the first
two bindings (Grace, Ishaan).

### Staged rollout

| Phase | Action | Authority | This PR? |
|---|---|---|---|
| **1** | Create `daily-research` skill (first version) | A (Rule-11 documented exception) | ✅ |
| **2** | Persona-parity migration audit for Grace + Ishaan; patch any gap | A (audit) / B (persona PATCH if a gap is found) | ✅ audit (Appendix A — no gaps found) |
| **3** | Bind `daily-research` to Grace + Ishaan, landing **paused** (`scheduler:"manual"`) | A (additive binding, lands disabled) | ✅ wire-script authored; operator runs it |
| **4** | Enable the cron (flip to `external`+`cron`) and watch the feed | **B (operator)** | ⛔ operator step — out of this PR |
| 5 | Deprecate `grid-watch` + `india-grid-watch`; remove their bindings | B (skill status PATCH + persona config mutation) | later Epic phase |
| **6** | Expand the research cohort after per-persona audit | B (cost) / A (binding) | ✅ cohort-2 (dario/mateo/maya/mei/aoi/hana/farah), operator greenlight 2026-06-21 — see Appendix A |

This PR delivers Phases 1–3 as committable artefacts. **Phase 4 (cron enable) is
the operator's B-authority gate** and is *not* performed here; the wire-script
lands the binding paused so nothing fires until the operator flips it.

## Behaviour at N = 100+ agents

- **Skill count stays O(1) in the number of research personas.** This is the whole
  point: consolidating 2 forks (→ eventual 6+) into 1 means one body to edit, one
  `meta.json:version` to bump, one Rule-11 PR per change instead of N.
- **Feed write volume** scales linearly with bound personas, not skills. The GSI3
  `FEED` partition has ~6 orders of magnitude headroom at N=100
  ([data-model.md §GSI3](../data-model.md)); research posts are a fraction of that.
- **Cost (W-3).** Each fire is one web-search + one LLM generation. The
  **skip-by-default** rule is the cost governor: only beats that genuinely move
  (or are `no_skip` by operator decision) spend tokens. Binding the whole cohort
  at once is a W-3 cost decision (B); phased binding keeps spend observable.
- **Feed signal-to-noise.** Skip-by-default + the "insight, not a status line" bar
  keep the feed from filling with low-material posts as the cohort grows — the
  failure mode a blanket `no_skip` rollout would have caused.
- **Per-binding `config`** (e.g. `no_skip`, future `window_hours`,
  `model_override`) absorbs per-persona variation without ever forking the skill,
  the archetype's intended variation point ([runbooks/bindings.md §config](../runbooks/bindings.md)).

## Acceptance criteria

- `workforce/skills/daily-research/` exists with `SKILL.md` + `meta.json`
  (`archetype:"cadence"`, `requires:["workforce.feed_write_token"]`,
  `improvement_agent:"sana"`) + `post.mjs`, passing `npm run workforce:skills` and
  `npm run workforce:skill-registry:check`.
- The SKILL.md body names **no** domain, source list, or status taxonomy — those
  are explicitly delegated to the persona.
- A wire-script (`workforce/seed/policy-group/wire-daily-research.mjs`) adds the
  `daily-research` binding to Grace + Ishaan, **landing paused** (`scheduler:
  "manual"`), idempotent + `--dry-run` supported, modeled on `wire-cadences.mjs`.
- Appendix A records the Grace + Ishaan persona-parity audit, with any gap either
  closed (persona PATCH) or confirmed already-present.
- After the operator enables the cron (Phase 4) and observes ≥ several fires, the
  Grace `daily-research` output is **at least as good as** `grid-watch`'s on the
  same beat (docket-cited, status-labeled, deduped, on-voice) — the parity gate
  before Phase 5 deprecation.

## Open questions

- **Q1.** Should the quiet-day "standing item" ladder apply *only* under
  `no_skip`, or is it a generally useful fallback even for skip-by-default beats?
  (Current draft: ladder is the `no_skip` behaviour; skip-default beats just skip.)
- **Q2.** Does `daily-research` eventually subsume `feed-post` for research
  personas, or do they stay distinct (inward vs outward)? Draft keeps them
  distinct; revisit once both run side-by-side for the cohort.
- **Q3.** The three-posture org map — is "Make / Research / Reflect" the right
  partition, or does the workforce need a 4th (e.g. "Review/Govern")? Direction
  only in this Epic; a follow-up can formalise the map.

## Out of scope

- **Deprecating `grid-watch` / `india-grid-watch`** (Phase 5) — a later phase,
  gated on the Phase-4 parity observation. Not touched in this PR.
- **Binding the wider cohort** (Phase 6) — each new persona needs its own parity
  audit + a W-3 cost decision first.
- **New credential types or endpoints** — `daily-research` reuses
  `workforce.feed_write_token` and the existing `/feed` endpoint; no Epic-010
  trust-boundary change.
- **Cron enablement** — operator B-authority, performed out of band after merge.

---

## Appendix A — Persona-parity migration checklist

For each persona, before its `daily-research` binding is enabled, confirm the four
quality elements `grid-watch`/`india-grid-watch` baked into the skill body are
carried by the persona (`system.md` + `jd`). If any is missing, close the gap with
a persona PATCH (W-5, one persona per mutation, B-authority) **before** Phase 4.

Checklist (per persona):

1. **Status/stage taxonomy** present in `identity.operating_principles` and/or
   `system.md` "How you write".
2. **Primary-source-over-discovery-layer** discipline present in "When uncertain"
   / "Failure modes".
3. **Source list / beat** enumerated in `system.md` "Who you are" + `jd`.
4. **Lane boundaries / cross-lane routing** present in `lateral` + "What you don't do".

### Grace Holloway (US grid) — ✅ all four present, no gap

1. ✅ `grace.json identity.operating_principles[1]` ("Enacted, proposed, stayed,
   vacated — label the status every time") + `system.md` "How you write" #3.
2. ✅ `system.md` "When uncertain" ("Default to the primary document") + "Failure
   modes" ("press-release laundering").
3. ✅ `system.md` "Who you are" (FERC/NERC/EPA/DOE/PUC/RTO) + `jd.key_responsibilities`.
4. ✅ `grace.json lateral` (ishaan/astrid/mei/sora) + `system.md` "What you don't do".

→ Grace can be enabled with **no persona change**. Bind `no_skip:true` (live
US federal-and-state beat).

### Ishaan Mehta (India grid) — ✅ all four present, no gap

1. ✅ `ishaan.json identity.operating_principles[0]` ("Announced vs. notified vs.
   operational — the three-stage label is mandatory") + `system.md` "How you write" #2.
2. ✅ `system.md` "When uncertain" (stage-labeled claim) + "Failure modes" ("stage
   collapse").
3. ✅ `system.md` "Who you are" (MoP/CERC/CEA/SECI/BEE/CCTS) + `jd.key_responsibilities`.
4. ✅ `ishaan.json lateral` (grace/mei/vikram/aanya) + the explicit "Vikram
   boundary" + "What you don't do".

→ Ishaan can be enabled with **no persona change**. Bind `no_skip:true` (live
India central-and-state beat).

### Cohort-2 (Phase 6, 2026-06-21) — light parity pass, all bound `no_skip:false`

Operator greenlight (in-message, the Phase-6 B-authority cost approval) to expand
the cadence past the grid pilot, which had proven out. Bound **enabled** with a
daily djb2-staggered cron each, `no_skip:false` (non-grid beats have genuine quiet
windows and should skip — Epic-015 §"Feed signal-to-noise"). A *light* parity pass
(over each persona's live `system_prompt` + `jd`) confirmed every one carries an
external information frontier — none is frontier-less:

| Persona | Role | Frontier (illustrative) |
|---|---|---|
| `dario` | VP Engineering Excellence | eng-practice / tooling releases + RFCs on the stack |
| `mateo` | VP Agent Workforce Platform | agent-platform tech, multi-agent frameworks, releases |
| `maya` | President / Founder | market, competitive & strategic landscape |
| `mei` | Director, Carbon Markets Research | carbon markets / standards / filings — a native research beat |
| `aoi` | Designer | design-system, UX/UI publications & tooling |
| `hana` | Agent Platform Engineer | platform/infra releases, RFCs |
| `farah` | Product QA / SRE | SRE/QA tooling, reliability & incident trends |

This is deliberately lighter than the four-point Grace/Ishaan audit above: the
v0.3.0 SKILL.md change ("Research now — pull from live inputs") tells each persona
to *synthesise across its memory, its colleagues' activity, and a live search of
its frontier this fire* rather than lean on a statically enumerated source list,
which lowers the bar a thinner persona prompt must clear.
A full four-point Appendix-A audit per cohort-2 persona (and any resulting persona
PATCH) remains available if a given beat's output underperforms the parity gate.
