# ADR-0033 — Promote `seed-projects.mjs` to a `WfSeedProjectsFunction` Lambda, META rows only, script kept as escape hatch

- **Status**: Proposed
- **Date**: 2026-09-10
- **Deciders**: operator (proposed by `dario`, workforce `issue-design`)
- **Epics**: [010](../epics/epic-010-project-trust-boundary.md) (project trust boundary — this is a follow-up on its `project.json` seeding path, not a Story of it)

## Context

Creating a non-`self/` project today requires a human step CI does not run:
PR `workforce/projects/{id}/project.json` into `main`, then the operator runs
`npm run workforce:projects:seed prod` by hand. Both prod projects registered
in git before this issue was filed — `asp-cloud` (2026-05-27) and
`agent-workforce` (PR #176, 2026-05-31) — sat with a `project.json` in `main`
but no `PROJECT#{id}/META` row in `wf-table-prod` for days to weeks, because
nobody re-ran the seed. Issue #184 (filed 2026-06-01) is the record of that
failure; both projects were seeded by hand in the same session that found the
gap, which fixed the symptom, not the cause.

`seed-agents` and `seed-skills` do not have this failure mode: both are
Lambdas (`WfSeedAgentsFunction` / `WfSeedSkillsFunction`) invoked automatically
by an `EventBridgeRule` on `CREATE_COMPLETE` / `UPDATE_COMPLETE` of the
`wf-data-plane-{stage}` stack (`workforce/infra/sam/template.yaml:1446-1465`,
the `WfSeedSkillsFunction` block). `seed-projects` is the one seed left as an
operator-run CLI script. Its own header
(`workforce/scripts/seed-projects.mjs:11-19`) explains why, as of 2026-06-01:
projects change rarely, so a dedicated Lambda looked like more surface than
the problem warranted, and the CLI shell-out kept the script free of
`@aws-sdk/*` dependencies. That assumption is the thing #184 falsified.

Two workforce cadences have since read this issue and independently reached
the same place — a decision, not a diff:

- **`issue-implement` (`ren`, 2026-08-09)** declined to build Option A as
  written: it names the retired agents-side seed as the pattern to mirror
  (only `WfSeedSkillsFunction` survives per `template.yaml:1421`, "the
  agents-side twin retired with ADR-0007"), and it still describes "one
  MEMBER row per `members[]` entry" — the membership concept, and the MEMBER
  row, were removed from `seed-projects.mjs` and
  `workforce/scripts/schemas/project.schema.json` on 2026-07-03. Ren also
  flagged that bundling the Lambda against the DDB SDK directly would be "a
  second implementation of the PROJECT row shape" — exactly the coupling the
  script's own header warns against — and asked that this be decided
  deliberately.
- **`issue-triage` (`nadia`, 2026-09-10)** re-examined the parked issue
  (>14 days idle) and re-laned it to `design` rather than leaving it parked,
  naming the same two drift points and asking for the settled scope to be
  handed back to `issue-implement` to build.

This ADR is that settled scope.

## Decision

Build `WfSeedProjectsFunction`, mirroring `WfSeedSkillsFunction`'s SAM shape
exactly, and keep `seed-projects.mjs` as a retained (not retired) operator
escape hatch. Concretely:

1. **New Lambda, `workforce/lambdas/seed-projects/{handler.ts,Makefile}`.**
   Reads `workforce/projects/{id}/project.json` from the deployed bundle
   (same `Makefile`-copies-the-tree pattern `seed-skills` uses) and upserts
   `PROJECT#{id}/META` rows only — **no MEMBER rows**, because there is no
   MEMBER row shape left to write (membership retired 2026-07-03; every
   registered agent participates in every project per that change). This
   corrects Option A's task list, which still names a MEMBER limb.
2. **SAM resource**: `WfSeedProjectsFunction` (`AWS::Serverless::Function`,
   `BuildMethod: makefile`), IAM scoped to `dynamodb:GetItem` +
   `dynamodb:PutItem` on `WfTable.Arn` only (same `SeedSkillsTableAccess`
   shape), triggered by an `EventBridgeRule` on
   `CloudFormation Stack Status Change` /
   `CREATE_COMPLETE`+`UPDATE_COMPLETE` for `wf-data-plane-{stage}` — the same
   post-deploy pattern, not a new trigger design. Paired
   `WfSeedProjectsErrorsAlarm` (`Errors > 0` over 5 minutes), matching
   `WfSeedSkillsErrorsAlarm`.
3. **Idempotency must replicate the ADR-0029 create-only field set, not just
   "upsert."** `seed-projects.mjs` already treats `name`, `owner_agent`,
   `github`, `governance_docs`, and `credential_types` as create-only
   (`API_OWNED_FIELDS` in the script; `project.schema.json`'s own description
   names ADR-0029 for this). A re-seed that blindly overwrites these on every
   deploy would silently revert an operator edit made via
   `PATCH /projects/{id}` — a W-4 (fail-loud) violation dressed as routine
   idempotency. The Lambda's write path MUST read the existing row first and
   preserve every `API_OWNED_FIELDS` value already present, exactly as the
   script does, not "re-derive from git and overwrite."
4. **Row-shape logic is not duplicated a second time; it already isn't a
   third.** Ren's coupling concern is about a *third* independent
   implementation of the PROJECT row shape (script, Lambda, and the
   agents-api write surface). `workforce/lambdas/shared/project.ts` is
   already the canonical module every DDB-side project consumer imports for
   key construction (`asProjectId`, `projectPk`); it does not yet export a
   row-builder for a `META` item from a `project.schema.json` payload. This
   ADR adds that builder there (a pure function, no I/O) and has both the new
   Lambda **and** the agents-api project-write path
   (`PATCH /projects/{id}`, ADR-0029) call it, so the row shape has exactly
   one source, consumed from two write paths. `seed-projects.mjs` — a bare
   `.mjs` CLI script with no build step, deliberately free of `@aws-sdk/*` —
   keeps its own local re-implementation of the same shape for its AWS-CLI
   code path; that duplication is the accepted, pre-existing cost of keeping
   the script dependency-free (unchanged by this ADR), not a new one this
   decision introduces.
5. **`seed-projects.mjs` is kept, not retired**, as the operator's manual
   escape hatch: seeding a fresh `dev` stage before its first `sam deploy`,
   a disaster-recovery reseed of a table, or a one-off backfill outside the
   normal git → deploy path. Its header comment is updated to say so
   explicitly (mirrors the CLI mirrors the Lambda's row shape via the new
   shared builder where it can, without taking on the `@aws-sdk/*`
   dependency it exists to avoid).

## Alternatives considered

- **Option B — run the existing script from
  `deploy-workforce-data-plane.yml`.** Couples seed timing to workflow *run*
  completion rather than stack *update* completion, needs the workflow's IAM
  role widened, and misses any `project.json` change made outside that
  workflow's path triggers. Also outside this decision's authority to
  implement directly: `.github/workflows/**` is root Zone A
  (`AGENTS.md` §1) and stays root-governed even for a workforce-scoped
  concern (`workforce/docs/governance.md` §1 excludes
  `deploy-workforce-data-plane.yml` from nothing — but it is still a
  workflow file, escalated under `workforce/docs/governance.md` §5's
  "new AWS service"/schedule rows by the same logic that governs a new
  EventBridge rule). Rejected as both operationally weaker and outside a
  design-lane PR's writable surface.
- **Option C — status-quo plus a CI lint requiring a `[seed-projects]`
  checkbox.** Smallest blast radius, but still operator-manual and provably
  forgettable under time pressure — the exact failure #184 records already
  happened once with a checklist-shaped process (nobody re-ran the seed for
  `asp-cloud`). Rejected: it treats the symptom as the disease.
- **Bundle the Lambda straight against the DDB SDK with its own inline row
  builder (unrefined Option A).** This is what `issue-implement` correctly
  declined to build as written. Rejected because it manufactures the second
  independent row-shape implementation ren named, instead of the shared
  builder in clause 4.
- **Retire `seed-projects.mjs` once the Lambda ships.** Removes the only path
  that works before a stack exists or without a deploy in flight. Rejected —
  the cost of keeping ~120 lines of already-idempotent script is lower than
  the cost of a dev environment with no seed path.

## Consequences

**What gets better.** Merging a `project.json` PR and completing the SAM
deploy is sufficient on its own — the operator no longer holds the seed step
in their head, and the specific failure mode #184 records (a project that
looks empty because nobody re-ran a CLI command) cannot recur for git-managed
projects, matching `seed-agents`/`seed-skills`.

**What it costs.**
- One more Lambda's worth of build, IAM, and CloudWatch-alarm surface for a
  low-frequency write (R-N1/R-N5 are unaffected — this is the existing
  Lambda execution surface and the existing CloudWatch observability stack,
  not a new one).
- A new shared export in `workforce/lambdas/shared/project.ts` is now
  imported by two write paths (Lambda + agents-api); a future change to the
  `project.json` schema must update that one function, and both callers'
  tests, in the same PR — a real but bounded coupling cost, and the one this
  ADR accepts deliberately in exchange for not having three.
- `seed-projects.mjs` keeps its own inline row-shape logic permanently (not
  temporarily) for its CLI-only, dependency-free code path; a schema change
  that isn't also applied there re-opens exactly the drift `issue-implement`
  found in this issue's original write-up, one level down. The mitigation is
  process, not a mechanism: `workforce/scripts/validate-projects.mjs` (already
  run before every seed) is the natural place to assert schema conformance
  independent of which writer runs.

**How this would be reversed.** Delete `WfSeedProjectsFunction`,
`WfSeedProjectsErrorsAlarm`, and their `EventBridgeRule`; the operator returns
to running `seed-projects.mjs` by hand exactly as today, since the script is
explicitly kept, not folded into the Lambda's own module.

**What would tell us this was wrong.** The Lambda's error alarm firing on
every deploy (bad IAM scope or a `project.json` shape the seeder can't parse)
without a clean rollback path; or a re-seed observed to silently overwrite an
`owner_agent`/`github`/`governance_docs`/`credential_types` value an operator
had set via the API (the ADR-0029 create-only contract failing loud instead
of being enforced) — either is a stop-and-fix, not a tolerate-and-monitor,
per W-4.

**Explicitly out of scope.**
- Seeding credential *values* into Secrets Manager — unchanged; the
  `credential_types[]` array remains a to-do list for the operator, values
  never enter git (per the issue's own out-of-scope section).
- `self/{slug}` project auto-seeding — untouched; that is the runner's Epic-010
  Story 1-B path, not this seed.
- Migrating `seed-agents`'s already-retired pattern back into existence —
  not proposed; `WfSeedSkillsFunction` is the only live pattern this ADR
  mirrors.
- The dev-environment verification task in the issue's own checklist ("add a
  throwaway `workforce/projects/dev-test/project.json`, deploy, confirm the
  row appears") — that is implementation verification, owed by the
  `issue-implement` PR that builds this, not by this design record.

## Related

- Issue [#184](https://github.com/refluster/ai-native-article/issues/184)
  (this ADR's source; the `issue-implement`/`ren` 2026-08-09 park comment and
  the `issue-triage`/`nadia` 2026-09-10 re-lane comment are the evidence
  cited above).
- [ADR-0007](adr-0007-agent-config-single-source.md) — retired the
  agents-side seed this issue's Option A originally (and incorrectly) named
  as the pattern to mirror.
- [ADR-0029](adr-0029-project-config-write-surface.md) — the create-only
  field set (`API_OWNED_FIELDS`) this decision requires the Lambda to
  preserve on re-seed.
- [Epic-010](../epics/epic-010-project-trust-boundary.md) §3/§7 — the
  `PROJECT#{id}` row shape and `self/{slug}` auto-seeding this ADR does not
  change.
