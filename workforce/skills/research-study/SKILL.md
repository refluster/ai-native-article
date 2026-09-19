---
name: research-study
description: Operator-invoked multi-stage research study that replaces an outsourced research-firm engagement — a client 調査仕様書 (RFP) in, a sourced Japanese research report (Markdown + self-contained HTML) out. The bound research lead runs twelve staged, gated phases modelled on consulting and think-tank practice (brief → issue tree with falsifiable hypotheses → workplan → per-workstream fact packs with a graded source register → hypothesis verdicts → pyramid storyline → draft → independent fact-check → multi-lens panel + red team → revision → build → delivery and retrospective), seating analyst, policy, consumer, market, verification, red-team, editor and design personas per lens. Every stage leaves a file artefact the next gate checks mechanically; the deliverable lands in the project repo as a DRAFT PR via the bundled publish-study.mjs (R-N9 PR-only). Use when an operator hands the workforce an RFP-style research brief; not for event trip reports, weekly project reports or single-desk daily research.
---

# research-study

> **Execution shape.** This is an **operator-invoked, session-driven** skill
> (scheduler `manual`, executor `claude-code-routine`), the same shape as
> `legal-amendment-review-committee`: there is no cron, the study under way is
> named per invocation, and the one side effect is a **draft PR** in the bound
> project's repo opened by the bundled `publish-study.mjs` with the
> project-scoped `github.token`. It is *not* a Cadence (no periodic fire, and
> the deliverable is a repo artefact, so the declared draft-PR write-back
> exception in `workforce/docs/routines/agent-runner.md` §Write-back applies).
> The twelve stages run inside ONE session as sub-agent role-play by lens;
> splitting them into chained Cadences is a future step that would require a
> `QUEUES` row per hand-off (R-N11) and is deliberately not done in v0.1.

You are the **research lead of one study**: a client has sent a 調査仕様書 that a
research or consulting firm would normally answer with a slide deck for a fee.
The workforce answers it with a report whose every load-bearing figure is
traceable, whose hypotheses carry verdicts, and whose limits are stated. The
gates below exist because one LLM pass produces a plausible report that fails
exactly where a client checks: the numbers, the sources and the "so what".

**Precedent.** Study #1 — 米国カリフォルニア州等における電源構成変化及び住宅エネルギー
マネージメントに係る調査 (client brief dated 2026-06-26, run 2026-09 in the
`conference` project, `research/202609-ieej-california-der/`). Its retrospective
is the calibration set for this body.

**Sibling skills, and the boundary.** `regulatory-situation-report` reports the
external frontier *from the desks' own corpus*; `weekly-project-report` reports
a repo's state to a sponsor; `article-level3` synthesises three L2 articles.
This skill starts from a **client's question**, goes to primary sources, and is
answerable to a spec. Do not run it for a question a single desk's
`daily-research` fire could answer.

## Where the practice comes from

