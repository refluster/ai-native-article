# ADR-0018 — Skill judgment-config syncs from git on a version gate (supersedes ADR-0008 §Decision-5)

- **Status**: Proposed (operator ratifies by merging the implementation PR)
- **Date**: 2026-07-05
- **Deciders**: operator
- **Epics**: [Epic-008](../epics/epic-008-skill-repository.md) (skill repository), [Epic-005](../epics/epic-005-agent-authored-article-pipeline.md) (the article pipeline that surfaced the drift)
- **Related**: [ADR-0008](adr-0008-skill-config-single-source.md) (the create-only seed this narrows), [ADR-0007](adr-0007-agent-config-single-source.md)

## Context

ADR-0008 made the `SKILL#{name}` DDB row authoritative for a skill's
judgment-side fields (`body`, `description`, `version`, `status`, `owners`,
`cost_class`, `improvement_agent`) and agents-api the single writer. To avoid
the "two-master clobber" — a deploy silently reverting a live `PATCH /skills`
edit — it made `wf-seed-skills` **create-only**: an existing row's
judgment-side fields are never re-synced from git (only `deliverable`, which is
git-authoritative, reconciles). After the first seed, the git `SKILL.md` body
is "a creation-time scaffold artefact."

That decision assumed body iteration would flow through the API. In practice it
has not: operators and Claude Code sessions edit `workforce/skills/{name}/`
(the natural, reviewable, PR-gated surface) and expect the change to reach the
runtime. Because the seed is create-only, it does not — and nothing surfaces the
gap. This bit the podcast pipeline directly:

- `workforce/skills/podcast-script/` was authored up to **v0.3.0** in git,
  adding an "Up to 5 episodes per fire — loop the picker up to 5×" instruction.
- The live DDB row (which `agent-runner` reads per ADR-0008 §Decision-6) was
  still **v0.1.0**, the single-article body. The cadence therefore processed
  **one** article per fire, and the git loop had **never** run in production.
- The seed being create-only, no deploy or `seed-skills.mjs` invocation could
  push the fix; only a hand-authored `PATCH /skills` could — an
  operator-invisible step nobody knew was owed.

ADR-0008 itself named the missing mitigation as a follow-up (Consequences (b):
"a `validate-skills` warning on body edits to already-seeded skills … until it
ships, the git body must be treated as creation-time only"). That follow-up
never shipped, so drift accrued silently — a C-4 "fail loud, not silent"
violation in slow motion.

## Decision

**Replace ADR-0008's flat create-only seed (§Decision-5) with a
VERSION-GATED sync, and add the PR-time drift guard ADR-0008 promised.**

1. **`wf-seed-skills` version-gated update.** For an existing
   `SKILL#{name}/META` row, the seed re-syncs the git-authored judgment-side
   fields **iff `git meta.json:version` is strictly newer** than the row's
   `version` (semver compare). An equal-or-older git version changes nothing
   — so a live `PATCH /skills` edit that bumps the version above git stays
   authoritative, and a stale/rolled-back bundle can never regress the row.
   New folders still create wholesale; `deliverable` still reconciles every
   run regardless of version.
2. **Every accepted sync is audited.** A version-gated update appends a
   `SKILL#{name}/AUDIT#{iso-ts}` item (actor `wf-seed-skills`) with the
   field-level diff, via the same `appendSkillAudit` / `diffChanges` path the
   agents-api PATCH uses — so `wf-config-digest` renders seed-driven and
   API-driven mutations uniformly (ADR-0008 §Decision-4 unchanged).
3. **A CI drift guard makes the version bump mandatory**
   (`workforce/scripts/check-skill-body-version.mjs`, wired as
   `npm run workforce:skill-body-version`). On a PR, if any authored judgment
   field of an already-existing skill changes, the same PR **must** bump
   `meta.json:version`; otherwise CI fails. This is the "warning on body edits
   to already-seeded skills" ADR-0008 promised, hardened to a gate: it turns the
   silent no-op into a red build.

The trigger stays the existing `wf-seed-skills-postdeploy-{stage}` EventBridge
rule (fires on every data-plane stack UPDATE). No new infra, no new IAM (the
function already holds `dynamodb:PutItem` on the table for the AUDIT write).

## Alternatives considered

- **Keep create-only + ship the ADR-0008 warning only.** Rejected: a warning
  that does not propagate the fix still requires a hand-authored `PATCH /skills`
  the operator forgets to make — the exact failure that produced this ADR. The
  warning is necessary but not sufficient.
- **Git-always-overwrite (unconditional re-sync on every deploy).** Rejected:
  reinstates the full two-master clobber ADR-0008 retired — any live API body
  improvement is reverted on the next unrelated deploy. The version gate keeps
  git as the practical source of truth while leaving an escape hatch (a higher
  live version) for API edits, so both masters coexist deterministically.
- **Identity-hash guard (skip when API-touched).** Rejected for the same reason
  ADR-0008 rejected it: transitional machinery. A monotonic version is a
  simpler, human-legible gate than a hash-transition state.

## Consequences

- **Positive.** A git skill edit reaches the runtime on the next deploy with no
  hand-authored PATCH — the "human PATCH nobody knew was owed" class disappears.
  The podcast-script v0.3.0 body (and any future authored change) propagates the
  first time the data plane deploys after this lands. Drift is caught at PR time,
  not months later in a "why did the cadence do the old thing" incident.
- **Accepted costs.** (a) A body change now *requires* a version bump to ship —
  intentional friction, and the correct signal (an un-bumped edit is a scaffold
  edit that will not reach production; the gate says so out loud). (b) The
  git↔live relationship is now "newer git version wins," so a live API edit must
  bump past git to survive a later git bump — documented here and in the seed
  handler. (c) `meta.json:version` regains load-bearing meaning (it did not,
  post-ADR-0008 §Consequences (d)); the AUDIT diff still records every change.
- **Migration.** One PR (this ADR): the version-gated seed + its unit tests, the
  `check-skill-body-version` gate + CI wiring. On first post-merge deploy, the
  seed reconciles every skill whose git version already exceeds its live row —
  including `podcast-script` (git 0.3.0 > live 0.1.0), which is the fix that
  motivated this.

## Related

- **Supersedes [ADR-0008](adr-0008-skill-config-single-source.md) §Decision-5**
  (create-only seed) and delivers its Consequences-(b) follow-up. ADR-0008's
  other decisions (API-writable fields §1, git-owned code-side §2, write-time
  validation §3, audit/digest §4, runner reads the API body §6, console live
  reads §7) are unchanged.
- Root `docs/governance.md` C-2 / C-4: the DDB row remains the master the
  runtime reads; this ADR makes the git→row propagation loud and automatic
  rather than silent and manual.
- `validate-skills.mjs` still gates creation-time shape in CI; the new
  `check-skill-body-version.mjs` gates the *version-bump-on-edit* discipline
  this ADR introduces.
