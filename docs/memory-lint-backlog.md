# Memory → Lint Promotion Backlog

**Layer:** L2 registry (this file is data; `scripts/check-governance-registries.mjs` keeps its table well-formed — R-12).
**Decision record:** [ADR-0001](adr/adr-0001-self-driving-governance-mechanisms.md) (the memory→lint ratchet, Engine A).
**Audience:** the operator, and any agent running a governance retrospective (governance.md §6).

---

## 0. What this is

A rule that gets **violated twice is no longer a memory item — it is a missing
mechanical check.** This backlog is the audit trail for that promotion: it records
every recurring failure mode, how many times it has bitten us, and whether it has
been promoted to an enforced regulation (an `R-NN` row in governance.md §4), accepted
as a tolerated risk (a row in [risk-acceptance-ledger.md](risk-acceptance-ledger.md)),
or is still being watched.

Without this file, the same class of bug returns and the fix is re-discovered from
scratch each time. With it, "why does this lint exist?" always has an answer.

## 1. Promotion rule

> A backlog entry is **promoted to an `R-NN` regulation** when it has been
> **violated ≥ 2 times within 90 days**, OR when it has sat in `watching` for
> ≥ 6 months without revision (stability — the rule is real, just rarely tripped).

When an incident reveals a new failure mode:

1. **Append a row** to §3 with `Status: watching` and `Count: 1` (cite the incident ref — a commit SHA, issue, or date).
2. On the **second** occurrence inside 90 days, bump `Count`, set `Status: accepted`, and open a PR that adds the lint/guard. Set `Promoted via` to the `R-NN` id once it lands.
3. If the failure mode is **not worth a machine check** (too rare, too costly to detect, intrinsically a judgment call), set `Status: declined` and add a one-line reason — or move it to the risk-acceptance ledger instead.

This is the §6 "governance retrospective" loop made into a durable ledger rather than a one-time doc edit.

## 2. Status vocabulary

| Status | Meaning |
|---|---|
| `watching` | Seen once. Recorded so a second occurrence is recognised, not re-discovered. |
| `accepted` | Crossed the threshold (≥2 in 90d, or ≥6mo stable). A lint/guard is owed; `Promoted via` names it once it lands. |
| `promoted` | The lint/guard is live in CI/hooks. `Promoted via` points at the `R-NN` id. |
| `declined` | Deliberately not mechanised. The reason lives in the row; consider the risk-acceptance ledger instead. |

## 3. Backlog

<!-- registry:memory-lint columns: ID | Rule | Incidents | Count | Status | Promoted via -->

| ID | Rule | Incidents | Count | Status | Promoted via |
|---|---|---|---|---|---|
| ML-001 | A truncated article body must never reach gh-pages; generation must fail loud on `finish_reason==='length'`. | d17e1d58ec42 (2026-05-03) | 1 | promoted | R-3 / R-4 / R-5 (runtime throws) + R-10 (pre-deploy gate) |
| ML-002 | An edit to an L1 framework law must announce itself (cite the doc or opt out), so undocumented rule drift can't ship. | azure-budget bracket was undocumented when the L2 truncation bug landed (2026-05-03) | 1 | promoted | R-11 (L1 citation gate) |
| ML-003 | Prompts inline in `Code.gs` hide content-generation diffs inside unrelated function changes; they should be extracted to versioned files. | design-policy.md §2 declared the commitment (2026-05-16); not yet executed | 1 | watching | — |
| ML-004 | A `routeKey` added to `agents-api/handler.ts` must ship with a matching `HttpApi` event in `workforce/infra/sam/template.yaml`; otherwise the route 404s in prod while every check stays green (`check-api-routes.mjs` compares template↔live, not handler↔template). | PR #274 added `GET /stats` to the handler only; console-wide outage 2026-06-10 | 1 | watching | — |
| ML-005 | A consumer that hardcodes a legacy `wf/{provider}` secret name must move to the Epic-010 typed credential (`wf/projects/…`) resolution; a consumer left on the bare name fails only at runtime — and on an async path, silently from the operator's seat — once the migration's deletion window closes. | `llm-anthropic.ts` hardcoded `getSecret("wf/anthropic")` while Epic-010 §6 moved the key to `wf/projects/_default/anthropic.api_key`; second `/messaging` no-reply incident 2026-06-10 (fix: tiered resolution, PR #281) | 1 | watching | — |
| ML-006 | The R-5/R-10 truncation heuristic must treat a trailing emphasis-close (`*…。*` italic byline) as a complete ending; a terminal-glyph set that omits `*`/`_` turns every persona-byline article into a false C-1 violation and blocks all deploys. With the GAS cron paused, the generation path (workforce article-level2/3) must carry the same cut-off guard at publish time, or truncation is only caught at R-10 where one bad body blocks the whole site deploy. | e7fc028993e1 byline `*Elena は…ご確認ください。*` flagged as truncated; deploy runs #469/#470/#485 red 2026-06-10/11 (fix: unwrap trailing `[*_]+` before the glyph test, in truncation.mjs + Code.gs together; W-1 cut-off guard added to article-level2/3 publish-notion.mjs importing the canonical lib) | 1 | watching | — |
