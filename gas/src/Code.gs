/**
 * AI Content Pipeline - Google Apps Script
 * Handles L1→L4 article creation and publishing
 * V2: Fixed POST body parsing
 */

function getConfig() {
  const props = PropertiesService.getScriptProperties();
  return {
    gh_token: props.getProperty('GH_TOKEN') || '',
    notion_api_key: props.getProperty('NOTION_API_KEY') || '',
    azure_openapi_key: props.getProperty('AZURE_OPENAPI_KEY') || '',
    l1_db_id: '32fd0f0b-e61e-80bd-89bf-f94965d05e80',
    l2_db_id: props.getProperty('L2_DB_ID') || '32fd0f0b-e61e-807a-9cde-e9cbb0c3729c',
    l3_db_id: '331d0f0b-e61e-812e-92bf-c1ba92bcd1d9',
    l4_db_id: props.getProperty('L4_DB_ID') || '',
    // Unified Articles DB — set this Script Property to migrate writes
    // to the new schema. While empty the L2/L3 handlers keep writing to
    // the legacy DBs so we can roll out without downtime. See
    // .claude/plans/l2-l3-db-validated-tulip.md §8 for the rollout
    // sequence.
    unified_db_id: props.getProperty('UNIFIED_DB_ID') || '',
  };
}

/**
 * True when the unified DB is configured. Handlers branch on this so a
 * partially-configured environment can keep operating against the legacy
 * DBs.
 */
function useUnifiedDb(config) {
  return !!(config && config.unified_db_id);
}

// ─── NOTION API ──────────────────────────────────────────────────────────────

function notionRequest(method, path, apiKey, body) {
  const url = `https://api.notion.com/v1${path}`;
  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    muteHttpExceptions: true,
  };

  if (body) {
    options.payload = JSON.stringify(body);
  }

  const response = UrlFetchApp.fetch(url, options);
  const status = response.getResponseCode();
  const content = response.getContentText();

  if (status >= 400) {
    throw new Error(`Notion API error ${status}: ${content}`);
  }

  return JSON.parse(content);
}

function notionQueryDatabase(dbId, apiKey) {
  const result = notionRequest('POST', `/databases/${dbId}/query`, apiKey, { page_size: 100 });
  return result.results || [];
}

function notionCreatePage(dbId, properties, apiKey) {
  return notionRequest('POST', '/pages', apiKey, {
    parent: { database_id: dbId },
    properties,
  });
}

function notionUpdatePage(pageId, properties, apiKey) {
  return notionRequest('PATCH', `/pages/${pageId}`, apiKey, { properties });
}

// ─── CATEGORY TAXONOMY ───────────────────────────────────────────────────────
// L1_SAVE stores a single letter A–E (see handleL1Save prompt). L2/L3 want the
// human-readable form. Inputs already containing a descriptor (e.g. "B: Trends"
// from manual edits) pass through unchanged.

const CATEGORY_NAMES = {
  A: 'A: AI Hyper-productivity',
  B: 'B: Role Blurring',
  C: 'C: New Roles/FDE',
  D: 'D: Big Tech Layoffs & AI Pivot',
  E: 'E: Rethinking SDLC',
};

function expandCategoryCode(code) {
  const trimmed = (code || '').trim();
  if (!trimmed) return '';
  if (trimmed.length > 2) return trimmed;
  return CATEGORY_NAMES[trimmed.toUpperCase()] || trimmed;
}

/**
 * Recover the canonical "X: Description" label from any of the variants
 * that have leaked into the data over time:
 *   - bare letter "B"
 *   - "B: TRENDS" / "B: Role Blurring" / "B：Trends" (full-width colon)
 *   - the canonical label itself
 *   - free-form Japanese / English (returns '' for these)
 *
 * Mirrors scripts/normalize-categories.mjs#canonicalFromLetterForm so the
 * UI sidebar (driven by fetch-notion) and GAS writes stay aligned.
 */
function canonicalCategoryFor(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return '';
  // Bare letter
  if (/^[A-E]$/i.test(trimmed)) {
    return CATEGORY_NAMES[trimmed.toUpperCase()] || '';
  }
  // "X[:：]<anything>" — discard the variant descriptor; force canonical.
  const m = trimmed.match(/^([A-E])[\s:：][\s\S]*$/i);
  if (m) return CATEGORY_NAMES[m[1].toUpperCase()] || '';
  return '';
}

/**
 * For an L3 (analysis) row, choose the canonical A-E bucket that best
 * represents the synthesis. Uses majority vote across the source L2s'
 * categories — falls back to the first non-empty when there's no
 * majority. Returns '' when none of the sources had a canonical label.
 */
function pickCanonicalFromSources(l2Categories) {
  const counts = {};
  for (const c of l2Categories) {
    const canonical = canonicalCategoryFor(c);
    if (!canonical) continue;
    counts[canonical] = (counts[canonical] || 0) + 1;
  }
  let best = '';
  let bestN = 0;
  for (const k of Object.keys(counts)) {
    if (counts[k] > bestN) { best = k; bestN = counts[k]; }
  }
  return best;
}

// ─── AZURE OPENAI ────────────────────────────────────────────────────────────

/**
 * Call Azure OpenAI chat completions.
 *
 * @param {string} prompt      User message.
 * @param {string} apiKey      Azure OpenAI API key.
 * @param {Object} [options]   Optional per-call tunables. Unknown keys are
 *                             ignored by the API; invalid values cause 400.
 * @param {string} [options.systemPrompt]
 *     Overrides the default system prompt. Needed for panel members
 *     (pattern / skeptic / editor / domain / reader) once roster-aware
 *     calls land.
 * @param {('minimal'|'low'|'medium'|'high')} [options.reasoningEffort]
 *     Maps to OpenAI's `reasoning_effort`. Only applied when set. See
 *     GROWTH.md §2a for the per-member defaults and the latency /
 *     cost envelope. `gpt-5.4` supports this parameter (verified by
 *     direct Azure probe 2026-04-23); older Azure deployments may
 *     reject it with 400.
 * @param {number} [options.maxCompletionTokens]
 *     Override `max_completion_tokens`. For gpt-5.4 (reasoning family)
 *     this budget covers reasoning + visible output combined; long
 *     visible outputs (e.g. L3's 3000–4000 char Japanese insights)
 *     need headroom or visible content is truncated to empty.
 *     Defaults to 2000.
 */
function azureGenerateText(prompt, apiKey, options) {
  options = options || {};
  const endpoint = 'https://rg-phd-openai-uehara.openai.azure.com/';
  const deploymentId = 'gpt-5.4';
  const apiVersion = '2024-12-01-preview';
  const url = `${endpoint}openai/deployments/${deploymentId}/chat/completions?api-version=${apiVersion}`;

  const systemPrompt = options.systemPrompt ||
    'You are a skilled tech writer creating high-quality AI industry insights.';

  const payload = {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: prompt },
    ],
    temperature: 0.7,
    // gpt-5.4 is reasoning-family and rejects the legacy `max_tokens`
    // parameter with HTTP 400 `unsupported_parameter`; use the newer
    // `max_completion_tokens` instead. Verified by direct Azure probe
    // of the deployment on 2026-04-23.
    max_completion_tokens: options.maxCompletionTokens || 2000,
  };

  // Only attach reasoning_effort when explicitly requested. Leaving it
  // unset lets the deployment use its default, which also means current
  // call sites (L2_CREATE / L3_CREATE) are bit-for-bit unchanged.
  if (options.reasoningEffort) {
    payload.reasoning_effort = options.reasoningEffort;
  }

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  const status = response.getResponseCode();
  const content = response.getContentText();

  if (status >= 400) {
    throw new Error(`Azure OpenAI error ${status}: ${content}`);
  }

  const result = JSON.parse(content);
  // gpt-5.4 occasionally returns 200 OK with empty `content` — most often
  // when reasoning consumes the entire `max_completion_tokens` budget
  // (finish_reason='length') or when content filters strip the output.
  // Without this guard the empty string flows downstream and we publish a
  // zero-byte article. finish_reason in the message helps triage in logs.
  const choice = result.choices?.[0];
  const text = choice?.message?.content || '';
  if (!text) {
    const reason = choice?.finish_reason || 'unknown';
    throw new Error(`Azure OpenAI returned empty content (finish_reason=${reason}). Raw: ${JSON.stringify(result).substring(0, 500)}`);
  }
  return text;
}

