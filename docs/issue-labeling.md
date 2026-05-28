# Issue Labeling Runbook

**Layer:** L3 Operational (this doc is a runbook; agents may freely edit per [docs/governance.md §1](governance.md#1-layers)).
**Scope:** Every GitHub issue and pull request on `refluster/ai-native-article`, across both sub-projects (`ai-native-article` and `workforce/`).
**Audience:** the operator and any agent that opens, triages, or refines an issue.

The repository is a monorepo housing two sub-projects (article pipeline + workforce subsystem). Labels are the only lightweight signal a glance can use to tell them apart, locate the governance layer the work touches, and decide pickup readiness. This doc pins the taxonomy, the canonical colour palette, and the decision flow.

The label set itself is defined declaratively in [`.github/labels.json`](../.github/labels.json) and reconciled to GitHub by [`scripts/sync-labels.mjs`](../scripts/sync-labels.mjs). The script is the source of truth for colours and descriptions; this doc is the source of truth for **when to apply which label.**

---

## 1. Taxonomy

Eight axes. Three are **mandatory** on every issue; the rest are applied when relevant. Keep it lean — over-labelling is C-3 sprawl ([docs/governance.md §2](governance.md#2-l0--constitution)).

### 1.1 Mandatory axes (always apply)

| Axis | Values | Meaning |
|---|---|---|
| `project:` | `article` \| `workforce` | Which sub-project the issue lives in. Use both labels if a single issue genuinely spans both (rare — usually split into two issues instead). |
| `layer:` | `L0` \| `L1` \| `L2` \| `L3` | The governance layer the work primarily touches. See §2 for the mapping per sub-project. |
| `type:` | `bug` \| `feature` \| `chore` \| `tracker` \| `ops` | Issue kind. `tracker` = an index issue that decomposes into sub-issues; `ops` = post-deploy verification or operational follow-up. |

### 1.2 Optional axes (apply when relevant)

| Axis | Values | When to apply |
|---|---|---|
| `area:` | `gas` \| `spa` \| `backend` \| `content` \| `infra` \| `docs` \| `design-tokens` | Technical surface. Multiple `area:` labels are fine. Omit if the issue is genuinely cross-cutting. |
| `epic-NNN` | `epic-010`, `epic-011`, ... | Epic membership. One epic label per issue. Add the epic to [`.github/labels.json`](../.github/labels.json) when it's first opened. |
| `role:` | `engineering` \| `architecture` \| `product` \| `design` | Who drives the work (existing convention). May be multi-select. |
| `wf:` | `ready` \| `blocked` \| `in-progress` | Workflow status. Apply only at interesting transitions — unlabelled = backlog/triaged. |
| `priority:` | `p0` \| `p1` | Urgency. Apply ONLY to genuinely urgent issues. Unlabelled = p2 (default). `p0` = blocks an invariant in production (C-1/W-1 live violation, build is red). `p1` = blocks an in-flight epic or the live site for non-invariant reasons. |

---

## 2. `layer:` mapping per sub-project

The four layers are a unified mental model, but they map to different concrete artefacts per sub-project. Mapping mistakes are common — read this carefully.

### 2.1 `project:article` mapping

| Label | Touches | Examples |
|---|---|---|
| `layer:L0` | A C-1..C-4 invariant in [docs/governance.md §2](governance.md#2-l0--constitution). Operator-only amendments. | "Allow truncated articles to publish" (would never be filed — it's a refusal trigger). |
| `layer:L1` | An L1 doc in [§3.1 of governance.md](governance.md#31-current-statute): `architecture-source-of-truth.md`, `azure-budget-rules.md`, `L1-L4-PIPELINE.md`, `DESIGN.md`, `GROWTH.md`. | "Add a fourth budget bracket to azure-budget-rules.md". |
| `layer:L2` | A mechanical guard from [§4](governance.md#4-l2--regulations-mechanical-enforcement) (R-1..R-9), or a runtime throw in `gas/src/Code.gs`, or `scripts/{check-gas-manifest,lint-design-tokens}.mjs`. | "Add a regex throw for LLM-failure artefacts" |
| `layer:L3` | A runbook in `L1-L4-PIPELINE.md §Operator runbooks`, a skill under `.claude/skills/`, or an issue about operational follow-up. | "Document the pipeline-quiet runbook"; "Run L2_BACKFILL on the truncated row". |

### 2.2 `project:workforce` mapping

Workforce inherits article's L0-L3 model but has its own concrete artefacts and W-1..W-5 invariants ([workforce/docs/governance.md §2](../workforce/docs/governance.md#2-l0-invariants-w-1w-5)).

| Label | Touches | Examples |
|---|---|---|
| `layer:L0` | A W-1..W-5 invariant. Zone A. Operator-only amendments. | "Loosen W-5 prompt-version one-at-a-time rule" — refusal trigger. |
| `layer:L1` | A Zone A doc: `workforce/docs/{governance,architecture,naming,data-model}.md`, an Epic body, or a Story design-doc that lands as a `design-note` row. | "§3 amendment scoping agent.json Rule 11" (#129), "Aoi-authored feed UI spec" (#133). |
| `layer:L2` | An R-N1..R-N8 design rule, a CI lint, a runtime throw in a Lambda, or a `validate-*.mjs` script under `workforce/scripts/`. | "feed-health sweep skill + W-1 gate" (#131); "credential-injector runtime guard" (#91). |
| `layer:L3` | A runbook under `workforce/docs/runbooks/`, a post-deploy verification tracker, a skill `SKILL.md`, or an operational follow-up. | "Post-deploy verification for Epic-010" (#150); "7-day production observation + Status flip" (#135). |

### 2.3 Picking the layer when an issue spans layers

Use the **highest layer touched.** An L2 mechanical check that requires a new L1 doc gets `layer:L1` (because L1 is the higher constraint and the layer that needs operator approval to merge). An L3 runbook that mentions an L2 check is still `layer:L3`.

If the issue exists *because* the higher-layer amendment is blocking it (e.g. "Story 3 mass-edit waiting on Story 2 §3 amendment"), label by the work the issue does, not its dependency — Story 3 gets `layer:L2` (mass-edit) even though it's gated on Story 2's `layer:L1` doc change. The blocking relationship is captured by `wf:blocked`, not by re-labelling the layer.

---

## 3. Decision flow — labelling a new issue

When opening or triaging an issue, walk these steps:

1. **`project:`** — which sub-tree? `article` if it touches `gas/`, `src/`, `docs/`, `scripts/`, `public/`, `template/`, or `.github/workflows/deploy-article-site.yml`. `workforce` if it touches `workforce/`, `apps/workforce/`, `.github/workflows/workforce-*.yml`. Both → split the issue if at all possible.
2. **`layer:`** — read the §2 table for that sub-project. Pick the highest layer touched (§2.3).
3. **`type:`** — bug (something broken), feature (new capability), chore (refactor / maintenance), tracker (decomposes into sub-issues), ops (verification, observation, post-deploy follow-up).
4. **`area:`** — apply each surface the issue touches. Skip if cross-cutting (>3 areas).
5. **`epic-NNN`** — if the issue is part of an epic, apply the epic label. Add the new epic to `.github/labels.json` if it doesn't exist yet, in the same PR that opens the first story.
6. **`role:`** — who drives. Multi-select fine (architect + engineer for an RFC).
7. **`wf:`** — apply only at a state transition. New issue: leave unlabelled (= backlog). Pickup-ready: `wf:ready`. Started: `wf:in-progress`. Stuck on a dep: `wf:blocked` and name the blocker in the issue body.
8. **`priority:`** — apply only `p0` (live invariant violation) or `p1` (blocks an epic or the live site non-fatally). Everything else is unlabelled (= p2 default).

A correctly-labelled issue has between 3 and 6 labels: 3 mandatory + 0-3 optional. More than 6 means you're labelling for completeness rather than signal.

---

## 4. Colour palette

Colours are declarative in `.github/labels.json`. The palette below is the source of truth; the JSON file mirrors it.

### 4.1 Family rules

- **Family = hue.** Every label in a family shares its hue so the family is recognisable at a glance.
- **Severity inside a family = saturation/lightness.** Within `layer:`, `wf:`, and `priority:`, the colour moves from red (stop / urgent / high-constraint) to green (go / done / low-constraint).
- **Legacy labels are migrated, not preserved.** Labels that predate this doc (`role:*`, `wf:ready`, the bare `tracker`) currently sit at GitHub's default gray `#ededed` and convey nothing. The sync script gives them the canonical colour. Renames (e.g. legacy `tracker` → `type:tracker`) live in the `aliases` section of `.github/labels.json` so issues retain their label across the migration.
- **Reserved escape hatch: `preserve: true`.** A future label entry MAY set `"preserve": true` in `.github/labels.json` to opt out of colour reconciliation. Flipping the flag on an existing entry requires operator approval (see §5).

### 4.2 Concrete colours

| Label | Hex | Family / intent |
|---|---|---|
| `layer:L0` | `B60205` | Layer family, deepest red — invariant |
| `layer:L1` | `D93F0B` | Layer family, orange-red — framework |
| `layer:L2` | `FBCA04` | Layer family, yellow — mechanical |
| `layer:L3` | `2EA043` | Layer family, green — operational |
| `project:article` | `1D76DB` | Project family, blue — blog brand |
| `project:workforce` | `5319E7` | Project family, deep purple |
| `type:bug` | `D73A4A` | Type family, red — GitHub-native |
| `type:feature` | `0366D6` | Type family, blue |
| `type:chore` | `CFD3D7` | Type family, gray |
| `type:tracker` | `7057FF` | Type family, purple — meta |
| `type:ops` | `006B75` | Type family, teal |
| `area:gas` | `BFDADC` | Area family, light surface tones |
| `area:spa` | `C5DEF5` | Area family |
| `area:backend` | `BFD4F2` | Area family |
| `area:content` | `FEF2C0` | Area family |
| `area:infra` | `EEEEEE` | Area family |
| `area:docs` | `C2E0C6` | Area family |
| `area:design-tokens` | `F9D0C4` | Area family |
| `epic-NNN` | `0052CC` | Epic family, uniform navy |
| `role:engineering` | (existing) | Role family — preserve |
| `role:architecture` | (existing) | Role family — preserve |
| `role:product` | (existing) | Role family — preserve |
| `role:design` | (existing) | Role family — preserve |
| `wf:ready` | `0E8A16` | Workflow stop-light, green |
| `wf:in-progress` | `FBCA04` | Workflow stop-light, yellow |
| `wf:blocked` | `B60205` | Workflow stop-light, red |
| `priority:p0` | `B60205` | Priority intensity, red |
| `priority:p1` | `D93F0B` | Priority intensity, orange |

### 4.3 Adding a new label family

Open a PR that:

1. Appends the new family to `.github/labels.json` with hex colours that follow §4.1's family-rule.
2. Adds a row to §1 of this doc (mandatory or optional axis as appropriate).
3. If the family touches the layer mental model, updates §2.1 and §2.2.
4. Names the L0/L1 invariant or runbook the new family supports in the PR description.

Operator approves; agent runs `node scripts/sync-labels.mjs` after merge.

---

## 5. Sync script

Source: [`scripts/sync-labels.mjs`](../scripts/sync-labels.mjs). Idempotent.

```bash
# One-shot reconciliation against .github/labels.json
GH_TOKEN=ghp_... node scripts/sync-labels.mjs

# Dry-run (no API writes)
GH_TOKEN=ghp_... node scripts/sync-labels.mjs --dry-run
```

The script:

- Creates labels that exist in `.github/labels.json` but not on GitHub.
- Updates colour + description on labels that exist in both (skipping any flagged `preserve: true`).
- Does NOT delete labels. Orphan labels on GitHub are flagged in the script output but require manual deletion (a guard against accidentally nuking labels the operator created ad-hoc).

The script is L3 tooling — agents may freely edit it, with one exception: changing the `preserve: true` flag on an existing label requires operator approval (it's effectively colour mutation on a label the operator may rely on for muscle memory).

---

## 6. Cross-references

- **[docs/governance.md §5](governance.md#5-l3--operational-rules-runbooks)** — the L3 table that lists this runbook.
- **[L1-L4-PIPELINE.md §Operator runbooks](../L1-L4-PIPELINE.md#operator-runbooks)** — sibling runbooks for pipeline-side ops; "Labelling a new issue" entry there points back here.
- **[CLAUDE.md §Skills you should use](../CLAUDE.md#skills-you-should-use-not-reinvent)** — agent-facing pointer.
- **[workforce/docs/governance.md §3](../workforce/docs/governance.md#3-zone-classifications-for-workforce)** — Zone A/B/C/D mapping for workforce paths; informs `layer:` selection inside `project:workforce`.

---

## 7. Worked examples

The 16 open issues at the time this doc was written, labelled per the decision flow in §3. Treat as reference for borderline cases.

| # | Title (short) | `project:` | `layer:` | `type:` | `area:` | Epic | `role:` | `wf:` | `priority:` |
|---|---|---|---|---|---|---|---|---|---|
| 89 | Epic-010 tracker | workforce | L1 | tracker | docs | epic-010 | architecture | — | — |
| 91 | Story 2 — type-keyed credentials | workforce | L2 | feature | backend, infra | epic-010 | engineering | — | — |
| 93 | Story 4 — semantic recall | workforce | L2 | feature | backend | epic-010 | engineering | blocked | p1 |
| 95 | Story 6 — operator project console | workforce | L3 | feature | spa | epic-010 | engineering, design | — | — |
| 127 | Epic-011 tracker | workforce | L1 | tracker | docs | epic-011 | architecture | — | — |
| 128 | Story 1 — feed-post foundation | workforce | L2 | feature | backend | epic-011 | engineering, architecture | ready | — |
| 129 | Story 2 — §3 governance amendment | workforce | L1 | chore | docs | epic-011 | product | ready | — |
| 130 | Story 3 — agent.json mass-edit | workforce | L2 | chore | backend | epic-011 | engineering | blocked | — |
| 131 | Story 4 — hide primitive + feed-health | workforce | L2 | feature | backend | epic-011 | engineering | — | — |
| 132 | Story 5 — feed API | workforce | L2 | feature | backend | epic-011 | engineering, architecture | — | — |
| 133 | Story 6 — feed UI design-doc | workforce | L1 | feature | docs, design-tokens | epic-011 | design | ready | — |
| 134 | Story 7 — feed SPA | workforce | L3 | feature | spa | epic-011 | engineering, design | — | — |
| 135 | Story 8 — production observation + Status flip | workforce | L1 | ops | docs | epic-011 | architecture, product | — | — |
| 146 | FU-021 — workforce-side audit skill | workforce | L2 | feature | backend, infra | — | engineering | — | p1 |
| 150 | OP-004 — Epic-010 post-deploy verification | workforce | L3 | ops | backend, spa | epic-010 | engineering | — | — |
| 153 | Epic-011 post-deploy verification | workforce | L3 | ops | backend, infra | epic-011 | architecture, product | — | — |

Note: zero open `project:article` issues at the time of authoring. That column gets exercised the next time an article-side issue lands.
