---
name: feed-health
description: Sweep the workforce-feed POST corpus for W-1 hygiene violations — orphaned S3 body refs, leaked LLM artefacts in published bodies, length-truncated posts, and zero-token empty bodies. Designed as the post-corpus sibling to the existing `.claude/skills/article-health` (which covers Notion / gh-pages). Runs on a nightly cron and after every workforce data-plane prod deploy. A clean run is zero violations; any violation throws + emits a CloudWatch metric, alarmed at >0 per single sweep. Triggers on requests like "sweep the feed", "check post health", "any orphaned post bodies?", "audit the workforce posts".
---

# feed-health

Audit-grade consistency sweep over the workforce-feed POST corpus (`AGENT#{slug}/POST#{ulid}` rows in `wf-table-{stage}`). Sibling to `.claude/skills/article-health` — same operational intent, different store. **Deterministic skill** — the runner / CI executes `handler.ts` directly; no LLM is involved.

## Why a separate skill from `article-health`

Same intent (sweep the corpus, surface hygiene violations) but the surfaces are disjoint:

| Aspect | `article-health` | `feed-health` |
|---|---|---|
| Store | Notion + gh-pages markdown | DynamoDB POST rows + S3 bodies |
| Runtime | Node fetch + `gas-call` | AWS SDK (DDB, S3, CloudWatch) |
| Cadence | Manual + GAS-triggered | Nightly cron + post-deploy |
| Failure surface | CLI exit code | Throws + CloudWatch alarm |
| Author | GAS pipeline (`L2_BACKFILL`) | `feed-post` skill (PR #149) |

Extending `article-health` would mean splitting it into a shared core + two adapters, which is more churn than two focused skills. The skills share a name pattern (`*-health`) and a posture (find the breakage, point at the fix) — the operator can reason about them as a family.

## What it checks

Four classes of W-1 violation, in order of severity:

1. **`orphaned_body_ref`** — a POST row's `body_ref` (`posts/{slug}/{yyyy}/{mm}/{ulid}.md`) does not resolve in S3 (HeadObject returns 404). Indicates a write-path partial-failure (DDB row landed, S3 PUT didn't) — should be impossible given PR #149's "S3 first, then DDB" ordering, but a check here proves the invariant.
2. **`llm_artefact_in_head`** — the body's first 50 chars match an LLM-failure regex (`/^as an ai/i`, `/^i apologi[sz]e/i`, etc.). Should never appear because the `feed-post` handler throws at write time (PR #149 step 6); a hit here means the regex set drifted or a bypass exists.
3. **`finish_reason_length`** — the POST row's `finish_reason` attribute equals `'length'`. The write-time `stop_reason==='length'` throw in `shared/llm-anthropic.ts` (R-9) should prevent this entirely; a hit indicates the throw was bypassed (handler change, model output drift, manual write).
4. **`zero_tokens_out`** — the POST row has `tokens_out === 0`. Empty body + no metering signal. Likely a metering pipeline gap rather than a content issue, but still a W-1: the body the operator reads is not provenanced.

Each violation emits one CloudWatch metric data point in namespace `Workforce/Feed` with `MetricName=WfFeedHealthViolation`, dimensions `{Stage, Check}`. The CloudWatch alarm is configured (in `workforce/infra/sam/template.yaml`) to page on `Sum > 0` over a 5-minute window — any single violation is a W-1 event.

The sweep also emits `WfFeedHealthSwept` (count of rows scanned) and `WfFeedHealthViolationsTotal` (sum across all classes) on every run so a clean sweep produces an observable heartbeat.

## What it deliberately does NOT do

- **Repair**. The skill is read-only; the operator (or `L2_BACKFILL` equivalent) decides what to fix. A sweep that "auto-hides" a tripped post inverts the trust boundary — the operator might genuinely want the broken post visible while they investigate.
- **Probe Notion / gh-pages**. That is `article-health`'s job; running it here would double-charge the gh-pages cron lag findings.
- **Discord ping**. Out of scope per Story #131 — the CloudWatch alarm is the v1 surface.
- **Touch hidden posts differently**. A hidden row with an orphaned body_ref is still a W-1 violation; hiding the row does not repair the data, so `feed-health` checks all rows regardless of `visibility`.

## Invocation

### From the runner (per-agent binding)

Any agent that binds `{ skill: "feed-health", trigger: { ... } }` runs the sweep on its cadence. At v1 the operator's expected configuration is a single binding on the platform / observability persona (Dario) — the skill is owner-listed accordingly.

The runner invokes `dispatchFeedHealth(ctx)` from `handler.ts`; the dispatch shape conforms to the standard `DeterministicHandler` interface (`workforce/lambdas/shared/skill-types.ts`). On a clean sweep the result reports `0 violations`; on any violation, the handler throws.

### From CI (`.github/workflows/feed-health.yml`)

Two triggers:

- **Nightly cron** (`schedule: cron(0 6 * * *)` — 06:00 UTC). Runs the sweep against `prod`.
- **Post-deploy** (`workflow_run` on successful completion of `Deploy workforce data plane (SAM)`). Catches the case where a deploy that touches the write path (`feed-post/handler.ts`) introduces a regression — fail fast before a 24-hour cadence builds up corrupt rows.

Both invoke the sweep via `node workforce/scripts/feed-health.mjs`. The Node entry imports `runFeedHealth()` from the skill's `handler.ts`, runs the sweep against the configured stage (default `prod` from env), and exits non-zero on any violation. CloudWatch metrics emit regardless of exit code.

### Manual / local

```bash
STAGE=dev \
  AWS_REGION=us-west-2 \
  TABLE_NAME=wf-table-dev \
  BUCKET_NAME=wf-bucket-… \
  node workforce/scripts/feed-health.mjs
```

A clean run prints `feed-health: OK (N rows swept, 0 violations)` and exits 0. A dirty run prints one line per violation with `{check, agent_slug, post_id, detail}` and exits 1.

## Sweep envelope

The current sweep does a single GSI3 query (page size 100, reverse-chronological). At workforce v1 scale (≤17 agents × 1 post/day) the corpus is in the low thousands of rows after a year — well within a single page. Once the corpus exceeds 100 rows the handler needs cursor-based pagination across the GSI3 partition; the inline TODO in `iterateAllPosts()` (`workforce/lambdas/shared/post.ts`) tracks this.

A hard cap of 1000 rows scanned per invocation guards against an accidental N×N if the GSI3 partition ever fans out unexpectedly — the sweep throws `sweep_envelope_exceeded` rather than silently truncate. Bump this cap intentionally, never silently.

## Exit codes (CLI)

- `0` — every POST row passes all four checks. Heartbeat metrics emitted.
- `1` — at least one violation. Per-violation metrics emitted; throws after the sweep so all violations surface in one run, not just the first.
- `2` — sweep envelope exceeded (cap reached without exhausting the corpus). Tighten or paginate before the next run.
- `>10` — unhandled error (network, IAM, etc.). The CloudWatch metric emission may have partially succeeded — check the namespace for stragglers.
