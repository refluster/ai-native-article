# Runbook — Onboarding an external project

How to register a new external GitHub repository as a workforce `Project` ([Epic-010](../epics/epic-010-project-trust-boundary.md)), so the workforce's agents can act against it (today: PR routing + PdM/architecture/engineering reviews; future: implementer flow).

This is the **end-to-end operator runbook**. The [`workforce/projects/README.md`](../../projects/README.md) covers the file shape; this one covers the live AWS + invocation surface.

## What you'll set up

For a project with id `acme-web`:

| Artefact | Where | Created by |
|---|---|---|
| `workforce/projects/acme-web/project.json` | this repo | operator PR |
| `wf/projects/acme-web/github.token` | AWS Secrets Manager (us-west-2) | operator out of band |
| `PROJECT#acme-web/META` row | `wf-table-prod` (DDB) | `npm run workforce:projects:seed` |
| `PROJECT#acme-web/MEMBER#{slug}` rows | `wf-table-prod` (DDB) | same seed |

The runner then resolves credentials by `(project_id, credential_type)` per [Epic-010 §5](../epics/epic-010-project-trust-boundary.md#5-type-keyed-credential-resolution) and writes execution rows under `PROJECT#acme-web/EXEC#{ulid}`.

## Step 1 — Issue the GitHub PAT

You need a GitHub fine-grained personal access token scoped to the **target** repo. Required permissions:

- `Contents`: Read-only (fetch PR diffs, governance docs)
- `Issues`: Read & Write (post routing comments)
- `Pull requests`: Read & Write (post reviews — `COMMENT` event only; the workforce never approves / request-changes per W-5)

Token TTL: operator's choice. 90 days is a reasonable default; the workforce has no rotation automation yet (out of scope for Epic-010 per §Out of scope).

Copy the `ghp_...` value. You will paste it once into Secrets Manager (next step) and not again.

## Step 2 — Store the PAT in Secrets Manager

```bash
aws secretsmanager create-secret \
  --name wf/projects/acme-web/github.token \
  --region us-west-2 \
  --secret-string '{"token":"ghp_paste_the_value_here"}'
```

Notes:
- The secret value is a JSON object with key `token` — matches the `GithubSecret` shape in [`workforce/lambdas/shared/secrets.ts`](../../lambdas/shared/secrets.ts).
- Path `wf/projects/{id}/github.token` — `getCredential<GithubSecret>(projectId, "github.token")` reads from exactly this path.
- The runner's IAM role grants `secretsmanager:GetSecretValue` on `wf/projects/*` (per [Epic-010 §6](../epics/epic-010-project-trust-boundary.md#6-credential-storage--refined-r-n3-namespace)).

If you need to rotate later:
```bash
aws secretsmanager put-secret-value \
  --secret-id wf/projects/acme-web/github.token \
  --region us-west-2 \
  --secret-string '{"token":"ghp_new_value"}'
```

## Step 3 — Author `project.json` and PR

Create `workforce/projects/acme-web/project.json` per the schema (see [`projects/README.md`](../../projects/README.md)).

Minimal shape:
```jsonc
{
  "id": "acme-web",
  "name": "Acme Web",
  "owner_agent": "nadia",
  "github": { "owner": "acmeorg", "repo": "web" },
  "governance_docs": ["AGENTS.md", "CONTRIBUTING.md"],
  "members": ["nadia", "dario", "ren", "aoi"],
  "credential_types": ["github.token"],
  "status": "active",
  "created_at": "2026-05-27"
}
```

Run locally before pushing:
```bash
npm run workforce:projects   # schema + cross-file invariants P-1..P-5
npm run workforce:naming     # naming convention
```

Open the PR and merge.

## Step 4 — Seed DDB

After the PR merges:

```bash
npm run workforce:projects:seed              # defaults to prod stage
# or: node workforce/scripts/seed-projects.mjs prod
```

The script is idempotent. A second run against an unchanged tree reports `noop` for every project. The `identity_hash` field guards against silent drift.

Output looks like:
```
Seeding 1 project(s) to wf-table-prod in us-west-2 ...
[
  {
    "id": "acme-web",
    "meta": "created",
    "members": [
      { "slug": "nadia", "action": "added" },
      { "slug": "dario", "action": "added" },
      ...
    ]
  }
]

Seed OK — 1 project(s): 1 created.
```

## Step 5 — Invoke

The first invocation is conversational (today's invocation surface — [`pr-autopilot.md`](../routines/pr-autopilot.md) describes the contract):

> Nadia, project `acme-web` の PR https://github.com/acmeorg/web/pull/42 を PdM 視点で review。Architecture surface あれば Dario に route。

The runner:
1. Resolves the project context for `acme-web`. (Update 2026-06-08: membership is no longer a write-gate — the cross-project denial was removed per CLAUDE.md C-3 — so this step records context rather than rejecting non-members.)
2. Resolves `wf/projects/acme-web/github.token` via `getCredential<GithubSecret>("acme-web", "github.token")`.
3. Fetches the PR + governance_docs from `acmeorg/web` using the token.
4. Composes the Nadia persona prompt (system.md + `pr-autopilot` binding config + `pr-autopilot.md` skill contract).
5. Posts the routing comment via the target repo's REST API.
6. Writes `PROJECT#acme-web/EXEC#{ulid}` with `agent_slug=nadia, skill_name=pr-autopilot` + an `artifact_ref` summarising the comment.

Reviewer dispatch (Dario etc.) repeats steps 2–6 with the reviewer persona's `pr-review` binding.

Verdict synthesis (cycle close) is the second mode of the same `pr-autopilot` skill.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `cross-project denial: …` (removed 2026-06-08) | n/a — the membership write-gate was removed (C-3); this error no longer occurs | If a record is missing from the roster, add to `project.json` + re-run `workforce:projects:seed` (informational only) |
| `ResourceNotFoundException` on `getCredential` | Step 2 skipped or wrong path | Confirm `aws secretsmanager describe-secret --secret-id wf/projects/acme-web/github.token` |
| 401 from GitHub | PAT expired or wrong scope | Rotate per Step 2; verify scopes (Contents Read, Issues R/W, Pull requests R/W) |
| Validator P-4 ("member X has no matching workforce/agents/X/") | Typo in members[], or agent not yet hired | Fix slug or wait for agent's onboarding PR |
| Seed reports `noop` but you changed something | `identity_hash` is computed from sorted-canonicalised fields | Check the canonical hash inputs in `seed-projects.mjs:projectIdentityHash`; a no-op might be correct |

## What's still manual (follow-ups)

- **Webhook-driven auto-fire**: today the operator invokes conversationally. A future Epic wires `pull_request.opened` from the target repo through API GW → orchestrator → runner. The `Project` membership + credential surfaces don't change.
- **PAT rotation**: operator-driven for now. A `credential-rotation` skill is out of scope for Epic-010 (§Out of scope).
- **Project console UI**: live in [Epic-010 Story 3](../epics/epic-010-project-trust-boundary.md#10-projects-console--operator-ui-surface-story-3). Until it ships, viewing membership / executions is `aws dynamodb query` against `wf-table-prod`.

## Cross-references

- [`workforce/projects/README.md`](../../projects/README.md) — file/schema reference
- [Epic-010](../epics/epic-010-project-trust-boundary.md) — design rationale
- [`pr-autopilot.md`](../routines/pr-autopilot.md) / [`pr-review.md`](../routines/pr-review.md) — skill contracts (cross-project mode section)
- [`workforce/lambdas/shared/project.ts`](../../lambdas/shared/project.ts) — runtime API
