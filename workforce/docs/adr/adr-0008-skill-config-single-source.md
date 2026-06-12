# ADR-0008 — Skill judgment-config is single-sourced from DynamoDB; the console reads DDB live

- **Status**: Proposed (operator ratifies by merging the implementation PR)
- **Date**: 2026-06-12
- **Deciders**: operator
- **Related**: [ADR-0007](adr-0007-agent-config-single-source.md) (the agent-side precedent this extends), [Epic-008](../epics/epic-008-skill-repository.md)

## Context

ADR-0007 made the `AGENT#{slug}` DDB row family the single authoritative
store for agent config, with agents-api the single writer (validated,
audited, weekly-digested, write = live). Two adjacent surfaces kept the old
shape, and both bit the operator during the 2026-06-12 policy-group
onboarding:

1. **Skills are still git-first.** A skill's judgment text (`SKILL.md`
   body), `owners[]`, `status`, and `cost_class` live in
   `workforce/skills/{name}/` and reach the runtime via `wf-seed-skills`
   (post-deploy upsert) and the per-fire repo clone. Iterating a prompt or
   amending `owners[]` therefore costs a PR + merge + data-plane deploy —
   the same ceremony-per-routine-adjustment argument the operator already
   rejected for agent config. The asymmetry is now visible at the seams:
   binding an agent to a skill is one audited PATCH, but the `owners[]`
   amendment that R8 requires first is a deploy.
2. **The console reads a build-time snapshot.** `workforce-agents.json` is
   baked at console deploy; after the (live, DDB-direct) `wire-cadences`
   PATCH, the operator saw `BINDINGS 0` on the agent page and could not
   tell whether work remained or a cron was pending. A "single source"
   whose authoritative state the primary UI does not show invites exactly
   this confusion.

Not everything in a skill folder is judgment text. The bundled
**write-scripts** (`*.mjs`) are executable code in the runner's supply
chain, and `requires[]` is compiled into the orchestrator's deploy bundle
(`skill-registry-generated.ts`) where it drives credential injection
(Epic-010 trust boundary). Those have different risk profiles from a prompt
body.

## Decision

**Split skill config along the Software 2.0 seam. Judgment-side fields
become DDB-authoritative and API-writable with ADR-0007's full governance
kit (write-time validation, AUDIT trail, weekly digest, write = live).
Code-side artefacts — write-scripts and `requires[]` — stay git-owned and
review-gated. The console stops reading baked snapshots of DDB-owned state
and reads the live API.**

Concretely:

1. **API-writable skill fields** (`PATCH /skills/{name}`, IAM-auth, same
   gate as agent config): `body` (the SKILL.md judgment text), `description`,
   `version`, `status`, `owners`, `cost_class`, `improvement_agent`, and the
   existing operational `improvement_agent_override`. `name` / `created_at`
   are immutable; computed fields are never client-writable.
2. **Git-owned, unchanged**: the write-scripts, `requires[]` (+
   `skill-registry-generated.ts` codegen), `archetype`, and `deliverable` —
   the C1–C3 cadence invariants and the credential trust boundary keep
   their CI + deploy supply chain. A new skill therefore still **enters via
   git** (`cadence-forge` scaffold → PR → merge → deploy), because a new
   skill needs its script; there is no `POST /skills`.
3. **Write-time validation** ports the J-rule shape checks from
   `validate-skills.mjs` (semver, status/cost-class enums, owner-slug shape
   + duplicate check) into a shared module enforced by agents-api, plus
   blast-radius ceilings: a body size cap, a description cap, and an
   owners-must-exist cross-check against the live `AGENT#` rows (CI could
   only check shape after ADR-0007 deleted the agents tree; the API can
   check existence again).
4. **Audit + digest**: every accepted mutation appends a
   `SKILL#{name}/AUDIT#{iso-ts}` item (same shape and digest-for-long-strings
   rule as agent audits); `wf-config-digest` compiles skill audits into the
   same weekly issue, under a `skill:{name}` heading.
