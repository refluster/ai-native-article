# L1→L4 AI Content Pipeline

A four-stage system for researching, synthesizing, and publishing AI industry insights.

## Architecture

```
L1: Web Articles (Notion DB)
  ↓ [Manual + AI search]

L2: Blog Articles (Notion DB)
  ↓ [Azure OpenAI synthesis]

L3: Insight Articles (Notion DB: L3 Insights)
  ↓ [Azure OpenAI deep synthesis]

L4: Published Articles (GitHub + https://kohuehara.xyz)
  ↓ [Markdown + manifest.json update]
```

## Setup

### 1. Configure Google Apps Script (GAS)

1. Visit https://script.google.com/home
2. Open the project (already initialized with clasp)
3. Go to **Project Settings** → add the following script properties:
   - `GH_TOKEN` — from `.env` file
   - `NOTION_API_KEY` — from `.env` file
   - `AZURE_OPENAPI_KEY` — from `.env` file
   - `L2_DB_ID` — create "L2: Blog Repository" database and paste ID
   - `L4_DB_ID` — create "L4: Published" database and paste ID

4. Deploy as **New Web App**:
   - Execute as: Your account
   - Who has access: Anyone
   - Copy the **Deployment URL** → paste into React app (replace `YOUR_SCRIPT_ID` in the pages)

### 2. Create Notion Databases

#### L2: Blog Repository
Create a Notion database with properties:
- **Title** (title)
- **L1 References** (relation to L1 Insights)
- **Content** (rich_text)
- **Status** (rich_text: draft|review|published)

#### L4: Published
Create a Notion database with properties:
- **Title** (title)
- **Slug** (rich_text)
- **Published URL** (url)
- **Status** (rich_text)

### 3. Update React Pages

Replace `YOUR_SCRIPT_ID` in these files with the GAS deployment ID:
- `src/pages/L1Register.tsx`
- `src/pages/L2Blog.tsx`
- `src/pages/L3Insight.tsx`
- `src/pages/L4Publish.tsx`

## Usage

### L1: Register Articles
- Navigate to `/l1-register`
- Add web articles manually or via AI research
- Sources saved to "AI Transformation library" Notion DB

### L2: Create Blog Articles
- Navigate to `/l2-blog`
- Select 1-5 L1 articles
- Click **GENERATE BLOG** → Azure OpenAI synthesizes a blog post
- Article saved to "L2: Blog Repository" with `draft` status

### L3: Create Insight Articles
- Navigate to `/l3-insight`
- Select 2+ blog articles
- Click **GENERATE INSIGHT** → Azure OpenAI deep synthesis
- Article saved to "L3: Insights" with abstract and category

### L4: Publish to Web
- Navigate to `/l4-publish`
- Select insight articles in `draft` status
- Click **PUBLISH TO WEB**:
  1. Generates Markdown files → GitHub (`newsletter/app/public/posts/{slug}.md`)
  2. Updates `manifest.json`
  3. Articles appear live at `https://kohuehara.xyz/article/{slug}`

## Time Constraints

Each GAS call should complete within **6 minutes**. Large operations (e.g., L3 with 5+ articles) may need splitting:

- Azure OpenAI generation: ~20-40s per 2000 tokens
- Notion API calls: ~200-400ms each
- GitHub API calls: ~200-500ms each

**Safe limits per call:**
- L1_SAVE: 1 article
- L2_CREATE: 5 L1 articles
- L3_CREATE: 3 L2 articles
- L4_PUBLISH: 5 L3 articles

## GAS API Reference

All requests use `POST` with JSON body:

```javascript
fetch('YOUR_GAS_URL', {
  method: 'POST',
  body: JSON.stringify({
    action: 'L1_SAVE|L1_LIST|L2_CREATE|L4_PUBLISH',
    ...data
  })
})
```

### Actions