// ─── GITHUB API ──────────────────────────────────────────────────────────────

function githubRequest(method, path, token, body) {
  const url = `https://api.github.com/repos/refluster/ai-native-article${path}`;
  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    muteHttpExceptions: true,
  };

  if (body) {
    options.payload = JSON.stringify(body);
  }

  const response = UrlFetchApp.fetch(url, options);
  const status = response.getResponseCode();
  const content = response.getContentText();

  if (status >= 400) {
    throw new Error(`GitHub API error ${status}: ${content}`);
  }

  return content ? JSON.parse(content) : {};
}

function githubReadManifest(token) {
  try {
    const result = githubRequest('GET', '/contents/public/posts/manifest.json?ref=main', token);
    const content = Utilities.newBlob(Utilities.base64Decode(result.content)).getDataAsString();
    return JSON.parse(content);
  } catch (e) {
    // If manifest doesn't exist, return empty array
    if (e.message && e.message.includes('404')) {
      return [];
    }
    throw e;
  }
}

/**
 * List the slugs that already have a committed cover image. Used by
 * handleL4Batch to decide which Notion rows still need image
 * generation. Image existence is more reliable than manifest
 * membership: scheduled fetch-notion runs add rows to the manifest
 * regardless of whether L4 has imaged them, so manifest-based gating
 * caused L4 to skip rows that hadn't been imaged yet (the 09:17 JST
 * cron racing the 11:00 JST L4 batch).
 *
 * GitHub's directory listing returns up to 1000 entries per request;
 * we're far below that. Falls open (returns empty Set) on any error
 * so L4 errs on the side of attempting publish rather than silently
 * skipping work — extra publish attempts are idempotent.
 */
function githubListImagedSlugs(token) {
  try {
    const result = githubRequest('GET', '/contents/public/posts/images?ref=main', token);
    const slugs = new Set();
    if (Array.isArray(result)) {
      for (const item of result) {
        if (item && item.name && item.name.endsWith('.jpg')) {
          slugs.add(item.name.slice(0, -4));
        }
      }
    }
    return slugs;
  } catch (e) {
    Logger.log('githubListImagedSlugs: ' + (e.message || e));
    return new Set();
  }
}

function githubUpdateManifest(entry, token) {
  const manifest = githubReadManifest(token);
  manifest.push(entry);
  manifest.sort((a, b) => b.date.localeCompare(a.date));

  try {
    const result = githubRequest('GET', '/contents/public/posts/manifest.json?ref=main', token);
    const sha = result.sha;
    githubRequest('PUT', '/contents/public/posts/manifest.json', token, {
      message: `Add article: ${entry.title}`,
      content: Utilities.base64Encode(JSON.stringify(manifest, null, 2), Utilities.Charset.UTF_8),
      branch: 'main',
      sha,
    });
  } catch (e) {
    // If file doesn't exist, create it without sha
    if (e.message && e.message.includes('404')) {
      githubRequest('PUT', '/contents/public/posts/manifest.json', token, {
        message: `Add article: ${entry.title}`,
        content: Utilities.base64Encode(JSON.stringify(manifest, null, 2), Utilities.Charset.UTF_8),
        branch: 'main',
      });
    } else {
      throw e;
    }
  }
}

function generateArticleImageWithAzure(title, category, apiKey) {
  // Generate JPG image using Azure OpenAI gpt-image-1.5 model
  const endpoint = 'https://rg-phd-openai-uehara.openai.azure.com/';
  const deploymentId = 'gpt-image-1.5';
  const apiVersion = '2024-12-01-preview';
  const url = `${endpoint}openai/deployments/${deploymentId}/images/generations?api-version=${apiVersion}`;

  // Create a descriptive prompt for the image generation
  // NO TEXT - pure abstract/artistic representation of the article content
  const prompt = `Create an abstract artistic representation of this article topic. NO TEXT, NO LABELS, NO WORDS.
Article title: "${title}"
Article category: ${category}

Generate a minimalist, geometric abstract image that captures the essence and themes of the article.
Style: Swiss design aesthetic, geometric shapes, clean lines, abstract photography.
Colors: Use dark gray (#5e5e5e), red (#c1000a), light surfaces (#f9f9fb), and black.
Purely visual - use shapes, patterns, geometry, and abstract composition to represent the article's meaning.
Professional, modern, tech industry aesthetic. No typography, no text overlay, no labels.`;

  const payload = {
    prompt,
    n: 1,
    size: '1024x1024',
    quality: 'high',
  };

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  const status = response.getResponseCode();
  const content = response.getContentText();

  if (status >= 400) {
    throw new Error(`Azure OpenAI image generation error ${status}: ${content}`);
  }

  const result = JSON.parse(content);
  const base64Image = result.data?.[0]?.b64_json;

  if (!base64Image) {
    throw new Error(`No image data returned from Azure OpenAI. Response: ${JSON.stringify(result)}`);
  }

  return base64Image;
}

function githubCreatePost(slug, mdContent, token, title, category, apiKey) {
  let payload = {
    message: `Add article: ${slug}`,
    content: Utilities.base64Encode(mdContent, Utilities.Charset.UTF_8),
    branch: 'main',
  };

  // Check if file already exists to get SHA
  try {
    const existingFile = githubRequest('GET', `/contents/public/posts/${slug}.md?ref=main`, token);
    payload.sha = existingFile.sha;
  } catch (e) {
    // File doesn't exist, that's fine - no SHA needed for creation
    if (!e.message || !e.message.includes('404')) {
      throw e;
    }
  }

  const result = githubRequest('PUT', `/contents/public/posts/${slug}.md`, token, payload);

  // Generate and upload article image (JPG using gpt-image-1.5)
  const base64Image = generateArticleImageWithAzure(title, category, apiKey);
  const imagePayload = {
    message: `Add image for article: ${slug}`,
    content: base64Image,
    branch: 'main',
  };

  try {
    const existingImage = githubRequest('GET', `/contents/public/posts/images/${slug}.jpg?ref=main`, token);
    imagePayload.sha = existingImage.sha;
  } catch (e) {
    // Image doesn't exist, that's fine
    if (!e.message || !e.message.includes('404')) {
      throw e;
    }
  }

  githubRequest('PUT', `/contents/public/posts/images/${slug}.jpg`, token, imagePayload);

  return {
    url: result.content?.html_url || '',
    slug,
    imageUrl: `/posts/images/${slug}.jpg`,
  };
}