5. **The seed becomes create-only.** `wf-seed-skills` keeps registering
   *new* skill folders on deploy but never overwrites an existing
   `SKILL#{name}/META` row — eliminating the two-master clobber (a deploy
   silently reverting API edits) instead of managing it with hash
   transitional machinery. After first seed, the git `SKILL.md` body is a
   creation-time scaffold artefact; the authoritative text is the row.
6. **The runner reads the body from the API.** `agent-runner.md` step 3
   changes from "read `workforce/skills/{skill}/SKILL.md` from the clone"
   to "GET `/skills/{name}` and use `.body`" (fail loud on error — the same
   API the write-scripts already POST to, so no new availability coupling).
   Scripts still execute from the clone. A body PATCH takes effect on the
   next fire with no deploy.
7. **The console reads DDB live.** The workforce SPA builds its agent
   roster from `GET /agents` (+ per-slug hydration on the profile page) at
   page load instead of the baked `workforce-agents.json`; `about` derives
   server-side, depth/direct-reports derive client-side from `reports_to`.
   The newsletter app's byline manifest (a tiny static subset of a fully
   static site) keeps the build-time copy. The C-4 property moves from
   "empty roster turns the build red" to "empty/failed roster renders a
   loud error state, never an empty page". The skills *file browser* keeps
   the git manifest (it displays code, which stays git-owned); rendering
   the DDB body as the authoritative text on the skill page is a follow-up.

## Alternatives considered

- **Full ADR-0007 mirror (retire `workforce/skills/**` from git).**
  Rejected: write-scripts are code the runner executes; moving them to DDB
  trades a review gate for nothing (they change rarely) and breaks the
  C1–C3 CI invariants. The folder stays; only its judgment slice changes
  ownership.
- **Status quo + faster deploys.** Rejected: ceremony per prompt iteration
  is the same operator-rejected cost, and the `owners[]`-then-bind two-step
  remains a deploy-coupled dance.
- **Two-master with identity-hash guards** (keep upsert seed, skip when
  API-touched). Rejected: this is the transitional machinery ADR-0007
  retired; create-only is strictly simpler and loses nothing once body
  edits flow through the API.
- **Console: cache-bust the manifest on a schedule.** Rejected: any baked
  copy of DDB-owned state re-creates the staleness window; the read path
  should be the store the writes land in.

## Consequences

- **Positive.** Prompt iteration and owners/status changes become one
  audited write with next-fire effect; the R8 bind-prerequisite no longer
  costs a deploy; the console shows the authoritative state (the
  `BINDINGS 0` confusion class disappears); skills gain the same
  review/audit machinery agents already have, on shared code paths.
- **Accepted costs.** (a) Post-hoc (≤1 week) review for skill-body changes,
  bounded by the size caps — same trade as ADR-0007. (b) Git `SKILL.md`
  bodies go stale after API edits; the file carries a scaffold-artefact
  banner and the validators keep checking only creation-time shape.
  (c) The console depends on API availability at page load (it already did
  for stats/feed/threads). (d) `version` self-reported via API is no longer
  forced to move with script changes — acceptable at C-3 scale; the digest
  shows both sides.
- **Migration order.** (1) PATCH /skills + validation + AUDIT + digest
  extension + create-only seed (one PR, this ADR); (2) runner-spec body
  cutover (same PR — effective next fire after merge); (3) console live
  reads (same PR); (4) follow-up: skill-page body overlay + a
  `wf-skill-edit` CLI mirroring the binding ergonomics.

## Related rules

- R8 (binding skill/owner cross-check) now reads API-writable `owners[]` —
  intended; the check itself is unchanged.
- `validate-skills.mjs` continues to gate *creation-time* shape and the
  C1–C3 cadence invariants in CI; it no longer implies the git body is
  runtime-authoritative.
- Root `docs/governance.md` C-2 analogue: the DDB row is the master copy
  for skill judgment config; `workforce/skills/{name}/SKILL.md` becomes a
  derived/initial artefact post-seed.
