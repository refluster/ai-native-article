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
- **L2_CREATE**: Generate blog from L1 articles
- **L4_PUBLISH**: Publish L3 articles to GitHub

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
# Push GAS code after changes
npm run push-gas

# Build and deploy React app
npm run build
git push origin main  # Triggers GitHub Actions → GitHub Pages
```

## Notes

- **Token credentials in .env**: GAS reads them via script properties (set manually in Apps Script UI)
- **Notion DB IDs**: L1 and L3 are hardcoded; L2 and L4 must be configured
- **GitHub branch**: All published files go to `gh-pages`
- **Azure OpenAI**: Model is `gpt-5.4` at endpoint `https://koh-uehara-ai.openai.azure.com/`
