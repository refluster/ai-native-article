# Runbook — Ren end-to-end smoke test

Verify that the full Ren PR path works end-to-end:
`wf-agent-runner` → LLM brief → S3 upload → GHA `workflow_dispatch` → draft PR.

Run this before enabling Ren in prod for the first time, and after any change to
`workforce/lambdas/agent-runner/`, `workforce/lambdas/shared/github.ts`, or
`workforce-engineer-routine.yml`.

---

## Prerequisites

All items from the [engineer-pr-timeout.md prevention checklist](engineer-pr-timeout.md#prevention-checklist) must be satisfied:

- [ ] `wf/github` Secrets Manager entry (region `us-west-2`) contains a PAT with
  `actions:write` + `pull_requests:write` + `contents:write` on `refluster/ai-native-article`.
- [ ] GitHub Secret `ANTHROPIC_API_KEY` is set on this repo and not expired.
- [ ] `.github/workflows/workforce-engineer-routine.yml` exists on `main`.
- [ ] The Claude Code action version pinned in `workforce-engineer-routine.yml` is current.
- [ ] Operator pre-flight secrets exist (see Phase 3 ROADMAP item): `wf/anthropic`,
  `wf/notion`, `wf/github`.

Run on `dev` stage first; never promote to `prod` until `dev` passes.

---

## Phase 1 — Dry run (no LLM call)

A dry run verifies agent config is loadable, the binding resolves, and the monthly
budget guard passes — without spending tokens or dispatching GHA.

```bash
STAGE=dev   # or prod once dev passes

aws lambda invoke \
  --function-name "wf-agent-runner-${STAGE}" \
  --invocation-type RequestResponse \
  --cli-binary-format raw-in-base64-out \
  --payload '{"agent":"ren","binding_idx":0,"dryRun":true}' \
  /tmp/ren-dry.json \
  --region us-west-2

cat /tmp/ren-dry.json
```

**Expected response:**
```json
{"status":"ok","run_id":"<ulid>","tokens_in":0,"tokens_out":0,"cost_usd":0}
```

If `status` is not `"ok"`, check `error_message`:
- `agent_not_found` → the DDB `AGENT#ren/META` row is missing; run seed-agents.
- `binding_idx 0 not found` → `agent.json` was not loaded from S3/DDB; check seed.
- `paused` → Ren is paused; run `PATCH /agents/ren {"paused":false}` via `wf-agents-api`.
- `budget_exceeded` → month-to-date spend is at the cap; wait for month rollover
  or raise `budget_monthly_usd` temporarily.

---

## Phase 2 — Full run (LLM brief + GHA dispatch)

```bash
STAGE=dev

aws lambda invoke \
  --function-name "wf-agent-runner-${STAGE}" \
  --invocation-type RequestResponse \
  --cli-binary-format raw-in-base64-out \
  --payload '{"agent":"ren","binding_idx":0}' \
  /tmp/ren-run.json \
  --region us-west-2

cat /tmp/ren-run.json
```

**Expected response:**
```json
{
  "status": "ok",
  "run_id": "<run-ulid>",
  "deliv_id": "<deliv-ulid>",
  "tokens_in": <N>,
  "tokens_out": <M>,
  "cost_usd": <X>
}
```

Note the `deliv_id` — you'll need it for the S3 and PR checks below.

Common failures:
- `skill_load_failed` → the `code-task-brief` skill folder is missing or malformed;
  check `workforce/skills/code-task-brief/`.
- `github workflow_dispatch 404` → the `ENGINEER_WORKFLOW` env var does not match an
  actual workflow filename. See [Gap note](#gap-note) below.
- `github workflow_dispatch 422` → the workflow does not have a `workflow_dispatch`
  trigger, or the `inputs` schema does not match.
- CloudWatch Logs `/aws/lambda/wf-agent-runner-${STAGE}` stream — grep for `runId`.

---

## Phase 3 — Verify brief in S3

```bash
DELIV_ID=<deliv-ulid from phase 2>
STAGE=dev
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REGION=us-west-2

aws s3 cp \
  "s3://wf-bucket-${ACCOUNT}-${REGION}-${STAGE}/pr-briefs/ren/${DELIV_ID}.md" \
  - | head -40
```

**Expected:** a non-empty Markdown document with a heading, context, acceptance
criteria, and test plan — shaped by `workforce/skills/code-task-brief/SKILL.md`.

If the file is missing, the `writeDeliverableArtefact` call failed before the
GHA dispatch. Check CloudWatch Logs for an S3 `PutObject` error.

---

## Phase 4 — Verify GHA workflow was dispatched

Check the GitHub Actions runs list for `workforce-engineer-routine.yml`:

```bash
gh run list --workflow workforce-engineer-routine.yml --repo refluster/ai-native-article \
  --limit 5
```

A new run triggered within the last few minutes should appear with `status=in_progress`
or `status=completed`. The `branch` column should be `ren/<DELIV_ID>`.

If no run appears within 2 minutes of the Lambda invocation:
1. Check `wf/github` PAT scope (`actions:write` required).
2. Check CloudWatch for `github workflow_dispatch` error logs.
3. Check that `workforce-engineer-routine.yml` exists on the `ref` branch (`main`).

---

## Phase 5 — Verify draft PR appears

Within ~30 minutes of the GHA run starting (time varies with Claude Code session
startup), a draft PR should appear on `refluster/ai-native-article` with:
- head branch: `ren/<DELIV_ID>`
- base: `main`
- draft: `true`

```bash
gh pr list --repo refluster/ai-native-article --head "ren/${DELIV_ID}" --state open
```

If no PR appears within 1 hour:
- Check the GHA run log for the `workforce-engineer-routine.yml` run.
- Most common causes: `ANTHROPIC_API_KEY` secret missing, Claude Code action version
  incompatibility, brief was too vague for the routine to scope a single PR.
- See [engineer-pr-timeout.md](engineer-pr-timeout.md) for full recovery options.

---

## Smoke test passed criteria

The smoke test is **complete and passing** when all five hold:

| Check | Passed when |
|---|---|
| Dry run | Response `status=ok`, `tokens_in=0` |
| Full run | Response `status=ok`, non-null `deliv_id` |
| Brief in S3 | Non-empty `.md` at `pr-briefs/ren/<deliv_id>.md` |
| GHA dispatched | A `workforce-engineer-routine.yml` run with `branch=ren/<deliv_id>` |
| Draft PR | A draft PR on `ren/<deliv_id>` within 60 minutes of dispatch |

Once all five pass on `dev`, repeat on `prod`.

---

## Gap note — DELIV row removed in Epic-010 C2 cutover

The original design had the orchestrator poll `AGENT#ren/DELIV#{ulid}` and
flip its status to `ok` once a PR appeared. That DELIV row write was removed
in the Epic-010 C2 cutover (`handler.ts` line 428–434). The correlation trail
is now:

- `wf-agent-runner` CloudWatch Logs (`/aws/lambda/wf-agent-runner-${STAGE}`) —
  run_id + deliv_id + GHA dispatch confirmation.
- GHA workflow run logs (`workforce-engineer-routine.yml`) — Claude Code session.
- PR on `ren/<deliv_id>` — terminal success signal.

FU-NEW-G tracks adding `dispatch_branch` + pending/ok status to the EXEC row
family so the orchestrator (and the audit Lambda) can resume polling-based
promotion once that story lands.
