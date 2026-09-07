# Daily-App Pipeline (retired)

> **Status: RETIRED (2026-06).** The GAS daily-trigger app this document described — the time-driven `setupDailyTriggers()` schedule (`runL2Batch` 09:00 / `runL3Batch` 10:00 / `runL4Batch` 11:00 JST) plus the React operator pages and the L1 share-target PWA in `newsletter/gas/src/Code.gs` — **has been removed along with the GAS engine.** This file is kept as a history stub.

## What replaced it

- **Generation (L2 / L3).** The daily GAS batches are gone. L2 explanations and L3 analyses are now produced by the **workforce cadences**:
  - [`workforce/skills/article-level2`](../../../workforce/skills/article-level2/SKILL.md) — one uncovered L1 source → one `explanation` row.
  - [`workforce/skills/article-level3`](../../../workforce/skills/article-level3/SKILL.md) — recent L2s → one `analysis` row.

  Both run on the **CCR execution model**, fired by `wf-orchestrator-tick` (EventBridge → `agent-runner` routine) — the workforce orchestrator schedule, not GAS time-driven triggers. Each cadence's `publish-notion.mjs` owns the Notion write and carries the canonical truncation guard (W-1, via `scripts/lib/truncation.mjs`).

- **L1 capture.** The L1 share-target PWA / Capture page is gone. New L1 source rows are added **directly in the Notion L1 source DB**, which `article-level2`'s `pick-l1-source.mjs` reads.

- **Publication (L4).** Publishing to `kohuehara.xyz` is the [`.github/workflows/deploy-article-site.yml`](../../../.github/workflows/deploy-article-site.yml) workflow: `fetch-notion.mjs` exports the unified Notion Articles DB → `npm run check-truncation` (R-10) gate → build → deploy to gh-pages. Cron 06:17 / 12:17 / 18:17 UTC, plus push-to-main and manual dispatch.

## Where to read now

- Current pipeline, stages, and operator runbooks: [L1-L4-PIPELINE.md](../L1-L4-PIPELINE.md).
- Source-of-truth contract (Notion authoritative; gh-pages built fresh): [architecture-source-of-truth.md](../architecture-source-of-truth.md).
- The generation cadences themselves: [article-level2](../../../workforce/skills/article-level2/SKILL.md) / [article-level3](../../../workforce/skills/article-level3/SKILL.md).

## Idempotency principle (still true)

The one design idea worth carrying forward: each stage derives "what's already done" from the **target state** (which L1 Source URLs an explanation already covers; which Notion rows exist), not from a last-run cursor. Re-running produces no duplicates, and a missed fire costs one item rather than a day. The cadences keep this property; see the "Design principles" section of [L1-L4-PIPELINE.md](../L1-L4-PIPELINE.md).