- **L1_SAVE**: Save web article to Notion
- **L1_LIST**: Fetch all L1 articles
- **L2_CREATE** / **EXPLANATION_CREATE**: Generate blog from one L1 article
- **L2_LIST**: List L2 (explanation) articles
- **L2_BATCH**: Daily batch — for each uncovered L1, create one L2 (max 3/run)
- **L2_BACKFILL**: One-shot operator action — sweep Notion for explanation rows whose body was truncated by an undersized LLM budget, regenerate them with the current 8000-token budget. Manual only; max 5/run. See [Operator runbooks](#operator-runbooks) below.
- **L3_CREATE** / **ANALYSIS_CREATE**: Synthesize one L3 insight from selected L2 articles
- **L3_LIST**: List L3 (analysis) articles
- **L3_BATCH**: Daily batch — sample one set of recent L2s and create one L3
- **L3_BACKFILL_DATE**: One-shot — set Date = created_time on legacy L3 rows
- **L4_PUBLISH**: Publish one article to GitHub (markdown + cover image)
- **L4_LIST**: List published articles
- **L4_BATCH**: Daily batch — image any unimaged published article (max 5/run)
- **REBUILD_MANIFEST**: Rebuild `manifest.json` from Notion (legacy maintenance)
- **ARTICLE_LIST**: Unified listing across types (used by `article-health` skill)
- **PIPELINE_STATUS**: Read-only diagnostic — counts (L1 total/uncovered, L2/L3 total + 7d), latest `created_time` per layer, installed triggers, and `L3_LAST_RUN_AT`. Use when `kohuehara.xyz` has gone quiet to localise whether the stall is L1 starvation, L3 gating, or missing triggers. See the [Pipeline has gone quiet](#pipeline-has-gone-quiet) runbook.

Use the [`gas-call` skill](../.claude/skills/gas-call/SKILL.md) to invoke any of these from the terminal — `curl -X POST` does NOT work because GAS redirects POSTs through `script.googleusercontent.com` and that endpoint returns 405.

## Code Structure

```
gas/
  appsscript.json         # GAS manifest
  src/Code.gs             # Main handler with all L1-L4 logic

src/
  pages/
    L1Register.tsx        # Register web articles
    L2Blog.tsx            # Generate blog articles
    L3Insight.tsx         # Generate insight articles
    L4Publish.tsx         # Publish to web
```

## Deployment

```bash
# Push GAS code + verify the new version is actually serving
node .claude/skills/gas-deploy-verify/scripts/gas-deploy-verify.mjs --expect L2_BACKFILL,L3_BATCH

# OR (without the readiness probe):
npm run deploy-gas

# Build and deploy React app
npm run build
git push origin main  # Triggers GitHub Actions → GitHub Pages
```

## Deploy cadence and lag

**The user-facing site is rebuilt from Notion on every deploy.** See [docs/architecture-source-of-truth.md](architecture-source-of-truth.md) for the full source-of-truth contract; the practical implications:

| Trigger | What rebuilds | Latency |
|---|---|---|
| `git push` to `main` | gh-pages from current Notion content | ~3 min for the workflow |
| Scheduled cron at **06:17 / 12:17 / 18:17 UTC** (`.github/workflows/deploy-article-site.yml`) | gh-pages from current Notion content | up to 6 hours from your Notion edit to live site |
| `gh workflow run deploy-article-site.yml` | gh-pages from current Notion content | ~3 min — the manual lever |
| `runL2Batch` / `runL3Batch` GAS triggers (09:00 / 10:00 JST) | New Notion rows — **not** the live site | next deploy picks them up |

So when fixing article content: edit Notion (directly or via a GAS handler like `L2_BACKFILL`), then either wait for the next cron tick or run the workflow manually.

## Cron triggers (Asia/Tokyo)

Installed via `setupDailyTriggers()` in `newsletter/gas/src/Code.gs`. Run once from the Apps Script editor after a fresh deploy to install or reset.

| Time (JST) | Function | Purpose |
|---|---|---|
| 09 / 13 / 17 / 21 / 01 / 05 (every 4h) | `runL2Batch` | Fetch any uncovered L1 articles, create up to **2** new L2 explanations per run |
| 10 / 14 / 18 / 22 / 02 / 06 (every 4h, +1h after L2) | `runL3Batch` | Sample recent L2s, synthesize 1 L3 insight if there's a fresh L2 |
| 11 (daily) | `runL4Batch` | Generate cover images and write markdown for any unimaged article (max 5/run) |

L2 / L3 run every 4 hours so a single stalled cycle (timeout, transient Azure error) doesn't cost a whole day's throughput. With `L2_BATCH_MAX = 2` the daily ceiling is 12 explanations — enough to drain a ~30-row backlog inside a week. `L4_BATCH_MAX = 5` keeps publish throughput aligned with the upstream production rate (up to 12 L2 + 6 L3 per day during a backlog burndown); observed per-item cost is ~35-40s, so 5 items per run lands at ~200s — comfortable under the 360s execution cap.

The hour set avoids the `deploy-article-site.yml` cron window (15:17 / 21:17 / 03:17 JST) by ≥17 minutes either side — comfortable margin against the 6-min GAS execution cap.

## Operator runbooks

### Article truncated mid-sentence

User reports an article that ends mid-sentence (e.g. `kohuehara.xyz/.../d17e1d58ec42` cut at `### ベンダーロックイン`).

1. Run the `article-health` skill to see whether the symptom is on gh-pages, in Notion, or both:
   ```bash
   node .claude/skills/article-health/scripts/article-health.mjs
   ```
2. If status is `TRUNCATED_NOTION` or `TRUNCATED_PUBLISHED`: regenerate via `L2_BACKFILL`. Repeat until `remaining: 0`:
   ```bash
   node .claude/skills/gas-call/scripts/gas-call.mjs L2_BACKFILL
   ```
3. Trigger a deploy so gh-pages picks up the fixed Notion content:
   ```bash
   gh workflow run deploy-article-site.yml
   ```
4. Re-run `article-health`. Confirm 0 truncated.

The `L2_BACKFILL` action uses the `isTruncatedMarkdown` heuristic in `newsletter/gas/src/Code.gs` — a heading with no body underneath, or a non-list line that doesn't end with proper punctuation. The same heuristic is mirrored in the `article-health` skill so what the skill flags will also be picked up by `L2_BACKFILL`.

### Pipeline has gone quiet

`kohuehara.xyz` hasn't shown a new article for several days even though the daily triggers should be running. The visible signal is the home-page list: its newest `date` is older than ~yesterday.

1. Snapshot the pipeline state from the deployed GAS:
   ```bash
   node .claude/skills/gas-call/scripts/gas-call.mjs PIPELINE_STATUS
   ```
   The response shape:
   ```json
   {
     "mode": "unified",
     "l1": { "total": 412, "uncovered": 0,  "latestCreated": "2026-05-15T03:11:00.000Z" },
     "l2": { "total": 187, "latestCreated": "2026-05-15T01:02:00.000Z", "createdLast7d": 0 },
     "l3": { "total": 53,  "latestCreated": "2026-05-15T02:14:00.000Z", "createdLast7d": 0 },
     "triggers": [
       { "handler": "runL2Batch", "type": "CLOCK", "source": "CLOCK" },
       { "handler": "runL3Batch", "type": "CLOCK", "source": "CLOCK" },
       { "handler": "runL4Batch", "type": "CLOCK", "source": "CLOCK" }
     ],
     "scriptProps": { "L3_LAST_RUN_AT": "2026-05-15T01:00:11.483Z", "L3_RECENTLY_USED_L2_IDS_count": 10 }
   }
   ```
2. Read the diagnosis off the snapshot:

   | What you see | Diagnosis | Fix |
   |---|---|---|
   | `l1.uncovered === 0` | **L1 starvation.** `L2_BATCH` had nothing to do; `L3_BATCH` then skipped per its "no new L2 since last run" rule. | Add new L1 sources via the Capture page (`/capture`) or `L1_SAVE`. Within 24h the next `runL2Batch` will pick them up. To unblock immediately, `gas-call L2_BATCH` once L1 is fed. |
   | `l1.uncovered > 0` but `l2.createdLast7d === 0` | `L2_BATCH` is not making progress despite work being available. Either the trigger isn't installed (see `triggers` row), the daily run is hitting an exception, or every L2_CREATE attempt is throwing. | Check the Apps Script `Executions` log. If the trigger is missing from the snapshot, re-run `setupDailyTriggers()` from the editor (it's idempotent). If runs are erroring, the most common cause is Azure OpenAI / Notion auth — confirm script properties are still set. |
   | `triggers` does not list all of `runL2Batch`, `runL3Batch`, `runL4Batch` | Triggers were dropped (e.g. a project copy/restore). | Open the Apps Script editor and run `setupDailyTriggers()` once. |
   | `l2.createdLast7d > 0` but `l3.createdLast7d === 0` | L3 is gated. Either `L3_LAST_RUN_AT > newest L2` (legitimate skip), or the recent pool has < `L3_SAMPLE_SIZE` items (legitimate too). | If you want one anyway: `gas-call L3_BATCH`. The gate releases as soon as `L3_LAST_RUN_AT` is older than at least one L2 in the recent window. |
   | `l3.createdLast7d > 0` but site still stale | Deploy lag. gh-pages cron runs `06:17 / 12:17 / 18:17 UTC`. | `gh workflow run deploy-article-site.yml`. |

3. After the fix, re-run `PIPELINE_STATUS` to confirm the next day's `createdLast7d` is non-zero.

### L2_BATCH stuck — same L1 keeps timing out

Symptom: `runL2Batch` / `doPost` repeatedly hits `Exceeded maximum execution time` (360s) on the same first item. Apps Script Executions logs show `[L2_BATCH] item 1/1: l1=...` then a 6-minute gap until the kill — i.e. `fetchSourceText` hung. `UrlFetchApp.fetch` has no JS-level timeout so we can't cancel mid-flight.

The mitigation already runs automatically: `handleL2Create` writes `L2 Skip = true` on the L1 row BEFORE entering `generateL2Markdown`, so even when GAS kills the function mid-fetch, the next `L2_BATCH` excludes the row. But you may want to inspect or recover.

**See what's skipped:**

1. Open the L1 DB in Notion.
2. Filter view: `L2 Skip` is checked.
3. Each row's `Source URL` is a URL that either hung the fetch or threw downstream of it.

**Retry one:**

1. In the Notion app, uncheck the row's `L2 Skip`.
2. Wait for the next `runL2Batch` tick (every 4h JST) or trigger now: `gas-call L2_BATCH`.

**Route a host through Jina Reader (preferred — actually reads the article):**

For hosts where direct `UrlFetchApp.fetch` hangs or returns useless JS-only HTML (consent-walled CDN-served articles like McKinsey, JS-only feeds like X/Twitter, soft-paywall sites like FT/NYT/WSJ/Bloomberg/LinkedIn), proxy the request through [Jina Reader](https://jina.ai/reader/) (`https://r.jina.ai/<url>`) which returns pre-extracted clean Markdown:

1. Identify the host pattern from a row whose `L2 Skip` was set.
2. Add the pattern to `L2_SOURCE_FETCH_VIA_READER` in `newsletter/gas/src/Code.gs` (near `fetchSourceText`).
3. Deploy + verify.
4. Uncheck the skipped row's `L2 Skip` in the Notion app so the next `L2_BATCH` retries it through the reader.

Anonymous Jina access is rate-limited (~20 RPM); fine for our ~6 runs/day cadence. If a large backfill ever hits the cap, set `JINA_API_KEY` in GAS Script Properties for the higher tier — no code change needed.

**One-time setup if the property doesn't exist yet:**

Open the L1 DB → add a Checkbox property named exactly `L2 Skip` (default unchecked). If the property is missing, you'll see `[L2_CREATE] WARNING: write-ahead L2 Skip failed` in the logs and the safety net is off — every hang costs another 6-minute timeout.

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

### Adding a new GAS action

1. Add the handler function in `newsletter/gas/src/Code.gs`.
2. Add a `case '<NEW_ACTION>':` in `doPost`.
3. Add `'<NEW_ACTION>'` to the `supportedActions` array in `doGet`.
4. Deploy + verify in one step:
   ```bash
   node .claude/skills/gas-deploy-verify/scripts/gas-deploy-verify.mjs --expect <NEW_ACTION>
   ```
5. Smoke-test:
   ```bash
   node .claude/skills/gas-call/scripts/gas-call.mjs <NEW_ACTION>
   ```

If the verify step fails after 90 seconds, the deploy didn't propagate — re-run.

## Notes

- **Token credentials in .env**: GAS reads them via script properties (set manually in Apps Script UI)
- **Notion DB IDs**: L1 and L3 are hardcoded; L2 and L4 must be configured
- **GitHub branch**: Markdown is written to both `main` (audit trail; CI overwrites it on next deploy) and `gh-pages` (live site, built from Notion). See [docs/architecture-source-of-truth.md](architecture-source-of-truth.md).
- **Azure OpenAI**: Model is `gpt-5.4` at endpoint `https://rg-phd-openai-uehara.openai.azure.com/`. Budget sizing rules: [docs/azure-budget-rules.md](azure-budget-rules.md).
