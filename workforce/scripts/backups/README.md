# scripts/backups — cold recovery artifacts

One-shot, human-triggered data backups captured immediately before a
destructive data migration. Nothing reads these files at runtime; they exist
so a deliberate revival is possible later. Each is named for the migration
that produced it.

## `experience-removal-prod-20260628.json`

The `experience` attribute (the LinkedIn-style **"Track Record on the
Workforce"** profile deck — `joined_at` + `highlights` + `endorsements`)
removed from every `AGENT#{slug}/META` row in `wf-table-prod` by **PR #389**.
The deck was a hand-authored placeholder with no live data behind it; the
operator asked for it gone surface-and-source. This file is the exact
pre-strip capture (DynamoDB-typed JSON, 21 rows).

> Why a committed file and not the git snapshot: unlike `jd` / `identity` /
> `memory`, this `experience` data was authored directly on the DDB rows —
> it is **not** present in the pre-ADR-0007 git snapshot
> (`c4e0422…:workforce/agents/{slug}/agent.json`) that
> `restore-agent-profile-fields.mjs` reads, so that script cannot revive it.
> This capture is the only exact copy.

### Revival procedure (if it ever becomes a product decision)

1. Revert the surface + type removal from PR #389 (`AgentProfile.tsx`
   `ExperiencePanel`, `types/agent.ts`, `lib/agents.ts`, the
   `build-agent-manifest.mjs` copy) and re-add `experience` to
   `PROFILE_FIELDS` in `restore-agent-profile-fields.mjs`.
2. Write each row's `experience` map back onto its `META` row, e.g. per item
   in `items[]`:
   `aws dynamodb update-item --table-name wf-table-prod --key '{"pk":…,"sk":…}' --update-expression "SET experience = :e" --expression-attribute-values '{":e": <the item's experience map>}'`.
3. Redeploy the console so the live API serves the restored deck.
