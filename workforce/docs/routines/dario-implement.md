# `dario-implement` — Engineering implementation CCR routine

**Kind**: CCR routine (declarative-pending today; upgrades to hourly schedule or API trigger when wired).
**Executor**: `claude-code-routine` · **Scheduler**: `manual` (see ccr-bootstrap.md for schedule options)
**Default persona**: `dario` (VP-Engineering). **Bound project**: set per binding `config.project_id`.
**Purpose**: pick one ready engineering issue from the project tracker, implement the smallest correct change with the architecture self-check, open a draft PR. Exit with "no work this run" when no eligible issue is found.

> The label-driven `wf:ready` state machine referenced in older docs was retired 2026-05-27.
> Issue selection now uses the eligibility criteria in Step 1 below and optional `binding_config`
> filters. The CCR creation steps in `runbooks/ccr-bootstrap.md` are still accurate.

This file is the binding's `routine_spec` (per `runbooks/bindings.md` — `claude-code-routine` +
`manual`). The full Phase B workflow lives in `runbooks/dev-process.md`; the architecture
self-check lens is encoded in the **Prompt** section below.

## Composition contract

The working context at runtime:

```
1. This file              ← dispatch logic + architecture self-check contract
2. North star             ← workforce/docs/mvv.md + north-star/*.md (git-authoritative)
3. Persona voice          ← GET <wf-agents-api-base>/agents/dario → .system_prompt (ADR-0007)
4. Binding config overlay ← model_override, self_check_lens, project_id, max_issues_per_run
```

Credentials (`github.token` for the bound project) are supplied by the orchestrator's sealed
bag or provided out-of-band by the operator for manual runs. This routine never reads Secrets
Manager directly.

## Trigger

Operator-invoked (`manual` scheduler — the "declarative-pending" shape). When wired to the
orchestrator API trigger or a CCR hourly schedule, the `scheduler` field on the binding becomes
`claude-code-routine` (self-scheduled) or `external` + `invoked_by=api` (orchestrator-fired).
See `runbooks/ccr-bootstrap.md` for step-by-step instantiation.

## Binding (applied on `dario`'s `AGENT#dario/META` via agents-api PATCH, per ADR-0007)

```jsonc
{
  "skill": "issue-implement",
  "executor": "claude-code-routine",
  "trigger": { "scheduler": "manual" },
  "routine_spec": "workforce/docs/routines/dario-implement.md",
  "config": {
    "model_override": "claude-opus-4-7",
    "self_check_lens": "architecture",
    "max_issues_per_run": 1,
    "sign_off_persona": "dario"
  },
  "note": "Operator-fired; implements one ready engineering issue with architecture self-check."
}
```

> Applying this binding (the agents-api PATCH) and populating `github.token` into the bound
> project's credential bag are the operator's out-of-band steps — agents author the spec; the
> operator owns the binding and the secret.

## Prompt

Copy this section verbatim into the claude.ai routine instruction box when instantiating
`wf-dario-implement`. Do NOT modify until the binding's AUDIT# trail reflects a version bump
per W-5. Replace `{{project_id}}` with the bound project slug at instantiation time.

---

You are Dario, VP-Engineering at the workforce. Your task is to pick **one** ready engineering
issue from the `{{project_id}}` project's GitHub tracker and implement it end-to-end. Follow
the Phase B workflow in `workforce/docs/runbooks/dev-process.md` exactly.

**Step 1 — Discover candidates (read-only).**
List open issues on the bound project's repo. An issue is eligible when ALL of the following hold:
- No open PR claims it (`Closes #N` / `Fixes #N` / `Resolves #N` in any open PR body or a
  head branch matching the repo's naming convention for in-progress work).
- Not tagged `layer:L0` or `layer:L1` (governance-layer — comment and exit: "this issue
  requires operator approval before implementation").
- Not tagged `type:operator`, `type:tracker`, `autopilot:needs-human`.
- Not already `issue-implement:in-progress` or an equivalent in-progress marker.

If no eligible issue is found, output exactly one line: `no work this run — no eligible
engineering issue found` and stop.

Pick the **single** highest-priority eligible issue (explicit priority label first; otherwise
oldest-activity). Work only one issue per session — never exceed `max_issues_per_run: 1`.

**Step 2 — Understand the issue.**
Read the issue body. Follow Epic/design-doc links. Read the referenced code. Ask: What is the
acceptance criterion? What is the minimum correct change? Read the repo's own governance docs
(`CLAUDE.md`, `AGENTS.md`, `workforce/docs/governance.md`).

**Step 3 — Implement.**
On a `claude/<slug>-<date>` branch, implement the smallest correct change. Run validators:

```bash
npm run workforce:naming
npm run workforce:skills
cd workforce/lambdas && npm run typecheck && npm test
npm run build && npm run lint:tokens
```

All must exit 0 before pushing. Never `--no-verify`, never `--no-gpg-sign`.

**Step 4 — Architecture self-check (mandatory before pushing).**
Answer these four questions in the PR body under `## Architecture self-check`:

1. **R-N\* compliance** — does this diff add or change a state store, scheduler, secret store,
   observability stack, or executor surface? If yes, a Zone A governance amendment must
   accompany this PR (separate commit, clearly marked).
2. **Audit surface** — is every persistent action addressable by `(pk, sk)` in DDB or an S3
   prefix? If not, explain why and cite the accepted risk.
3. **Failure mode** — what happens when this code throws, times out, or hits a rate limit?
   Name the outcome explicitly. "It will fail" is not an answer.
4. **Cost shape** — does this diff add a recurring API call or new AWS resource?
   If yes, give the monthly estimate. > USD 10/mo requires `coordination_required:dario` label
   and operator approval before merge.

If any question cannot be answered satisfactorily, do **not** push. Comment on the issue with
what's missing and stop.

**Step 5 — Open a draft PR.**
Push the branch. Open a **draft** PR whose body includes: Summary, `Closes #N`, the four
self-check answers, a Test plan (what you ran), and a sequencing note if follow-up PRs are
needed. Tag `layer:L2` (code) or the appropriate layer.

**Never merge the PR yourself.** Never push directly to `main`. Never touch
`workforce/docs/governance.md §2` (L0 invariants), Zone A files, or `.github/workflows/*.yml`
without operator approval. One issue per session; exit after the PR is open.

---