function rebuildManifestFromNotion(config) {
  // Rebuild manifest.json from Notion L3 database (source of truth)
  const l3Pages = notionQueryDatabase(config.l3_db_id, config.notion_api_key);

  const manifest = l3Pages.map(p => ({
    slug: p.id.replace(/-/g, ''), // Use full Notion page ID (without dashes) as slug
    title: p.properties.Title.title[0]?.plain_text || '',
    category: p.properties.Category?.rich_text[0]?.plain_text || '',
    date: new Date().toISOString().split('T')[0],
    abstract: p.properties.Abstract?.rich_text[0]?.plain_text || '',
    image: `/posts/images/${p.id.replace(/-/g, '')}.jpg`,
  })).sort((a, b) => b.date.localeCompare(a.date));

  // Write to GitHub with proper UTF-8 encoding
  try {
    const token = config.gh_token;
    const url = `https://api.github.com/repos/refluster/ai-native-article/contents/public/posts/manifest.json?ref=main`;

    const getOptions = {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      muteHttpExceptions: true,
    };

    const getResponse = UrlFetchApp.fetch(url, getOptions);
    const sha = getResponse.getResponseCode() === 200 ? JSON.parse(getResponse.getContentText()).sha : null;

    const putOptions = {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      payload: JSON.stringify({
        message: 'Rebuild manifest.json from Notion (fix UTF-8 encoding)',
        content: Utilities.base64Encode(JSON.stringify(manifest, null, 2), Utilities.Charset.UTF_8),
        branch: 'main',
        ...(sha && { sha }),
      }),
      muteHttpExceptions: true,
    };

    const putResponse = UrlFetchApp.fetch(url, putOptions);
    return {
      success: putResponse.getResponseCode() < 400,
      message: `Rebuilt manifest with ${manifest.length} articles`,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ─── HANDLERS ────────────────────────────────────────────────────────────────

function handleL1Save(data, config) {
  // Extract metadata from URL using Azure OpenAI
  const url = data.sourceUrl;
  const prompt = `Analyze this article URL: ${url}\n\nExtract and return ONLY valid JSON (no markdown or extra text) with these fields:\n{\n  "title": "article title",\n  "category": "A-E based on: A=AI Hyper-productivity, B=Role Blurring, C=New Roles/FDE, D=Big Tech Layoffs & AI Pivot, E=Rethinking SDLC",\n  "summary": "2-3 sentence summary",\n  "publicationDate": "YYYY-MM-DD"\n}\n\nIf you cannot access the URL, make reasonable estimates based on URL structure.`;

  const responseText = azureGenerateText(prompt, config.azure_openapi_key);

  // Parse JSON response - handle potential markdown formatting
  let metadata = { title: 'Untitled', category: 'A', summary: '', publicationDate: new Date().toISOString().split('T')[0] };
  try {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      metadata = JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    // Use defaults if parsing fails
  }

  const properties = {
    'Title': { title: [{ text: { content: metadata.title } }] },
    'Source URL': { url: url },
    'Category': { rich_text: [{ text: { content: metadata.category } }] },
    'Contents Summary': { rich_text: [{ text: { content: metadata.summary } }] },
    'Publication Date': { date: { start: metadata.publicationDate } },
  };

  const result = notionCreatePage(config.l1_db_id, properties, config.notion_api_key);
  return {
    success: true,
    data: {
      id: result.id,
      sourceUrl: url,
      title: metadata.title,
      category: metadata.category,
      contentsSummary: metadata.summary,
      publicationDate: metadata.publicationDate,
      notionUrl: result.url
    },
  };
}

function handleL1List(config) {
  const pages = notionQueryDatabase(config.l1_db_id, config.notion_api_key);
  const entries = pages.map(p => ({
    id: p.id,
    title: p.properties.Title.title[0]?.plain_text || '',
    sourceUrl: p.properties['Source URL'].url || '',
    category: p.properties.Category.rich_text[0]?.plain_text || '',
    contentsSummary: p.properties['Contents Summary'].rich_text[0]?.plain_text || '',
    publicationDate: p.properties['Publication Date'].date?.start || '',
    notionUrl: p.url,
    createdAt: p.created_time,
  }));

  return { success: true, data: entries };
}

function handleL2Create(data, config) {
  const l1Pages = notionQueryDatabase(config.l1_db_id, config.notion_api_key);
  const l1Page = l1Pages.find(p => p.id === data.l1EntryId);

  if (!l1Page) {
    throw new Error('L1 entry not found');
  }

  const l1Title = l1Page.properties.Title.title[0]?.plain_text || '';
  const l1Summary = l1Page.properties['Contents Summary'].rich_text[0]?.plain_text || '';
  const l1Category = l1Page.properties.Category?.rich_text[0]?.plain_text || 'A';
  const l1SourceUrl = l1Page.properties['Source URL']?.url || '';

  const prompt = `Based on this AI industry news:\n\nTitle: ${l1Title}\nSummary: ${l1Summary}\n\nWrite a comprehensive blog article (800-1200 words) that expands on the topic, explains implications, includes examples, and discusses opportunities and challenges. Suggest a catchy Japanese blog title at the beginning. Format as Markdown with ## for headings.`;
  const blogContent = azureGenerateText(prompt, config.azure_openapi_key);

  // Extract title from the generated content (first line should have the title)
  const titleMatch = blogContent.match(/^#+\s+(.+?)(?:\n|$)/);
  const blogTitle = titleMatch ? titleMatch[1] : l1Title;

  // Convert markdown to Notion blocks
  const blocks = markdownToNotionBlocks(blogContent);
  const fullCategory = expandCategoryCode(l1Category);
  const today = new Date().toISOString().split('T')[0];

  // Branch on UNIFIED_DB_ID so a half-configured rollout still works.
  // Schema differences vs. the legacy L2 DB:
  //   - Title prop is `Title` (not `Name`)
  //   - Type=explanation, Status=published
  //   - Source URLs/multi-select collapse into rich_text `SourceURLs`.
  let pageData;
  if (useUnifiedDb(config)) {
    // CategoriesMulti uses the *canonical* form so the sidebar always
    // groups under one of the 5 controlled buckets. fullCategory is
    // already canonical (expandCategoryCode maps the bare letter), but
    // we belt-and-brace via canonicalCategoryFor() in case Azure ever
    // returns a fuller string in l1Category.
    const canonical = canonicalCategoryFor(fullCategory) || fullCategory;
    pageData = {
      parent: { database_id: config.unified_db_id },
      properties: {
        'Title': { title: [{ text: { content: blogTitle } }] },
        'Type': { select: { name: 'explanation' } },
        'Status': { select: { name: 'published' } },
        'Date': { date: { start: today } },
        'Abstract': { rich_text: [{ text: { content: l1Summary } }] },
        'Category': { rich_text: [{ text: { content: canonical } }] },
        'CategoriesMulti': { multi_select: canonical ? [{ name: canonical }] : [] },
        'SourceURLs': { rich_text: [{ text: { content: l1SourceUrl } }] },
      },
      children: blocks,
    };
  } else {
    pageData = {
      parent: { database_id: config.l2_db_id },
      properties: {
        'Name': { title: [{ text: { content: blogTitle } }] },
        'Publication Date': { date: { start: today } },
        'Source URLs': { url: l1SourceUrl },
        'Sub Category': { rich_text: [{ text: { content: fullCategory } }] },
        'Categories': { multi_select: fullCategory ? [{ name: fullCategory }] : [] },
        'Contents Summary': { rich_text: [{ text: { content: l1Summary } }] },
        '実務への使い道': { rich_text: [{ text: { content: 'AIのビジネス応用に関する実務的な洞察' } }] },
      },
      children: blocks,
    };
  }

  const result = notionRequest('POST', '/pages', config.notion_api_key, pageData);
  return {
    success: true,
    data: {
      id: result.id,
      title: blogTitle,
      l1EntryId: data.l1EntryId,
      blogContent,
      notionUrl: result.url,
    },
  };
}

// Forward alias matching the new naming scheme. Plan §3.1 calls for
// renaming the handlers; we keep both names so downstream callers
// (doPost, batch wrappers) can adopt the new term incrementally.
function handleExplanationCreate(data, config) { return handleL2Create(data, config); }

// Markdown → Notion blocks. Reasonably comprehensive; intentionally line-based
// (no nested lists, no inline-link parsing) to keep the converter simple.
// Inline emphasis (**bold**, *italic*, `code`, [text](url)) IS preserved via
// the rich-text segmenter below.
function markdownToNotionBlocks(mdText) {
  const blocks = [];
  const lines = mdText.split('\n');
  let inCode = false;
  let codeLang = '';
  let codeBuf = [];

  function pushParagraph(text) {
    blocks.push({
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: mdInlineToRichText(text) },
    });
  }

  for (const rawLine of lines) {
    // Fenced code blocks. We accumulate body lines until the closing fence.
    if (inCode) {
      if (rawLine.trim().startsWith('```')) {
        blocks.push({
          object: 'block',
          type: 'code',
          code: {
            language: codeLang || 'plain text',
            rich_text: [{ type: 'text', text: { content: codeBuf.join('\n') } }],
          },
        });
        inCode = false; codeLang = ''; codeBuf = [];
      } else {
        codeBuf.push(rawLine);
      }
      continue;
    }
    if (rawLine.trim().startsWith('```')) {
      inCode = true;
      codeLang = rawLine.trim().slice(3).trim();
      codeBuf = [];
      continue;
    }

    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('# ')) {
      blocks.push({
        object: 'block',
        type: 'heading_1',
        heading_1: { rich_text: mdInlineToRichText(trimmed.substring(2)) },
      });
    } else if (trimmed.startsWith('## ')) {
      blocks.push({
        object: 'block',
        type: 'heading_2',
        heading_2: { rich_text: mdInlineToRichText(trimmed.substring(3)) },
      });
    } else if (trimmed.startsWith('### ')) {
      blocks.push({
        object: 'block',
        type: 'heading_3',
        heading_3: { rich_text: mdInlineToRichText(trimmed.substring(4)) },
      });
    } else if (trimmed.startsWith('> ')) {
      blocks.push({
        object: 'block',
        type: 'quote',
        quote: { rich_text: mdInlineToRichText(trimmed.substring(2)) },
      });
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      blocks.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: { rich_text: mdInlineToRichText(trimmed.substring(2)) },
      });
    } else if (/^\d+\.\s+/.test(trimmed)) {
      blocks.push({
        object: 'block',
        type: 'numbered_list_item',
        numbered_list_item: { rich_text: mdInlineToRichText(trimmed.replace(/^\d+\.\s+/, '')) },
      });
    } else {
      pushParagraph(trimmed);
    }
  }

  // Unterminated fence: dump what we collected as a code block anyway so
  // the body isn't silently lost.
  if (inCode && codeBuf.length) {
    blocks.push({
      object: 'block',
      type: 'code',
      code: {
        language: codeLang || 'plain text',
        rich_text: [{ type: 'text', text: { content: codeBuf.join('\n') } }],
      },
    });
  }

  return blocks;
}

