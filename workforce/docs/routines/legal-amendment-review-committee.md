# `legal-amendment-review-committee` — Governance-amendment review committee (routine spec)

**Skill type**: deliberative review (comment-only).
**Executor**: `claude-code-routine` · **Scheduler**: `manual` (declarative-pending — invoked
conversationally as a sub-agent today; future CCR API trigger). **No cron.**
**Chair / owner**: `maya`. **Bound project**: `asp-cloud`.
**Purpose**: convene the VP-tier-and-above committee to review a proposed amendment to the
**bound project's** governance document(s), render an APPROVE / REJECT recommendation, and on
REJECT organise the follow-up items needed to reach APPROVE. Posts one `event: COMMENT` review
to the target PR. **Never** approves, requests-changes, or merges (W-5 / R-N9).

This file is the binding's load-bearing `routine_spec` (per
[runbooks/bindings.md](../runbooks/bindings.md) — `claude-code-routine` + `manual`). The full
task contract — committee composition, recall packet, verdict shape, skip rule, write step, and
guardrails — lives in the skill body:
[`workforce/skills/legal-amendment-review-committee/SKILL.md`](../../skills/legal-amendment-review-committee/SKILL.md).

## Composition contract

When `maya` invokes this skill, the working prompt is composed as:

```
1. Generic skill spec   ← workforce/skills/legal-amendment-review-committee/SKILL.md
                          (committee protocol, verdict format, skip rule)
2. Persona voice        ← maya's system prompt (chair's voice)
3. Invocation args      ← { project_id: "asp-cloud", pr: <number> } and the amendment
                          named by the operator ("具体的な変更内容は都度指示")
```

The committee roster (VP tier and above + co-opted experts) is resolved **dynamically by
tier** at invocation — see SKILL.md § "Committee composition". Do not hard-code names here.

## Trigger

Operator-invoked. There is no scheduled fire. The operator supplies the target PR and the
amendment under review per session; the chair (`maya`) runs the deliberation and the bundled
`post-review.mjs` performs the single comment-only write.

## Binding (applied on `maya`'s `AGENT#maya/META` via agents-api PATCH, per ADR-0007)

```jsonc
{
  "skill": "legal-amendment-review-committee",
  "executor": "claude-code-routine",
  "trigger": { "scheduler": "manual" },
  "routine_spec": "workforce/docs/routines/legal-amendment-review-committee.md",
  "project_id": "asp-cloud",
  "note": "VP-tier+ committee; reviews asp-cloud governance amendments; comment-only (W-5)."
}
```

> Wiring the binding (the agents-api write) and sharing `github.token` into `asp-cloud`'s
> credential bag are the operator's out-of-band steps — agents author the skill + spec; the
> operator owns the binding and the secret.
