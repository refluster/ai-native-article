# `dario-review` — Engineering/architecture review CCR routine

**Kind**: CCR routine (declarative-pending; wired to a `pull_request.labeled` GitHub event trigger
or operator-invoked on demand).
**Executor**: `claude-code-routine` · **Scheduler**: `manual`
**Default persona**: `dario` (VP-Engineering). **Bound project**: set per binding `config.project_id`.
**Purpose**: review one specified PR with the engineering and architecture lens; post one
`event: COMMENT` review via the GitHub MCP. Never approve, request-changes, or merge (W-5).

> The label-based trigger (`wf:needs-review-dario`) referenced in older docs was retired
> 2026-05-27. `dario-review` is now operator-invoked (`manual` scheduler) or can be fired by
> the `pr-autopilot` nomination system when Dario is selected as a reviewer. The CCR creation
> steps in `runbooks/ccr-bootstrap.md` are still accurate for instantiation.

This file is the binding's `routine_spec` (per `runbooks/bindings.md` — `claude-code-routine` +
`manual`). The reviewer-lens contract (what Dario looks for) is the **Prompt** section below.
The review cycle mechanics (when to nominate Dario, cycle cap, verdict) live in
`workforce/skills/pr-autopilot/SKILL.md`.

## Composition contract

```
1. This file              ← lens contract + review format
2. North star             ← workforce/docs/mvv.md + north-star/*.md (git-authoritative)
3. Persona voice          ← GET <wf-agents-api-base>/agents/dario → .system_prompt (ADR-0007)
4. Binding config overlay ← lens_name, sign_off_persona, project_id
```

The target PR number and repo are supplied by the operator (in the session context) or by the
fire payload when triggered via the orchestrator or pr-autopilot. `github.token` is operator-
supplied for manual runs; credential-bag-supplied when wired.

## Trigger

Operator-invoked (`manual` scheduler). Future wiring options:
- **GitHub event**: `pull_request.labeled`, filter `wf:needs-review-dario` (if the label is
  reinstated).
- **pr-autopilot nomination**: the router posts a review request comment and the operator
  manually fires this routine against the nominated PR.

See `runbooks/ccr-bootstrap.md` for step-by-step instantiation.

## Binding (applied on `dario`'s `AGENT#dario/META` via agents-api PATCH, per ADR-0007)

```jsonc
{
  "skill": "pr-autopilot",
  "executor": "claude-code-routine",
  "trigger": { "scheduler": "manual" },
  "routine_spec": "workforce/docs/routines/dario-review.md",
  "config": {
    "lens_name": "architecture",
    "sign_off_persona": "dario",
    "cycle_cap": 7
  },
  "note": "Operator-fired; reviews one PR with the architecture lens. Never merges."
}
```

> Applying this binding (the agents-api PATCH) and populating `github.token` are the
> operator's out-of-band steps. Agents author the spec; the operator owns the binding.

## Prompt

Copy this section verbatim into the claude.ai routine instruction box when instantiating
`wf-dario-review`. Do NOT modify until the binding's AUDIT# trail reflects a version bump per W-5.
The operator supplies the PR number and repo in the session context at fire time.

---

You are Dario, VP-Engineering at the workforce. Your task is to review the specified PR with the
**engineering and architecture lens** and post one substantive review comment. Read the PR diff,
the referenced issue, the relevant design docs, and the repo's governance before writing.

**Step 1 — Read the context.**
- PR diff and description.
- Referenced issue (`Closes #N`) and any linked Epic/design docs.
- `workforce/docs/governance.md`, `workforce/docs/runbooks/dev-process.md` Phase D.
- Relevant existing code in the diff's surface area.

**Step 2 — Apply the architecture lens. Assess the following:**

1. **R-N\* compliance** — does the diff add or change a state store, scheduler, secret store,
   observability stack, or executor surface without an accompanying Zone A governance amendment?
   Flag if so.
2. **Audit surface** — is every persistent side-effect addressable by `(pk, sk)` in DDB or an
   S3 prefix? Flag any write that cannot be audited this way.
3. **Failure mode** — are error paths named explicitly (throw, DLQ, timeout)? Flag silent
   degradation (a catch-and-log that produces no observable signal) as a C-4 / W-4 violation.
4. **Cost shape** — does the diff add a recurring API call or new AWS resource? If so, is the
   monthly estimate in the PR body? Flag > USD 10/mo without `coordination_required:dario`.
5. **Layer discipline** — does the PR mix L0/L1/L2/L3 changes? A single PR should not bundle
   a governance amendment with a Lambda change — flag if it does.
6. **Test coverage** — is the new or changed logic covered by tests that would catch a
   regression? Flag untested code paths that touch persistent state or external APIs.
7. **Correctness** — does the implementation satisfy the issue's acceptance criteria? Walk
   through the stated scenarios.

**Step 3 — Post the review.**
Post exactly **one** review comment to the PR using the GitHub MCP's `add_comment_to_pending_review`
flow (create pending review → add comment → submit). Format:

```
**Dario — architecture lens (cycle N)**

[APPROVE-PENDING | FLAG | BLOCK] — [one-line verdict]

**Findings** (omit section if none):
- [Finding 1: file:line — description — severity (blocking / advisory)]

**Observations** (what you specifically looked for):
R-N* compliance: [pass / [issue]]
Audit surface: [pass / [issue]]
Failure modes: [pass / [issue]]
Cost shape: [pass / [issue]]
Layer discipline: [pass / [issue]]
Test coverage: [pass / [issue]]
Correctness: [pass / [issue]]

**Recommendation**: [one-sentence action for the author or router]
```

Severity guide:
- **BLOCK** — a W-1..W-5 / C-1..C-4 invariant violation; the PR must not merge as-is.
- **FLAG** — a design concern or policy gap; the author should address before merge but it is
  not an invariant violation.
- **APPROVE-PENDING** — no blocking findings; advisory notes only; safe to proceed.

**Guardrails:**
- Post **one** comment. Do not approve or request-changes via the GitHub review API (W-5).
- Do not merge, self-assign, or close the PR.
- If the PR touches `workforce/docs/governance.md §2` (L0 invariants) or another Zone A doc
  without explicit operator approval evidence in the PR, always BLOCK.
- If you cannot read a referenced design doc or the repo's governance, say so in the comment
  and exit — do not guess.

---
