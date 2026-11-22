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

**Trust limit (FU-042).** The attestation is a feed receipt, and the feed
accepts it from any holder of the team-shared `workforce.feed_write_token`,
taking `agent_slug` from the request body. The receipt therefore proves that
*someone with the shared capability* posted under a desk's slug, not that the
desk did. The ledger's auto-applied types (`verified_no_change`,
`unconfirmed`, `note`, `budget_signal`) rest on that alone, and the slug allowlist is not an identity
control until the receipt is bound to the caller (per-desk token, or the feed
recording the token principal). Until FU-042 lands, the ledger side should
treat `verified_no_change` as time-boxed or review-queued, and an operator
auditing a suspicious reset should check the feed post's origin, not the slug.

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
   credentials from that project. `getCredential`
   (`workforce/lambdas/shared/project.ts`) resolves a type in this order, and
   only a not-found falls through to the next tier:
   1. `wf/projects/workflow-foundry/workforce.feed_write_token` (canonical),
   2. `wf/projects/_default/workforce.feed_write_token` (shared fallback;
      logs `legacy_credential_read` and counts `WfLegacyCredentialReads`),
   3. `wf/workforce.feed_write_token` (legacy bare path, same metric).

   The project-scoped secret at tier 1 is the prerequisite. A fire that
   resolves through tier 2 or 3 still works, but it shows up in the legacy
   metric and should be moved. Today `workforce/projects/workflow-foundry/project.json`
   lists only `github.token` in `credential_types`; add
   `workforce.feed_write_token` there. This step is operator-only. If no tier
   holds the token, the credential bag arrives empty and the task fails loud.

## Deploy order for contract v1.1 (skill 0.2.0)

Skill 0.2.0 uses the ledger contract v1.1 (the ledger's `API.md` §5):
change type `unconfirmed`, `run.fetch_failures[].program_code`,
`run.discovery_mode`, and the worklist's `retry` / `needs_human` items and
`discovery.seed_urls`. **Deploy the ledger first, then merge this skill.**

- A v1.0 ledger rejects `unconfirmed` and an unknown `fetch_failures` key.
  `post.mjs` refuses to post a payload that uses either one to a ledger that
  does not advertise v1.1 (exit 3, before any feed post). It treats the
  ledger as v1.1 when the worklist carries `contract_version` ≥ 1.1 or, until
  the ledger sends a version, `discovery.seed_urls`. So the wrong order costs
  a day of `throw` engagements, not orphan receipts.
- A 0.1.x payload is accepted by a v1.1 ledger (API.md §5.5), so the ledger
  can go first with no gap.
- **Contract handshake.** `post.mjs` reads `contract_version` from the
  worklist. If it is absent, the script prints one warning line and goes on.
  If its major differs from `LEDGER_CONTRACT_MAJOR` in
  `ledger-payload.mjs`, the run stops with exit 3 before any feed post. The
  check only bites once the deployed ledger returns `contract_version` (its
  v1.1 change returns `"1.1"` from `/v1/worklist` and `/v1/health`). After
  the ledger deploy, confirm with
  `curl -sS "<ledger_url>/v1/worklist?agent=soledad&limit=1"`: the answer
  should carry `contract_version` and `discovery.seed_urls`. The ledger
  raises the major only for a change that invalidates current payloads. When
  that happens, change `ledger-payload.mjs` and `LEDGER_CONTRACT_MAJOR` in a
  skill PR merged right after the ledger deploy.

## `needs_human` and `retry` (what the operator sees)

- The ledger sets `needs_human` on a program when a desk reported it
  `unconfirmed` (the page loaded but did not settle the row), or when its
  sources failed on 2 fires in a row (`source_blocked`). The desks do not
  work around a blocked site, so these rows wait for a person.
- While `needs_human` is set, the program leaves the daily worklist. It
  comes back once every 7 days (`NEEDS_HUMAN_RETRY_DAYS`) marked
  `retry: true`. The desk tries once and reports `unconfirmed` again or the
  fetch failure. Repeats of the same wording are expected, not a fault.
- To clear one: open the page yourself and post a reviewer
  `verified_no_change` with the URL and the words you read (ledger API §5.3),
  approve a pending change, or hand-edit the program with
  `clear_needs_human: true`. The list is in the ledger's summary
  (`counts.needs_human`, `needs_human[]`) and `GET /v1/programs?needs_human=true`.
- Discovery: `GET /v1/summary` shows each desk's `last_discovery`. A desk
  with none for 7 days means discovery keeps being skipped. Read the
  `run.note` of its recent runs for the reason.

## Fire one binding on demand (for a check)

The orchestrator Lambda (`wf-orchestrator-prod`, `WfOrchestratorFunction`
in `workforce/infra/sam/template.yaml`) accepts an explicit single-binding
event (adr-0025, `handleDispatch` in `workforce/lambdas/orchestrator/handler.ts`).
It skips the cron scan and fires that one binding through the normal CCR
path, with the binding's project credentials attached by the orchestrator:

```sh
# B-authority: operator credentials. Find binding_idx in GET /agents/<slug>
# (the ledger-watch binding was index 3 for both desks on 2026-11-22).
aws-vault exec <profile> -- aws lambda invoke --region us-west-2 \
  --function-name wf-orchestrator-prod --invocation-type Event \
  --cli-binary-format raw-in-base64-out \
  --payload '{"dispatch":{"agent_slug":"soledad","binding_idx":3,"reason":"ledger-watch 0.2.0 check","requested_by":"operator"}}' \
  /dev/stdout
```

- The payload shape is `OrchestratorDispatchEvent` (`shared/dispatch.ts`):
  `agent_slug` (non-empty) and `binding_idx` (integer ≥ 0) are required;
  `reason` and `requested_by` are audit-only. It is the same body agents-api's
  `POST /dispatch` (`dispatchBindingRoute`) sends after its own checks.
- The orchestrator re-reads the binding and refuses (logs `dispatch-refused`,
  fires nothing) when the agent is archived or paused, the index is out of
  range, or the binding is not orchestrator-owned CCR (`scheduler: external`,
  `invoked_by: api`). A binding paused to `scheduler: "manual"` cannot be
  fired this way.
- The tick's dedup window is not applied, so this can fire a binding that
  already ran today. Each fire spends one feed receipt and one medium fire
  (USD 0.20 modelled).
- Look for `ccr-dispatch-fired` (with `session_url`) or `ccr-dispatch-error`
  in `/aws/lambda/wf-orchestrator-prod`, then verify as below.
- **Pasting this JSON into a runner session does nothing useful.** The
  session has no AWS access, and the task's credentials (the feed-write
  token) are attached by the orchestrator when it prepares the task. A
  session that "runs" the binding by hand has no token and no ledger URL
  from the binding config.

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
   unreachable from the session (exit 3). A "possible orphan receipt
   sha256:…" means the feed POST failed in a way that may have stored the
   post (network error, timeout or 5xx). Search
   `GET /agents/<slug>/posts?page_size=10` for a body ending in
   `ledger-receipt: sha256:<that hash>`. If it is there, it is a stray
   receipt the ledger never saw.
5. From 0.2.0, the run in `GET /v1/runs` carries `discovery_mode`
   (`search`, `seed_pages` or `skipped` with the reason in `note`).

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
