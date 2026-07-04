# ai-native-article Governance (Repository Law Code)

**Status:** v1.1 (consolidated 2026-07-03 — [ADR-0004](adr/adr-0004-governance-consolidation.md))
**Last updated:** 2026-07-03
**Scope:** Everything in this repository — `newsletter/`, `workforce/`, `packages/`, `scripts/`, `.github/`, `.claude/`
**Audience:** the operator (solo author), Claude Code agents acting on this repo, CI

---

## 0. Why this document exists

This is a small, single-operator content site — not a production service — so we don't need the same ceremony as a multi-stakeholder system. We DO need durable rules, because the operator is offloading work to AI agents and the site has already shipped one silently-truncated-article bug (`d17e1d58ec42`, 2026-05-03) that was structurally avoidable.

This document does three things:

1. **Pins the invariants** the project must never violate, regardless of who's editing.
2. **Layers the rules** so an agent reading a diff knows which layer a change touches and what evidence is required for it to be safe.
3. **Tells agents what they may do automatically vs. what requires the operator's explicit approval.**

The framework is a civil-law-style hierarchy — higher layers constrain lower — scaled down for a hobby-grade project. **Production security and multi-stakeholder process are explicitly out of scope.**

### 0.1 The other axis: design policy

This document is the **rules axis** of the project: invariants the agent must not violate, mechanical guards CI enforces, and the A/B action-authority matrix. A **separate, orthogonal axis — design policy — lives at [`docs/design-policy.md`](design-policy.md)**: how we build (Software 2.0 commitments, external-substrate leverage, innovation-velocity discipline).

Governance constrains; design policy directs. An agent consults both before acting:

- The **rules axis** answers *"may I do this?"* — pinned C-axioms, R-regulations, A/B matrix.
- The **design-policy axis** answers *"should I do this, and how?"* — D-principles, substrate map, iteration loop.

A D-principle is **not** enforced by hook or CI; violating it does not make a build red. It shapes judgment in the moments governance leaves open — typically "default to A or B?", "build it ourselves or ride a substrate?", "ask the operator or just ship?". When the two axes appear to conflict, the rules axis wins (a D-principle never licenses a C-1 violation).

### 0.2 The third document: the machinery

This document is the law; design-policy is the direction. **[`docs/governance-mechanisms.md`](governance-mechanisms.md)** is the *machinery* — the working mechanisms that make this law run itself without the operator in the loop: the CI gates (R-10…R-12), the two self-driving engines (the memory→lint **ratchet** and the content-insights **loop**), and the registries that make the audit loop converge. The decision to adopt them — and what was deliberately left as ceremony — is recorded in [ADR-0001](adr/adr-0001-self-driving-governance-mechanisms.md). Read it before adding a new gate, loop, or registry — it carries the anti-reinvention reflex.

---

## 1. Layers

| Layer | Subject | Where it lives | Changes via |
|---|---|---|---|
| **L0 Constitution** | Invariant principles. Editorial integrity, source-of-truth contract, scale lock. | This document, §2 | Operator decision only — no agent may amend |
| **L1 Framework Laws** | Architectural decisions that constrain code shape: pipeline structure, Notion-as-truth, Azure budget brackets | [docs/architecture-source-of-truth.md](../newsletter/docs/architecture-source-of-truth.md), [docs/azure-budget-rules.md](../newsletter/docs/azure-budget-rules.md), [L1-L4-PIPELINE.md](../newsletter/docs/L1-L4-PIPELINE.md), [DESIGN.md](../newsletter/docs/DESIGN.md), [GROWTH.md](../newsletter/docs/GROWTH.md) | Agent drafts a doc PR → operator approves |
| **L2 Regulations** | Mechanical enforcement. Lints, hooks, generation-time + deploy-time guards | `workforce/skills/article-level{2,3}/publish-notion.mjs` (W-1), `scripts/check-corpus-truncation.mjs` (R-10), `scripts/lint-design-tokens.mjs`, `.claude/skills/article-health/` | Agent freely tightens; loosening a check requires operator approval |
| **L3 Operational** | Runbooks the operator (or an agent acting as operator) follows when CI cannot decide | [L1-L4-PIPELINE.md §Operator runbooks](../newsletter/docs/L1-L4-PIPELINE.md), `.claude/skills/*/SKILL.md` | Agent freely edits |

