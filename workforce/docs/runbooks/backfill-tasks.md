# Runbook — `wf-backfill-tasks` (one-shot)

The Lambda that fills `project_id` on existing `TASK#{ulid}/META` rows that pre-date Epic-010 Story 1-B. Operator-invoked, idempotent across re-runs.

See [Epic-010 §3](../epics/epic-010-project-trust-boundary.md) for why this exists, and [data-model.md "Task rows"](../data-model.md#task-rows) for the row shape.

## When to run

- **First production rollout of Story 1-B**: invoke once. If the table has no TASK rows yet (likely — orchestrator does not currently create TASK rows), the Lambda is a no-op that just emits zero-valued metrics.
- **After any future schema change** that introduces TASK rows without `project_id`: re-invoke. Backfill is replayable.

You do NOT need to run this on every deploy. It is not wired to any schedule; it has no EventBridge rule.

## How to run

```bash
STAGE=prod
REGION=us-west-2

aws lambda invoke \
  --function-name wf-backfill-tasks-$STAGE \
  --region $REGION \
  --cli-binary-format raw-in-base64-out \
  --payload '{}' \
  /tmp/wf-backfill-tasks.json && cat /tmp/wf-backfill-tasks.json | jq .
```

Expected output (no TASK rows yet):

```json
{
  "scanned": 0,
  "backfilled": 0,
  "already_backfilled": 0,
  "skipped_missing_agent_slug": 0,
  "errors": []
}
```

Expected output (after TASK rows exist + this is the first backfill):

```json
{
  "scanned": 42,
  "backfilled": 42,
  "already_backfilled": 0,
  "skipped_missing_agent_slug": 0,
  "errors": []
}
```

Expected output (idempotent re-run):

```json
{
  "scanned": 42,
  "backfilled": 0,
  "already_backfilled": 42,
  "skipped_missing_agent_slug": 0,
  "errors": []
}
```

## What it does

1. Scans the table for items where `pk` starts with `TASK#` and `sk = "META"`.
2. For each row missing `project_id`:
   - If `agent_slug` is set: writes `project_id = "self/{agent_slug}"` via conditional `UpdateItem` (`attribute_not_exists(project_id)`).
   - If `agent_slug` is missing: skips and logs `backfill_task_skipped` with reason `missing_agent_slug`. These rows need operator inspection — they're malformed.
3. Emits three CloudWatch metrics under namespace `Workforce/Backfill` dimensioned by `Stage`:
   - `WfBackfilledTaskRows` — rows this run actually updated
   - `WfAlreadyBackfilledTaskRows` — rows already filled (concurrent run OR re-invocation)
   - `WfBackfillErrors` — rows that errored (not the conditional-check race; real errors)
4. Logs a structured `backfill_complete` event with the result summary.

## Idempotency

The `UpdateItem` is guarded by `ConditionExpression: attribute_not_exists(project_id)`. Re-running over already-filled rows triggers `ConditionalCheckFailedException`, which the handler interprets as "another run already did this" and counts under `already_backfilled`. Safe to invoke twice concurrently; safe to re-invoke after a partial failure.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `errors[]` populated | Non-CCF DDB write failure (throttle, IAM, etc.) | Inspect logs; re-run after addressing |
| All rows fall into `skipped_missing_agent_slug` | TASK schema drifted; rows missing `agent_slug` | Inspect a few rows manually; decide whether to amend the Lambda's default-derivation logic |
| `scanned` ≫ `backfilled + already_backfilled + skipped_missing_agent_slug` | Implementation bug | File issue; the totals should always add to `scanned` |

## After Story 1-B

This Lambda stays in the SAM template indefinitely as a small, free-at-rest safety net for any future TASK schema change. It can be removed once no future schema change is expected to introduce TASK rows without `project_id` — but that's a forward decision, not a current one.
