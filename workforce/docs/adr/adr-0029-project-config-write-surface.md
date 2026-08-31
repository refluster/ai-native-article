# ADR-0029 — Project config is edited in the console: widening `PATCH /projects/{id}` past name and status

- **Status**: Proposed
- **Date**: 2026-08-31
- **Deciders**: operator (refluster), drafted by a Claude Code session on the operator's direction (「project.jsonやknowledge-backup.jsonをworkforceのプロジェクトページから編集できるようにしてくれる？」)
- **Related**: [ADR-0007](adr-0007-agent-config-single-source.md) (the same move, made for agents — DDB authoritative, git non-authoritative, one API writer, an `AUDIT#` trail), [Epic-010](../epics/epic-010-project-trust-boundary.md) §10 (the minimal write surface this supersedes), [ADR-0028](adr-0028-per-project-knowledge-backup.md) (the sibling config file deliberately NOT moved here)

## Context

`PATCH /projects/{id}` accepted exactly two fields:

```ts
const PATCHABLE_PROJECT_FIELDS = ["status", "name"] as const;
```

Everything else was rejected with a 400 whose detail told the caller where to
go instead: *"edit workforce/projects/{id}/project.json + seed"*. `POST
/projects` likewise returns 404, "write surface intentionally not exposed per
Epic-010 §10". That was a deliberate decision, not an oversight.

Its cost has grown. The console renders a project's owner and target repo but
cannot change them, so the operator's path for "point this project at a
different repo" or "this project now needs a Notion token" is: edit a JSON
file, open a PR, wait for CI, merge, then run `seed-projects.mjs` with AWS
credentials in scope. For a single-operator hobby workforce (C-3) that is a
lot of ceremony around a value the operator is the only person who will ever
set.

Two facts make the widening cheap rather than novel:

1. **The write path already exists and is already gated.** The route is
   `AWS_IAM` on API Gateway; the console signs with SigV4 through the Cognito
   broker; `ProjectRenameButton` and `ProjectArchiveButton` are working
   instances. Nothing new is exposed to the public read API.
2. **The agent tree already made this exact move.** ADR-0007 took agent
   identity/config out of git, made DDB authoritative, put every mutation
   through agents-api, and replaced the lost git history with an append-only
   `AGENT#{slug}/AUDIT#` trail. The objection "but then we lose the review and
   the history" was answered there; the answer transfers unchanged.

A third fact bounds the decision: **two of the four fields were already in
DDB and simply not exposed.** `seed-projects.mjs` has written
`governance_docs` and `credential_types` to the META row since its first
version, but `ProjectMetaRow` never declared them and `toProjectApiView` never
returned them. The console could not show them, let alone edit them.

## Decision

**Widen `PATCH /projects/{id}` to the descriptive project attributes, validate
them server-side against the same constraints the seed's schema imposes, audit
every mutation, and make the console the editing surface.**

1. **Patchable:** `status`, `name` (unchanged), plus `owner_agent`, `github`,
   `governance_docs`, `credential_types`.
2. **Not patchable, by design:** `project_id` keys the DDB partition, the URL
   and the Secrets Manager prefix; `created_at` and `archived_at` are facts
   about what happened, not settings. The 400 for these no longer points at
   the seed — it explains why they are immutable.
3. **The API is the validation authority.** Each field is checked against the
   constraints in `project.schema.json` (slug/owner/repo patterns, the 8-entry
   list bound, uniqueness), plus two checks the schema cannot make:
   - `owner_agent` must name a **registered agent** or `_operator`. A dangling
     owner silently breaks every "who owns this" read downstream.
   - each `credential_types` base type must be in the injector's registry, or
     the orchestrator fails to resolve it at fire time — a runtime failure the
     operator would only meet in a cadence's logs.
4. **The whole patch is validated before anything is written.** A request that
   fails on its third field leaves the first two unapplied. Half-applied
   config is the worst outcome for a form.
5. **Every mutation appends a `PROJECT#{id}/AUDIT#{ts}#{nonce}` row** carrying
   the actor and a field-level before/after diff — the same shape, and the
   same `diffChanges` implementation, as the agent trail (R-N8). A patch that
   re-sends the stored values writes no audit row. The append runs after the
   row update and throws on failure (W-4), inherited from agent-audit.