A change at any layer must satisfy every higher layer. A proposed change that would violate L0 is not a code change — it's a request for the operator to amend the constitution.

---

## 2. L0 — Constitution

These are the four invariants. If a proposed change conflicts with one of these, the agent stops and reports rather than implements.

**C-1. Editorial integrity.** A published article must be a complete, well-formed Japanese explanation/analysis. Articles that are empty, end mid-sentence, or have obvious LLM-failure artefacts (e.g. heading with no body, JSON parse errors leaked into prose) MUST NOT reach `kohuehara.xyz`. Mechanical guards: the workforce generation path refuses to write a degraded article (`article-level{2,3}/publish-notion.mjs`, the W-1 guard — empty/short body, LLM-failure prelude, or cut-off last line); the deploy gate `check-corpus-truncation.mjs` (R-10) blocks a truncated body from reaching gh-pages; the `article-health` skill scans the live site for the symptom.

**C-2. Notion is the source of truth.** Article bodies, titles, abstracts, categories, dates, and source URLs live authoritatively in Notion. Every other location (`main:newsletter/app/public/posts/`, gh-pages markdown, the React app's bundled state) is derived. Any change that would invert this — making GitHub or the React app authoritative for content — is an L0 amendment, not a code change. See [docs/architecture-source-of-truth.md](../newsletter/docs/architecture-source-of-truth.md).

**C-3. Single-operator scale.** This is a hobby project with one human author. The agent must NOT propose primitives that only make sense at scale: multi-tenant auth, per-user quotas, role-based access, pay-tier gating, cross-region failover. New endpoints stay single-operator; new env vars stay opt-in.

**C-4. Fail loud, not silent.** When something goes wrong — a timeout, a content-filter strip, a budget overrun, a missing API key — the system must error visibly (thrown exception, a non-zero exit from a cadence's `publish-notion.mjs`, CI red). Silent fallbacks that publish degraded content are a C-1 violation. The current enforcers are the W-1 guard in the workforce `publish-notion.mjs` (exit 2 on an empty/short/cut-off body) and the R-10 deploy gate. (Provenance: the 2026-05-03 truncation incident `d17e1d58ec42` — see ML-001.)

**Agent application.** When the operator or an external rule asks for a change that would violate any of C-1…C-4, the agent stops, names the conflict in chat, and waits. It does not "interpret" the request charitably and ship anyway. The cost of stopping is one extra exchange; the cost of misreading is days of broken content.

---

## 3. L1 — Framework Laws

L1 is the body of architectural decisions the project rests on. Each is documented in a single file; superseding a file is the only way to change its rule. Decisions are recorded two ways: the **named statute docs** below (long-lived contracts, edited in place when refined), and **ADRs** under [`docs/adr/`](adr/README.md) (point-in-time decisions, append-only — a reversal supersedes the old ADR rather than rewriting it). Both are L1; both are citable by the R-11 gate, so implementing against either announces itself in the PR.

### 3.1 Current statute

| File | Subject | Binding on |
|---|---|---|
| [docs/adr/](adr/README.md) | Architecture Decision Records — point-in-time framework decisions (e.g. [ADR-0001](adr/adr-0001-self-driving-governance-mechanisms.md), the governance mechanisms). Follow the ADR in force when implementing what it governs. | whatever each ADR scopes |
| [docs/architecture-source-of-truth.md](../newsletter/docs/architecture-source-of-truth.md) | Notion = authoritative; main:newsletter/app/public/posts is stale; gh-pages built fresh per deploy | `workforce/skills/article-level{2,3}/publish-notion.mjs`, `newsletter/pipeline/fetch-notion.mjs`, any future content-pipeline script |
| [docs/azure-budget-rules.md](../newsletter/docs/azure-budget-rules.md) | Token-budget bracket discipline for any LLM generation call site (historical: the GAS `azureGenerateText` brackets) | any future LLM call site |
| [L1-L4-PIPELINE.md](../newsletter/docs/L1-L4-PIPELINE.md) | The 4-stage L1→L2→L3→L4 pipeline shape; idempotent cadence design; per-run caps | `workforce/skills/article-level{2,3}/`, `newsletter/pipeline/`, `.github/workflows/deploy-article-site.yml` |
| [DESIGN.md](../newsletter/docs/DESIGN.md) | Visual / IA decisions for the React app | `newsletter/app/src`, `newsletter/app/tailwind.config.ts`, `newsletter/template/` |
| [GROWTH.md](../newsletter/docs/GROWTH.md) | Iteration & growth principles (e.g. reasoning-effort wiring, model-name handling) | `workforce/skills/article-level{2,3}/`, prompt construction |

### 3.2 Derived invariants

These are mechanical consequences that any agent reviewing a diff should check:

- **I-1 (Source-of-truth read direction).** Code that decides "should this article be regenerated?" reads from Notion or gh-pages, NEVER from `main:newsletter/app/public/posts/`. The latter is stale by design.
- **I-2 (Editorial-integrity floor).** A generation path must refuse to emit an empty / truncated / LLM-artefact body rather than publish it degraded. Enforced by the W-1 guard in `article-level{2,3}/publish-notion.mjs` (exit 2) and the R-10 deploy gate; token-budget discipline for any LLM call site is [azure-budget-rules.md](../newsletter/docs/azure-budget-rules.md).
- **I-3 (Cadence idempotency).** The generation cadences and the deploy build must be safe to re-run. The pickers (`pick-l1-source.mjs`, `pick-l2-sources.mjs`) re-derive "pending"/"uncovered" work from Notion each fire (covered-URL set, reuse-avoidance), and `fetch-notion.mjs` re-derives the full corpus from the Notion DB — not from a cursor. A failed run leaves the system in a state where the next run picks up where it left off.
- **I-4 (Slug stability).** Once an article is published, its slug never changes. New article? Last 12 hex chars of the Notion page id. Migrated from a legacy URL? Honour `LegacySlug`. No agent may rewrite slugs to "make them prettier."
- **I-5 (Image fallback).** A slug's cover image is whatever `posts/images/<slug>.jpg` is committed on disk; when absent the reader falls back to a placeholder (`posts-md.mjs` resolveImagePath). (Historical: cover images were auto-generated once by the GAS `handleL4Batch`; that generation path was retired with the GAS pipeline, so new articles carry the placeholder unless an image is added by hand.)

### 3.3 How to amend L1

1. Open a PR that edits the relevant statute doc, or adds an ADR under [`docs/adr/`](adr/README.md) for a point-in-time decision (use the format in the ADR README; reverse a prior ADR by superseding it, never by rewriting its Decision).
2. PR description names the L0 invariant the new rule honours, and cites the L1 doc / ADR (the R-11 gate requires this).
3. PR description names the L2 (mechanical) checks that will need to update as a consequence — agent or operator follows up with those changes.
4. **Operator approves.** An agent never self-merges an L1 change.

---

## 4. L2 — Regulations (mechanical enforcement)

Whatever portion of L0/L1 a machine can check, it should. These are the guards as of 2026-05-03:

| # | Regulation | Tool | Where | Status |
|---|---|---|---|---|
| R-1 | ~~GAS manifest sanity~~ | ~~`check-gas-manifest.mjs`~~ | — | ⛔ **Retired** 2026-06-28 (GAS pipeline removed) |
| R-2 | Design-token lint | `node scripts/lint-design-tokens.mjs` | CI in `deploy-article-site.yml` | ✅ |
| R-3 | ~~`finish_reason === 'length'` throw~~ | ~~runtime in `azureGenerateText`~~ | — | ⛔ **Retired** 2026-06-28 — role now served by W-1 (workforce `publish-notion.mjs`) + R-10 |
| R-4 | ~~Empty-content throw~~ | ~~runtime in `azureGenerateText`~~ | — | ⛔ **Retired** 2026-06-28 — role now served by W-1 |
| R-5 | ~~Truncation heuristic on regenerated content~~ | ~~runtime in `handleL2Backfill`~~ | — | ⛔ **Retired** 2026-06-28 — role now served by W-1 |
| R-6 | ~~Deploy-verify supportedActions probe~~ | ~~`.claude/skills/gas-deploy-verify/`~~ | — | ⛔ **Retired** 2026-06-28 (GAS deploy removed) |
| R-7 | Article health sweep | `.claude/skills/article-health/` | manual / future cron | ✅ |
| R-8 | TypeScript typecheck on React app | implicit via `vite build` | `deploy-article-site.yml` + `ci.yml` | ✅ |
| R-9 | Sitemap generation succeeds | `npm run sitemap` | `deploy-article-site.yml` | ✅ |
| R-10 | Pre-deploy corpus truncation gate | `node scripts/check-corpus-truncation.mjs` | `deploy-article-site.yml` (after `fetch-notion`) | ✅ added 2026-06-07 |
| R-11 | L1 citation gate (touch an L1 doc → cite it or `RULE-N/A:`) | `node scripts/check-l1-citation.mjs` | `ci.yml` (PRs only) | ✅ added 2026-06-07 |
| R-12 | Governance registry integrity (backlog + ledger well-formed) | `node scripts/check-governance-registries.mjs` | `ci.yml` | ✅ added 2026-06-07 |
| R-13 | PR terminal-state sweep — every PR in autopilot scope ends **merged** or **escalated** (`autopilot:needs-human`); auto-escalates ML-009 label drops, stalled cycles, and window-aged PRs | `node workforce/skills/pr-autopilot/pr-autopilot-sweep.mjs --apply` (state check: `workforce/scripts/check-escalation-labels.mjs`) | `workforce-pr-terminal-sweep.yml` (daily) | ✅ added 2026-07-03 |

R-numbers are never re-used: a retired row keeps its slot so older provenance (incident notes, ADRs, memory-lint rows) still resolves.

**Policy.** R-1, R-3, R-4, R-5 and R-6 were guards on the GAS L1→L4 engine; they were **retired 2026-06-28** when that engine was removed and generation moved to the workforce `article-level{2,3}` cadences. Their editorial-integrity job did not disappear — it moved to **W-1** (the generation-time guard in `article-level{2,3}/publish-notion.mjs`, owned by the workforce governance) plus **R-10** (the deploy-time gate). R-2, R-8, R-9, **R-10** must stay green for `deploy-article-site.yml` to ship. R-10 is the *deploy-time* twin of the *generation-time* W-1 guard: W-1 stops bad content from being written to Notion; R-10 stops it from being published to gh-pages. The `article-health` skill (R-7) is advisory but should be run after any generation change and after every user-reported content issue. R-11 requires an L1-document edit (a framework law in §3.1, this doc / design-policy, the workforce statute docs, or any ADR under `docs/adr/` / `workforce/docs/adr/`) to cite the law it touches — so following the relevant ADR when implementing is mechanical, not optional. R-12 keeps the two governance registries ([memory-lint-backlog.md](memory-lint-backlog.md), [risk-acceptance-ledger.md](risk-acceptance-ledger.md)) machine-parseable. R-13 is the mechanical half of the §4.4 two-outcome contract: a daily scheduled sweep that escalates any open PR the autopilot left in a non-terminal state (promoted from ML-009 per the §6.1 ratchet). The full operating notes for R-10…R-13 live in [governance-mechanisms.md §2.1](governance-mechanisms.md#21-how-to-operate-each); the decision records are [ADR-0001](adr/adr-0001-self-driving-governance-mechanisms.md) and [ADR-0004](adr/adr-0004-governance-consolidation.md).

**Loosening.** Tightening any active R-rule (R-2, R-7…R-13) is L2 work and an agent may do it freely. **Loosening, disabling, or retiring any of them requires operator approval** — drop the line in chat with the rationale, wait for explicit yes. (The 2026-06-28 retirements above were operator-approved as part of the GAS-cleanup refactor.)

### 4.4 Autopilot PR merge — workforce R-N10 delegation + L0/L1 off-limits

This repository **delegates** bounded autonomous merge to the agent-workforce's `pr-autopilot` skill (its R-N10 lane, predicate per workforce [adr-0010](../workforce/docs/adr/adr-0010-autopilot-merge-consensus-widening.md), extended to this repo by [adr-0011](../workforce/docs/adr/adr-0011-own-repo-autopilot-merge.md), drafts included by [adr-0014](../workforce/docs/adr/adr-0014-drafts-are-merge-eligible.md)) — the same delegation `PSVL/asp-cloud` carries. `pr-autopilot` may approve+merge a PR **iff** it touches **no L0/L1 path** declared below, has the nominated reviewers' **unanimous-green consensus**, is mergeable (state `clean` **or** `draft` — a green draft is marked Ready for Review then merged) with checks green, and carries no `autopilot:off` label.

**No own-repo exception ([adr-0011](../workforce/docs/adr/adr-0011-own-repo-autopilot-merge.md)).** This repo is treated **identically to an external delegated target** — the former "the agent escalates rather than self-merges on the own repo" step is retired. A 🟢, non-L0/L1, consensus PR here is **merged by the agent**, exactly as on `PSVL/asp-cloud`; the single thing that holds a PR back from an autonomous merge is the **L0/L1 boundary** below (plus the standard predicate: clean, checks green, no `autopilot:off`). This is why that boundary must be the faithful projection of the repo's **operator-only (Zone A)** surface — it is now the *only* line between "agent merges" and "human merges." **One deliberate exception ([adr-0015](../workforce/docs/adr/adr-0015-skill-bodies-not-l0l1.md), operator-directed 2026-06-27):** skill bodies (`workforce/skills/**/SKILL.md`) stay Zone A for authorship/Rule-11 but are **removed from L0/L1**, so `pr-autopilot` can autonomously merge skill-body changes — the workforce iterating its own instructions is the autonomous-operation / experience-building initiative. The L0/L1 set is therefore the Zone A surface *minus skill bodies*.

**L0/L1 off-limits (machine-readable; the engine reads this block from this file).** A PR touching any path below is L0/L1 — it always escalates to a human and is never autopilot-merged. The block doubles as the **repo-wide kill-switch**: empty it → the L0/L1 set is unknown → every autopilot merge fails closed. It mirrors the AGENTS.md **Zone A** (human-owned) surface — governance, decision records, system shape, schedules, and deploy/production config.

<!-- autopilot:l0l1-paths -->
- docs/governance.md
- docs/design-policy.md
- docs/adr/**
- AGENTS.md
- CLAUDE.md
- .github/workflows/**
- workforce/docs/governance.md
- workforce/docs/adr/**
- workforce/docs/architecture.md
- workforce/docs/naming.md
- workforce/docs/data-model.md
- workforce/docs/mvv.md
- workforce/infra/sam/samconfig.toml
<!-- /autopilot:l0l1-paths -->

(Per-PR pause: an `autopilot:off` label. This §4.4 block sits inside `docs/governance.md`, which is itself L0/L1 — so the autopilot can never edit its own boundary, nor widen what it may merge.)

---

## 5. L3 — Operational rules (runbooks)

These are what the operator (or an agent acting as operator) actually does. Each lives in a single file with a clear trigger.

| Runbook | Trigger | Location |
|---|---|---|
| Article truncated mid-sentence | User reports a broken article on `kohuehara.xyz` | [L1-L4-PIPELINE.md §Operator runbooks](../newsletter/docs/L1-L4-PIPELINE.md) |
| Force a fresh deploy | "I just edited Notion and want it live now" | `gh workflow run deploy-article-site.yml` (documented in [L1-L4-PIPELINE.md](../newsletter/docs/L1-L4-PIPELINE.md)) |
| Daily content sweep (advisory) | Once a day, or after any generation change | `.claude/skills/article-health/` |
| Labelling a GitHub issue | Opening or triaging any issue on `refluster/ai-native-article` | [docs/issue-labeling.md](issue-labeling.md) + `scripts/sync-labels.mjs` |

Skills are L3 in their entirety: each `SKILL.md` is the runbook, each `scripts/*.mjs` is the executable form.

---

## 6. Audit cadence

Deliberately lightweight — no QA engineer, no monthly threat-model refresh. The cadences that matter:

| Review | Trigger | Output |
|---|---|---|
| **Article health sweep** | After any change to the generation cadences (`workforce/skills/article-level{2,3}/`) or the deploy build; after any user-reported broken article | Run the `article-health` skill; fix any TRUNCATED_* findings before considering the change done |
| **Governance retrospective** | Whenever an incident reveals a bug class that an existing rule didn't catch (the L2 truncation case is the seed example) | Update this doc + the relevant L1 doc to make the next instance impossible. **Record the failure mode in [memory-lint-backlog.md](memory-lint-backlog.md)** (§6.1). Cite the incident in the change. |
| **Weekly content-insights** | Mondays 02:00 UTC, automatic ([weekly-content-insights.yml](../.github/workflows/weekly-content-insights.yml)) | One `insights`-labelled GitHub issue with reader-engagement gaps + top performers. Triage into editorial action. Inert until the GA4 credential is provisioned (RAL-002). |

Missing a "what should this rule have caught?" pass after an incident is itself a governance defect.

### 6.1 The memory→lint ratchet

A retrospective that just edits a doc is forgotten by the next incident. The **ratchet** makes the
loop converge: every recurring failure is logged in [memory-lint-backlog.md](memory-lint-backlog.md),
and on its **second occurrence within 90 days** it is promoted to an `R-NN` mechanical regulation
(§4). The truncation incident is
the worked example: `d17e1d58ec42` → R-3/R-4/R-5 (runtime) → R-10 (deploy gate). Do not write a
one-off lint without a backlog row — the row is the provenance for "why does this gate exist?".

### 6.2 The risk-acceptance ledger

A finding that is real but **not** worth a machine check goes to
[risk-acceptance-ledger.md](risk-acceptance-ledger.md) — an agent drafts the row, the operator
"signs" it by merging (the only merge authority, §8.1 B). A signed row **suppresses re-filing**: a
later retrospective that rediscovers the gap checks the `Re-eval` date instead of opening a new
finding. The signed ledger is what stops the audit loop from re-litigating
the same accepted trade-offs forever. Both registries are kept well-formed by R-12.

The mechanics of all of this — the gates, the two engines, the provenance, and the C-3 boundary on
what we deliberately did *not* import — live in [governance-mechanisms.md](governance-mechanisms.md).

---

## 7. Roles

A single-operator project. The roles below collapse to one person, but listing them separately makes accountability clear when an agent is asked to do "operator-level" work.

| Role | Owns | When the operator is active vs. delegated |
|---|---|---|
| **Operator (= owner)** | L0 amendments, L1 approvals, deciding what counts as "good enough to ship" | Always you (the human) |
| **Author agent** | Drafting code, drafting prompts, drafting docs | A Claude Code session in this repo |
| **Audit agent** | Running `article-health`, reporting findings | Same session, or a scheduled / on-demand run |

A Claude Code agent acting in this repo is acting as Author + Audit by default. It does NOT have Operator authority — see §8.

---

## 8. How agents interact with this framework

When an agent is spawned against this repository:

1. **Read first.** Before editing, read this file (§2 L0 at minimum), [docs/architecture-source-of-truth.md](../newsletter/docs/architecture-source-of-truth.md), and any L1 doc named in [§3.1](#31-current-statute) that's relevant to the path being edited.
2. **Respect layer precedence.** L3 work (runbook edits, new skills, refactors that don't change L1 contracts) is freely auto-executable. L2 hardening (new mechanical check) is auto-executable. L2 loosening, L1 amendment, and L0 conflict require operator approval.
3. **Flag L0 conflicts.** A request that violates C-1…C-4 must be reported to the operator, not implemented "with a workaround."
4. **Use L2 tooling locally before declaring done.** After changing a generation cadence or regenerating Notion content: run the `article-health` skill.
5. **Cite the layer in commit messages.** A commit that adds a runtime guard says "L2"; a commit that revises the budget brackets says "L1: docs/azure-budget-rules.md". Free-form history entries are fine, but the layer tag helps future audit.
6. **Never bypass governance via tooling.** No `--no-verify` on hooks, no manual disabling of a CI gate (`check-corpus-truncation`, `check-l1-citation`, `check-registries`), no commenting out the W-1 `publish-notion.mjs` guard to ship a borderline result.

### 8.1 Action authority matrix

This pins which actions are auto-executed (**A**) and which require operator approval (**B**). The principle: an action is **B** when (a) it's an L0/L1 amendment, (b) it modifies live state outside the agent's branch (push to `main`, merge PRs, GitHub releases, repo settings), (c) it's irreversible (force-push, history rewrite of a published branch, content deletion), or (d) it changes external services in a way that can't be undone by reverting (production AWS writes, secret rotations).

#### A — auto-execute

- **Read-only.** `Read`, `Grep`, `Bash` for inspection (`git status/log/diff`, `gh pr view`).
- **Local build/test.** `npm run build`, `npm run lint:tokens`, `npm run sitemap`, `npm run check-truncation`.
- **Local development.** `npm run dev`, killing local processes the agent started, deleting `dist/`, `.aws-sam/`, `node_modules/`.
- **L3 edits on a feature branch.** Anything under `docs/`, `.claude/skills/`, runbooks, comments, refactors that don't change L1 contracts.
- **L2 hardening.** Adding a runtime guard, adding a new lint, tightening an existing check.
- **Git on a feature branch.** `add`, `commit`, `push` to a branch the agent created; `pull`, `fetch`, `stash`, `cherry-pick`, rebase of unpublished commits.
- **GitHub author-side.** `gh pr create`, `gh pr edit` (description), `gh issue create`, `gh pr ready`.
- **Drafting an L1 doc change.** The agent may open a PR that edits an L1 doc — but must NOT merge it (B).
- **Article-health sweep.** Idempotent and fix-forward.

#### B — escalate to operator

- **Merging any PR**, including the agent's own. Agent never self-merges.
- **Push to `main` directly** (vs. via PR). Always B.
- **Force-push, history rewrite, branch deletion of a published branch**, `git reset --hard` on `main`/`gh-pages`.
- **L0 amendment** (this doc §2). Always B.
- **L1 amendment merge** (a doc named in §3.1). Drafting is A; merging is B.
- **L2 loosening or disabling** (e.g. removing the W-1 `publish-notion.mjs` guard, disabling `check-corpus-truncation`). Always B.
- **Changing GitHub repo settings, branch protection, secrets, deploy-key/PAT scopes.**
- **Issuing destructive Notion mutations** (deleting pages, changing DB schema, archiving in bulk). The current handlers don't do this; if a future handler does, the trigger requires operator approval.
- **Spending money** that isn't already implicitly approved by the existing pipeline (e.g. switching to a more expensive model, raising LLM call rates).

A B action surfaces in chat with a one-line ask. Operator says "yes" → agent proceeds. Operator says "no" or doesn't reply → agent stops.

---

## 9. Out of scope (deliberately)

The canonical "what we deliberately did NOT adopt" table — every mechanism we *did* adopt versus the ones we judged to be ceremony at single-operator scale, each with a "revisit when…" trigger — lives in **one place**: [governance-mechanisms.md §5](governance-mechanisms.md#5-what-we-deliberately-did-not-adopt-c-3-boundary), ratified in [ADR-0001](adr/adr-0001-self-driving-governance-mechanisms.md). (This section previously carried its own copy of that list; the duplicate was removed by [ADR-0004](adr/adr-0004-governance-consolidation.md) — one table, one owner.) If any of those become relevant (the site grows, takes payments, hosts user data), revisit there.
