# L1→L4 AI Content Pipeline

A four-stage system for researching, synthesizing, and publishing AI industry insights.

> **History note (2026-06):** L2/L3 generation used to run on a Google Apps Script (GAS) engine (`newsletter/gas/src/Code.gs`) fired by GAS time-driven triggers, with a React operator UI (`/capture`, `/l2-blog`, `/l3-insight`, `/l4-publish`). **That engine has been removed.** Generation now runs through the **workforce article-level2 / article-level3 cadences**, and publication through the **`deploy-article-site.yml`** workflow. This doc describes the current pipeline. The GAS-era mechanics are summarized in [pipeline-daily-app.md](pipeline-daily-app.md) for historical context only.

## Architecture

```
L1: Web sources (Notion L1 source DB)
  ↓ [captured directly in Notion]

L2: Explanation articles (unified Notion Articles DB, Type=explanation)
  ↓ [workforce article-level2 cadence — agent synthesis]

L3: Analysis articles (unified Notion Articles DB, Type=analysis)
  ↓ [workforce article-level3 cadence — agent synthesis]

L4: Published articles (gh-pages + https://kohuehara.xyz)
  ↓ [deploy-article-site.yml: fetch-notion.mjs → check-truncation (R-10) → build → deploy]
```

Both L2 and L3 rows live in **one unified Notion Articles DB**, distinguished by `Type` (`explanation` / `analysis`). L1 sources live in a **separate** L1 source DB.

## The stages

### L1 — Capture sources

New L1 source rows land in the Notion L1 source DB, which the L2 cadence's picker (`workforce/skills/article-level2/pick-l1-source.mjs`) reads to find uncovered sources. The capture path is the same **Capture UI** as before — only its backend changed from GAS to the `wf-l1-source-register` Lambda (`POST /l1/register` to save, `GET /l1/sources` for the recent-list/streak). Ways in:

1. **The Capture page** (`/capture` in the reader app; header **+ CAPTURE** link). Paste a URL (optionally a title/category) and save; the iOS Share Sheet target (`/l1-register`) prefills and auto-submits a shared link. Auth: the operator enters the capture bearer token once (kept in `localStorage`, never built into the bundle); the build-time `VITE_L1_CAPTURE_ENDPOINT` points at `/l1/register`.
2. **The CLI** (desktop / scripts): `L1_CAPTURE_ENDPOINT=… L1_CAPTURE_TOKEN=… node scripts/capture-l1.mjs <url> [--title …] [--category A-E]`.
3. **Directly in Notion.** Add the row by hand (Title + Source URL, optionally Contents Summary + Category). Useful for paywalled sources where you want to paste a `Contents Summary` (the L2 cadence's only grounding fallback when the URL body can't be fetched).

The endpoint is **mechanical, no LLM** (`url` required; `title`/`category`/`summary`/`publicationDate` optional; idempotent on the Source URL). Bearer token `wf/api/l1-source-write-token`. Setup, deploy, and the iOS Shortcut recipe: [`workforce/lambdas/l1-source-register/README.md`](../../workforce/lambdas/l1-source-register/README.md).

> **Why no LLM at capture.** The retired GAS `L1_SAVE` auto-extracted title/category/summary via Azure. Downstream, the L2 cadence fetches the actual source URL and re-canonicalises category, so those fields are selection hints, not load-bearing — capture is now a deterministic write, with title/category saved exactly as entered. The one exception is the paywall fallback above: supply a `summary` (via the optional field or by hand) for sources whose body can't be fetched.

### L2 — Explanation articles (`article-level2` cadence)

The [`workforce/skills/article-level2`](../../workforce/skills/article-level2/SKILL.md) cadence (persona **Elena**) turns one uncovered L1 source into one Japanese briefing-document **explanation** (`Type=explanation`).

