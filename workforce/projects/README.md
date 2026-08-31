# Workforce Projects

`Project` is the trust boundary for credentials, executions, and artefacts per [Epic-010 §3](../docs/epics/epic-010-project-trust-boundary.md). This directory is the **file-based seed** for non-`self/` projects — one folder per project, `project.json` inside.

```
workforce/projects/
  asp-cloud/
    project.json     ← schema: workforce/scripts/schemas/project.schema.json
  README.md
```

`self/{slug}` rows are auto-seeded by the runner ([Story 1-B](../docs/epics/epic-010-project-trust-boundary.md#story-1)) and **MUST NOT** appear here.

## When to add a project

Add a project when an agent needs to act against a target that is **not** the workforce's own self-projects — most commonly, when an external GitHub repository should be subject to PR review by the workforce's PdM / architecture / engineering personas. The project gives the runner:

- a scoped **credential bag** (`wf/projects/{id}/{type}` in Secrets Manager — not the global `wf/{type}`),
- an **execution ledger** (`PROJECT#{id}/EXEC#{ulid}` rows in DDB) for audit,
- an **artefact prefix** (`s3://wf-bucket-{stage}/projects/{id}/...`) the IAM policy will gate on.

A project is **not** a way to share state across repos — each external repo is its own project, with its own membership list and its own GitHub PAT.

## Schema

See [`workforce/scripts/schemas/project.schema.json`](../scripts/schemas/project.schema.json). Minimal example:

```jsonc
{
  "id": "asp-cloud",
  "name": "ASP Cloud",
  "owner_agent": "nadia",
  "github": { "owner": "PSVL", "repo": "asp-cloud" },
  "governance_docs": ["AGENTS.md", "CONTRIBUTING.md"],
  "members": ["nadia", "dario", "ren", "aoi"],
  "credential_types": ["github.token"],
  "status": "active",
  "created_at": "2026-05-27",
  "note": "First external project — validates the multi-project PR-review path."
}
```

## Onboarding workflow

The full operator runbook lives at [docs/runbooks/external-project-onboarding.md](../docs/runbooks/external-project-onboarding.md). At a glance:

1. **Choose an `id`** matching the parent directory name (lowercase, kebab-case, no `self/` prefix).
2. **Author `project.json`** per the schema above; PR it in.
3. **Store credentials out of band**: `aws secretsmanager create-secret --name wf/projects/{id}/github.token --secret-string '{"token":"ghp_..."}'`.
4. **Run `npm run workforce:projects:seed`** with operator AWS credentials in scope — writes `PROJECT#{id}/META` + a `MEMBER#{slug}` row for every member.
5. **Invoke**: `Nadia, review PR https://github.com/{owner}/{repo}/pull/{N} on project {id}` — the routing skill reads project membership and credentials, posts the routing comment, and dispatches the reviewer skills.

## Editing an EXISTING project (ADR-0029)

**Do not edit `project.json` to change a live project's config — it will not
apply.** Since [ADR-0029](../docs/adr/adr-0029-project-config-write-surface.md),
`name`, `owner_agent`, `github`, `governance_docs` and `credential_types` are
**create-only** in the seed: `seed-projects.mjs` carries the stored DDB value
forward rather than the one the file declares, so a re-seed cannot revert an
operator's edit. DDB is authoritative for these fields on an existing row;
`project.json` is creation-time input. (This is [ADR-0007](../docs/adr/adr-0007-agent-config-single-source.md)'s
posture for agents, applied to projects.)

To change one, use the project page in the console —
`https://workforce.kohuehara.xyz/projects/{id}` → **CONFIG** panel → **EDIT**.
Every save is validated server-side and appends a `PROJECT#{id}/AUDIT#` row
recording the actor and a field-level before/after diff.

`project.json` remains the reviewable declaration of a NEW project, and the
schema still governs it. The API validates against the same constraints — but
"so the two cannot disagree" would be a claim about a property nothing was
checking, and when it was checked they had already drifted three ways
(registry 9 types, schema 6, validator 7). `credential-type-mirrors-tests.ts`
now asserts the agreement, so the drift fails CI instead of surfacing as a
project that the console accepts and `workforce:projects` later rejects.

**Not editable from the console:** `project_id` (it keys the DDB partition, the
URL and the Secrets Manager prefix), `created_at` / `archived_at` (facts, not
settings), and `knowledge-backup.json` — that sibling file stays in git because
its reader is a GitHub Actions runner with no AWS access
([ADR-0028](../docs/adr/adr-0028-per-project-knowledge-backup.md)).

## Invariants (validator-enforced)

| Rule | Description |
|---|---|
| **P-1** | `id` MUST equal the parent directory name. |
| **P-2** | `id` MUST NOT start with `self` (reserved for the runner). |
| **P-3** | `owner_agent` (if set) MUST appear in `members[]`. |
| **P-4** | Every member MUST resolve to a `workforce/agents/{slug}/` directory. |
| **P-5** | `credential_types[]` MUST match the Epic-010 §5 type registry (`anthropic.api_key` / `discord.bot_token` / `github.token` / `notion.integration_token`, optionally suffixed `@variant`). |

CI runs `npm run workforce:projects` on every PR — any violation fails the build.

## What this directory does **not** contain

- **Credentials.** Values live in AWS Secrets Manager under `wf/projects/{id}/{type}`. The `credential_types[]` field declares *which* types the project is expected to hold; the values are written out of band by the operator and never committed.
- **Execution history.** Lives in DDB under `PROJECT#{id}/EXEC#{ulid}`. The `Project.appendExecution` helper writes those rows at skill runtime.
- **`self/` projects.** Per-agent personal projects (`self/{slug}`) are auto-seeded by the runner on first invocation — they do not appear here. Their `project.json` would be redundant.

## Cross-references

- [Epic-010 — Project as trust boundary](../docs/epics/epic-010-project-trust-boundary.md) — the L1 spec this directory implements.
- [`workforce/lambdas/shared/project.ts`](../lambdas/shared/project.ts) — the runtime API (`getCredential`, `appendExecution`, `addMember`, `isMember`, `selfProjectId`).
- [`docs/runbooks/external-project-onboarding.md`](../docs/runbooks/external-project-onboarding.md) — the step-by-step for adding a project (credential setup, seed, first invocation).