/**
 * Best-effort inline-markdown → Notion rich_text segmenter.
 * Handles the common quartet: **bold**, *italic*, `code`, [text](url).
 * Order matters — code must be parsed before *italic* so backtick-asterisk
 * collisions don't double-wrap.
 */
function mdInlineToRichText(s) {
  if (!s) return [];
  const out = [];
  let buf = '';
  let i = 0;

  function flushBuf() {
    if (buf) {
      out.push({ type: 'text', text: { content: buf } });
      buf = '';
    }
  }

  while (i < s.length) {
    const rest = s.slice(i);
    // [text](url)
    let m = rest.match(/^\[([^\]]+)\]\(([^)]+)\)/);
    if (m) {
      flushBuf();
      out.push({ type: 'text', text: { content: m[1], link: { url: m[2] } } });
      i += m[0].length; continue;
    }
    // `code`
    m = rest.match(/^`([^`]+)`/);
    if (m) {
      flushBuf();
      out.push({ type: 'text', text: { content: m[1] }, annotations: { code: true } });
      i += m[0].length; continue;
    }
    // **bold**
    m = rest.match(/^\*\*([^*]+)\*\*/);
    if (m) {
      flushBuf();
      out.push({ type: 'text', text: { content: m[1] }, annotations: { bold: true } });
      i += m[0].length; continue;
    }
    // *italic* — only when not adjacent to another asterisk (handled by **bold** above).
    m = rest.match(/^\*([^*\n]+)\*/);
    if (m) {
      flushBuf();
      out.push({ type: 'text', text: { content: m[1] }, annotations: { italic: true } });
      i += m[0].length; continue;
    }
    buf += s[i];
    i += 1;
  }
  flushBuf();
  return out.length ? out : [{ type: 'text', text: { content: '' } }];
}

function handleL2List(config) {
  const pages = notionQueryDatabase(config.l2_db_id, config.notion_api_key);
  const entries = pages.map(p => ({
    id: p.id,
    title: p.properties.Name.title[0]?.plain_text || '',
    sourceUrl: p.properties['Source URLs']?.url || '',
    summary: p.properties['Contents Summary']?.rich_text[0]?.plain_text || '',
    category: p.properties['Sub Category']?.rich_text[0]?.plain_text || '',
    publicationDate: p.properties['Publication Date']?.date?.start || '',
    notionUrl: p.url,
  }));

  return { success: true, data: entries };
}

function handleL3Create(data, config) {
  // Source DB: post-migration, the explanations live in the unified DB
  // alongside analyses. Pre-migration, fall back to the legacy L2 DB.
  const sourceDbId = useUnifiedDb(config) ? config.unified_db_id : config.l2_db_id;
  const candidatePages = notionQueryDatabase(sourceDbId, config.notion_api_key);
  // When reading from the unified DB, restrict the candidate pool to
  // explanation-type entries — analyses shouldn't feed analyses.
  const eligible = useUnifiedDb(config)
    ? candidatePages.filter(p => (p.properties.Type?.select?.name || '') === 'explanation')
    : candidatePages;
  const selectedL2 = eligible.filter(p => data.l2EntryIds.includes(p.id));
  // Property names differ between schemas. The helpers below normalise.
  function _title(p) { return p.properties.Title?.title[0]?.plain_text || p.properties.Name?.title[0]?.plain_text || ''; }
  function _summary(p) { return p.properties.Abstract?.rich_text[0]?.plain_text || p.properties['Contents Summary']?.rich_text[0]?.plain_text || ''; }
  function _sourceUrl(p) {
    return p.properties.SourceURLs?.rich_text[0]?.plain_text
      || p.properties['Source URLs']?.url
      || '';
  }
  function _category(p) { return p.properties.Category?.rich_text[0]?.plain_text || p.properties['Sub Category']?.rich_text[0]?.plain_text || ''; }
  const l2Titles = selectedL2.map(_title);
  const l2Summaries = selectedL2.map(_summary);
  const l2SourceUrls = selectedL2.map(_sourceUrl);
  const l2Categories = selectedL2.map(_category);

  const sourceList = l2Titles.map((t, i) => `- ${t}: ${l2Summaries[i].substring(0, 200)}...`).join('\n');

  // Generate title and category from the blog articles (in Japanese)
  const titleCategoryPrompt = `以下のAI関連ブログ記事のタイトルを分析してください：\n\n${l2Titles.join('\n')}\n\n複数の記事から共通する深層的なパターンや仮説を見つけ（帰納的推論）、次を日本語で生成してください：\n1. これらの記事が指し示す根底にある共通原理を表現したインサイト記事のタイトル（15-25字）\n2. 「テーマ1 × テーマ2」形式のカテゴリ\n\n【重要】必ず日本語で出力してください。出力形式：\nTITLE: [日本語のタイトル]\nCATEGORY: [日本語のカテゴリ]`;
  const titleCategoryResponse = azureGenerateText(titleCategoryPrompt, config.azure_openapi_key);

  const titleMatch = titleCategoryResponse.match(/TITLE:\s*(.+?)(?:\n|$)/);
  const categoryMatch = titleCategoryResponse.match(/CATEGORY:\s*(.+?)(?:\n|$)/);
  const generatedTitle = titleMatch ? titleMatch[1].trim() : l2Titles.join(' + ');
  const generatedCategory = categoryMatch ? categoryMatch[1].trim() : l2Categories.join(', ');

  //const contentPrompt = `以下の複数のAI関連ブログ記事の内容を分析してください：\n\n${sourceList}\n\n【タスク】これらの記事が示す具体的事実を観察し、それらを統一的に説明する最も可能性の高い深層原理（仮説）を帰納的推論で導出してください。その仮説に基づいて、以下の構成で日本語のディープダイブインサイト記事（3000-4000字）を執筆してください：\n\n【記事の構成】\n- 導入（100-200字）：一見無関係な複数の事実を提示し、「実はこれらは同じ原理で説明できる」と宣言\n- 分析セクション（×2-4）：各セクションで異なる視点から事実を深掘りし、L2記事からの具体的引用・数字・事例を含める\n- 共通原理の提示（500-800字）：「Why」から「So What」へ。観察された事実群を統一的に説明する根底原理を論理的に展開\n- 未来予測と示唆（500-800字）：この原理から導出される将来の状況変化と、その確率・根拠、読者への実務的な示唆\n\n【重要な指示】\n- 冒頭50字程度の要旨を含める\n- 各セクションで必ず具体的な数字・引用・事例を複数含める\n- 帰納的推論プロセスを明示的に示す（「これらの事実は～を示唆している」という表現を使用）\n- 単なる要約ではなく、複数記事を横断した新しい洞察を生み出すこと\n- Markdown形式で、##は中見出し、###は小見出しを使用\n\nカテゴリ：${generatedCategory}`;

  const contentPrompt = `以下の複数のAI関連ブログ記事の内容を分析してください：\n\n${sourceList}\n\n【タスク】これらの記事が示す具体的事実を観察し、それらを統一的に説明する最も可能性の高い深層原理（仮説）を帰納的推論で導出してください。その仮説に基づいて、以下の構成で日本語のディープダイブインサイト記事（3000-4000字）を執筆してください：\n\n【記事の構成】\n- 導入（100-200字）：一見無関係な複数の事実を提示し、「実はこれらは同じ原理で説明できる」と宣言\n- 分析セクション（×2-4）：各セクションで異なる視点から事実を深掘りし、L2記事からの具体的引用・数字・事例を含める\n- 共通原理の提示（500-800字）：「Why」から「So What」へ。観察された事実群を統一的に説明する根底原理を論理的に展開\n- 未来予測と示唆（500-800字）：この原理から導出される将来の状況変化と、その確率・根拠、読者への実務的な示唆\n\n【重要な指示】\n- 冒頭50字程度の要旨を含める\n- 各セクションで必ず具体的な数字・引用・事例を複数含める\n- 帰納的推論プロセスを明示的に示す（「これらの事実は～を示唆している」という表現を使用）\n- 単なる要約ではなく、複数記事を横断した新しい洞察を生み出すこと\n- Markdown形式で、##は中見出し、###は小見出しを使用\n- 【重要】全文を必ず日本語で出力してください\n\nカテゴリ：${generatedCategory}`;
  // 8000 tokens = ~4000 visible (3000-4000 字 Japanese ≈ 1500-2500 tokens)
  // + reasoning headroom. The 2000-token default exhausted the entire
  // budget on reasoning and produced empty `content`, which created the
  // zero-body L3 page f1eee3c4a119 on 2026-04-25.
  const insightContent = azureGenerateText(contentPrompt, config.azure_openapi_key, {
    maxCompletionTokens: 8000,
  });

  // Defense-in-depth: if azureGenerateText's empty-content guard was ever
  // bypassed (API shape change, wrapper refactor), refuse to create a
  // page with no usable body.
  if (!insightContent || insightContent.trim().length < 200) {
    throw new Error(`L3 content generation produced insufficient output (length=${insightContent ? insightContent.length : 0}). Aborting page creation so handleL3Batch can retry tomorrow.`);
  }

  // Extract abstract (first 200 chars)
  const abstract = insightContent.substring(0, 200);

  // Convert markdown to Notion blocks
  const blocks = markdownToNotionBlocks(insightContent);
  if (blocks.length === 0) {
    throw new Error(`L3 content yielded zero Notion blocks after markdown conversion. Source length=${insightContent.length}.`);
  }

  const today = new Date().toISOString().split('T')[0];
  // Branch on UNIFIED_DB_ID so writes go to the new schema once it's
  // provisioned. The legacy L3 DB property names ("Source Article URLs")
  // collapse to the unified `SourceURLs` rich_text.
  let pageData;
  if (useUnifiedDb(config)) {
    // CategoriesMulti for analyses carries TWO tags: the canonical A-E
    // bucket (so the article shows up under one of the 5 main sidebar
    // entries) plus the free-form × theme as a sub-tag (so the deeper
    // synthesis theme stays browsable). Canonical is derived by
    // majority-vote across the source L2 categories.
    const canonicalBucket = pickCanonicalFromSources(l2Categories);
    const tags = [];
    if (canonicalBucket) tags.push(canonicalBucket);
    if (generatedCategory && tags.indexOf(generatedCategory) === -1) {
      tags.push(generatedCategory);
    }
    pageData = {
      parent: { database_id: config.unified_db_id },
      properties: {
        'Title': { title: [{ text: { content: generatedTitle } }] },
        'Type': { select: { name: 'analysis' } },
        'Status': { select: { name: 'published' } },
        'Abstract': { rich_text: [{ text: { content: abstract } }] },
        'Category': { rich_text: [{ text: { content: generatedCategory } }] },
        'CategoriesMulti': { multi_select: tags.map(name => ({ name })) },
        'SourceURLs': { rich_text: [{ text: { content: l2SourceUrls.join(', ') } }] },
        // fetch-notion.mjs reads this for manifest sort order; empty values
        // sink new entries to the bottom of the home-page list.
        'Date': { date: { start: today } },
      },
      children: blocks,
    };
  } else {
    pageData = {
      parent: { database_id: config.l3_db_id },
      properties: {
        'Title': { title: [{ text: { content: generatedTitle } }] },
        'Abstract': { rich_text: [{ text: { content: abstract } }] },
        'Category': { rich_text: [{ text: { content: generatedCategory } }] },
        'Source Article URLs': { rich_text: [{ text: { content: l2SourceUrls.join(', ') } }] },
        'Date': { date: { start: today } },
      },
      children: blocks,
    };
  }

  const result = notionRequest('POST', '/pages', config.notion_api_key, pageData);
  return {
    success: true,
    data: {
      id: result.id,
      title: generatedTitle,
      l2EntryIds: data.l2EntryIds,
      abstract,
      category: generatedCategory,
      notionUrl: result.url,
    },
  };
}

