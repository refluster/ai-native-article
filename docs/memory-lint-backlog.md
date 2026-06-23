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
| ML-005 | A non-test caller that passes a literal `wf/...` name to `getSecret`/`getSecretRaw` is a credential-resolution bypass: it skips the Epic-010 typed→`_default`→legacy tiering (`project.ts getCredential` / `llm-anthropic resolveAnthropicApiKey`) and so fails only at runtime — silently, on an async path — once the migration deletes the bare key. Candidate gate when it recurs: grep `getSecret(Raw)?\(["']wf/` outside `shared/{secrets,project,llm-anthropic}.ts` + `*-tests.ts`. | `llm-anthropic.ts` hardcoded `getSecret("wf/anthropic")` while Epic-010 §6 moved the key to `wf/projects/_default/anthropic.api_key`; the bare secret was never (re)stored, so every Lambda-side `complete()` (messaging-reply, memory-compactor) threw at key-read — the second `/messaging` no-reply, root-caused from prod logs via the #284 diagnostic and fixed by tiered resolution (PR #281) + operator storing the typed secret 2026-06-10 | 1 | watching | — |
| ML-006 | The R-5/R-10 truncation heuristic must treat a trailing emphasis-close (`*…。*` italic byline) as a complete ending; a terminal-glyph set that omits `*`/`_` turns every persona-byline article into a false C-1 violation and blocks all deploys. With the GAS cron paused, the generation path (workforce article-level2/3) must carry the same cut-off guard at publish time, or truncation is only caught at R-10 where one bad body blocks the whole site deploy. | e7fc028993e1 byline `*Elena は…ご確認ください。*` flagged as truncated; deploy runs #469/#470/#485 red 2026-06-10/11 (fix: unwrap trailing `[*_]+` before the glyph test, in truncation.mjs + Code.gs together; W-1 cut-off guard added to article-level2/3 publish-notion.mjs importing the canonical lib) | 1 | watching | — |
| ML-007 | A roster model whose `complete()` request shape isn't pinned by a per-model wire-shape test fails only at runtime, and only for the personas on that model — Anthropic removes/renames params across model generations (`thinking:{enabled,budget_tokens}` and `temperature` removed on Opus 4.7+), so a shape that works on sonnet silently 400s on opus. | maya (roster's only `opus-4-7`) never replied on /messaging while sonnet personas worked, 2026-06-11; root cause: legacy thinking shape + temperature sent to a model where both are removed. Fix: model-capability gates in `llm-anthropic.complete()` + per-model wire-shape unit tests | 1 | watching | — |
| ML-008 | A list/index endpoint that returns a deliberately-truncated field (`body_preview`, an excerpt) which the renderer treats as the complete value ships a mid-sentence cut with no expand affordance — a C-1/W-1-class defect that passes every test because the field is *valid*, just short. Candidate guard when it recurs: a view-builder convention (or lint) that a list response either carries the full field, or an explicit `truncated`/`has_more` flag the renderer must honour — never a bare preview the client renders as whole. | `GET /feed` + `/agents/{slug}/posts` returned only `body_preview` (≤320c); the SPA rendered it as the body, so every >320c post was cut and PostCard's read-more never fired (it only received the preview). Fixed PR #310 by hydrating full `body` server-side (`resolveFeedBody`/`toFeedPostListView`) + a bounded, logged S3-miss fallback (W-4). | 1 | watching | — |
| ML-009 | Every escalation of a PR to a human MUST stamp `autopilot:needs-human`, regardless of *who* escalates. The pr-autopilot skill enforces this mechanically on its write-path (`workforce/skills/pr-autopilot/pr-autopilot-post.mjs` adds `ESCALATION_LABEL` from the `--needs-human` flag OR the hidden `<!-- autopilot:needs-human -->` body marker), but a **session-driven** escalation — a Claude Code / persona-in-session reviewer handing a PR to the operator without going through that script — bypasses the label entirely, so the operator's `is:open label:autopilot:needs-human` queue silently misses it. Guard (this PR): `workforce/scripts/check-escalation-labels.mjs` — flags any open PR whose comments carry the `<!-- autopilot:needs-human -->` hand-off marker but lack the label, catching session-driven misses regardless of code path. CI wiring (a workflow / the daily `wf-audit` Lambda) is the Zone-A follow-up. | (1) #358 (project-ind) touched the L0/L1 path `workforce/docs/data-model.md`; pr-autopilot correctly escalated to the operator in-session (R-N10 / adr-0010) but the PR was not labelled `autopilot:needs-human` until the operator flagged the miss (2026-06-22); label applied retroactively before the operator-approved merge. (2) #362 (pr-merge self-approve fix): the session reviewer handed the merge decision to the operator **in chat** without the label, until the operator flagged it again (2026-06-22); label applied via `pr-autopilot-post.mjs --needs-human`. Two session-driven misses in one day = the recurrence the ratchet promotes on. | 2 | accepted | pending — `workforce:escalation-labels` lint (this PR) + CI wiring (operator, Zone A) |
