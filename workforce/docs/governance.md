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
- **W-3 Cost ceiling.** A monthly token budget per agent is enforced at the LLM call site (throw on overrun). A CloudWatch Billing Alarm covers the deployment as a whole. Initial cap: USD 100/month combined (raised from USD 50/mo on 2026-05-23 to accommodate the VP layer introduced by RFC-009). Raising the cap is a Zone A change.
- **W-4 Fail loud.** `finish_reason==='length'`, Notion/GitHub API errors, memory `memver` conflicts, and 24h Engineer-PR timeouts (R-N1 exception path) all throw or DLQ. No silent degradation. Inherits C-4 with the new failure modes named.
- **W-5 Persona stability.** A bump to any agent's `system.md` (prompt-version) is its own PR (inherits AGENTS.md Rule 11). No PR may bump more than one persona's system.md or more than one skill's `SKILL.md` body. A PR that bumps a `SKILL.md` body must also bump that skill's `meta.json:version` in the same PR (the two are co-versioned). A PR may not combine a persona `system.md` bump with a skill `SKILL.md` bump; each is its own PR even when conceptually paired. The first version of every persona (PR2 of the rebuild) and the first version of every skill (PR3 of the rebuild) are documented exceptions — first version is not a bump.

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
| `workforce/agents/{slug}/system.md` | **A** with Rule 11 | Persona identity. One PR may not bump more than one persona's `system.md`. First version per persona is the documented exception. |
| `workforce/agents/{slug}/agent.json` | **B** with Rule 11 | Persona config (model, schedule, budget). Same one-at-a-time discipline. |
| `workforce/agents/{slug}/avatar.*` | **Forbidden** | Per-agent avatar files do not scale to 100s of agents. Avatars are rendered procedurally on the frontend from the slug (initial letter + slug-hash-derived HSL hue). The linter rejects any `avatar.*` under `agents/{slug}/`. |
| `workforce/skills/{name}/SKILL.md` | **A** with Rule 11 | Reusable agent instructions. One PR may not bump more than one skill's body. First version per skill is the documented exception. |
| `workforce/lambdas/**/*.ts` | **B** | Implementation code. Agent-merge OK with CI + review. |
| `workforce/lambdas/**/package*.json` | **B** | Dependency lists for the Lambdas. Per-PR `npm ci` regeneration is fine. |
| `workforce/infra/sam/template.yaml` | **B** | SAM template. Changes that alter cost or scheduling are escalated under §5. |
| `workforce/infra/sam/samconfig.toml` | **A** | Deploy targets, region, stack names. Production surface. |
| `workforce/scripts/**` | **B** | Lint scripts, seeders, validators. Pure tooling. |
| `workforce/seed/**` | **B** | Bootstrap data. Idempotent. |
| `.github/workflows/workforce-*.yml` | **A** | Inherits the AGENTS.md Zone A on `.github/workflows/**`. Agent proposes the diff in a PR; human merges. |

Anything new under `workforce/**` that doesn't match an entry above defaults to **B** with the requirement that the PR description names the new path and why it doesn't need Zone A protection. If reviewers disagree, treat it as Zone A pending a follow-up classification PR.

## §4. R-N design rules (basic-design simplicity)

These rules exist so the architecture stays comprehensible as N grows from 1 persona to 5 to (eventually) more. They are tighter than the AGENTS.md §2 rules — they govern *shape*, not just process.