function handleL3List(config) {
  // In unified mode this lists analysis rows; otherwise the legacy L3 DB.
  const sourceDbId = useUnifiedDb(config) ? config.unified_db_id : config.l3_db_id;
  const pages = notionQueryDatabase(sourceDbId, config.notion_api_key);
  const filtered = useUnifiedDb(config)
    ? pages.filter(p => (p.properties.Type?.select?.name || '') === 'analysis')
    : pages;
  const entries = filtered.map(p => ({
    id: p.id,
    title: p.properties.Title?.title[0]?.plain_text || '',
    abstract: p.properties.Abstract?.rich_text[0]?.plain_text || '',
    category: p.properties.Category?.rich_text[0]?.plain_text || '',
    sourceUrls: p.properties.SourceURLs?.rich_text[0]?.plain_text
      || p.properties['Source Article URLs']?.rich_text[0]?.plain_text
      || '',
    notionUrl: p.url,
  }));

  return { success: true, data: entries };
}

// Forward alias matching the new naming scheme.
function handleAnalysisCreate(data, config) { return handleL3Create(data, config); }

/**
 * List unified articles, filtered by type when requested.
 * `data.type` may be 'explanation' | 'analysis' | undefined (= both).
 * Falls back to the appropriate legacy DB while UNIFIED_DB_ID is unset.
 */
