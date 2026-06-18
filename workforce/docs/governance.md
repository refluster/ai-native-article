# Workforce — Governance

The rules that bind every PR, agent, and skill inside `workforce/`. This doc is the workforce subsystem's L1 governance, layered on top of the root-level [AGENTS.md](../../AGENTS.md) and [docs/governance.md](../../docs/governance.md). Where this doc and the root docs conflict, **root wins** unless this doc explicitly tightens (never loosens).

This file is itself **Zone A** (see §3). Agents may propose edits; humans merge.

## §1. Scope and inheritance

This document governs files under `workforce/**`. It does not govern the legacy article pipeline (`gas/`, `src/`, `public/`, `docs/`, `skills/`, `scripts/`, `.github/workflows/{ci,deploy}.yml`), which continue to operate under the root [AGENTS.md](../../AGENTS.md) and [docs/governance.md](../../docs/governance.md).

The workforce subsystem **inherits**:

- The Zone A / B / C / D model from [AGENTS.md §1](../../AGENTS.md#1-zones--who-owns-what). Zone classifications for `workforce/` paths are in §3 below.
- The 12 rules from [AGENTS.md §2](../../AGENTS.md#2-the-rules-agents-must-follow). All apply to workforce PRs unchanged; Rule 11 (prompt-version bump = own PR) is reinforced in §4.
- The C-1..C-4 invariants from [docs/governance.md §2](../../docs/governance.md#2-l0--constitution). The workforce-specific W-1..W-5 below extend them.

The workforce subsystem **adds**:

- W-1..W-5 invariants (§2) — extensions of C-1..C-4 specific to multi-persona output.
- R-N1..R-N8 design rules (§4) — the "shape" rules that keep the architecture from drifting toward implementation sprawl.
- Action-authority matrix (§5) — what an agent does autonomously vs escalates.

## §2. L0 invariants (W-1..W-5)

Non-negotiable. A request that would force a violation must be refused or escalated, never implemented as a "creative interpretation".

- **W-1 Editorial integrity.** Any article published under a persona byline on `kohuehara.xyz` must be free of mid-sentence truncation, empty bodies, and LLM-failure artefacts. Extends C-1 by attaching responsibility to the persona, not just the site.
- **W-2 No double source-of-truth.** Article content is owned by Notion (inherits C-2). Workforce state — agent definitions, tasks, runs, deliverables, memory — is owned by DynamoDB + S3. The two domains never cross: Notion never holds workforce state, DDB never holds article body text.
- **W-3 Cost ceiling.** A monthly token budget per agent is enforced at the LLM call site (throw on overrun). A CloudWatch Billing Alarm covers the deployment as a whole. Current cap: USD 190/month combined (raised from USD 160/mo on 2026-06-14 for the Finance & Capital group — Silas/Delphine/Corinne, +USD 18/mo — which had pinned the prior roster at 156/160 and left no room for a three-hire finance function; previously from USD 130/mo on 2026-06-05 for the Agent Workforce Platform group — Mateo/Hana/Freya/Sana, +USD 30/mo — which had pinned the prior cap at 129/130 and left no room to lift the platform ICs off Haiku; previously from USD 100/mo on 2026-05-27 for the Q2 five-hire round — Nadia/Aanya/Vikram/Farah/Levi, +USD 30/mo — and from USD 50/mo on 2026-05-23 for Epic-009's VP layer). Raising the cap is a Zone A change.
- **W-4 Fail loud.** `finish_reason==='length'`, Notion/GitHub API errors, memory `memver` conflicts, and 24h Engineer-PR timeouts (R-N1 exception path) all throw or DLQ. No silent degradation. Inherits C-4 with the new failure modes named.
- **W-5 Persona stability.** An agent's identity/config — persona prompt (`system_prompt`), model, budget, streams, bindings — lives on the `AGENT#{slug}/META` row and is mutated **only** through the agents-api write path ([ADR-0007](adr/adr-0007-agent-config-single-source.md)): one persona per mutation, validated at the write boundary, appended to the immutable `AUDIT#` trail, and surfaced in the weekly config digest — the post-hoc review that replaced per-change PR review. The discipline AGENTS.md Rule 11 enforced via "a persona bump is its own PR" — atomic, reviewable, one-persona-at-a-time — is unchanged; ADR-0007 moved the *mechanism* from git PRs to audited writes. Skills stay file-based and keep the PR discipline: no PR may bump more than one skill's `SKILL.md` body; a `SKILL.md` bump must also bump that skill's `meta.json:version` in the same PR (the two are co-versioned); the first version of every skill is the documented exception — first version is not a bump.

When in doubt about which invariant a proposed change touches: it's almost certainly W-2 or W-5. Ask before merging.

## §3. Zone classifications for `workforce/`

Per AGENTS.md §1 vocabulary:

| Path | Zone | Notes |
|---|---|---|
| `workforce/docs/governance.md` | **A** | This file. Identity-level governance. Agents propose; humans merge. |
| `workforce/docs/architecture.md` | **A** | The "system shape". Changes to the diagram or the R-N1 exception belong in their own PRs. |
| `workforce/docs/naming.md` | **A** | The naming contract; loosening it cascades through every later PR. |
| `workforce/docs/data-model.md` | **A** | The DDB/S3 schema. Schema changes touch every consumer. |
| `workforce/docs/runbooks/*.md` | **B** | Operator runbooks. Agent-merge OK with CI + review. |
| Agent identity/config — DDB `AGENT#{slug}/META` via agents-api `PATCH` | **B** with W-5 | [ADR-0007](adr/adr-0007-agent-config-single-source.md): the authoritative store; not a git path. One persona per mutation; the write-time validator + blast-radius guards (model allowlist, W-3 budget ceiling, cadence floor, prompt-size cap) are the mechanical gate; the `AUDIT#` trail + weekly digest are the review. The mass-edit exemption survives as: additive `bindings[]` writes that wire the same new skill across multiple agents may land as a series of writes in one digest week. |
| `workforce/agents/{slug}/*` (legacy git tree) | **Frozen** | ADR-0007 migration: changes go to DDB only; the tree and its seed retire at step 6. Until then a file edit here is a governance violation, not a config change. |
| `workforce/agents/{slug}/avatar.*` | **Forbidden** | Per-agent avatar files do not scale to 100s of agents. Avatars are rendered procedurally on the frontend from the slug (initial letter + slug-hash-derived HSL hue). The linter rejects any `avatar.*` under `agents/{slug}/`. |
| `workforce/skills/{name}/SKILL.md` | **A** with Rule 11 | Reusable agent instructions. One PR may not bump more than one skill's body. First version per skill is the documented exception. |
| `workforce/skills/{name}/meta.json` | **B** with Rule 11 | Workforce-internal skill sidecar (executor, version, owners). Co-versioned with `SKILL.md` per W-5. |
| `workforce/skills/{name}/handler.ts` | **B** with Rule 11 | Deterministic skill implementation, bundled in the skill folder. A behavior-changing edit bumps `meta.json:version` in the same PR. Auto-registered via `workforce/scripts/build-skill-registry.mjs`. |
| `workforce/lambdas/**/*.ts` | **B** | Implementation code. Agent-merge OK with CI + review. |
| `workforce/lambdas/**/package*.json` | **B** | Dependency lists for the Lambdas. Per-PR `npm ci` regeneration is fine. |
| `workforce/infra/sam/template.yaml` | **B** | SAM template. Changes that alter cost or scheduling are escalated under §5. |
| `workforce/infra/sam/samconfig.toml` | **A** | Deploy targets, region, stack names. Production surface. |
| `workforce/scripts/**` | **B** | Lint scripts, seeders, validators. Pure tooling. |
| `workforce/seed/**` | **B** | Bootstrap data. Idempotent. |
| `workforce/client/**` | **B** | External-repo distribution surface (Phase 7 PR7 — `wf-engage` Claude Code skill + helper scripts + install template). Consumed by downstream repos via `scripts/install.sh`; the skill body is the load-bearing contract for client-side agent engagement under R-N1(b). |
| `.github/workflows/workforce-*.yml` | **A** | Inherits the AGENTS.md Zone A on `.github/workflows/**`. Agent proposes the diff in a PR; human merges. |

Anything new under `workforce/**` that doesn't match an entry above defaults to **B** with the requirement that the PR description names the new path and why it doesn't need Zone A protection. If reviewers disagree, treat it as Zone A pending a follow-up classification PR.

## §4. R-N design rules (basic-design simplicity)

These rules exist so the architecture stays comprehensible as N grows from 1 persona to 5 to (eventually) more. They are tighter than the AGENTS.md §2 rules — they govern *shape*, not just process.

- **R-N1. Execution surfaces (declared).** Agent reasoning runs on AWS Lambda by default. Documented exceptions:
  - **(a) Claude Code routine on GitHub Actions** — code execution that needs interactive Claude Code tools (Lambda cannot host them). The dispatch surface is **per-Skill, not per-agent**: any Skill whose `meta.json:trigger_class=claude-code-routine` may dispatch through the CC routine path regardless of which agent owns it. Originally this exception was Ren-only; Epic-008 generalises it to the Skill level so the execution unit and the execution surface choice are co-located.
  - **(b) Client-side execution by external clients (Phase 7).** External clients (RepoA-style downstream repos) fetch agent metadata via the public read surface (`GET /workforce/agents`, `GET /workforce/agents/{slug}`, `GET /workforce/agents/{slug}/portfolio`) and execute the agent's reasoning in their own environment (Claude Code session in RepoA, RepoA-supplied LLM credentials, RepoA-supplied target-surface credentials). Engagement records POST back to the workforce via `POST /workforce/agents/{slug}/engagements` (Bearer-token auth) — written to `PROJECT#{id}/EXEC#{ulid}` via the same `appendExecution` helper used by Lambda-side execution. **Best-effort posture explicitly accepted on this path**: audit row may be lost if the POST-back fails; W-3 (token budget cap) is not enforced because the workforce never sees the LLM call; persona stability and version reproducibility degrade because RepoA caches agent definitions and assembles prompts under its own Claude Code rules. The operator opts in by issuing the bearer token; the C-3 single-operator-scale constraint makes the silent-loss failure mode acceptable.
  - No other execution surfaces — EC2, Fargate, ECS, Cloud Run, per-Lambda nested invocations, GAS triggers, Step Functions — without a further Zone A amendment to this rule.
- **R-N2. Single state store.** All persistent workforce state lives in DynamoDB (`wf-table-{stage}`) and S3 (`wf-bucket-{acct}-{region}-{stage}`). Notion and GitHub hold *artefacts* (articles, PRs), not state. RDS / Redis / Elasticache / local filesystem are out (W-2 inheritance). **Agent identity/config is state in this rule's sense** ([ADR-0007](adr/adr-0007-agent-config-single-source.md)): owned by the `AGENT#{slug}/META` row — git holds no authoritative agent config — and guarded by the agents-api write-time validator, the append-only `AUDIT#` trail, the weekly config digest, and PITR + weekly S3 exports (the durability machinery that replaced "git reconstructs the org").
- **R-N3. Single secret store.** All API keys, tokens, and deploy credentials live in AWS Secrets Manager under the `wf/` namespace. SSM Parameter Store, plain environment variables, hard-coded constants, and per-runner GitHub Secrets (CI excluded) are not permitted.
- **R-N4. Bindings are the unified scheduler declaration.** Every scheduled or event-driven workforce execution is declared in the agent's `AGENT#{slug}/META.bindings[]` (written via agents-api per [ADR-0007](adr/adr-0007-agent-config-single-source.md); formerly `workforce/agents/{slug}/agent.json:bindings[]`). A binding specifies `{skill, executor, trigger}`:
  - Permitted **executors**: `lambda` (workforce Lambda fired by orchestrator-tick OR direct invocation), `claude-code-routine` (a CCR running in the operator's claude.ai account; see [runbooks/bindings.md](runbooks/bindings.md)), `gha` (a GitHub Actions workflow under `.github/workflows/`), `cli` (operator manual invocation; declarative only).
  - Permitted **schedulers**: `eventbridge`, `claude-code-routine`, `gha`, `external` (fired via API by another binding or the wf-webhook surface), `manual` (operator-triggered direct invoke).
  - **`lambda` accepts `eventbridge` (cron), `external` (API GW / async invoke from another binding), or `manual` (operator `aws lambda invoke`).** The earlier "lambda requires eventbridge" rule was too tight — it forced multi-project PR-review skills (Phase 7) to misclassify Lambda-resident handlers as `claude-code-routine`. Lambda is the execution surface (R-N1); how the surface is *triggered* is orthogonal. The validator enforces (executor, scheduler) pairs per the table in [runbooks/bindings.md §Executor × scheduler compatibility](runbooks/bindings.md#executor--scheduler-compatibility).
  - The agents-api write-time validator (`workforce/lambdas/shared/agent-config.ts`) asserts every binding's structural contract — executor/scheduler allowlists, skill existence + ownership against the `SKILL#` rows, the CCR-batch `project_id` requirement — synchronously on every write (ADR-0007; formerly the `validate-agent-json.mjs` CI lint, which retires with the git tree at step 6).
  - **Undeclared scheduled runs are forbidden.** This includes CCR routines instantiated in an operator's claude.ai account that target workforce repos without a corresponding binding entry — the binding is the audit surface, not the cloud account's routine list.
  - `setTimeout` / `setInterval` inside a Lambda body remains forbidden. Anything that recurs must be declared as a separate binding.
- **R-N5. Single observability stack.** All logs, metrics, alarms, and dashboards are CloudWatch. Datadog / Sentry / OpenTelemetry exporters are deferred to a v2 discussion.
- **R-N6. Single frontend surface (v1).** Workforce-visible pages (agent directory, agent profile, deliverable feed, author byline) extend the existing Vite/React SPA under `/workforce/*` routes. CloudFront + S3 distribution for an interactive `workforce.kohuehara.xyz` is a v2 decision, opened by a Zone A PR.
- **R-N7. Single naming convention.** See [naming.md](naming.md). The convention is enforced by `workforce/scripts/validate-naming.mjs` in CI. Violations block the PR; loosening the rule is Zone A.
- **R-N8. Data shape uniformity (no per-agent exceptions).** All personas share the same identity shape (the `AGENT#{slug}/META` field set — ADR-0007); the same DDB row shapes (`META`, `AUDIT#{ts}`, `MEMORY#INDEX`, `RUN#{ts}`, `DELIV#{id}`); the same S3 prefix layout (`memory/{slug}/`, `articles/{slug}/`, etc.); the same EventBridge cron-rule shape (idle agents still have an `Enabled: false` rule). "Sora-only" or "Ren-only" branches in the shared code are forbidden — the R-N1 CC-routine exception is dispatched on `activeSkill.meta.trigger_class === "claude-code-routine"`, not on `if (agent === "ren")` or `if (agent.code_execution === "claude-code-routine-on-gha")`.
- **R-N9. External git surface is PR-only, never direct commit.** When a workforce skill produces an artefact destined for an **external project's git surface** (per Epic-010 §3, a `PROJECT#{id}` that is not `self/*` and has a non-null `github` field), the skill MUST open a Pull Request against the target repository; it MUST NOT write to the default branch directly. Mechanically:
  - The skill `meta.json:deliverable.type` for external-git delivery is **`external-pr`** only. There is **no** `external-commit` deliverable type — the schema (`workforce/scripts/schemas/skill-meta.schema.json`) does not register it, and adding one is a Zone A amendment that must explain why W-5 (agents never gate merges) does not apply. The TS-side mirror (`workforce/lambdas/shared/skill.ts:DeliverableType` union) carries the same constraint, so a skill that declares `external-commit` fails at both schema lint AND TypeScript compile. The execution helper that turns an `external-pr` deliverable into an actual PR lives at `workforce/lambdas/shared/external-pr.ts` (Phase 7 PR6 scaffold; full git-data REST wiring lands when the first real consumer arrives).
  - The project's `github.token` PAT scope SHOULD omit `Contents:write` on protected branches (only `Pull requests:write` + `Contents:write` on a workforce-prefixed branch namespace, or equivalent). The GitHub API layer becomes the second mechanical enforcement — a direct push to `main` is denied at the wire, not just at the application layer.
  - The PR body MUST cite the parent skill invocation (run_id) and the agent identity, so the external repo's maintainer can trace the artefact back to the workforce's audit ledger.
  - Composition: cross-project work that needs "open a PR on project C, then post a notification on `self`" remains two skill invocations per Epic-010 §4. This rule narrows §4's general principle to a specific shape — the C-side invocation produces a PR, never a commit.
  - **Inheritance with W-5.** W-5 says agents never gate merges on the workforce's own PRs; R-N9 extends the same logic outward — the external maintainer is the merger on their repo, the workforce is the author. The workforce does not push code anywhere it does not also relinquish merge authority. **R-N10 is the bounded inverse:** the workforce may act as merger on an external repo *only where that repo's own statute has explicitly delegated merge authority back to the workforce agent* for a defined, machine-checkable PR class — i.e. the maintainer **granting** authority, not the workforce **taking** it. See R-N10.

- **R-N10. Delegated external-merge (the one bounded exception to "agents never merge").** A workforce skill MAY merge a Pull Request on an **external** project's repo — overriding the §5 "agents never merge" default and the R-N9 author-only posture — **only when every one of the following holds**; otherwise it MUST escalate (post a review comment + hand off, or file a tracking issue):
  1. **Delegation exists.** The target project's *own* governance has explicitly granted autonomous-merge authority to the workforce agent for a named PR class (e.g. `PSVL/asp-cloud` → `docs/adr_autopilot_pr_merge.md`, the "Autopilot PR" lane). The grant lives in the *target repo's* statute; the workforce never self-asserts it. This is the W-5 / R-N9 reconciliation: those rules forbid the workforce *taking* merge authority the maintainer never gave — R-N10 permits a merge *only where the maintainer has given it.* **Self-repo delegation ([adr-0011](adr/adr-0011-own-repo-autopilot-merge.md)).** The workforce's *own* repo `refluster/ai-native-article` carries this delegation in its [root `docs/governance.md` §4.4](../../docs/governance.md) + the L0/L1 block there, and is treated **identically to an external delegated target** — there is no own-repo carve-out. adr-0011 retired the former "a passing 🟢 on the own repo escalates instead of merging" step (and the `SELF_REPO` guard that enforced it): the single boundary is clause 2's L0/L1 set, which on this repo is the faithful projection of the operator-only **Zone A** surface (§3). A reviewed, non-L0/L1 PR is merged by the agent; anything on the L0/L1 boundary — every governance / ADR / identity / schedule / production path — still escalates to the operator. This does **not** weaken W-5: persona/identity config and all Zone A files remain operator-only via the L0/L1 set; what changed is only that *mechanical, reversible* own-repo PRs are no longer special-cased out of the standard predicate.
  2. **Eligibility predicate passes (machine-checkable).** The PR meets the target project's published predicate. The predicate widened on 2026-06-17 ([adr-0010](adr/adr-0010-autopilot-merge-consensus-widening.md), superseding the original Dependabot-only safe class) to: the PR touches **no L0/L1 governance path of the target repo** (the L0/L1 path set is read from the *target repo's own* `docs/governance.md`, between its `<!-- autopilot:l0l1-paths -->` markers — the maintainer declares what is off-limits, never the workforce), is open + mergeable + **clean**, has **all required checks green**, carries **no human `CHANGES_REQUESTED`**, and has the routing persona's **nominated reviewers' unanimous-green consensus** (every nominee posted a non-blocking lens review). A PR touching the target's L0/L1 **always escalates to a human** — the operator's final call. The skill's bundled write-script **re-verifies the predicate server-side and fails closed**: if the target governance doc is unreadable or declares no L0/L1 block, the L0/L1 set is *unknown* and the merge is **refused**, never guessed.
  3. **Kill-switch armed.** The workforce-side per-binding switch is on. (The target-repo `AUTOPILOT_PR` variable gate was **removed** by adr-0010 — the L0/L1 boundary read from the target's own statute now carries the "what may autopilot merge" decision, so a separate repo-variable toggle was redundant. The R-N10 *delegation* in clause 1 still lives in the target repo.)
  4. **Audited & legible.** The merge posts a verdict/advisory-cited comment (a CVE/GHSA id when the PR is a security update; the reviewer-consensus summary otherwise), the squash commit references the rationale, and the fire self-records an engagement (R-N1 audit ledger). The mechanical marker is the deliverable type **`external-pr-merge`** (registered in `skill-meta.schema.json` + `skill.ts:DeliverableType`): a skill that performs delegated merges MUST declare it, and `external-pr` skills still cannot merge.
  This realises the 2026-06-16 Autopilot direction as widened by the 2026-06-17 adr-0010; it is the **only** path by which a workforce agent merges anything, and the rule is itself Zone A (this amendment). **Consumer (one shared engine).** `pr-autopilot` verdict mode performs the delegated merge (on a unanimous-green, non-L0/L1 PR) and MUST declare `external-pr-merge`; it calls the **single** fail-closed engine `workforce/skills/pr-autopilot/pr-merge.mjs`, which re-verifies clauses 1–3 server-side. The former `dependabot-triage` no-review fast path is **retired** by adr-0010 — bot PRs now route through `pr-autopilot` like any other PR (reviewed, not no-review). There is one merge implementation, not per-skill copies. Routing/review under `pr-autopilot` (which absorbed the retired `pr-review` reviewer skill) generalise to **all** PRs; the *merge* never widens past this predicate (notably: never to an L0/L1 change) without a further superseding R-N10 amendment.

These rules also constrain reviewers: a PR that adds a new state store, a new schedule mechanism, or a per-agent branch must either re-classify itself as a Zone A R-N amendment or be rejected.

## §5. Action authority — autonomous vs escalate

Defaults for an agent acting on a workforce task. The matrix below tightens [AGENTS.md §3](../../AGENTS.md#3-what-machines-decide-vs-what-humans-decide) for workforce-specific decisions.

| Action | Authority | Notes |
|---|---|---|
| Edit `workforce/lambdas/**/*.ts` to fix a bug, push to a branch, open a draft PR. | **A** (autonomous) | Standard Zone B agent-merge with CI + review. |
| Run a one-off Lambda invocation against `dev` stage to verify a fix. | **A** | `dev` is for this; `prod` is not. |
| Add a new skill under `workforce/skills/`, first version. | **A** | First version is the Rule 11 documented exception (§3). |
| Mutate an existing persona's identity/config (`system_prompt`, model, budget, bindings) via agents-api `PATCH`. | **B** (escalate) | One persona per mutation, validated + audited at the write boundary, surfaced in the weekly digest (W-5, ADR-0007). The operator edits autonomously; an *agent* asking to mutate a persona — its own included — escalates first. |
| Bump an existing skill's `SKILL.md` body (prompt-version). | **B** | Same one-per-PR discipline. |
| Add a `bindings[]` entry to multiple agents' `META` rows (agents-api writes) for the same new skill. | **A** | Per §3 amendment (this doc; mechanism moved to DDB writes by ADR-0007). The new binding's `trigger` lands `Enabled: false`-equivalent (paused or manual scheduler); enabling a new cron cadence is a separate B-authority action (see next row). |
| Add a new EventBridge cron rule or enable a previously-disabled rule. | **B** | Affects schedule and cost; operator approval before flipping `Enabled: true`. |
| Raise the W-3 cost ceiling (`USD 190/mo` default). | **B** | Zone A change to this doc. |
| Add a new AWS service to the SAM template (e.g., adding SQS, Step Functions). | **B** | Probable R-N1..R-N5 violation. Discuss before opening the PR. |
| Edit `workforce/docs/governance.md` §2 (W-1..W-5). | **B** | L0 amendments are Zone A by definition; requires explicit operator approval, not just review. |
| Loosen, disable, or skip the `validate-naming.mjs` check. | **B** | R-N7 tightening only — never loosening — without §2 amendment. |
| Merge any PR (including agent-authored ones). | **B** | Agents never merge — **except** a *delegated merge* under **R-N10** (an autopilot-eligible PR on a delegated repo — external **or** the workforce's own, [adr-0011](adr/adr-0011-own-repo-autopilot-merge.md) — whose statute has granted the workforce merge authority, predicate-passing, kill-switches armed). Every other merge escalates. Inherits AGENTS.md R-6. |
| Perform a delegated merge under **R-N10**. | **A** (autonomous, bounded) | Only when all R-N10 clauses hold (delegation in target statute — external or own repo per adr-0011; predicate passes server-side — non-L0/L1 + unanimous-green consensus + clean + green checks, adr-0010; per-binding kill-switch armed; audited via `external-pr-merge` + advisory/consensus comment + engagement). A PR touching the target's L0/L1 → escalate to a human. Any failed clause → escalate (file issue). |
| Force-push `main` or `gh-pages`. | **Forbidden** | AGENTS.md R-6. No exception. |
| Force-push a feature branch (e.g. after rebase). | **A** | Feature-branch force-push is the standard rebase workflow. Use `--force-with-lease`. |
| Run a destructive AWS action (delete stack, drop table, empty bucket). | **B** | Even on `dev`, operator confirmation required. The cost of a wrong-stage typo is hours. |
| Spend money outside the existing cost envelope (new managed service, larger Lambda memory). | **B** | Cost guard; mention in PR description. |

When the matrix doesn't cover a case: default to **B** and ask. A redundant question costs a minute; an unauthorised action costs an afternoon.

## §6. Governance retrospective loop

When a bug, outage, or surprise happens that this doc didn't prevent, the fix is **not complete** until one of the following has been added:

- A new sentence under W-1..W-5 (an invariant was missing).
- A new row in §3 (a path's zone was undefined).
- A new R-N rule (a shape constraint was implicit).
- A new row in §5 (an authority boundary was unclear).
- A new mechanical check (CI lint, Lambda runtime guard) that catches the failure mode.

The original PR that fixes the bug should link to the follow-up governance PR (and vice versa) so the audit trail is one click in either direction.