6. **`governance_docs` and `credential_types` are declared on `ProjectMetaRow`
   and returned by the API.** A field the operator can set but not see is
   worse than one they can do neither with.
7. **The seed treats every API-owned field as create-only.** `name` already
   worked this way; the rule now covers all six. **Consequence, stated
   plainly: for an existing project, DDB is authoritative for these fields and
   `project.json` is creation-time input only.** Editing `project.json` for a
   live project will not apply — use the console. This is ADR-0007's posture,
   arrived at for the same reason.

### What is deliberately NOT moved

`workforce/projects/{id}/knowledge-backup.json` (ADR-0028) stays in git and
stays uneditable from the console. Its consumer is a GitHub Actions runner
with no AWS credentials, so DDB-resident config would have to be fetched from
the API — either over the public read route, which would publish private store
repo names, or over an authenticated one, which would put AWS credentials in
CI and undo a core property of ADR-0026. The operator chose to keep it in git.
The asymmetry is intentional and worth restating: **project.json's fields are
read by services that can reach DynamoDB; knowledge-backup.json's are not.**

## Alternatives considered

- **Leave the surface minimal (status changes only via the console, the rest
  via PR).** Preserves review and git history for config changes. **Rejected:**
  the review is the operator reviewing themselves, and the history is
  reconstructed by the AUDIT# trail — which is *better* than a git blame for
  this purpose, since it records the actor and the exact before/after per
  field. The PR round-trip is pure latency at C-3 scale.
- **Console edits open a PR against `project.json`.** Keeps git authoritative
  and reuses CI validation. **Rejected here** (and chosen for nothing): it
  needs a new API surface holding a GitHub token, and it fights the fact that
  DDB — not the file — is what every runtime reader actually consults. It
  remains the right answer for `knowledge-backup.json`, whose reader is CI.
- **Widen the allowlist without an audit trail.** Simplest diff. **Rejected:**
  the whole reason Epic-010 §10 could keep the surface minimal was that
  `project.json` + git gave accountability for free. Removing the round-trip
  without replacing the record is the part that would actually be a
  regression.
- **Also expose `POST /projects` so the console can create projects.**
  Rejected as out of scope: creation involves provisioning secrets and (for
  external repos) an R-N9 decision, so it stays an operator runbook.

## Consequences

- **Positive.** Project config is edited where it is read. Two fields that
  were written-but-invisible since the seed's first version are now visible.
  Every change is attributable, per field, with an actor — which the
  `project.json` path only gave at commit granularity.
- **`project.json` becomes creation-time-only for existing projects.** The
  files stay in the repo as the creation seed and the reviewable declaration
  of a new project; they will drift from DDB for any project edited in the
  console, exactly as the agent tree drifted before it was frozen. Freezing
  or regenerating them is a follow-up, not part of this decision.
- **A new row family** (`PROJECT#{id}/AUDIT#`) shares the project partition.
  It is append-only and unbounded; the agent trail has the same property and
  no compaction, so this inherits that accepted risk rather than adding a new
  one.
- **The audit trail has no read route yet.** `listProjectAudit` exists and is
  tested, but no `GET /projects/{id}/audit` is wired and the console renders
  nothing — the agent equivalent has both. Filed as the immediate follow-up;
  until then the rows are queryable only from AWS.
- **Validation is now duplicated** between `project.schema.json` (the seed's
  input) and the API. They must agree — a value the console accepts but the
  schema rejects would fail CI the next time anyone wrote that project out to
  a file. Both sets live one function apart in `patchProject` with the schema
  named in a comment; generating one from the other is a follow-up if they
  drift.

## Related

- `workforce/lambdas/agents-api/handler.ts` — `PATCH /projects/{id}`, the
  widened allowlist and the per-field validation.
- `workforce/lambdas/shared/project.ts` — `patchMeta`, and the two newly
  declared row fields.
- `workforce/lambdas/shared/project-audit.ts` — the trail.
- `workforce/scripts/seed-projects.mjs` — `API_OWNED_FIELDS`, the create-only
  rule that keeps a re-seed from reverting console edits.
- `workforce/app/src/components/ProjectConfigEditor.tsx` — the console form.
- [Epic-010 §10](../epics/epic-010-project-trust-boundary.md) — the minimal
  write surface this supersedes.