function handleArticleList(data, config) {
  if (!useUnifiedDb(config)) {
    if (data && data.type === 'explanation') return handleL2List(config);
    if (data && data.type === 'analysis') return handleL3List(config);
    return { success: false, error: 'ARTICLE_LIST without UNIFIED_DB_ID requires data.type to be set' };
  }
  const pages = notionQueryDatabase(config.unified_db_id, config.notion_api_key);
  const wanted = data && data.type;
  const filtered = wanted ? pages.filter(p => (p.properties.Type?.select?.name || '') === wanted) : pages;
  const entries = filtered.map(p => ({
    id: p.id,
    title: p.properties.Title?.title[0]?.plain_text || '',
    type: p.properties.Type?.select?.name || '',
    status: p.properties.Status?.select?.name || '',
    abstract: p.properties.Abstract?.rich_text[0]?.plain_text || '',
    category: p.properties.Category?.rich_text[0]?.plain_text || '',
    date: p.properties.Date?.date?.start || '',
    sourceUrls: p.properties.SourceURLs?.rich_text[0]?.plain_text || '',
    legacySlug: p.properties.LegacySlug?.rich_text[0]?.plain_text || '',
    notionUrl: p.url,
  }));
  return { success: true, data: entries };
}

function notionBlocksToMarkdown(blocks) {
  // Convert Notion blocks back to markdown
  let markdown = '';

  for (const block of blocks) {
    try {
      if (block.type === 'heading_2' && block.heading_2) {
        const text = block.heading_2.rich_text.map(t => t.plain_text).join('');
        markdown += '## ' + text + '\n\n';
      } else if (block.type === 'heading_3' && block.heading_3) {
        const text = block.heading_3.rich_text.map(t => t.plain_text).join('');
        markdown += '### ' + text + '\n\n';
      } else if (block.type === 'paragraph' && block.paragraph) {
        const text = block.paragraph.rich_text.map(t => t.plain_text).join('');
        if (text.trim()) {
          markdown += text + '\n\n';
        }
      } else if (block.type === 'bulleted_list_item' && block.bulleted_list_item) {
        const text = block.bulleted_list_item.rich_text.map(t => t.plain_text).join('');
        markdown += '- ' + text + '\n';
      }
    } catch (e) {
      // Skip blocks that can't be converted
      continue;
    }
  }

  return markdown;
}

function notionReadPageBlocks(pageId, apiKey) {
  // Read all blocks from a Notion page
  const result = notionRequest('GET', `/blocks/${pageId}/children?page_size=100`, apiKey);
  return result.results || [];
}

function handleL4Publish(data, config) {
  // Source DB depends on whether the unified rollout is in effect.
  // Pre-migration: legacy L3 DB. Post-migration: unified DB containing
  // both explanation and analysis articles.
  const sourceDbId = useUnifiedDb(config) ? config.unified_db_id : config.l3_db_id;
  const pages = notionQueryDatabase(sourceDbId, config.notion_api_key);
  // Accept either parameter name. Older callers send `l3EntryId`; the
  // type-neutral `articleId` reads better in the unified world.
  const articleId = data.articleId || data.l3EntryId;
  const page = pages.find(p => p.id === articleId);

  if (!page) {
    throw new Error('Article entry not found');
  }

  const title = page.properties.Title?.title[0]?.plain_text
    || page.properties.Name?.title[0]?.plain_text
    || '';
  const abstract = page.properties.Abstract?.rich_text[0]?.plain_text
    || page.properties['Contents Summary']?.rich_text[0]?.plain_text
    || '';
  const category = page.properties.Category?.rich_text[0]?.plain_text
    || page.properties['Sub Category']?.rich_text[0]?.plain_text
    || '';
  const typeProp = page.properties.Type?.select?.name || 'analysis';
  const dateProp = page.properties.Date?.date?.start
    || page.properties['Publication Date']?.date?.start
    || '';
  const date = (dateProp || new Date().toISOString().split('T')[0]).split('T')[0];
  const sourceUrls = page.properties.SourceURLs?.rich_text[0]?.plain_text
    || page.properties['Source Article URLs']?.rich_text[0]?.plain_text
    || '';
  const legacySlug = page.properties.LegacySlug?.rich_text[0]?.plain_text || '';

  const blocks = notionReadPageBlocks(page.id, config.notion_api_key);
  const articleContent = notionBlocksToMarkdown(blocks);

  // Slug resolution: legacySlug wins (preserves prior URLs); otherwise
  // 12-char tail of the Notion page id, matching fetch-notion.mjs's
  // `slugFromId`. The 32-char-UUID format that earlier versions used is
  // now retired — its only output ever lived in main, never gh-pages.
  const slug = legacySlug || page.id.replace(/-/g, '').slice(-12);

  const frontmatter = [
    '---',
    `title: "${(title || '').replace(/"/g, '\\"')}"`,
    `type: "${typeProp}"`,
    `category: "${(category || '').replace(/"/g, '\\"')}"`,
    `date: "${date}"`,
    `abstract: "${(abstract || '').replace(/"/g, '\\"')}"`,
    `image: "/posts/images/${slug}.jpg"`,
    `notionId: "${page.id}"`,
  ];
  if (sourceUrls) frontmatter.push(`sourceUrls: "${sourceUrls.replace(/"/g, '\\"')}"`);
  if (legacySlug) frontmatter.push(`legacySlug: "${legacySlug}"`);
  frontmatter.push('---', '');
  const mdContent = frontmatter.join('\n') + '\n' + articleContent;

  const { url, imageUrl } = githubCreatePost(slug, mdContent, config.gh_token, title, category, config.azure_openapi_key);
  githubUpdateManifest({ slug, title, type: typeProp, category, date, abstract, image: imageUrl, sourceUrls }, config.gh_token);

  // Stamp PublishedAt back on the unified row so re-runs and audits know
  // the publish completed. Best-effort: failures here don't undo the publish.
  if (useUnifiedDb(config)) {
    try {
      notionUpdatePage(page.id, {
        'Status': { select: { name: 'published' } },
        'PublishedAt': { date: { start: new Date().toISOString().split('T')[0] } },
      }, config.notion_api_key);
    } catch (e) {
      // Common cause: PublishedAt property not yet created on the DB.
      // Logged but non-fatal.
      Logger.log('handleL4Publish: failed to update Status/PublishedAt: ' + e.message);
    }
  }

  return {
    success: true,
    data: {
      id: page.id,
      title,
      slug,
      type: typeProp,
      publishedUrl: url,
      status: 'published',
    },
  };
}

function handleL4List(config) {
  const pages = notionQueryDatabase(config.l4_db_id, config.notion_api_key);
  const entries = pages.map(p => ({
    id: p.id,
    title: p.properties.Title.title[0]?.plain_text || '',
    slug: p.properties.Slug?.rich_text[0]?.plain_text || '',
    publishedUrl: p.properties['Published URL']?.url || '',
    status: p.properties.Status?.rich_text[0]?.plain_text || 'published',
  }));

  return { success: true, data: entries };
}

// ─── MAINTENANCE ─────────────────────────────────────────────────────────────

// One-shot backfill: set Date = created_time (date portion) for L3 rows where
// Date is empty. Idempotent — re-running only touches rows still blank.
function handleL3BackfillDate(_data, config) {
  const pages = notionQueryDatabase(config.l3_db_id, config.notion_api_key);
  const updated = [];
  const errors = [];
  for (const p of pages) {
    if (p.properties.Date?.date?.start) continue;
    const createdDate = (p.created_time || '').split('T')[0];
    if (!createdDate) continue;
    try {
      notionUpdatePage(p.id, { 'Date': { date: { start: createdDate } } }, config.notion_api_key);
      updated.push({ id: p.id, date: createdDate });
    } catch (e) {
      errors.push({ id: p.id, error: String(e && e.message || e) });
    }
  }
  return { success: true, data: { updated: updated.length, items: updated, errors } };
}