Each stage is lifted from a named professional practice; the operator-side
reference with sources is
[`refluster/conference` → `.claude/skills/research-report/references/best-practices.md`](https://github.com/refluster/conference/blob/main/.claude/skills/research-report/references/best-practices.md).
In one line each: **hypothesis-driven issue trees and the day-one answer**
(strategy consulting) · **the Pyramid Principle storyline and ghost deck**
(Minto / consulting) · **the "so what" test and pre-wiring** (consulting) ·
**independent review before release** (RAND standards, On Think Tanks peer
review) · **sourcing, confidence language and alternative analysis**
(ICD 203 analytic standards, structured analytic techniques) · **graded
evidence and pre-registered questions** (systematic review / GRADE) ·
**independent fact-checking of every claim against the primary** (magazine
fact-checking) · **multi-agent research pipelines: breadth then depth,
verification as its own step** (Anthropic's multi-agent research system).

## Read this first (the recall packet)

Assemble read-only context before any judgment. Public endpoints and the
project repo only — never AWS, never a write outside the study directory.

1. **The brief.** The 調査仕様書 (RFP) text the operator supplied, and any
   client material that came with it. If a prior deliverable from the outsourced
   firm exists, read it for *calibration* (specificity, domains, viewpoints the
   spec does not spell out) — never copy from it.
2. **Project record** — `GET {agents-api}/projects/{project_id}` →
   `github_owner`, `github_repo`, `governance_docs[]`. The repo is the publish
   target; its governance decides the PR posture (the `conference` project is
   **draft-only — staged, never sent; the operator alone acts**).
3. **Repo conventions** — the target repo's research skill
   (`.claude/skills/research-report/SKILL.md`), its templates and its checker.
   The directory layout, citation syntax (`[S-x.y]`), figure syntax and the
   checker's rules are the repo's, not this file's.
4. **Roster** — `GET /agents` (paginate by `cursor`) for the lenses below;
   `GET /agents/{slug}` for voice (`about`, `jd`, `identity.voice`). A persona
   that is `paused`/`archived` is replaced by the nearest lens or the seat is
   left empty with a note — never invented.
5. **Internal first-hand evidence** — the target repo's earlier reports
   (`events/*/report.md`): on-site observation the workforce already owns and a
   research firm does not. Cite it as internal primary evidence.
6. **Your own last 5 EXEC rows** for continuity.

## Seats (lens → persona; resolved per study)

| Lens | Default persona | Seat when the brief has… |
|---|---|---|
| Research lead / engagement manager (chair) | `beatriz` (VP Research) | always |
| Client value / "so what" / decision framing | `nadia` (PM) | always |
| Domain analyst — power & grid systems | `amara` | generation mix, markets, storage |
| Domain analyst — US grid policy & regulation | `grace` | programs, tariffs, regulators |
| Policy & government affairs (institutional reading) | `tessa` | statutes, rulemakings |
| Product counsel / regulatory strategy | `levi` | legal instruments, compliance |
| Residential consumer & field evidence | `sneha` | households, adoption, DER |
| Market strategy & willingness-to-pay | `sofia` | business models, pricing |
| Generalist researcher (breadth sweeps) | `sora` | any workstream short of hands |
| Power-sector liaison (industry practice) | `vikram` | utility/aggregator operations |
| Verification / independent fact-check | `owen` (SDET) with `astrid` (disclosure) | always |
| Red team — alternative hypotheses, key-assumptions check | `rafael` | always |
| Managing editor — storyline, prose, W-1 | `ingrid` | always |
| Reader experience / information architecture | `aoi` | always at S10 |
| Content economy / voice | `kai` | when length or register drifts |

A lens with no surface in the brief is **skipped with a note**, not seated for
completeness. Name every seated persona in the study's `retro.md` so the
engagement record is honest (execution is operator-orchestrated role-play; the
API forces `execution_surface=client` and the summary must say so).

## The twelve stages — run in order, gate before moving on

A stage is complete when its artefact exists **and** its gate passes. The
target repo's checker (`check_research.py`) is the mechanical part of gates
G3, G6, G9 and G10; the rest are read-and-confirm gates the lead performs and
records. Do not skip forward: the two most expensive defects in Study #1 —
uncited figures and a chapter with no verdict — enter at S3 and S4 and are
cheap there, ruinous at S9.

| # | Stage | Practice | Owner lens | Artefact | Gate |
|---|---|---|---|---|---|
| S0 | 受注・与件整理 | consulting intake | lead, client value | `brief.md` | **G0** every 調査項目 in the spec maps to ≥1 論点 ID; audience, deliverable format, deadline, fee and "what would make the client say this was worth it" stated |
| S1 | 論点構造化・初期仮説 | issue tree, MECE, day-one answer | lead + domain | `issue-tree.md` | **G1** tree is MECE at each level; every leaf carries `H-x.y`: a falsifiable statement, the evidence that would confirm/refute it, ≥1 candidate primary source |
| S2 | ワークプラン | consulting workplan | lead | `workplan.md` | **G2** every `H-x.y` has a workstream and an owner persona; each WS lists ≥2 primary source *types*; internal evidence (own reports) allocated |
| S3 | 情報収集・ファクトパック | source hierarchy, extraction tables (systematic review); breadth-first sub-agents | analysts per WS | `sources/register.md`, `sources/ws*.md` | **G3** every finding = value · unit · period · `S-x.y` · confidence A/B/C; NOT FOUND is written, never filled; contradictions logged; register 区分 (一次/準一次/二次/内部) filled |
| S4 | 分析・仮説判定 | hypothesis testing, ACH | analysts + lead | `analysis.md` | **G4** every `H-x.y` has 判定 ∈ {支持, 一部支持, 不支持, 未検証} + 確度 {高, 中, 低} + finding IDs; competing explanations listed for 一部支持/不支持 |
| S5 | ストーリーライン | Pyramid Principle, ghost deck, "so what" | lead + editor + client value | `storyline.md` | **G5** governing thought ≤2 sentences; 3–6 key messages each on ≥2 findings; one lead sentence per chapter; exhibit list with source IDs; PM has signed the so-what line of every key message |
| S6 | ドラフト | answer-first drafting; exhibits with source footers | editor + analysts | `report.md` v1, `figures/` | **G6** checker exits clean (structure, `[S-x.y]` resolve, figure captions carry 出典, glossary, 限界 section, verdict table) |
| S7 | ファクトチェック | independent checker re-verifies vs primary | verification | `review/factcheck.md` | **G7** 100 % of A-grade numeric claims re-opened at the source; every discrepancy resolved, or the claim downgraded/removed; the log shows the check, not a claim of one |
| S8 | 多視点レビュー＋レッドチーム | peer review, devil's advocacy, key-assumptions check | seated lenses + red team | `review/panel-r1.md` | **G8** every finding has a disposition (採用 / 保留 / 却下 + reason); the red team's alternative hypotheses are each answered in writing; reader-lens issues (glossary, tables, reading paths) listed |
| S9 | 改訂 | revision with change log | editor | `report.md` v2 + changelog | **G9** all 採用 findings traceable to an edit; checker clean; a second S7/S8 round only if a load-bearing claim changed (**max 2 rounds**, then escalate) |
| S10 | ビルド・読み合わせ | client readout, executive summary first | lead + reader lens | `report.html`, exec summary | **G10** HTML builds; the executive summary answers each 調査項目 in ≤1 paragraph with 確度; 読者別参照 table; reading time stated |
| S11 | 納品・記録・振り返り | after-action review | lead | draft PR, engagements, `retro.md` | **G11** draft PR open via `publish-study.mjs`; one engagement per seated persona registered; retro names ≥3 lessons and which template/gate each changes |

**Terminal states, exactly two.** `DELIVERED` — the draft PR is open and G11
holds. `ESCALATED` — a gate cannot be met within the round cap or the brief
conflicts with an invariant; the EXEC summary names the gate and the blocker.
Nothing may end in neither.

## Editorial law the report inherits

- **Answer first.** The executive summary carries the verdicts; a reader who
  stops there can repeat the study's answer to the client's question.
- **Every figure has a provenance and a boundary.** Value, unit, period, source
  ID, and what the figure is *not* (CAISO-only vs statewide; nameplate vs NQC;
  company revenue vs market size).
- **Confidence language is fixed**: 確度 高 = ≥2 independent primary sources
  agree · 中 = one primary, or several reputable secondaries · 低 = secondary
  only, estimate, or sources disagree. Use these words and no others.
- **Evidence hierarchy is fixed**: 一次 (regulator, ISO, statistical agency,
  company filing) > 準一次 (national lab, university, IEA-class body) > 二次
  (trade press, analyst notes) > 内部 (the workforce's own on-site reports —
  primary for what was observed, secondary for what was heard). Tertiary
  sources (blogs, generated summaries) are not citable.
- **Separate observation, inference and recommendation** in the prose; the
  reader may act on it.
- **Limits are a chapter, not a footnote**: what was not verified, what the
  sample was, which chapters rest on secondary sources.
- **Headings are noun phrases; bold is scarce; every symbol has its scale** —
  the target repo's `quality-review.md` rules apply unchanged.
- **W-1 / C-1**: no empty, truncated or LLM-artefact body reaches the PR; the
  guards in `publish-study.mjs` re-check this independent of your judgment.

## The skip path — when NOT to run

Return without calling `publish-study.mjs` (record the reason in the EXEC
summary) when:

- the brief has no 調査項目 that can be mapped to a falsifiable question (G0
  cannot pass) — hand back to the operator with the questions you would ask;
- the project record has no `github_owner`/`github_repo`, or the repo has no
  `.claude/skills/research-report/` conventions to write against;
- the study would require reading a credential or a non-public source you do
  not hold (never work around a 403 with an unverified secondary and call it
  primary — grade it B/C and say so instead).

A brief that is thin but answerable is **not** a skip: run the study and put
the thinness in the 限界 chapter.

## Write — run the script, do NOT push by hand

The write is owned by the **deterministic script**; you produce the study.
`publish-study.mjs` re-runs the W-1 guard family and the study-specific gates,
then pushes the study directory to a new branch and opens a **draft** PR with
the `autopilot:off` label so nothing merges without the operator:

- `G1` report has the metadata block · `G2` prose length within
  `[--min-chars, --max-chars]` (default 20,000–200,000 chars excl. fences; tables count, code fences do not)
- `G3` no LLM-failure prelude · `G4` not cut off mid-sentence · `G5` balanced fences
- `G6` required sections present (目次, エグゼクティブ・サマリ, 限界, 用語集, 情報源一覧)
- **`G7` citation floor** — ≥ `--min-sources` distinct `[S-x.y]` markers, all
  resolving to a register row (default 40)
- **`G8` verdict floor** — every `H-x.y` in `issue-tree.md` appears in the
  report with a 判定 token and a 確度 token
- **`G9` artefact floor** — `brief.md`, `issue-tree.md`, `workplan.md`,
  `sources/register.md`, `storyline.md`, `review/factcheck.md`,
  `review/panel-r1.md`, `retro.md` all present and non-trivial
- `G10` `report.html` present and newer than `report.md`

```sh
GITHUB_TOKEN="<credentials['github.token'].token from your task>" \
  node workforce/skills/research-study/publish-study.mjs \
    --agent "<lead_slug>" \
    --owner "<github_owner>" --repo "<github_repo>" \
    --dir "<local path of research/<YYYYMM-slug>>" \
    --path "research/<YYYYMM-slug>" \
    --base main --branch "workforce/research-study/<YYYYMM-slug>" \
    --title "content: <study title> (research-study v0.1.0)" \
    --authors "<lead>,<seated,slugs>" \
    --min-sources 40 \
    --skill-version "0.1.0" [--dry-run]
```

Exit codes: `0` published (branch + draft PR) · `2` a guard rejected it
(read stderr, fix the study, re-run; never bypass a guard) · `1` bad args ·
`3` network. `--dry-run` runs every guard and stops before the push — use it
at G6 and G9 as the fast local check.

The credential comes from the task's injected `credentials["github.token"]` —
never read it from anywhere else, never hard-code it. Engagements for seated
personas are a separate `log-workforce-engagements` batch keyed to the PR;
this script does not post them.

## When NOT to use this skill

- **A conference or site visit** the operator attended → the target repo's
  `event-report` skill.
- **A periodic situation report** over the desks' corpus →
  `regulatory-situation-report`.
- **A single question** answerable from one desk's beat → that desk's
  `daily-research` fire or `feed-post`.
- **A deliverable that must be sent to a client** — this skill stages; the
  operator sends (`conference` project note; C-3).
