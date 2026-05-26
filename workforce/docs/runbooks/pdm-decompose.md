# Runbook — pdm-decompose (Maya's daily epic decomposition)

The PdM routine that picks up Epic-derived Epic tracker issues and turns
them into role-tagged child issues, gated by operator approval. Owned by
**Maya (PM / Founder)**.

Companion docs:
- [SKILL.md](../../skills/pdm-decompose/SKILL.md) — full state machine + reasoning contract
- [bindings.md](bindings.md) — `agent.json:bindings[]` shape
- [project-workforce-meta-bootstrap.md](project-workforce-meta-bootstrap.md) — DDB row required before first run

## What fires it

EventBridge orchestrator-tick (`wf-orchestrator-tick-{stage}`) reads
Maya's bindings every 5 minutes and matches `cron(0 22 * * ? *)` against
the current UTC window. **15:00 America/Los_Angeles daily** (PDT; slips
to 14:00 in PST because EventBridge cron is UTC and does not honour DST).

To force an immediate run for testing:

```bash
aws lambda invoke \
  --function-name wf-agent-runner-prod \
  --payload '{"agent":"maya","binding_idx":1}' \
  --cli-binary-format raw-in-base64-out \
  /tmp/pdm-decompose.json && cat /tmp/pdm-decompose.json | jq .
```

`binding_idx: 1` because `pdm-decompose` is the 2nd binding in
`maya/agent.json` (0=plan-write, 1=pdm-decompose, 2=pdm-charter). After
adding or removing bindings in agent.json, re-confirm the index.

## What the operator does day-to-day

Maya's loop is one transition per run, one comment per epic per run.
The operator's role is the **approval gate** on the proposed decomposition.

### Daily Discord-or-issue-list sweep

1. Check the list of issues with the label `wf:ready` is moving — if not,
   something upstream is stuck (probably a CCR routine not picking up
   the work). Investigate per [bindings.md](bindings.md) (CCR section).
2. Find issues with comments containing the literal marker
   `<!-- pdm-decompose:proposal -->` and **no 👍 reaction yet** — those
   are the epics waiting on your approval.

### Reviewing a proposal

Each proposal comment contains:

- **Scenarios walked** — 2-3 operator scenarios Maya identified for the
  epic. If a scenario is missing or wrong, leave a reply comment with
  the gap; Maya will revise on the next run.
- **Proposed children** — the list of child issues Maya wants to create,
  with reviewer personas in italics.
- **Fenced ```json``` block** — the machine-parseable payload Maya uses
  on the next run to materialise the children. If the JSON is malformed,
  reply with adjustments — Maya will regenerate.

**Approve**: react 👍 on the comment. Next run, Maya creates the children + sub-issue links.

**Revise**: leave a reply comment (no 👍). Next run, Maya re-reads the
parent epic and re-posts a fresh proposal (the old proposal stays in
the thread for history). To completely reset, delete Maya's old
proposal comment manually.

**Skip**: close the parent epic. Maya will not propose against closed
issues.

### After Maya creates the children

Each child issue carries:
- title `[Epic-N Story M] (role) — deliverable`
- labels `wf:ready`, `role:<role>`, `epic:<N-M>`, `reviewer:<persona>` × N
- body with AC bullets + parent link

The `wf:ready` label is the **dispatch hook** for the VP-of-Engineering
CCR routine (PR C). That routine (running in the operator's claude.ai
account) reacts to the `issues.labeled` event and picks the next ready
child to implement.

## State diagram

```
UNDECOMPOSED ──Maya: post proposal──▶ AWAITING_OPERATOR
                                            │
                            ┌──── operator: 👍 ────┐
                            │                       │
                            ▼                       │
                       APPROVED                     │
                            │                       │
        Maya: create children + link sub-issues     │
                            │                       │
                            ▼                       │
                       DECOMPOSED ◀──no further action
                            ▲
                            │
                            └─── (terminal) once children exist
```

`AWAITING_OPERATOR` can also loop back to `UNDECOMPOSED` if the operator
deletes the proposal comment (Maya treats absence-of-proposal as
UNDECOMPOSED).

## Per-run guard rails

Hard-coded in `workforce/skills/pdm-decompose/handler.ts`:

| Env var | Default | Why |
|---|---|---|
| `PDM_GH_OWNER` | `refluster` | Single-tenant repo for v1. |
| `PDM_GH_REPO` | `ai-native-article` | Same. |
| `PDM_MAX_EPICS` | `5` | Caps Anthropic calls per run (Opus is expensive). |
| `PDM_MAX_CHILDREN` | `8` | An epic proposing > 8 children is probably too big; surface for split. |

If Maya hits the per-run cap, she processes the next batch on tomorrow's run.

## Failure modes

| Symptom | Investigate | Fix |
|---|---|---|
| RUN.status=throw with "github 401" | Token in `wf/github` expired or rotated | Rotate the secret. Maya retries on next tick. |
| RUN.status=throw with "anthropic 529" | Anthropic overloaded | Auto-recovers; no action. |
| RUN.status=throw with "stop_reason=max_tokens" | Proposal too large for 4000 token cap | Inspect the epic — usually the workstreams section is too verbose. Split the epic or trim the section, then retry. |
| Proposal comment posted but children not created on next run | Operator hasn't 👍'd yet | Check the proposal comment, react 👍 if it looks good. |
| Children created but missing sub-issue link | `sub_issues` REST endpoint not available on the repo | Inspect manually; link via UI if needed. The handler tolerates this (children still have parent link in body). |
| Two proposal comments on the same epic | Operator deleted the first, Maya re-proposed | Pick whichever you'll approve; ignore/delete the other. |

## Telemetry

Each run writes:
- a RUN row to DDB with `output_summary` = `pdm-decompose: undecomposed=N, awaiting_operator=M, decomposed=K, ...`
- the full `ScanOutput` JSON to S3 under the standard run artefact prefix (`runs/{slug}/{run_id}/output.json`)

Sweep CloudWatch for `event:tick-complete` JSON logs and look at the
`dispatched` array — `{slug:"maya", skill:"pdm-decompose"}` confirms a
fire. RUN row carries the result.
