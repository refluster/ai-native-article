# Workforce — Follow-ups index

A single index of "deferred to follow-up" items surfaced across PRs. The dev process ([dev-process.md](runbooks/dev-process.md)) requires every reviewer-flagged item to be **either fixed in the PR or named here**, never silent-dropped. This file is the index.

## Schema

Each row has:

- **#** — `FU-NNN` (engineering, governance, process) or `OP-NNN` (operator-action). Monotonically increasing.
- **Item** — one-line description.
- **Severity** — `L0` (blocks ship) / `L1` (Story-level) / `L2` (sweep at Epic boundary) / `L3` (eventual).
- **Source** — PR # or Epic ID where the finding originated.
- **Target** — concrete next anchor: Story #, separate PR scope, or "next Epic".
- **Owner** — engineering / governance / operator / `story-N` (when the resolution is folded into a specific Story's scope).
- **Status** — open / in-progress (`@PR#`) / ✅ done (`@PR#`) / ⛔ won't-do (with one-line rationale).
- **Notes** — context.

## Sweep cadence

- **Maya** sweeps the index at every Phase A (Epic kickoff) — pull anything `target = next Epic` into the new Epic's scope or re-target.
- **Author** confirms relevant FU-* items at Phase G (operator merge) — mark any rows the PR resolved as ✅.
- **Operator** sweeps OP-* rows at every stage-deploy.

## Open

| # | Item | Severity | Source | Target | Owner | Status | Notes |
|---|---|---|---|---|---|---|---|
| FU-001 | `pdm-charter` real implementation | L1 | retro 2026-05-27 | next Epic | maya | open | The next Epic should drive its first real handler. Today Epic → Story split is chat-driven. |
| FU-002 | `pr-route` routine instantiation in claude.ai | L2 | retro 2026-05-27 | when conversational pattern saturates | operator | open | Spec at `routines/pr-route.md`. Maya's binding holds the persona overlay (nomination_rules etc.); paste into CCR with `pull_request.opened` + `pull_request.synchronize` triggers, configuring the routine with Maya's `system.md` + agent.json `config`. |
| FU-003 | Reviewer (`pr-review`) routine instantiation in claude.ai | L2 | retro 2026-05-27 | when conversational pattern saturates | operator | open | Single generic spec at `routines/pr-review.md` instantiated three times in CCR, once per persona (Dario / Ren / Aoi), each composed with its `agent.json:bindings[pr-review].config` lens. API-triggered from the routing routine. |
| FU-004 | Mechanical cycle counter CI lint | L1 | retro 2026-05-27 | separate PR | engineering | open | Count Maya-authored router comments per PR; fail build at cycle ≥ 8. Definition pinned to "router→verdict bundle" per `dev-process.md`. W-4 enforcement on the 7-cap. |
| FU-005 | Reviewer scope-creep enforcement | L2 | retro 2026-05-27 | after FU-004 | engineering | open | Cycle-2+ reviewer comments cite a cycle-1 finding-ID or are flagged `[NEW]`. Specs now mandate the ID convention; lint enforces. |
| FU-006 | Cross-PR pattern detection | L2 | retro 2026-05-27 | post-Story-6 | engineering | open | When two PRs in the same Epic make conflicting decisions, surface the conflict. Possibly an Epic-scoped audit Lambda. |
| FU-007 | `resolveProjectId` hoist to handler entry | L2 | PR #111 (Ren) | separate PR | engineering | open | Drop `?:` on `RunnerEvent.project_id` in favour of a private `ResolvedRunnerEvent`. |
| FU-008 | `aws-sdk-client-mock` standardisation | L2 | PR #111 (Ren) | before Story 2 lands | engineering | open | Replace hand-rolled SDK mocks in `backfill-tasks/handler-tests.ts`. ~5KB devDep. Settle before pattern multiplies. |
| FU-009 | `WfBackfillTasksErrorsAlarm` + `ReservedConcurrentExecutions: 1` | L2 | PR #111 (Ren) | separate PR | engineering | open | Mirror existing alarm pattern; add concurrency cap for operator-invoked Lambda safety. |
| FU-010 | `asProjectId` extra validation | L3 | PR #111 (backlog) | backlog | engineering | open | Reject `:` / `\n` / control chars in addition to current `#` / `|`. |
| FU-011 | Story 6 (#95) orphan-RUN reconciliation AC | L1 | PR #111 (Dario + Ren) | story-6 | story-6 | open | Pre-cutover one-shot emits EXEC for every RUN row missing its EXEC sibling. Filed on [#95](https://github.com/refluster/ai-native-article/issues/95). |
| FU-012 | Test-file naming convention in `naming.md` | L3 | PRs #100 / #110 (Ren) | next governance amend | governance | open | Formalise `*-tests.ts` (currently in `vitest.config.mjs`). |
| FU-013a | Extend `writeRunAndExec` to failure paths | L2 | PR #111 (Dario observation) | story-1-extension | engineering | open | Cover `failRun` / `throwRun` / `skipRun` so failure-path runs also emit EXEC rows. |
| FU-013b | Document failure-path EXEC asymmetry | L3 | PR #111 (Dario observation) | separate PR | engineering | open | If FU-013a is rejected, add a comment near the absence test naming the intentional asymmetry per Story 1-B scope. |
| FU-014 | `ccr-bootstrap.md` L82-L120 residual cleanup | L3 | PR #112 (Dario) | separate PR | governance | open | Header warns "ignore labels section" but ~30 lines of stale label-state-machine content remain. Excise or move instantiation steps to `routines/CCR-INSTANTIATE.md`. |
| FU-015 | `follow-ups.md` opened-date + grouping columns | L3 | PR #112 (Dario) | when index hits ~30 rows | governance | open | At 50 entries scan becomes hard. Add `Opened` column + group headings by owner/Epic. |
| FU-016 | Router-rule lint: lambdas/ → Ren always nominated | L2 | PR #112 (Ren) | with FU-004 | engineering | open | When `workforce/lambdas/` is touched, Maya's router comment must nominate Ren. Cheap lint on routing-comment text. |
| FU-017 | `pull_request_review_write` race avoidance | L3 | PR #112 (Dario procedural note) | with FU-002/-003 | engineering | open | Two concurrent reviewer agents stomp each other's pending review (one pending review per user). Maya's router should serialise reviewer dispatch, OR each reviewer should `delete_pending` any existing pending review before creating. |
| FU-018 | Per-skill `config` JSON schema | L2 | PR #112 cycle-3 (operator) | when 2nd binding overlay diverges in shape | engineering | open | `validate-agent-json.mjs` currently checks structural binding fields (executor, scheduler, routine_spec existence) but not `config` contents — the skill spec author owns the schema. Add a `config.schema.json` next to each spec and have the validator load + run ajv against `bindings[*].config`. Today the overlays are well-typed by inspection; add the check before the third reviewer / second router persona lands. |
| FU-019 | Composition-prompt runtime | L1 | PR #112 cycle-3 (operator) | when a `pr-review` / `pr-implement` binding is first auto-fired | engineering | open | The routine_spec docs assert the runtime composes "generic spec + persona `system.md` + binding `config`". No code does this yet — composition happens conversationally today. When the first auto-fire lands (FU-002 / FU-003), build the composer: read spec → read agent's system.md → inject config block → submit to model. Probably lives in the CCR-side instantiation script, not the data plane. |
| FU-020 | Dev-process retrospective cadence sentence | L3 | PR #112 cycle-3 (self-audit) | next dev-process edit | governance | open | `dev-process.md` mentions cycle counter / scope creep mechanically but does not name the retro that produced the seven-phase shape itself. Add one paragraph under "Where this came from" linking the Epic-010 retrospective once that file lands. |
| FU-021 | Workforce-side audit skill (article-health equivalent) | L2 | PR #136 cycle-1 (Dario A5) | before Epic-010 → `Implemented` | engineering | open ([#146](https://github.com/refluster/ai-native-article/issues/146)) | Build the workforce-side audit equivalent that ROADMAP §Status-transition criterion #4 references. Signals: 0 truncated executions, 0 orphan `EXEC` rows (`EXEC#{ulid}` with no `RUN`/`DELIV` sibling during dual-write, or missing `artifact_ref` on a non-`throw` row post-cutover), 0 cross-project leakage detections (any `appendExecution` call where the agent wasn't an active member at the time-of-call). Runs on cron; emits structured signals into a `Workforce/Audit` CloudWatch namespace. Without this, criterion #4 is the silent blocker that never closes. |
| FU-NEW-C | OP-001 bootstrap runbook fix (canonical ProjectMetaRow shape) | L2 | Issue [#150](https://github.com/refluster/ai-native-article/issues/150) B5 | this PR | governance | ✅ done @PR#151 | Pre-Story-1 runbook wrote `stream` + `repo` AND omitted `project_id`; broke `wf-agents-api listProjects` in prod. Runbook patched to write the canonical shape + idempotent hot-fix snippet for already-broken stages. |
| FU-NEW-D | `wf-agents-api listProjects` defensive harden | L2 | Issue [#150](https://github.com/refluster/ai-native-article/issues/150) B5 | this PR | engineering | ✅ done @PR#151 | Skip rows missing canonical `ProjectMetaRow` attributes + emit `WfMalformedProjectMeta` metric under `Workforce/AgentsApi`. Defence-in-depth so a single bad row doesn't 500 the route. |
| FU-NEW-A | Epic-010 CloudWatch dashboard | L3 | Issue [#150](https://github.com/refluster/ai-native-article/issues/150) B6 | this PR | ops | ✅ done @PR#152 | `AWS::CloudWatch::Dashboard` SAM resource `WfEpic010Dashboard` (per-region per-stage). 6 widgets covering `Workforce/Credentials` / `Workforce/AgentsApi` / `Workforce/Recall` / `Workforce/Runner`. |
| FU-NEW-E | Extend malformed-row harden to `listAgents` / `listSkills` | L3 | PR #151 (Dario A1) | when bandwidth | engineering | open | Same bug class as FU-NEW-D applied to the two other scan-based list endpoints in agents-api. Extract `isWellFormedProjectMeta` into a shared `shared/row-validators.ts` module with sibling validators; mirror the skip-and-emit pattern. Metric stays in `Workforce/AgentsApi` with a `RowType` dimension. Out of scope for #151; explicitly not a Story-blocker. |
| FU-NEW-F | Project CRUD UI — credential vault + archive (retires OP-005, Story 6 deferred slice #1) | L2 | Issue [#150](https://github.com/refluster/ai-native-article/issues/150) OP-005, PR #140 deferred | new issue [#158](https://github.com/refluster/ai-native-article/issues/158) | engineering | open ([#158](https://github.com/refluster/ai-native-article/issues/158)) | Replace `CredentialVaultStub` with a real UI surface that consumes `wf-credentials-api` (PUT/GET/DELETE per credential type) + new `GET /projects/{slug}/credentials` LIST + new `PATCH /projects/{slug+}` archive/unarchive. Major work item: Cognito ID-token → IAM SigV4 brokering at the SPA edge (Identity Pool recommended). Splits into a 4-PR series: α SigV4 broker, β LIST + PATCH backend, γ vault UI, δ archive UI. Closes this issue retires OP-005 entirely. |

## Operator-only action items (no PR needed)

| # | Item | Severity | Status | Notes |
|---|---|---|---|---|
| OP-001 | `PROJECT#workforce-meta` DDB bootstrap | L1 per stage | ✅ done 2026-05-27 (prod / us-west-2) | Runbook at `runbooks/project-workforce-meta-bootstrap.md`. Wrote META + 6 MEMBER rows (maya / dario / ren / aoi / yuki / sora). Verified 7 rows present. |
| OP-002 | `wf-backfill-tasks` first invocation | L2 per stage | ✅ done 2026-05-27 (prod / us-west-2) | Runbook at `runbooks/backfill-tasks.md`. Invocation returned `{scanned: 0, backfilled: 0, already_backfilled: 0, skipped_missing_agent_slug: 0, errors: []}` — matches runbook "no TASK rows yet" expected output. |
| OP-003 | Instantiate reviewer + router CCR routines | L2 | open | When conversational pattern saturates. Specs in `routines/`. |
| OP-004 | Epic-010 post-deploy verification | L2 per stage | ✅ done 2026-05-28 (prod / us-west-2) | Issue [#150](https://github.com/refluster/ai-native-article/issues/150). Ran by agent with operator creds — A1–A8 + B1–B6 sections; surfaced FU-NEW-C / FU-NEW-D from a real prod bug (workforce-meta META row missing `project_id`). Hot-fix applied + this PR patches the runbook + harden. |
| OP-005 | Voyage credential provision | L2 | open — UI path tracked at [#158](https://github.com/refluster/ai-native-article/issues/158) (FU-NEW-F) | Provision `wf/projects/_default/voyage.api_key` with `{"apiKey":"..."}` in Secrets Manager (`region us-west-2`). Until done, semantic recall (Story 4) is offline; structured recall continues to work. **Today's options**: (a) CLI: `aws secretsmanager create-secret --region us-west-2 --name wf/projects/_default/voyage.api_key --secret-string '{"apiKey":"vy-..."}'`; (b) SigV4-signed `wf-credentials-api PUT /projects/_default/credentials/voyage.api_key` (needs awscurl or equivalent). **Future**: once FU-NEW-F (issue #158) ships, this is a click in the project console at `/workforce/projects/_default/credentials`. |
| OP-006 | Bare-credentials provisioning decision | L2 | ✅ **decided 2026-05-28 — option A (modern path)**. Pending operator key entry. | Decision locked: when LLM / GitHub / Notion skills are needed in prod, provision under `wf/projects/_default/{type}` via the credentials API (option A from Issue #150 OP-006). The bare-path migration option (B) is rejected because the bare keys do not exist in prod today — using the migration would require provisioning the deprecated path first then copying, which is strictly more work than provisioning the canonical path directly. **Runbook** (same shape as OP-005 above, repeat per credential type as needed): `aws secretsmanager create-secret --region us-west-2 --name wf/projects/_default/{type} --secret-string '...'` for `anthropic.api_key` / `github.token` / `notion.integration_token`. Verify with `getCredential` (via a synthetic runner invocation OR `wf-credentials-api GET`). Re-running `wf-migrate-credentials-prod` afterwards is a no-op (it copies bare→default; with no bare keys it returns `source_missing=3`). |

## Done

| # | Item | Resolved by | Notes |
|---|---|---|---|
| — | (none yet) | — | — |

## Won't do

| # | Item | Rationale |
|---|---|---|
| — | (none yet) | — |