- **R-N1. Single execution surface.** All agent reasoning runs on AWS Lambda. The only documented exception is **code execution via Claude Code routine on GitHub Actions** (Lambda cannot host interactive code authoring). The dispatch surface is **per-Skill, not per-agent**: any Skill whose `meta.json:trigger_class=claude-code-routine` may dispatch through the CC routine path regardless of which agent owns it. Originally this exception was Ren-only; RFC-008 generalises it to the Skill level so the execution unit and the execution surface choice are co-located. No other execution surfaces — EC2, Fargate, ECS, Cloud Run, local fs, GAS triggers, Step Functions — without a Zone A amendment to this rule.
- **R-N2. Single state store.** All persistent workforce state lives in DynamoDB (`wf-table-{stage}`) and S3 (`wf-bucket-{stage}`). Notion and GitHub hold *artefacts* (articles, PRs), not state. RDS / Redis / Elasticache / local filesystem are out (W-2 inheritance).
- **R-N3. Single secret store.** All API keys, tokens, and deploy credentials live in AWS Secrets Manager under the `wf/` namespace. SSM Parameter Store, plain environment variables, hard-coded constants, and per-runner GitHub Secrets (CI excluded) are not permitted.
- **R-N4. Single scheduler.** Every time-based trigger is an EventBridge rule. No GitHub Actions cron for workforce work (the workforce CI lint check itself is fine), no GAS triggers, no `setTimeout` inside Lambda.
- **R-N5. Single observability stack.** All logs, metrics, alarms, and dashboards are CloudWatch. Datadog / Sentry / OpenTelemetry exporters are deferred to a v2 discussion.
- **R-N6. Single frontend surface (v1).** Workforce-visible pages (agent directory, agent profile, deliverable feed, author byline) extend the existing Vite/React SPA under `/workforce/*` routes. CloudFront + S3 distribution for an interactive `workforce.kohuehara.xyz` is a v2 decision, opened by a Zone A PR.
- **R-N7. Single naming convention.** See [naming.md](naming.md). The convention is enforced by `workforce/scripts/validate-naming.mjs` in CI. Violations block the PR; loosening the rule is Zone A.
- **R-N8. Data shape uniformity (no per-agent exceptions).** All 5 personas have the same `agent.json` + `system.md` + `avatar.svg` files; the same DDB row shapes (`META`, `MEMORY#INDEX`, `RUN#{ts}`, `DELIV#{id}`); the same S3 prefix layout (`memory/{slug}/`, `articles/{slug}/`, etc.); the same EventBridge cron-rule shape (idle agents still have an `Enabled: false` rule). "Sora-only" or "Ren-only" branches in the shared code are forbidden — the R-N1 CC-routine exception is dispatched on `activeSkill.meta.trigger_class === "claude-code-routine"`, not on `if (agent === "ren")` or `if (agent.code_execution === "claude-code-routine-on-gha")`.

These rules also constrain reviewers: a PR that adds a new state store, a new schedule mechanism, or a per-agent branch must either re-classify itself as a Zone A R-N amendment or be rejected.

## §5. Action authority — autonomous vs escalate

Defaults for an agent acting on a workforce task. The matrix below tightens [AGENTS.md §3](../../AGENTS.md#3-what-machines-decide-vs-what-humans-decide) for workforce-specific decisions.

| Action | Authority | Notes |
|---|---|---|
| Edit `workforce/lambdas/**/*.ts` to fix a bug, push to a branch, open a draft PR. | **A** (autonomous) | Standard Zone B agent-merge with CI + review. |
| Run a one-off Lambda invocation against `dev` stage to verify a fix. | **A** | `dev` is for this; `prod` is not. |
| Add a new skill under `workforce/skills/`, first version. | **A** | First version is the Rule 11 documented exception (§3). |
| Bump an existing persona's `system.md` (prompt-version). | **B** (escalate) | One agent per PR, human merge (W-5, Rule 11). |
| Bump an existing skill's `SKILL.md` body (prompt-version). | **B** | Same one-per-PR discipline. |
| Add a new EventBridge cron rule or enable a previously-disabled rule. | **B** | Affects schedule and cost; operator approval before flipping `Enabled: true`. |
| Raise the W-3 cost ceiling (`USD 100/mo` default). | **B** | Zone A change to this doc. |
| Add a new AWS service to the SAM template (e.g., adding SQS, Step Functions). | **B** | Probable R-N1..R-N5 violation. Discuss before opening the PR. |
| Edit `workforce/docs/governance.md` §2 (W-1..W-5). | **B** | L0 amendments are Zone A by definition; requires explicit operator approval, not just review. |
| Loosen, disable, or skip the `validate-naming.mjs` check. | **B** | R-N7 tightening only — never loosening — without §2 amendment. |
| Merge any PR (including agent-authored ones). | **B** | Agents never merge. Inherits AGENTS.md R-6. |
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