// ─── DAILY BATCH HANDLERS ────────────────────────────────────────────────────
//
// Three batches run independently on daily triggers. Each is idempotent:
// re-running yields the same next-day result, because "what's done" is derived
// from the target DB (L2 source URLs, manifest slugs), not from a cursor.
// Per-run caps keep each invocation well under the 6-minute GAS timeout.

// L2_BATCH: for each L1 whose source URL isn't yet referenced by any L2,
// create an L2 blog. Oldest-first, up to L2_BATCH_MAX per run.
const L2_BATCH_MAX = 3;
function handleL2Batch(_data, config) {
  // Coverage check pulls from wherever explanation articles live now.
  const sourceDbId = useUnifiedDb(config) ? config.unified_db_id : config.l2_db_id;
  const existingPages = notionQueryDatabase(sourceDbId, config.notion_api_key);
  // Filter to explanation-type rows when reading the unified DB so we
  // don't accidentally treat analyses as covering the same source URL.
  const explanationPages = useUnifiedDb(config)
    ? existingPages.filter(p => (p.properties.Type?.select?.name || '') === 'explanation')
    : existingPages;
  const coveredUrls = new Set();
  for (const p of explanationPages) {
    // Schema-aware: legacy `Source URLs` is a url field; unified
    // `SourceURLs` is rich_text (single URL for explanations).
    const u = p.properties['Source URLs']?.url
      || p.properties.SourceURLs?.rich_text[0]?.plain_text
      || '';
    if (u) coveredUrls.add(u.trim());
  }
  const l1Pages = notionQueryDatabase(config.l1_db_id, config.notion_api_key)
    .slice()
    .sort((a, b) => (a.created_time || '').localeCompare(b.created_time || ''));
  const pending = l1Pages.filter(p => {
    const u = p.properties['Source URL']?.url;
    if (!u || coveredUrls.has(u)) return false;
    // Test/placeholder fixtures must not flow into L2/L3.
    if (/^https?:\/\/(www\.)?example\.com(\/|$)/i.test(u)) return false;
    return true;
  });

  const picked = pending.slice(0, L2_BATCH_MAX);
  const processed = [];
  const errors = [];
  for (const l1 of picked) {
    try {
      const result = handleL2Create({ l1EntryId: l1.id }, config);
      processed.push({ l1Id: l1.id, l2Id: result.data.id, title: result.data.title });
    } catch (e) {
      errors.push({ l1Id: l1.id, error: String(e && e.message || e) });
    }
  }
  return { success: true, data: { processed: processed.length, remaining: pending.length - picked.length, items: processed, errors } };
}

// L3_BATCH: synthesize one L3 insight from a sample of recent L2s.
//
// Rules:
//   1. Skip if no L2 has been created since the last successful L3 run
//      ("L3_LAST_RUN_AT"). This is the "run only when there's something new"
//      guarantee for the previous stage.
//   2. Sample `L3_SAMPLE_SIZE` L2s uniformly from the last L3_RECENT_DAYS.
//   3. The sample is guaranteed to include AT LEAST ONE new L2 (created
//      after L3_LAST_RUN_AT). The remaining picks fill from the broader
//      recent pool.
//   4. Within both the "new" and "fill" pools we prefer L2s that weren't
//      used in the previous L3_AVOID_REUSE_COUNT runs; if that starves the
//      pool, fall back to the full eligible set.
//
// Intended cadence: up to 1 synthesis/day, skipping on no-new-input days.
const L3_RECENT_DAYS = 14;
const L3_SAMPLE_SIZE = 3;
const L3_AVOID_REUSE_COUNT = 10;
const L3_RECENTLY_USED_KEY = 'L3_RECENTLY_USED_L2_IDS';
const L3_LAST_RUN_KEY = 'L3_LAST_RUN_AT';
function handleL3Batch(_data, config) {
  const props = PropertiesService.getScriptProperties();
  const lastRunAt = props.getProperty(L3_LAST_RUN_KEY) || '';
  const cutoff = new Date(Date.now() - L3_RECENT_DAYS * 86400 * 1000).toISOString();

  // Source DB & filtering: in unified mode, restrict to explanation rows.
  const sourceDbId = useUnifiedDb(config) ? config.unified_db_id : config.l2_db_id;
  const candidatePages = notionQueryDatabase(sourceDbId, config.notion_api_key);
  const l2Pages = useUnifiedDb(config)
    ? candidatePages.filter(p => (p.properties.Type?.select?.name || '') === 'explanation')
    : candidatePages;
  const recent = l2Pages.filter(p => (p.created_time || '') >= cutoff);
  // "New" = arrived since the last L3 run. Empty lastRunAt (first run ever)
  // treats everything recent as new, so the first invocation isn't blocked.
  const isNew = (p) => !lastRunAt || (p.created_time || '') > lastRunAt;
  const freshL2 = recent.filter(isNew);

  if (freshL2.length === 0) {
    return { success: true, data: { processed: 0, skipped: true, reason: `no new L2 since last L3 run (${lastRunAt || 'never'})` } };
  }
  if (recent.length < L3_SAMPLE_SIZE) {
    return { success: true, data: { processed: 0, skipped: true, reason: `only ${recent.length} L2 in last ${L3_RECENT_DAYS}d (need ${L3_SAMPLE_SIZE})` } };
  }

  let recentlyUsed = [];
  try { recentlyUsed = JSON.parse(props.getProperty(L3_RECENTLY_USED_KEY) || '[]'); } catch (_) { recentlyUsed = []; }
  const avoid = new Set(recentlyUsed);

  // Fisher-Yates shuffle in place.
  const shuffle = (a) => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  };

  // Required pick: one L2 from freshL2. Prefer non-reused within fresh.
  const freshNonReused = freshL2.filter(p => !avoid.has(p.id));
  const freshPool = freshNonReused.length > 0 ? freshNonReused : freshL2;
  const required = shuffle(freshPool.slice())[0];

  // Fill the rest from the full recent pool (minus the required pick).
  const fillCandidates = recent.filter(p => p.id !== required.id);
  const fillNonReused = fillCandidates.filter(p => !avoid.has(p.id));
  const fillPool = fillNonReused.length >= L3_SAMPLE_SIZE - 1 ? fillNonReused : fillCandidates;
  const fills = shuffle(fillPool.slice()).slice(0, L3_SAMPLE_SIZE - 1);

  const picked = [required, ...fills];
  const pickedIds = picked.map(p => p.id);

  const result = handleL3Create({ l2EntryIds: pickedIds }, config);

  // Stamp "last run" only on success so retries after a failure still see
  // the fresh L2 as new.
  const updated = [...pickedIds, ...recentlyUsed].slice(0, L3_AVOID_REUSE_COUNT);
  props.setProperty(L3_RECENTLY_USED_KEY, JSON.stringify(updated));
  props.setProperty(L3_LAST_RUN_KEY, new Date().toISOString());

  return { success: true, data: { processed: 1, l3Id: result.data.id, title: result.data.title, chosenL2Ids: pickedIds, requiredNewL2Id: required.id } };
}

