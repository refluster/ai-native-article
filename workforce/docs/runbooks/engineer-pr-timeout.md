# Runbook — Engineer PR timeout

**Symptom.** A DDB row `AGENT#ren/DELIV#{ulid}` has `status=timeout` and `error_message="no PR appeared within 1440min"`. The orchestrator-tick CloudWatch logs show a `engineer-pr-timeout` line for the same `deliv_id`.

**What it means.** The runner dispatched Ren's engineering routine via `workflow_dispatch` on `workforce-engineer-routine.yml`, and the orchestrator's 5-minute poll has not seen a PR on the `dispatch_branch` for >24 hours. The R-N1 exception path failed silently — this runbook recovers it without losing the brief.

## Triage

1. **Look at the workflow run.** Open `.github/actions/runs` filtered by `workforce-engineer-routine.yml`, find the run whose inputs include this `task_id`. Three outcomes:
   - **No run exists.** The `workflow_dispatch` failed. Causes: `wf/github` PAT lacks `actions:write` on the target repo, workflow disabled, ref doesn't exist. Fix the token/scope/ref, then **re-trigger** (see "Recover" below).
   - **Run failed.** Read the failed step. Most common: `ANTHROPIC_API_KEY` GitHub Secret missing or revoked, or Claude Code action version drift. Fix the secret/action and re-trigger.
   - **Run succeeded but no PR was created.** Claude Code may have decided the brief was infeasible. Read the run logs and the brief in S3 (`pr-briefs/ren/{deliv_id}.md`). Decide whether to revise the brief and re-trigger, or mark the timeout as expected.

2. **Read the brief.** `aws s3 cp s3://wf-bucket-{acct}-{stage}/pr-briefs/ren/{deliv_id}.md -` — gives the exact text Ren produced. If the brief is wrong-shaped (vague, multi-PR, off-policy), Ren's `system.md` may need a tightening bump (separate Rule-11 PR).

3. **Check the budget.** If timeouts cluster around month-end, the LLM call that produced the brief may have throttled or been guard-tripped before producing usable text. Run `aws dynamodb get-item --table-name wf-table-{stage} --key '{"pk":{"S":"BUDGET#{yyyy-mm}"},"sk":{"S":"AGENT#ren"}}'` to confirm.

## Recover

### Option A — re-trigger the same brief

Use when the brief is sound and the failure was infrastructural (missing secret, action drift, transient network).

```bash
gh workflow run workforce-engineer-routine.yml \
  --repo refluster/ai-native-article \
  -f brief="$(aws s3 cp s3://wf-bucket-{acct}-{stage}/pr-briefs/ren/{deliv_id}.md -)" \
  -f task_id={deliv_id} \
  -f branch=ren/{deliv_id}
```

Then flip the DELIV row back to `pending` so the orchestrator picks it up again:

```bash
aws dynamodb update-item \
  --table-name wf-table-{stage} \
  --key '{"pk":{"S":"AGENT#ren"},"sk":{"S":"DELIV#{deliv_id}"}}' \
  --update-expression "SET #s = :p, dispatched_at = :now REMOVE error_message" \
  --expression-attribute-names '{"#s":"status"}' \
  --expression-attribute-values "$(printf '{":p":{"S":"pending"},":now":{"S":"%s"}}' "$(date -u +%Y-%m-%dT%H:%M:%SZ)")"
```

The orchestrator's next tick will see it as pending and poll again.

### Option B — abandon and let Ren retry on his next cron

Use when the brief is wrong and you don't want to re-run the same one. Leave the DELIV row as `status=timeout` (history kept). Ren's next weekday-09:00-JST tick will produce a fresh brief from current memory — but it may produce the same broken brief. **Edit `workforce/agents/ren/system.md`** to tighten the brief-shape guidance, ship it as a Rule-11 PR (Ren prompt_version bump), then let the next tick run.

### Option C — pause Ren

Use when the infra failure is unbounded (e.g. action breaking change, repo permissions overhaul).

```bash
awscurl --service execute-api --region us-west-2 \
  -X PATCH "$(aws cloudformation describe-stacks --stack-name wf-data-plane-{stage} \
    --query 'Stacks[0].Outputs[?OutputKey==`AgentsApiUrl`].OutputValue' --output text)/agents/ren" \
  -d '{"paused": true}'
```

The orchestrator skips Ren until the operator flips `paused: false`.

## Prevention checklist

Before enabling Ren in prod (`paused: false` for the first time):

- [ ] `wf/github` PAT has `actions:write` + `pull_requests:write` + `contents:write` on `refluster/ai-native-article`.
- [ ] GitHub Secret `ANTHROPIC_API_KEY` is set on this repo and not expired.
- [ ] `.github/workflows/workforce-engineer-routine.yml` exists on `main` (this workflow is dispatched against `main` by default).
- [ ] The Claude Code action version pinned in `workforce-engineer-routine.yml` is current (check the action's release notes monthly).
- [ ] One successful end-to-end smoke (Ren's tick → brief → workflow → PR → poll promotion to `ok`) has run on `dev`.
