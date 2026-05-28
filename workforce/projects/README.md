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