// L4_BATCH: publish L3s that aren't yet on the site. Source of truth for
// "published" is manifest.json; slug == L3 page id without dashes.
//
// "Pending" here IS the "new on the previous stage" set: an L3 is new to
// L4 iff it has no corresponding slug in the manifest. If a previous
// publish failed, the L3 stays pending and gets retried tomorrow.
// Skip-with-reason when the pending set is empty so the execution log is
// explicit instead of showing a silent zero-iteration loop.
const L4_BATCH_MAX = 2;
function handleL4Batch(_data, config) {
  // Image existence is the source of truth for "this article has been
  // L4-published." Manifest membership is NOT — scheduled fetch-notion
  // runs (deploy.yml cron) add rows to the manifest regardless of
  // whether L4 has imaged them, so manifest-based gating let L4 skip
  // rows whose images had never been generated. Image filenames are
  // stable per slug (handleL4Publish writes <slug>.jpg) so existence
  // is a faithful proxy for "L4 already ran for this article".
  const imagedSlugs = githubListImagedSlugs(config.gh_token);

  // Source DB depends on rollout state. Unified DB carries both
  // explanation and analysis articles; the legacy L3 DB only has analysis.
  const sourceDbId = useUnifiedDb(config) ? config.unified_db_id : config.l3_db_id;
  const pages = notionQueryDatabase(sourceDbId, config.notion_api_key)
    .slice()
    // Date asc → fair coverage: oldest unpublished publishes first.
    .sort((a, b) => {
      const da = (a.properties.Date?.date?.start || a.created_time || '').split('T')[0];
      const db = (b.properties.Date?.date?.start || b.created_time || '').split('T')[0];
      return da.localeCompare(db);
    });

  // For unified rows, slug-for-publish considers LegacySlug first, then
  // 12-char tail. Legacy L3 rows only have the tail option.
  function pendingSlug(p) {
    const legacy = p.properties.LegacySlug?.rich_text[0]?.plain_text || '';
    return legacy || p.id.replace(/-/g, '').slice(-12);
  }

  // For unified rows we additionally honour Status: rows marked
  // 'archived' or 'draft' are explicitly out of band and won't get
  // imaged. Pre-unified runs see no Status property, so this filter
  // is inert.
  const pending = pages.filter(p => {
    if (imagedSlugs.has(pendingSlug(p))) return false;
    if (useUnifiedDb(config)) {
      const status = p.properties.Status?.select?.name || '';
      if (status === 'archived' || status === 'draft') return false;
    }
    return true;
  });

  if (pending.length === 0) {
    return { success: true, data: { processed: 0, skipped: true, reason: 'all eligible articles already imaged' } };
  }

  const picked = pending.slice(0, L4_BATCH_MAX);
  const processed = [];
  const errors = [];
  for (const page of picked) {
    try {
      const result = handleL4Publish({ articleId: page.id }, config);
      processed.push({ articleId: page.id, slug: result.data.slug, title: result.data.title, type: result.data.type });
    } catch (e) {
      errors.push({ articleId: page.id, error: String(e && e.message || e) });
    }
  }
  return { success: true, data: { processed: processed.length, remaining: pending.length - picked.length, items: processed, errors } };
}

// ─── TIME-DRIVEN TRIGGERS ────────────────────────────────────────────────────
// Run `setupDailyTriggers` ONCE from the GAS editor to install the schedule.
// Wrappers are what GAS invokes; keep them thin so the handlers stay testable
// via doPost (L2_BATCH / L3_BATCH / L4_BATCH actions).

function runL2Batch() { return handleL2Batch({}, getConfig()); }
function runL3Batch() { return handleL3Batch({}, getConfig()); }
function runL4Batch() { return handleL4Batch({}, getConfig()); }

function setupDailyTriggers() {
  const wanted = ['runL2Batch', 'runL3Batch', 'runL4Batch'];
  ScriptApp.getProjectTriggers().forEach(t => {
    if (wanted.indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });
  // 1-hour gaps give each batch the full 6-min timeout without overlap.
  // Hours are in Asia/Tokyo (see appsscript.json).
  ScriptApp.newTrigger('runL2Batch').timeBased().atHour(9).everyDays(1).create();
  ScriptApp.newTrigger('runL3Batch').timeBased().atHour(10).everyDays(1).create();
  ScriptApp.newTrigger('runL4Batch').timeBased().atHour(11).everyDays(1).create();
  return 'Installed: runL2Batch 09:00 JST, runL3Batch 10:00 JST, runL4Batch 11:00 JST';
}

// ─── ONE-SHOT SETUP (run from GAS editor) ────────────────────────────────────
//
// Setting Script Properties via the GAS UI is fiddly (Project Settings →
// Script Properties → Add → key/value), so we expose a manual-trigger
// helper. Run `setupUnifiedDbId` once from the editor's "Run" button to
// stamp the unified DB id, then this function can stay in source as a
// no-op safety net (it's idempotent — overwriting with the same value
// is harmless) or be deleted in a later cleanup.

function setupUnifiedDbId() {
  // Created via Notion API on 2026-04-27 under page
  // https://www.notion.so/Articles-Unified-container-34fd0f0be61e81d588d5dca96fbadee1
  const id = '34fd0f0b-e61e-817a-9f6b-dc65b0d5b4cc';
  PropertiesService.getScriptProperties().setProperty('UNIFIED_DB_ID', id);
  return 'UNIFIED_DB_ID set to ' + id;
}

// ─── HTTP ENTRY POINT ────────────────────────────────────────────────────────

function createCorsResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON)
    .append('\n');
}

function doPost(e) {
  try {
    const data = e.postData.contents ? JSON.parse(e.postData.contents) : {};
    const action = data.action || e.parameter.action;
    const config = getConfig();

    let response;

    switch (action) {
      case 'L1_SAVE':
        response = handleL1Save(data, config);
        break;
      case 'L1_LIST':
        response = handleL1List(config);
        break;
      // L2_CREATE / L3_CREATE remain for backward compat. New callers
      // should send EXPLANATION_CREATE / ANALYSIS_CREATE which read more
      // naturally now that the legacy L2/L3 distinction is collapsing.
      case 'L2_CREATE':
      case 'EXPLANATION_CREATE':
        response = handleExplanationCreate(data, config);
        break;
      case 'L2_LIST':
        response = handleL2List(config);
        break;
      case 'L3_CREATE':
      case 'ANALYSIS_CREATE':
        response = handleAnalysisCreate(data, config);
        break;
      case 'L3_LIST':
        response = handleL3List(config);
        break;
      case 'ARTICLE_LIST':
        response = handleArticleList(data, config);
        break;
      case 'L4_PUBLISH':
        response = handleL4Publish(data, config);
        break;
      case 'L4_LIST':
        response = handleL4List(config);
        break;
      case 'L2_BATCH':
        response = handleL2Batch(data, config);
        break;
      case 'L3_BATCH':
        response = handleL3Batch(data, config);
        break;
      case 'L4_BATCH':
        response = handleL4Batch(data, config);
        break;
      case 'REBUILD_MANIFEST':
        response = rebuildManifestFromNotion(config);
        break;
      case 'L3_BACKFILL_DATE':
        response = handleL3BackfillDate(data, config);
        break;
      default:
        response = { success: false, error: `Unknown action: ${action}` };
    }

    return createCorsResponse(response);
  } catch (error) {
    return createCorsResponse({ success: false, error: error.message });
  }
}

function doOptions(e) {
  // Handle CORS preflight requests
  const output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.TEXT);
  return output;
}

function doGet(e) {
  // Handle GET requests - redirect to API documentation or return info
  return ContentService.createTextOutput(
    JSON.stringify({
      success: false,
      error: 'This is a POST-only API. Use POST requests with {"action":"..."}',
      supportedActions: ['L1_SAVE', 'L1_LIST', 'L2_CREATE', 'EXPLANATION_CREATE', 'L2_LIST', 'L2_BATCH', 'L3_CREATE', 'ANALYSIS_CREATE', 'L3_LIST', 'L3_BATCH', 'ARTICLE_LIST', 'L3_BACKFILL_DATE', 'L4_PUBLISH', 'L4_LIST', 'L4_BATCH', 'REBUILD_MANIFEST']
    })
  ).setMimeType(ContentService.MimeType.JSON);
}
