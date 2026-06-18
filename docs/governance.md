# ai-native-article Governance (Repository Law Code)

**Status:** Draft v1.0
**Last updated:** 2026-05-03
**Scope:** Everything in this repository — `gas/`, `src/`, `scripts/`, `public/`, `.github/`, `.claude/`
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
| **L2 Regulations** | Mechanical enforcement. Lints, hooks, runtime guards, deploy-verify, manifest checks | `newsletter/gas/src/Code.gs` runtime guards, `newsletter/pipeline/check-gas-manifest.mjs`, `scripts/lint-design-tokens.mjs`, `.claude/skills/gas-deploy-verify/`, `.claude/skills/article-health/` | Agent freely tightens; loosening a check requires operator approval |
| **L3 Operational** | Runbooks the operator (or an agent acting as operator) follows when CI cannot decide | [L1-L4-PIPELINE.md §Operator runbooks](../newsletter/docs/L1-L4-PIPELINE.md), `.claude/skills/*/SKILL.md` | Agent freely edits |

A change at any layer must satisfy every higher layer. A proposed change that would violate L0 is not a code change — it's a request for the operator to amend the constitution.

---

## 2. L0 — Constitution

These are the four invariants. If a proposed change conflicts with one of these, the agent stops and reports rather than implements.

**C-1. Editorial integrity.** A published article must be a complete, well-formed Japanese explanation/analysis. Articles that are empty, end mid-sentence, or have obvious LLM-failure artefacts (e.g. heading with no body, JSON parse errors leaked into prose) MUST NOT reach `kohuehara.xyz`. Mechanical guard: `azureGenerateText` throws on `finish_reason === 'length'` (Code.gs); `article-health` skill scans the live site for the symptom.

