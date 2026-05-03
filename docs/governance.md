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

The framework is borrowed from [asp-cloud's governance.md](../../asp-cloud/docs/governance.md) — civil-law-style hierarchy where higher layers constrain lower — and scaled down for a hobby-grade project. **Production security and multi-stakeholder process are explicitly out of scope.**

---

## 1. Layers

| Layer | Subject | Where it lives | Changes via |
|---|---|---|---|
| **L0 Constitution** | Invariant principles. Editorial integrity, source-of-truth contract, scale lock. | This document, §2 | Operator decision only — no agent may amend |
| **L1 Framework Laws** | Architectural decisions that constrain code shape: pipeline structure, Notion-as-truth, Azure budget brackets | [docs/architecture-source-of-truth.md](architecture-source-of-truth.md), [docs/azure-budget-rules.md](azure-budget-rules.md), [L1-L4-PIPELINE.md](../L1-L4-PIPELINE.md), [DESIGN.md](../DESIGN.md), [GROWTH.md](../GROWTH.md) | Agent drafts a doc PR → operator approves |
| **L2 Regulations** | Mechanical enforcement. Lints, hooks, runtime guards, deploy-verify, manifest checks | `gas/src/Code.gs` runtime guards, `scripts/check-gas-manifest.mjs`, `scripts/lint-design-tokens.mjs`, `.claude/skills/gas-deploy-verify/`, `.claude/skills/article-health/` | Agent freely tightens; loosening a check requires operator approval |
| **L3 Operational** | Runbooks the operator (or an agent acting as operator) follows when CI cannot decide | [L1-L4-PIPELINE.md §Operator runbooks](../L1-L4-PIPELINE.md), `.claude/skills/*/SKILL.md` | Agent freely edits |

A change at any layer must satisfy every higher layer. A proposed change that would violate L0 is not a code change — it's a request for the operator to amend the constitution.

---

## 2. L0 — Constitution

These are the four invariants. If a proposed change conflicts with one of these, the agent stops and reports rather than implements.

**C-1. Editorial integrity.** A published article must be a complete, well-formed Japanese explanation/analysis. Articles that are empty, end mid-sentence, or have obvious LLM-failure artefacts (e.g. heading with no body, JSON parse errors leaked into prose) MUST NOT reach `kohuehara.xyz`. Mechanical guard: `azureGenerateText` throws on `finish_reason === 'length'` (Code.gs); `article-health` skill scans the live site for the symptom.

**C-2. Notion is the source of truth.** Article bodies, titles, abstracts, categories, dates, and source URLs live authoritatively in Notion. Every other location (`main:public/posts/`, gh-pages markdown, the React app's bundled state) is derived. Any change that would invert this — making GitHub or the React app authoritative for content — is an L0 amendment, not a code change. See [docs/architecture-source-of-truth.md](architecture-source-of-truth.md).

**C-3. Single-operator scale.** This is a hobby project with one human author. The agent must NOT propose primitives that only make sense at scale: multi-tenant auth, per-user quotas, role-based access, pay-tier gating, cross-region failover. New endpoints stay anonymous (matching `appsscript.json`); new env vars stay opt-in.

**C-4. Fail loud, not silent.** When something goes wrong — a timeout, a content-filter strip, a budget overrun, a missing API key — the system must error visibly (thrown exception, GAS execution log, CI red). Silent fallbacks that publish degraded content are a C-1 violation. The current example is the `finish_reason === 'length'` throw added 2026-05-03; the previous behavior of returning truncated content silently was a C-4 (and consequently a C-1) violation.

**Agent application.** When the operator or an external rule asks for a change that would violate any of C-1…C-4, the agent stops, names the conflict in chat, and waits. It does not "interpret" the request charitably and ship anyway. The cost of stopping is one extra exchange; the cost of misreading is days of broken content.

---

## 3. L1 — Framework Laws

L1 is the body of architectural decisions the project rests on. Each is documented in a single file; superseding a file is the only way to change its rule.

### 3.1 Current statute

| File | Subject | Binding on |
|---|---|---|
| [docs/architecture-source-of-truth.md](architecture-source-of-truth.md) | Notion = authoritative; main:public/posts is stale; gh-pages built fresh per deploy | `gas/src/Code.gs`, `scripts/fetch-notion.mjs`, any future content-pipeline script |
| [docs/azure-budget-rules.md](azure-budget-rules.md) | 3-bracket sizing (Tiny=2000 / Standard=8000 / Heavy=16000) for `maxCompletionTokens`; throw on length | every `azureGenerateText` call site |
| [L1-L4-PIPELINE.md](../L1-L4-PIPELINE.md) | The 4-stage L1→L2→L3→L4 pipeline shape; daily idempotent batch design; per-batch caps | `gas/src/Code.gs`, `src/pages/L*.tsx` |
| [DESIGN.md](../DESIGN.md) | Visual / IA decisions for the React app | `src/`, `tailwind.config.ts`, `template/` |
| [GROWTH.md](../GROWTH.md) | Iteration & growth principles (e.g. reasoning-effort wiring, model-name handling) | `gas/src/Code.gs`, prompt construction |

### 3.2 Derived invariants

These are mechanical consequences that any agent reviewing a diff should check:

- **I-1 (Source-of-truth read direction).** Code that decides "should this article be regenerated?" reads from Notion or gh-pages, NEVER from `main:public/posts/`. The latter is stale by design.
- **I-2 (Budget bracket).** Every `azureGenerateText` call site declares one of {2000, 8000, 16000}. No custom values. Long Japanese prose (>500 visible chars) requires 8000+. Enforced at runtime by the `finish_reason === 'length'` throw.
- **I-3 (Batch idempotency).** L2_BATCH / L3_BATCH / L4_BATCH must be safe to re-run. They re-derive "pending" work from the target DB or manifest, not from a cursor. A failed run leaves the system in a state where the next run picks up where it left off.
- **I-4 (Slug stability).** Once an article is published, its slug never changes. New article? Last 12 hex chars of the Notion page id. Migrated from a legacy URL? Honour `LegacySlug`. No agent may rewrite slugs to "make them prettier."
- **I-5 (Image idempotency).** A slug's cover image is generated once by `handleL4Batch` and reused thereafter. Image presence on `main` is the canonical "L4 has run for this slug" signal. Don't conflate it with manifest membership.

### 3.3 How to amend L1

1. Open a PR that edits the relevant doc (or adds a new one).
2. PR description names the L0 invariant the new rule honours.
3. PR description names the L2 (mechanical) checks that will need to update as a consequence — agent or operator follows up with those changes.
4. **Operator approves.** An agent never self-merges an L1 change.

---

## 4. L2 — Regulations (mechanical enforcement)

Whatever portion of L0/L1 a machine can check, it should. These are the guards as of 2026-05-03:

| # | Regulation | Tool | Where | Status |
|---|---|---|---|---|
| R-1 | GAS manifest sanity (only `gas/appsscript.json`) | `node scripts/check-gas-manifest.mjs` | `npm run push-gas` precondition | ✅ |
| R-2 | Design-token lint | `node scripts/lint-design-tokens.mjs` | CI in `deploy.yml` | ✅ |
| R-3 | `finish_reason === 'length'` throw | runtime in `azureGenerateText` | every L2/L3/etc. handler | ✅ added 2026-05-03 |
| R-4 | Empty-content throw | runtime in `azureGenerateText` | same | ✅ |
| R-5 | Truncation heuristic on regenerated content | runtime in `handleL2Backfill` | `runL2Backfill` operator action | ✅ added 2026-05-03 |
| R-6 | Deploy-verify supportedActions probe | `.claude/skills/gas-deploy-verify/` | manual after `gas/src/Code.gs` edits | ✅ |
| R-7 | Article health sweep | `.claude/skills/article-health/` | manual / future cron | ✅ |
| R-8 | TypeScript typecheck on React app | implicit via `vite build` | `deploy.yml` | ✅ |
| R-9 | Sitemap generation succeeds | `npm run sitemap` | `deploy.yml` | ✅ |

**Policy.** R-3 and R-4 are runtime invariants — no agent may catch and ignore them; the right fix is to bump the `maxCompletionTokens` bracket. R-5 is a precondition for `L2_BACKFILL`; if it ever fires there's a deeper bug. R-1, R-2, R-8, R-9 must stay green for `deploy.yml` to ship. The skills (R-6, R-7) are advisory but should be run after every `gas/src/Code.gs` edit and after every user-reported content issue respectively.

**Loosening.** Tightening any of R-1…R-9 is L2 work and an agent may do it freely. **Loosening or disabling any of them requires operator approval** — drop the line in chat with the rationale, wait for explicit yes.

---

## 5. L3 — Operational rules (runbooks)

These are what the operator (or an agent acting as operator) actually does. Each lives in a single file with a clear trigger.

| Runbook | Trigger | Location |
|---|---|---|
| Article truncated mid-sentence | User reports a broken article on `kohuehara.xyz` | [L1-L4-PIPELINE.md §Operator runbooks](../L1-L4-PIPELINE.md) |
| Adding a new GAS action | Editing `gas/src/Code.gs` to add a `case 'X'` to `doPost` | [L1-L4-PIPELINE.md §Operator runbooks](../L1-L4-PIPELINE.md) |
| Force a fresh deploy | "I just edited Notion and want it live now" | `gh workflow run deploy.yml` (documented in [L1-L4-PIPELINE.md](../L1-L4-PIPELINE.md)) |
| Daily content sweep (advisory) | Once a day, or after any GAS change | `.claude/skills/article-health/` |

Skills are L3 in their entirety: each `SKILL.md` is the runbook, each `scripts/*.mjs` is the executable form.

---

## 6. Audit cadence

Lighter than asp-cloud — no QA engineer, no monthly threat-model refresh. The two cadences that matter:

| Review | Trigger | Output |
|---|---|---|
| **Article health sweep** | After any `gas/src/Code.gs` change that touches generation; after any user-reported broken article | Run the `article-health` skill; fix any TRUNCATED_* findings before considering the change done |
| **Governance retrospective** | Whenever an incident reveals a bug class that an existing rule didn't catch (the L2 truncation case is the seed example) | Update this doc + the relevant L1 doc to make the next instance impossible. Cite the incident in the change. |

Missing a "what should this rule have caught?" pass after an incident is itself a governance defect.

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

1. **Read first.** Before editing, read this file (§2 L0 at minimum), [docs/architecture-source-of-truth.md](architecture-source-of-truth.md), and any L1 doc named in [§3.1](#31-current-statute) that's relevant to the path being edited.
2. **Respect layer precedence.** L3 work (runbook edits, new skills, refactors that don't change L1 contracts) is freely auto-executable. L2 hardening (new mechanical check) is auto-executable. L2 loosening, L1 amendment, and L0 conflict require operator approval.
3. **Flag L0 conflicts.** A request that violates C-1…C-4 must be reported to the operator, not implemented "with a workaround."
4. **Use L2 tooling locally before declaring done.** After editing `gas/src/Code.gs`: run the `gas-deploy-verify` skill. After regenerating Notion content: run the `article-health` skill.
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
- **Editing `package.json` deploy IDs, `gas/appsscript.json` access settings, or the `clasp deploy -i` slot.**
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
