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
  1. Generates Markdown files → GitHub (`public/posts/{slug}.md`)
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
- **L4_BATCH**: Daily batch — image any unimaged published article (max 2/run)
- **REBUILD_MANIFEST**: Rebuild `manifest.json` from Notion (legacy maintenance)
- **ARTICLE_LIST**: Unified listing across types (used by `article-health` skill)

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

**The user-facing site is rebuilt from Notion on every deploy.** See [docs/architecture-source-of-truth.md](docs/architecture-source-of-truth.md) for the full source-of-truth contract; the practical implications:

| Trigger | What rebuilds | Latency |
|---|---|---|
| `git push` to `main` | gh-pages from current Notion content | ~3 min for the workflow |
| Scheduled cron at **06:17 / 12:17 / 18:17 UTC** (`.github/workflows/deploy.yml`) | gh-pages from current Notion content | up to 6 hours from your Notion edit to live site |
| `gh workflow run deploy.yml` | gh-pages from current Notion content | ~3 min — the manual lever |
| `runL2Batch` / `runL3Batch` GAS triggers (09:00 / 10:00 JST) | New Notion rows — **not** the live site | next deploy picks them up |

So when fixing article content: edit Notion (directly or via a GAS handler like `L2_BACKFILL`), then either wait for the next cron tick or run the workflow manually.

## Daily cron triggers (Asia/Tokyo)

Installed via `setupDailyTriggers()` in `gas/src/Code.gs`. Run once from the Apps Script editor after a fresh deploy to install or reset.

| Time | Function | Purpose |
|---|---|---|
| 09:00 JST | `runL2Batch` | Fetch any uncovered L1 articles, create up to 3 new L2 explanations |
| 10:00 JST | `runL3Batch` | Sample recent L2s, synthesize 1 L3 insight if there's a fresh L2 |
| 11:00 JST | `runL4Batch` | Generate cover images and write markdown for any unimaged article (max 2/run) |

The 1-hour gaps give each batch the full 6-min GAS timeout without overlap.

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
   gh workflow run deploy.yml
   ```
4. Re-run `article-health`. Confirm 0 truncated.

The `L2_BACKFILL` action uses the `isTruncatedMarkdown` heuristic in `gas/src/Code.gs` — a heading with no body underneath, or a non-list line that doesn't end with proper punctuation. The same heuristic is mirrored in the `article-health` skill so what the skill flags will also be picked up by `L2_BACKFILL`.

### Adding a new GAS action

1. Add the handler function in `gas/src/Code.gs`.
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
- **GitHub branch**: Markdown is written to both `main` (audit trail; CI overwrites it on next deploy) and `gh-pages` (live site, built from Notion). See [docs/architecture-source-of-truth.md](docs/architecture-source-of-truth.md).
- **Azure OpenAI**: Model is `gpt-5.4` at endpoint `https://rg-phd-openai-uehara.openai.azure.com/`. Budget sizing rules: [docs/azure-budget-rules.md](docs/azure-budget-rules.md).
