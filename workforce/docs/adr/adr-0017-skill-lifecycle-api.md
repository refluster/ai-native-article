# ADR-0017 — Skill lifecycle API: display-name/slug split, archive soft-delete, API-first creation, per-skill run ledger

- **Status**: Proposed (operator ratifies by merging the implementation PR)
- **Date**: 2026-07-03
- **Deciders**: operator (refluster), drafted by a Claude Code session on the operator's request ("skillのライフサイクルを桁違いに高める")
- **Related**: [ADR-0008](adr-0008-skill-config-single-source.md) (the judgment/code split this extends — and partially supersedes on creation), [adr-0012](adr-0012-decouple-binding-from-ownership.md), [Epic-008](../epics/epic-008-skill-repository.md)

## Context

The operator's direction: skill development must speed up by an order of
magnitude — an agent (or the operator, from any repo) should be able to
create a skill and assign it in ~5 minutes, iterate daily, and retire
skills casually without breaking history. Four frictions blocked that:

1. **Name = slug = identity.** The directory name, `SKILL.md:name`,
   `meta.json:name`, the DDB key, the binding reference, and the EXEC-row
   `skill_name` are all one string. Renaming a skill meant breaking every
   causal link to its past runs and deliverables — so nobody renamed.
2. **No lifecycle end-state.** `status ∈ {active, stale, deprecated}` had
   no soft-delete: a retired skill either lingered in every list or was
   hard-deleted, orphaning its activity/deliverable history.
3. **Creation was git-only.** ADR-0008 deliberately kept `POST /skills`
   out ("a new skill needs its script"), so even a pure-judgment skill
   cost a scaffold → PR → merge → deploy round-trip.
4. **No per-skill observability read.** GSI2 (`SKILL#{name}` ×
   `started_at`) existed in the data plane, but no API or console surface
   answered "who ran this skill, when, with what result" — the
   Lambda↔CloudWatch-style debugging loop the operator asked for.

## Decision

1. **The slug is the immutable ID; `display_name` is the renameable
   label.** `name` keeps its Anthropic Agent Skills-compatible shape
   (kebab-case, ≤64, no reserved tokens) and never changes — bindings,
   EXEC history, GSI2 partitions, and URLs all keep referencing it. A new
   optional `display_name` (1–120 chars, any script) is PATCH-able at any
   time and rendered by the console with the slug as sub-line. Renames
   therefore never touch any other entity — the operator's "スキル名を
   変更しても他エンティティとの因果関係に影響しない" requirement, by
   construction. SKILL.md frontmatter stays the portable Anthropic format
   (`name` + `description` only); `display_name` lives in the workforce
   sidecar (meta.json / DDB), exactly the split that keeps SKILL.md
   marketplace-compatible.
2. **`archived` joins the status enum as the soft delete.** An archived
   skill: disappears from the default `GET /skills` list
   (`?include_archived=true` or `?status=archived` reveals it — and the
   console's ARCHIVED checkbox); is rejected as a **new** binding target
   (`R8-binding-skill-archived` at the agents-api write boundary);
   keeps its EXEC/deliverable history fully queryable (rows reference the
   immutable slug). Existing bindings are not force-unbound — the
   operator unbinds on their own schedule; archive is a listing/wiring
   state, not a kill switch. Unarchive is the same PATCH back to
   `active`.
3. **`POST /skills` creates judgment-only skills** (IAM-auth, validated
   by `shared/skill-config.ts:validateSkillCreate`, audited like every
   config mutation). Creatable fields: `name`, `description`, `body`,
   `display_name`, `version`, `status`, `cost_class`, `owners` (required,
   ≥1 live agent), `improvement_agent`. Code-side fields (write-scripts,
   `requires[]`, `archetype`, `deliverable`) are rejected — they are
   executable code / the credential trust boundary, and ADR-0008's
   reasoning stands for that slice: those still enter via the git
   scaffold (`cadence-forge`). This *partially supersedes* ADR-0008
   Decision §2's "there is no `POST /skills`": there is now, for the
   judgment-only class. The 5-minute loop is: `POST /skills` → `PATCH
   /agents/{slug}` bindings[] → live on the next fire. Both calls are
   IAM-auth'd HTTP — callable from any repo or environment holding
   operator credentials, and by agents through any operator-granted
   signing path; per-agent capability tokens for self-serve creation are
   a named follow-up, not this ADR.
4. **`GET /skills/{name}/executions` is the per-skill run ledger** —
   GSI2-backed (`?from`/`?to` push down; `?agent`/`?status` post-filter),
   same row shape as the project ledger. The console's skill page grows
   an EXECUTIONS panel (agent + status filters) so "which run, whose run,
   when" is one click from the skill — the CloudWatch-for-Lambda analogy
   the operator gave.

## Alternatives considered

- **A separate opaque skill_id (ULID) with name as a mutable attribute.**
  Rejected: every existing reference (bindings, EXEC rows, S3 prefixes,
  registry) keys on the slug; introducing a second ID means a migration
  across all of them for no gain the display_name split doesn't already
  deliver. The slug is already opaque *enough* once display_name carries
  the human label — and it stays Anthropic-compatible.
- **Hard DELETE /skills.** Rejected: EXEC/deliverable rows reference the
  skill; a hard delete orphans the activity trail ("activity runsから
  追えなくなる" — the operator's own concern). Archive-as-status keeps
  one lifecycle field instead of a tombstone row family.
- **Full creation via API (write-scripts in DDB).** Rejected by ADR-0008
  and still right: scripts are supply-chain code; the review gate stays.

## Consequences

- Rename and archive become daily, zero-risk operations; creation of
  judgment skills drops from PR+deploy to one API call.
- Two creation paths exist (git scaffold for cadence/code skills, API for
  judgment skills). The seed stays create-only, so the paths cannot
  clobber each other; `identity_hash: "api"` marks API-born rows.
- Archived-but-still-bound skills keep firing until unbound (documented
  above; the binding editor shows the state). If this bites, the
  follow-up is an orchestrator-side skip on `status=archived`, logged
  loudly — deliberately not shipped now to keep archive non-destructive.
- The git `validate-skills.mjs` allowlist now includes `display_name`
  (and fixes a latent drift: `recall_k` was schema-legal but rejected by
  the validator's unknown-key check).

## Related rules

- Workforce zone table: `SKILL.md` body remains Zone A with Rule 11;
  `display_name`/`status` are judgment-side fields under the ADR-0008
  write kit (validated, audited, digested).
- R8 binding check family gains `R8-binding-skill-archived`.
- data-model.md SKILL row updated in the implementing PR.