**C-2. Notion is the source of truth.** Article bodies, titles, abstracts, categories, dates, and source URLs live authoritatively in Notion. Every other location (`main:newsletter/app/public/posts/`, gh-pages markdown, the React app's bundled state) is derived. Any change that would invert this — making GitHub or the React app authoritative for content — is an L0 amendment, not a code change. See [docs/architecture-source-of-truth.md](../newsletter/docs/architecture-source-of-truth.md).

**C-3. Single-operator scale.** This is a hobby project with one human author. The agent must NOT propose primitives that only make sense at scale: multi-tenant auth, per-user quotas, role-based access, pay-tier gating, cross-region failover. New endpoints stay anonymous (matching `appsscript.json`); new env vars stay opt-in.

**C-4. Fail loud, not silent.** When something goes wrong — a timeout, a content-filter strip, a budget overrun, a missing API key — the system must error visibly (thrown exception, GAS execution log, CI red). Silent fallbacks that publish degraded content are a C-1 violation. The current example is the `finish_reason === 'length'` throw added 2026-05-03; the previous behavior of returning truncated content silently was a C-4 (and consequently a C-1) violation.

**Agent application.** When the operator or an external rule asks for a change that would violate any of C-1…C-4, the agent stops, names the conflict in chat, and waits. It does not "interpret" the request charitably and ship anyway. The cost of stopping is one extra exchange; the cost of misreading is days of broken content.

---

## 3. L1 — Framework Laws

L1 is the body of architectural decisions the project rests on. Each is documented in a single file; superseding a file is the only way to change its rule. Decisions are recorded two ways: the **named statute docs** below (long-lived contracts, edited in place when refined), and **ADRs** under [`docs/adr/`](adr/README.md) (point-in-time decisions, append-only — a reversal supersedes the old ADR rather than rewriting it). Both are L1; both are citable by the R-11 gate, so implementing against either announces itself in the PR.

### 3.1 Current statute

| File | Subject | Binding on |
|---|---|---|
| [docs/adr/](adr/README.md) | Architecture Decision Records — point-in-time framework decisions (e.g. [ADR-0001](adr/adr-0001-self-driving-governance-mechanisms.md), the governance mechanisms). Follow the ADR in force when implementing what it governs. | whatever each ADR scopes |
| [docs/architecture-source-of-truth.md](../newsletter/docs/architecture-source-of-truth.md) | Notion = authoritative; main:newsletter/app/public/posts is stale; gh-pages built fresh per deploy | `newsletter/gas/src/Code.gs`, `newsletter/pipeline/fetch-notion.mjs`, any future content-pipeline script |
| [docs/azure-budget-rules.md](../newsletter/docs/azure-budget-rules.md) | 3-bracket sizing (Tiny=2000 / Standard=8000 / Heavy=16000) for `maxCompletionTokens`; throw on length | every `azureGenerateText` call site |
| [L1-L4-PIPELINE.md](../newsletter/docs/L1-L4-PIPELINE.md) | The 4-stage L1→L2→L3→L4 pipeline shape; daily idempotent batch design; per-batch caps | `newsletter/gas/src/Code.gs`, `newsletter/app/src/pages/L*.tsx` |
| [DESIGN.md](../newsletter/docs/DESIGN.md) | Visual / IA decisions for the React app | `newsletter/app/src`, `newsletter/app/tailwind.config.ts`, `newsletter/template/` |
| [GROWTH.md](../newsletter/docs/GROWTH.md) | Iteration & growth principles (e.g. reasoning-effort wiring, model-name handling) | `newsletter/gas/src/Code.gs`, prompt construction |

### 3.2 Derived invariants

These are mechanical consequences that any agent reviewing a diff should check:

- **I-1 (Source-of-truth read direction).** Code that decides "should this article be regenerated?" reads from Notion or gh-pages, NEVER from `main:newsletter/app/public/posts/`. The latter is stale by design.
- **I-2 (Budget bracket).** Every `azureGenerateText` call site declares one of {2000, 8000, 16000}. No custom values. Long Japanese prose (>500 visible chars) requires 8000+. Enforced at runtime by the `finish_reason === 'length'` throw.
- **I-3 (Batch idempotency).** L2_BATCH / L3_BATCH / L4_BATCH must be safe to re-run. They re-derive "pending" work from the target DB or manifest, not from a cursor. A failed run leaves the system in a state where the next run picks up where it left off.
- **I-4 (Slug stability).** Once an article is published, its slug never changes. New article? Last 12 hex chars of the Notion page id. Migrated from a legacy URL? Honour `LegacySlug`. No agent may rewrite slugs to "make them prettier."
- **I-5 (Image idempotency).** A slug's cover image is generated once by `handleL4Batch` and reused thereafter. Image presence on `main` is the canonical "L4 has run for this slug" signal. Don't conflate it with manifest membership.

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
| R-1 | GAS manifest sanity (only `newsletter/gas/appsscript.json`) | `node newsletter/pipeline/check-gas-manifest.mjs` | `npm run push-gas` precondition | ✅ |
| R-2 | Design-token lint | `node scripts/lint-design-tokens.mjs` | CI in `deploy-article-site.yml` | ✅ |
| R-3 | `finish_reason === 'length'` throw | runtime in `azureGenerateText` | every L2/L3/etc. handler | ✅ added 2026-05-03 |
| R-4 | Empty-content throw | runtime in `azureGenerateText` | same | ✅ |
| R-5 | Truncation heuristic on regenerated content | runtime in `handleL2Backfill` | `runL2Backfill` operator action | ✅ added 2026-05-03 |
| R-6 | Deploy-verify supportedActions probe | `.claude/skills/gas-deploy-verify/` | manual after `newsletter/gas/src/Code.gs` edits | ✅ |
| R-7 | Article health sweep | `.claude/skills/article-health/` | manual / future cron | ✅ |
| R-8 | TypeScript typecheck on React app | implicit via `vite build` | `deploy-article-site.yml` | ✅ |
| R-9 | Sitemap generation succeeds | `npm run sitemap` | `deploy-article-site.yml` | ✅ |
| R-10 | Pre-deploy corpus truncation gate | `node scripts/check-corpus-truncation.mjs` | `deploy-article-site.yml` (after `fetch-notion`) | ✅ added 2026-06-07 |
| R-11 | L1 citation gate (touch an L1 doc → cite it or `RULE-N/A:`) | `node scripts/check-l1-citation.mjs` | `ci.yml` (PRs only) | ✅ added 2026-06-07 |
| R-12 | Governance registry integrity (backlog + ledger well-formed) | `node scripts/check-governance-registries.mjs` | `ci.yml` | ✅ added 2026-06-07 |

**Policy.** R-3 and R-4 are runtime invariants — no agent may catch and ignore them; the right fix is to bump the `maxCompletionTokens` bracket. R-5 is a precondition for `L2_BACKFILL`; if it ever fires there's a deeper bug. R-1, R-2, R-8, R-9, **R-10** must stay green for `deploy-article-site.yml` to ship. The skills (R-6, R-7) are advisory but should be run after every `newsletter/gas/src/Code.gs` edit and after every user-reported content issue respectively. R-10 is the *deploy-time* twin of the *generation-time* finish_reason throw (R-3): R-3 stops bad content from being written; R-10 stops it from being published. R-11 requires an L1-document edit (a framework law in §3.1, this doc / design-policy, or any ADR under `docs/adr/`) to cite the law it touches — so following the relevant ADR when implementing is mechanical, not optional. R-12 keeps the two governance registries ([memory-lint-backlog.md](memory-lint-backlog.md), [risk-acceptance-ledger.md](risk-acceptance-ledger.md)) machine-parseable. The full operating notes for R-10…R-12 live in [governance-mechanisms.md §2.1](governance-mechanisms.md#21-how-to-operate-each); the decision record is [ADR-0001](adr/adr-0001-self-driving-governance-mechanisms.md).

**Loosening.** Tightening any of R-1…R-9 is L2 work and an agent may do it freely. **Loosening or disabling any of them requires operator approval** — drop the line in chat with the rationale, wait for explicit yes.

### 4.4 Autopilot PR merge — workforce R-N10 delegation + L0/L1 off-limits

This repository **delegates** bounded autonomous merge to the agent-workforce's `pr-autopilot` skill (its R-N10 lane, predicate per workforce [adr-0010](../workforce/docs/adr/adr-0010-autopilot-merge-consensus-widening.md), extended to this repo by [adr-0011](../workforce/docs/adr/adr-0011-own-repo-autopilot-merge.md)) — the same delegation `PSVL/asp-cloud` carries. `pr-autopilot` may approve+merge a PR **iff** it touches **no L0/L1 path** declared below, has the nominated reviewers' **unanimous-green consensus**, is mergeable/clean with checks green, and carries no `autopilot:off` label.

**No own-repo exception ([adr-0011](../workforce/docs/adr/adr-0011-own-repo-autopilot-merge.md)).** This repo is treated **identically to an external delegated target** — the former "the agent escalates rather than self-merges on the own repo" step is retired. A 🟢, non-L0/L1, consensus PR here is **merged by the agent**, exactly as on `PSVL/asp-cloud`; the single thing that holds a PR back from an autonomous merge is the **L0/L1 boundary** below (plus the standard predicate: clean, checks green, no `autopilot:off`). This is why that boundary must be the faithful, complete projection of the repo's **operator-only (Zone A)** surface — it is now the *only* line between "agent merges" and "human merges."

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
- workforce/infra/sam/samconfig.toml
- workforce/skills/**/SKILL.md
<!-- /autopilot:l0l1-paths -->

(Per-PR pause: an `autopilot:off` label. This §4.4 block sits inside `docs/governance.md`, which is itself L0/L1 — so the autopilot can never edit its own boundary, nor widen what it may merge.)

---

## 5. L3 — Operational rules (runbooks)

These are what the operator (or an agent acting as operator) actually does. Each lives in a single file with a clear trigger.

| Runbook | Trigger | Location |
|---|---|---|
| Article truncated mid-sentence | User reports a broken article on `kohuehara.xyz` | [L1-L4-PIPELINE.md §Operator runbooks](../newsletter/docs/L1-L4-PIPELINE.md) |
| Adding a new GAS action | Editing `newsletter/gas/src/Code.gs` to add a `case 'X'` to `doPost` | [L1-L4-PIPELINE.md §Operator runbooks](../newsletter/docs/L1-L4-PIPELINE.md) |
| Force a fresh deploy | "I just edited Notion and want it live now" | `gh workflow run deploy-article-site.yml` (documented in [L1-L4-PIPELINE.md](../newsletter/docs/L1-L4-PIPELINE.md)) |
| Daily content sweep (advisory) | Once a day, or after any GAS change | `.claude/skills/article-health/` |
| Labelling a GitHub issue | Opening or triaging any issue on `refluster/ai-native-article` | [docs/issue-labeling.md](issue-labeling.md) + `scripts/sync-labels.mjs` |

Skills are L3 in their entirety: each `SKILL.md` is the runbook, each `scripts/*.mjs` is the executable form.

---

## 6. Audit cadence

Deliberately lightweight — no QA engineer, no monthly threat-model refresh. The cadences that matter:

| Review | Trigger | Output |
|---|---|---|
| **Article health sweep** | After any `newsletter/gas/src/Code.gs` change that touches generation; after any user-reported broken article | Run the `article-health` skill; fix any TRUNCATED_* findings before considering the change done |
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
| **Audit agent** | Running `article-health`, `gas-deploy-verify`, reporting findings | Same session, or a scheduled / on-demand run |

A Claude Code agent acting in this repo is acting as Author + Audit by default. It does NOT have Operator authority — see §8.

---

## 8. How agents interact with this framework

When an agent is spawned against this repository:

1. **Read first.** Before editing, read this file (§2 L0 at minimum), [docs/architecture-source-of-truth.md](../newsletter/docs/architecture-source-of-truth.md), and any L1 doc named in [§3.1](#31-current-statute) that's relevant to the path being edited.
2. **Respect layer precedence.** L3 work (runbook edits, new skills, refactors that don't change L1 contracts) is freely auto-executable. L2 hardening (new mechanical check) is auto-executable. L2 loosening, L1 amendment, and L0 conflict require operator approval.
3. **Flag L0 conflicts.** A request that violates C-1…C-4 must be reported to the operator, not implemented "with a workaround."
4. **Use L2 tooling locally before declaring done.** After editing `newsletter/gas/src/Code.gs`: run the `gas-deploy-verify` skill. After regenerating Notion content: run the `article-health` skill.
5. **Cite the layer in commit messages.** A commit that adds a runtime guard says "L2"; a commit that revises the budget brackets says "L1: docs/azure-budget-rules.md". Free-form history entries are fine, but the layer tag helps future audit.
6. **Never bypass governance via tooling.** No `--no-verify` on hooks, no manual disabling of `check-gas-manifest`, no commenting out `finish_reason` throws to ship a borderline result.

### 8.1 Action authority matrix

This pins which actions are auto-executed (**A**) and which require operator approval (**B**). The principle: an action is **B** when (a) it's an L0/L1 amendment, (b) it modifies live state outside the agent's branch (push to `main`, merge PRs, GitHub releases, repo settings), (c) it's irreversible (force-push, history rewrite of a published branch, content deletion), or (d) it changes external services in a way that can't be undone by reverting (production AWS writes, secret rotations).

#### A — auto-execute

- **Read-only.** `Read`, `Grep`, `Bash` for inspection (`git status/log/diff`, `gh pr view`, `npx clasp deployments`, GET to `/exec`).
- **Local build/test.** `npm run build`, `npm run check-gas`, `npm run lint:tokens`, `npm run sitemap`.
- **Local development.** `npm run dev`, killing local processes the agent started, deleting `dist/`, `.aws-sam/`, `node_modules/`.
- **L3 edits on a feature branch.** Anything under `docs/`, `.claude/skills/`, runbooks, comments, refactors that don't change L1 contracts.
- **L2 hardening.** Adding a runtime guard, adding a new lint, tightening an existing check.
- **Git on a feature branch.** `add`, `commit`, `push` to a branch the agent created; `pull`, `fetch`, `stash`, `cherry-pick`, rebase of unpublished commits.
- **GitHub author-side.** `gh pr create`, `gh pr edit` (description), `gh issue create`, `gh pr ready`.
- **GAS push to the existing deployment.** `npm run deploy-gas`, the `gas-deploy-verify` skill, the `gas-call` skill against the existing `/exec`. The deployment ID does not change; this is reversible by re-pushing.
- **Drafting an L1 doc change.** The agent may open a PR that edits an L1 doc — but must NOT merge it (B).
- **Article-health sweep + L2_BACKFILL invocation.** Both are idempotent and fix-forward.

#### B — escalate to operator

- **Merging any PR**, including the agent's own. Agent never self-merges.
- **Push to `main` directly** (vs. via PR). Always B.
- **Force-push, history rewrite, branch deletion of a published branch**, `git reset --hard` on `main`/`gh-pages`.
- **L0 amendment** (this doc §2). Always B.
- **L1 amendment merge** (a doc named in §3.1). Drafting is A; merging is B.
- **L2 loosening or disabling** (e.g. removing the `finish_reason` throw, deleting `check-gas-manifest`). Always B.
- **Editing `package.json` deploy IDs, `newsletter/gas/appsscript.json` access settings, or the `clasp deploy -i` slot.**
- **Changing GitHub repo settings, branch protection, secrets, deploy-key/PAT scopes.**
- **Issuing destructive Notion mutations** (deleting pages, changing DB schema, archiving in bulk). The current handlers don't do this; if a future handler does, the trigger requires operator approval.
- **Spending money** that isn't already implicitly approved by the existing pipeline (e.g. switching to a more expensive model, raising LLM call rates).

A B action surfaces in chat with a one-line ask. Operator says "yes" → agent proceeds. Operator says "no" or doesn't reply → agent stops.

---

## 9. Out of scope (deliberately)

These are conventions worth borrowing from production-grade governance frameworks that we explicitly do NOT adopt here:

- **Production security review** (threat models, pen tests, ISO 27001 alignment). Not a production service.
- **Multi-stakeholder approval matrices.** Single operator.
- **Quarterly governance retrospective with formal output document.** Replaced by §6's lighter "after an incident, update the doc."
- **SBOM generation per release.** The "release" is gh-pages; auditing it adds no value here.
- **Dependency-vulnerability triage runbook.** Dependabot is configured but findings go to the operator's chat, not a formal triage process.

If any of these become relevant (the site grows, takes payments, hosts user data), revisit this section.

The full, current decision table — every mechanism we *did* adopt versus the ones we judged to be ceremony at single-operator scale, each with a "revisit when…" trigger — lives in [governance-mechanisms.md §5](governance-mechanisms.md#5-what-we-deliberately-did-not-adopt-c-3-boundary) and is ratified in [ADR-0001](adr/adr-0001-self-driving-governance-mechanisms.md). That table supersedes this list as the canonical "what we left off and why."
