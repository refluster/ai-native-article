# Runbook — Registering a new agent (post-ADR-0007)

Since [ADR-0007](../adr/adr-0007-agent-config-single-source.md) the
`workforce/agents/` git tree is retired: the `AGENT#{slug}/META` DDB row is
the single authoritative store, agents-api is the single writer, and a new
persona is registered with **`POST /agents`** (AWS_IAM, SigV4 — operator
credentials), not a PR that adds files.

## Procedure

1. **Compose the body.** `slug` + the identity fields (`first_name`,
   `last_name`, `residence` ("City, Country" form), `role`, `model`,
   `prompt_version`, `budget_monthly_usd_default`, `default_project`,
   `streams`, `bindings`, `system_prompt`; optionally `owner_email`, `jd`,
   `identity`, `experience`, `memory`, `reports_to`, `lateral`).
   `created_at`, `paused`/`archived`, and the computed roll-ups are
   server-set — supplying them is a `400 non_writable_fields`.
2. **POST it** (group registrations: write a one-shot script under
   `workforce/seed/` — see `workforce/seed/policy-group/register.mjs` for
   the reference shape):

   ```bash
   aws-vault exec <profile> -- curl -sS -X POST \
     --aws-sigv4 "aws:amz:us-west-2:execute-api" \
     --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY" \
     -H "x-amz-security-token: $AWS_SESSION_TOKEN" \
     -H "content-type: application/json" --data-binary @agent.json \
     https://sjhikazsf9.execute-api.us-west-2.amazonaws.com/prod/agents
   ```
3. **Expect**: `201` (created; a `kind="create"` AUDIT item is appended and
   the weekly config digest will carry it), `409 already_exists` (a create
   is never an update — use PATCH), or `422 config_validation_failed` with
   the violation list (`S0-required`, the S1–S18 field rules, and the
   blast-radius guards incl. the W-3 aggregate budget cap — see
   `workforce/lambdas/shared/agent-config.ts`).

## Ordering and edges

Register **parents before reports** (`reports_to` targets should exist when
the console manifest next builds — `computeDepths` throws on a dangling or
cyclic graph, which is fail-loud but blocks the deploy; FU-022 adds the
digest-side check).

## After registration

- **Verify** via `GET /agents/{slug}` (public) — the same read the SPA and
  `build-agent-manifest.mjs` consume; the next console predev/prebuild picks
  the new roster up automatically.
- **Wire cadences second.** `bindings` referencing a skill require the new
  slug in that skill's `owners[]` (R8) — amend the skill, then PATCH the
  bindings on. `cadence-forge` scaffolds new periodic skills.
- **W-5 discipline**: subsequent persona-prompt changes remain one persona's
  prompt bump per write, each carrying its own AUDIT item.
- **Budget**: the API enforces the W-3 aggregate (`160` USD/mo across
  non-archived agents) per write. If a registration round needs headroom,
  raising the cap is a Zone A change — operator decision before, not after.
