# Epic-006 — Workforce scalability to 100+ agents

- **Status**: Rejected (2026-06-23 — obsoleted; only S6 slug-disambiguation left open)
- **Owner**: Maya
- **Created**: 2026-05-18
- **Implemented by**: — (S1/S3 shipped incidentally; S2/S4 made moot; S6 to carve to a follow-up Story)

> **Status reconciliation (2026-06-23, Mateo).** Rejected as *obsoleted*: this six-item bundle was overtaken before it was ever Accepted. **S1** (single `wf-orchestrator-tick` rule, dispatch-from-data) and **S3** (procedural `Sigil` avatars) shipped incidentally via other work — SAM carries zero per-agent CFN rules. **S2/S4** were made moot by the dispatch-from-data model + **ADR-0007** (no per-agent CFN rule explosion; no git-file prompt review — agent config lives in DDB). Only **S6** (slug `-NNN` disambiguation; `validate-naming.mjs` still `/^[a-z]+$/`) is genuinely unbuilt — carve it to a one-Story follow-up if still wanted. Not marked Implemented because it never moved through the lifecycle and S6 remains open.

## Problem

The current workforce design (v0.1, defined in [PR2](https://github.com/refluster/ai-native-article/pull/28) and the [architecture.md](../architecture.md)) was sized for **5 personas**. Operator direction (chat, 2026-05-18) confirms the planned operating point is **100+ agents**. Several design choices that work fine at N = 5 become liabilities at N = 100:

1. **Per-agent EventBridge cron rules.** SAM template defines one `Wf{Agent}{Cadence}Rule` per agent. 100 agents × 2 cadences = 200 CloudFormation resources per stack. CFN has a 500-resource per-stack soft limit; deploy times grow linearly; per-rule IAM gets noisy.
2. **W-3 monthly cap of USD 50 (combined).** At N = 100 the per-agent share is ~USD 0.50, below the price of a single Opus generation. Either total cap rises 20–100× or per-agent caps need to be the only enforcement layer.
3. **Per-agent avatar files.** Already resolved by [PR #28 review fix](https://github.com/refluster/ai-native-article/pull/28#issuecomment-4479560164) — avatars are now rendered procedurally from the slug, no per-agent asset.
4. **Per-agent system.md prompts.** 100 files is fine to *store*; the friction is **review**. AGENTS.md Rule 11 ("one persona's prompt bump per PR") means revising a shared phrasing across 100 personas requires 100 PRs. Unsustainable.
5. **Agent directory UI.** A grid of 100 cards is browsable but not navigable; search (Epic-001) and pagination are non-optional.
6. **Slug collisions.** The current convention `^[a-z]+$` admits ~26^5 ≈ 12M short slugs, but human-meaningful ones run out fast (`sora`, `maya`, …). Need a disambiguation rule (e.g., suffix `-002`).

This Epic captures all six in one place so we can sequence the fixes deliberately rather than chasing each as it bites.

## Proposed solution

### S1. EventBridge rules: one orchestrator-tick, dispatch from data

Replace per-agent rules with a single `wf-orchestrator-tick-{stage}` rule that runs every 5 minutes. The orchestrator reads all `AGENT#*/META` rows, evaluates each agent's `schedule_cron` against `now()`, and dispatches the ones that are due. CFN resource count is constant in N.

- New library: small cron-matcher in `lambdas/shared/cron.ts` (parses the cron expression and answers "fires within the next 5 min?").
- `agent.json:schedule_cron` stays as the agent's owned cadence definition; it just doesn't materialise as a CFN resource any more.
- Idempotency: a `RUN#…` row with a fired-at timestamp prevents duplicate dispatch within a tick window.

### S2. W-3 cap: per-agent only, scrap the combined cap

Drop "USD 50 combined" from `governance.md §2 W-3`. Keep per-agent `budget_monthly_usd` (already in `agent.json`) as the enforcement layer. Add an alarm at the **stack level** (CloudWatch Billing Alarm scales naturally) at a generous threshold (default: USD 500/month, raisable by Zone A amendment). The `validate-agent-json.mjs` `W3-cap` check is removed; replaced with a per-agent sanity check (no single agent above USD 100/month).

This is a Zone A governance amendment — requires a PR that updates `governance.md §2 W-3` and a PR that updates `validate-agent-json.mjs`.

### S3. Per-agent avatar files (resolved)

Procedural rendering on the frontend from the slug. `validate-agent-json.mjs` now treats `agents/{slug}/avatar.*` as a forbidden artefact. No further action.

### S4. `system.md` review: a shared "prelude" + per-agent "voice"

Split `system.md` into two files per agent:

- `workforce/agents/_prelude.md` — shared boilerplate (W-invariants, R-N rules, "you are running on Lambda", failure-mode reminders). One file. Changes go through one Rule-11 PR for "the prelude."
- `workforce/agents/{slug}/voice.md` — the per-agent identity (currently the bulk of `system.md`). Bumps stay Rule-11 one-per-PR but reviewers don't re-read the shared parts.

The runner concatenates `_prelude.md + voice.md` to form the system prompt.

This is also a governance amendment — `governance.md §3` zone table changes; one PR per change.

### S5. Agent directory UI

Covered by Epic-001 (search) and Epic-002 (profile). No additional design needed here; the work happens in those Epics.

### S6. Slug disambiguation

Extend the `R2-slug` rule in `validate-naming.mjs`:

- v1: `^[a-z]+$` (one to many lowercase letters).
- v2: `^[a-z]+(-\d{3})?$` — admits an optional three-digit suffix like `sora-002`. The auto-generation flow for new personas (forthcoming, separate Epic) takes the human-meaningful base and appends `-NNN` if taken.

## Behaviour at N = 100+ agents

This Epic *is* the N = 100 design. After S1–S6 land:

- Adding agents 6, 7, … to N = 100 is a `workforce/agents/{slug}/{agent.json, voice.md}` add — no CFN change, no per-agent SAM template edit, no per-agent governance edit.
- Per-agent budget enforcement is the only cost gate. The combined cap becomes a billing alarm, not a hard CI block.
- Search, profile, org chart UIs scale by Epic-001/002/003's own N-bounded designs.

## Acceptance criteria

This Epic produces **multiple PRs**, not one. Maya converts it into:

- Issue A — `S1`: orchestrator-tick rule + cron-matcher library; deprecate per-agent rules in SAM template.
- Issue B — `S2`: W-3 governance amendment; `validate-agent-json.mjs` cap-check update.
- Issue C — `S4`: prelude/voice split; one persona migrated as the pattern (Sora first), then the other four in separate Rule-11 PRs.
- Issue D — `S6`: slug regex extension.
- (S3 already done; S5 covered by Epic-001/002.)

Each issue is mergeable independently. S1 unblocks N > ~20. S2 unblocks N > ~10. S4 unblocks N > ~30 reviewer-bandwidth. S6 unblocks N > some practical limit on memorable single-word slugs (~50).

## Open questions

- Q1. The S1 orchestrator-tick adds a 5-minute granularity to all schedules. Currently Sora's cron expression resolves to an exact minute (`cron(0 23 ? * SUN *)`). At 5-min granularity she might fire 0–4 minutes late. Operator confirm acceptable.
- Q2. Per-agent `budget_monthly_usd` cap of USD 100 (S2) — too high? Too low? Operator nudge.
- Q3. Should the prelude be one file or one-per-stream (editorial-prelude, client-prelude, internal-prelude)? Default: one file at v1; split later if reviewers find it bloating.

## Out of scope

- Auto-generation of personas (text-to-persona via an LLM). That's a separate Epic; this one defines the *shape* the auto-generator must respect.
- Multi-region deployment, multi-account. C-3 (single-operator scale) still holds.
- Skill catalog scalability — covered by Epic-004.