- Fired on the **CCR execution model** by `wf-orchestrator-tick` (EventBridge → `agent-runner` routine). The schedule is the workforce orchestrator tick, not a GAS trigger.
- `pick-l1-source.mjs` selects the oldest L1 source whose Source URL no explanation covers yet; if nothing is pending it returns `{"skip": true}` and the fire produces nothing.
- The agent generates the prose; `publish-notion.mjs` owns the Notion write (schema, blocks, properties) and carries the **canonical truncation guard (W-1)** via `scripts/lib/truncation.mjs`. A truncated/empty body fails the write loud (C-1 / C-4).
- For JS-only / paywalled hosts, the body is fetched through [Jina Reader](https://jina.ai/reader/) (`https://r.jina.ai/<url>`) before grounding.

### L3 — Analysis articles (`article-level3` cadence)

The [`workforce/skills/article-level3`](../../workforce/skills/article-level3/SKILL.md) cadence (persona **Elena**) synthesizes several recent L2 explanations into one Japanese **analysis** (`Type=analysis`) that induces a unifying principle.

- Same CCR execution model and orchestrator schedule as L2.
- `pick-l2-sources.mjs` selects the L2 source rows to synthesize from (recent-window sampling with a fresh-entry guarantee, so each analysis carries at least one signal the previous one didn't see).
- `publish-notion.mjs` writes the `analysis` row to the same unified Articles DB and applies the same W-1 truncation guard.

### L4 — Publish (`deploy-article-site.yml`)

Publication to the live site is the [`.github/workflows/deploy-article-site.yml`](../../.github/workflows/deploy-article-site.yml) workflow. It is the only path that puts content on `kohuehara.xyz`.

1. Runs `newsletter/pipeline/fetch-notion.mjs`, which queries the unified Notion Articles DB. **No `Status` filter — every row in the DB is exported.**
2. Gates on `npm run check-truncation` (**R-10**): a truncated article fails the build red, so a degraded article never deploys (C-1 / C-4).
3. Builds the reader SPA and deploys to `gh-pages`.

**Cover images:** the GAS L4 batch used to generate hero images; that path is gone. The site falls back to a placeholder when no `posts/images/<slug>.jpg` exists on disk (`newsletter/pipeline/writers/posts-md.mjs` `resolveImagePath`). No new auto-generated hero images are produced going forward — drop a `posts/images/<slug>.jpg` in by hand if you want a non-placeholder cover.

## Design principles (carried over from the daily batches)

These held for the GAS daily batches and still apply to the cadences:

- **Idempotent / derive-from-target.** "What's already done" is derived from the target state (which L1 Source URLs an explanation already covers; which Notion rows exist), not from a last-run cursor. Re-running produces no duplicates and no rows rot if a single fire is missed.
- **Fresh-entry guarantee for L3.** Each analysis includes at least one L2 newer than the previous synthesis, so L3 never stalls on the same pool.
- **Throughput tolerant of missed fires.** Cadences fire on a recurring orchestrator tick; a single skipped/stalled fire costs one item, not a day.
- **Notion is the source of truth (C-2).** Both cadences write to Notion; the live site is rebuilt from Notion on every deploy. See [architecture-source-of-truth.md](architecture-source-of-truth.md).

## Deploy cadence and lag

**The user-facing site is rebuilt from Notion on every deploy.** See [architecture-source-of-truth.md](architecture-source-of-truth.md) for the full source-of-truth contract; the practical implications:

| Trigger | What rebuilds | Latency |
|---|---|---|
| `git push` to `main` | gh-pages from current Notion content | ~3 min for the workflow |
| Scheduled cron at **06:17 / 12:17 / 18:17 UTC** (`.github/workflows/deploy-article-site.yml`) | gh-pages from current Notion content | up to 6 hours from your Notion edit to live site |
| `gh workflow run deploy-article-site.yml` | gh-pages from current Notion content | ~3 min — the manual lever |
| `article-level2` / `article-level3` cadence fires (`wf-orchestrator-tick`) | New Notion rows — **not** the live site | next deploy picks them up |

So when fixing article content: edit Notion (directly, or re-run the relevant cadence), then either wait for the next cron tick or run the workflow manually.

## Operator runbooks

### Article truncated mid-sentence

User reports an article that ends mid-sentence (e.g. a body cut at a heading with no text under it).

1. Run the `article-health` skill to see whether the symptom is on gh-pages, in Notion, or both:
   ```bash
   node .claude/skills/article-health/scripts/article-health.mjs
   ```
2. Fix the source:
   - If the body in **Notion** is truncated, fix the Notion row directly, or re-run the relevant cadence (`article-level2` for an explanation, `article-level3` for an analysis) so it regenerates the row. The cadence's `publish-notion.mjs` truncation guard (W-1) blocks a re-publish that would still be truncated.
   - If Notion is fine but gh-pages is stale, you only need a fresh deploy (next step).
3. Trigger a deploy so gh-pages picks up the fixed Notion content:
   ```bash
   gh workflow run deploy-article-site.yml
   ```
   The `check-truncation` (R-10) gate will block the deploy if the article is still truncated, so a bad fix fails loud rather than publishing.
4. Re-run `article-health`. Confirm 0 truncated.

The truncation heuristic is shared: the `article-health` skill, `npm run check-truncation` (R-10), and the cadences' `publish-notion.mjs` all import `scripts/lib/truncation.mjs`, so what one flags the others flag too.

### Force a fresh deploy

You changed Notion (fixed a row, re-ran a cadence) and don't want to wait for the next cron tick:

```bash
gh workflow run deploy-article-site.yml
```

This re-runs `fetch-notion.mjs` against the current Notion DB and rebuilds gh-pages (~3 min). It's the manual lever in the deploy-cadence table above.

### Pipeline has gone quiet

`kohuehara.xyz` hasn't shown a new article for several days. The visible signal is the home-page list: its newest `date` is older than ~yesterday.

1. **Is it a generation stall or a deploy stall?** Run `article-health` first. If Notion has recent rows but the site doesn't, it's a deploy stall → `gh workflow run deploy-article-site.yml`.
2. **Generation stall — no new Notion rows.** Diagnose the cadence side:

   | What you see | Likely cause | Fix |
   |---|---|---|
   | No uncovered L1 sources | **L1 starvation.** `article-level2`'s picker returned `{skip:true}` every fire, so `article-level3` then had no fresh L2 to synthesize. | Add new L1 source rows **directly in the Notion L1 source DB**. The next orchestrator tick will pick them up. |
   | Uncovered L1 exists but no new explanations | The `article-level2` cadence isn't firing or is erroring. | Check the workforce orchestrator / `agent-runner` execution logs for this skill. Confirm the cadence's agent binding and the injected Notion credential are intact. |
   | New explanations exist but no new analyses | `article-level3` is gated (no fresh L2 since its last run, or too few recent L2s to sample). This may be legitimate. | Confirm via the cadence logs; the gate releases once there is a fresh L2 in the recent window. |
   | New rows in Notion but the site is still stale | Deploy lag. gh-pages cron runs `06:17 / 12:17 / 18:17 UTC`. | `gh workflow run deploy-article-site.yml`. |

3. After the fix, confirm the next tick produces a new Notion row and the next deploy serves it.

### Labelling a new GitHub issue

Every issue on `refluster/ai-native-article` gets three mandatory labels — `project:` + `layer:` + `type:` — plus any relevant `area:` / `epic-NNN` / `role:` / `wf:` / `priority:` axes. The full taxonomy, the L0-L3 mapping per sub-project, and the decision flow are in [`docs/issue-labeling.md`](../../docs/issue-labeling.md).

When opening a new issue (operator or agent):

1. Walk [`docs/issue-labeling.md §3`](../../docs/issue-labeling.md#3-decision-flow--labelling-a-new-issue) — the decision flow gives a deterministic 3-6 labels per issue.
2. If the issue belongs to a new epic, add the epic label to [`.github/labels.json`](.github/labels.json) in the same PR.
3. If you added or changed any label definition, reconcile to GitHub:

   ```bash
   GH_TOKEN=ghp_... node scripts/sync-labels.mjs           # apply
   GH_TOKEN=ghp_... node scripts/sync-labels.mjs --dry-run # preview
   ```

The script is idempotent and never deletes — orphan labels are reported, not removed.

## Notes

- **Notion DB IDs:** the L1 source DB id and the unified Articles DB id are constants held in the cadence scripts (`pick-l1-source.mjs`, `pick-l2-sources.mjs`, `publish-notion.mjs`) and in `newsletter/pipeline/fetch-notion.mjs`. Only the Notion integration `apiKey` is a secret.
- **Notion integration sharing:** the integration behind the Notion `apiKey` must be shared with **both** the L1 source DB and the unified Articles DB.
- **GitHub branch:** the live site is `gh-pages`, built fresh from Notion every deploy. `main:newsletter/app/public/posts/*.md` is a derived export that CI overwrites — never authoritative. See [architecture-source-of-truth.md](architecture-source-of-truth.md).
- **Model / LLM budget:** generation prose is produced by the cadence's running agent (CCR model). The historical GAS `azureGenerateText` budget-bracket discipline is retained as guidance in [azure-budget-rules.md](azure-budget-rules.md).
