# Runbook — `PROJECT#workforce-meta` bootstrap — **RETIRED**

> **Status: retired (project archived 2026-06-17).** `workforce-meta` was
> bootstrapped solely to own the audit/RUN rows of Maya's `pdm-decompose`
> routine. That routine is superseded (see [pdm-decompose.md](pdm-decompose.md) /
> [dev-process.md](dev-process.md)) and Maya's binding to it was removed, so the
> project has no remaining consumer. Rather than hard-delete (which would destroy
> the `EXEC#` audit ledger — against R-N2 / append-only AUDIT / ADR-0007
> durability), the `PROJECT#workforce-meta/META` row was flipped to
> `status: archived` (+ `archived_at`) in prod via the `project.ts:archive()`
> shape; the META / MEMBER / EXEC rows remain queryable. Do NOT re-run the
> bootstrap below. Kept as historical record + for the canonical-shape /
> idempotent hot-fix knowledge.

One-time DDB write to register the project that owns "the workforce
working on itself" (Maya's PdM routine, Dario's VP-of-eng routines, Aoi's
design reviews, Ren's engineering, Yuki's GTM ops). All of `pdm-decompose`'s
artefacts (RUN rows, S3 outputs, child-issue audit) belong to this project.

Runs once. After Epic-010 Story 1 lands (proper `Project` entity + `MEMBER#`
rows), this manual step is replaced by the normal project creation API.

## Why

Today the workforce data model has `default_project` on each agent but
no `PROJECT#{slug}` rows in DDB. Maya's `default_project = "workforce-self"`
is a string, not a foreign key. To make Maya's pdm-decompose runs auditable
under "the project that builds the workforce," we pre-seed one project row
with its membership.

This is an **interim** shape — once Epic-010 Story 1 lands the membership
becomes `PROJECT#workforce-meta/MEMBER#maya`, `PROJECT#workforce-meta/MEMBER#dario`,
... rows. For PR B, we just need the project to exist so pdm-decompose's
RUN rows don't reference a dangling project_id.

## Pre-flight

```bash
# Confirm the table exists and you're targeting the right stage.
aws dynamodb describe-table --table-name wf-table-prod \
  --query 'Table.{ItemCount: ItemCount, Status: TableStatus}' \
  --region us-west-2
```

## One-time writes

Six agents are members for now (the PR A/B/C ribbon participants + Sora).
Theo, Mira, Noor, Priya, Kai are NOT in `workforce-meta` — they have
their own editorial/legal/people streams. Sora is included because she
narrates architectural moves.

```bash
STAGE=prod
REGION=us-west-2
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# META row — every attribute below corresponds 1:1 to ProjectMetaRow
# in workforce/lambdas/shared/project.ts. Do NOT add stream / repo /
# region or any other attribute the type does not declare.
# Pre-FU-NEW-C runbook versions wrote `stream` + `repo` AND omitted
# `project_id`, which caused wf-agents-api listProjects to throw in
# prod (Issue #150 / B5).
aws dynamodb put-item --table-name wf-table-$STAGE --region $REGION --item "$(cat <<JSON
{
  "pk": {"S": "PROJECT#workforce-meta"},
  "sk": {"S": "META"},
  "project_id": {"S": "workforce-meta"},
  "status": {"S": "active"},
  "owner_agent": {"S": "maya"},
  "created_at": {"S": "$NOW"}
}
JSON
)"

# MEMBER rows — match ProjectMemberRow. project_id is a denormalised
# attribute so scan paths can read it without a META join.
for slug in maya dario ren aoi yuki sora; do
  aws dynamodb put-item --table-name wf-table-$STAGE --region $REGION --item "$(cat <<JSON
{
  "pk": {"S": "PROJECT#workforce-meta"},
  "sk": {"S": "MEMBER#$slug"},
  "project_id": {"S": "workforce-meta"},
  "agent_slug": {"S": "$slug"},
  "joined_at": {"S": "$NOW"}
}
JSON
  )"
done
```

### Existing stage hot-fix (if pre-FU-NEW-C runbook was used)

If a previous run of this runbook wrote the legacy shape (no
`project_id` on META, alien `repo` / `stream` attrs), patch in place:

```bash
aws dynamodb update-item --table-name wf-table-$STAGE --region $REGION \
  --key '{"pk":{"S":"PROJECT#workforce-meta"},"sk":{"S":"META"}}' \
  --update-expression "SET project_id = :pid" \
  --condition-expression "attribute_not_exists(project_id)" \
  --expression-attribute-values '{":pid":{"S":"workforce-meta"}}'
```

The conditional makes it idempotent (skips if `project_id` already set).
The alien `repo` / `stream` attrs are tolerated by the canonical reader
(DDB silently ignores unrecognised attributes) AND by the FU-NEW-D
defensive skip in `wf-agents-api listProjects` if the fix is missed; the
deletion of those attrs is cosmetic.

## Verify

```bash
aws dynamodb query --table-name wf-table-$STAGE --region $REGION \
  --key-condition-expression "pk = :pk" \
  --expression-attribute-values '{":pk":{"S":"PROJECT#workforce-meta"}}' \
  --query 'Items[*].sk.S' --output table
```

Expected output: `META`, `MEMBER#aoi`, `MEMBER#dario`, `MEMBER#maya`,
`MEMBER#ren`, `MEMBER#sora`, `MEMBER#yuki` (alphabetical or insertion
order).

## After Epic-010 Story 1 lands

The new `Project.create()` + `Project.add_member()` helpers ([Story 1 issue](https://github.com/refluster/ai-native-article/issues/90))
take over. The rows above remain valid — the data model is additive.

The cutover work for Maya's pdm-decompose:

- Set `pdm-decompose` handler to call `Project.append_execution(...)` for
  the audit trail instead of the standalone RUN row write
- Resolve `project_id` from the task instead of the hardcoded
  `"workforce-meta"` (pdm-decompose runs against `PROJECT#workforce-meta`
  by definition — the project is the workforce itself)

That's a separate PR after Story 1's foundation lands.
