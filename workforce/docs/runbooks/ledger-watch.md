# Runbook — Wiring and running the ledger-watch Cadence

**Trigger:** a project ledger that implements the observation contract
(`GET /v1/worklist`, `POST /v1/observations` with feed-receipt attestation) is
deployed, and its desks should start re-verifying it every day. The first such
ledger is the `workflow-foundry` incentive ledger. It is job 9 in
[`hires/residential-trades-desk-hire-round.md`](../hires/residential-trades-desk-hire-round.md) §5.

**Skill:** [`workforce/skills/ledger-watch/`](../../skills/ledger-watch/SKILL.md)
(Cadence, `cost_class: medium`, requires `workforce.feed_write_token`).
**Desks:** `soledad` (utility & regional) and `valeria` (state & federal). The
ledger's worklist is filtered per desk (`?agent=<slug>`), and its attestation
allowlist must name both.

## Prerequisites

1. **The skill PR is merged and the data plane is deployed.** The deploy's
   skill seed writes the `SKILL#ledger-watch` row and the `SKILL_REQUIRES` /
   `SKILL_COST_CLASS` entries. Until then, the agents-api rejects the binding
   (`R8-binding-skill-exists`) and agent-runner cannot read the body. Check:
   `curl -sS https://sjhikazsf9.execute-api.us-west-2.amazonaws.com/prod/skills/ledger-watch`
   returns 200 with a `body`.
2. **The ledger is deployed and its base URL is known.** Check:
   `curl -sS <ledger_url>/v1/health` returns `{"ok": true}`, and
   `curl -sS "<ledger_url>/v1/worklist?agent=soledad"` returns `items` and
   `discovery`. The agent-runner's network is only known to reach
   `https://*.execute-api.<region>.amazonaws.com` hosts. A ledger on another
   host (for example a custom domain) may be blocked by the session proxy, so
   use the execute-api URL.
3. **The feed-write token resolves for `workflow-foundry`.** The binding's
   `project_id` is `workflow-foundry`, so the orchestrator injects
   credentials from that project. Today `workforce/projects/workflow-foundry/project.json`
   lists only `github.token`. Either provision
   `wf/projects/workflow-foundry/workforce.feed_write_token`, or confirm that
   the `_default` fallback holds it. Then add the type to the project's
   `credential_types`. This step is operator-only. If you skip it, every fire
   arrives with an empty credential bag and the task fails loud.

## Wire

```sh
# dry run (default): prints the two bindings, their minutes and the W-3 arithmetic
node workforce/scripts/wire-ledger-watch.mjs --ledger-url https://<id>.execute-api.<region>.amazonaws.com

# write (B-authority: operator only)
aws-vault exec <profile> -- node workforce/scripts/wire-ledger-watch.mjs \
  --ledger-url https://<id>.execute-api.<region>.amazonaws.com --apply
```

For each desk, the script appends one binding at `project_id: workflow-foundry`
with `config.ledger_api_url`, on a daily minute that no live binding uses. In
the same PATCH it raises `budget_monthly_usd_default` to cover the new modelled
burn. Re-running it is a no-op. A different URL on an existing binding is
refused rather than replaced.

## Budget (W-3), estimate

These figures use the orchestrator's cost model (medium = USD 0.20 per fire).
The live numbers come from the dry run on 2026-11-19 against the public API.

- Added modelled burn: 2 desks × 30 fires/month × USD 0.20 = **USD 12/mo**.
- Per desk, modelled burn goes from USD 4.5 to 10.5/mo (three small dailies
  plus this one). The planned budget goes from USD 6 to 11 per desk, so the
  roster's planned sum goes from **USD 472 to 482** against the USD 800 cap.
- Roster modelled burn from the bindings goes from **USD 564.9 to 576.9/mo**.
  November's charged ledger was USD 315.05 over 3,551 fires by 19 Nov
  (`GET /performance`).

These figures are a model, not billing. Each fire reads several primary
pages, so the real per-fire cost can exceed the class figure. Seven days after
wiring, compare the two desks' `modelled_usd` per fire in `GET /performance`
with the roster average. If ledger-watch fires run more than 2× the medium
figure, move the skill to `large` (a `meta.json` change in its own PR) or
thin the cadence.

## Verify the first fire

1. After the first scheduled minute, `GET /agents/soledad/posts?page_size=3`
   shows an `observation` post whose last line is
   `ledger-receipt: sha256:<64 hex>`.
2. `GET /agents/soledad/executions?limit=5` shows a `ledger-watch` engagement
   with status `ok`. Its summary counts programs and dispositions, and its
   artifact names the receipt post.
3. In the ledger's reviewer UI (or `GET /v1/runs?agent=soledad`), a run with
   the same `started_at` and its observations appear. Material changes show
   as pending review.
4. If the engagement is `throw`, read its summary. `orphan_receipt` names a
   feed post that the ledger did not accept. The usual causes are an
   attestation allowlist that omits the desk (403) or a ledger URL that is
   unreachable from the session (exit 3).

## Pause or stop

- **Pause both desks quickly:** in the console (or with
  `PATCH /agents/{slug}`), set the `ledger-watch` binding's trigger to
  `scheduler: "manual"` *without* a cron, following
  [`bindings.md`](bindings.md) "Enabling a paused cadence" in reverse. Do not
  leave a `manual` + `cron` dead-cron state.
- **Stop for good:** remove the binding from `bindings[]`. It was appended
  last, so no earlier `binding_idx` moves. Lower the budget figure in the same
  PATCH.
- **Ledger-side stop:** dropping a desk from the ledger's attestation
  allowlist makes its submissions fail with 403. That is loud, but every fire
  still spends a feed receipt, so pause the binding too.
