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
  };
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

// ─── AZURE OPENAI ────────────────────────────────────────────────────────────

function azureGenerateText(prompt, apiKey) {
  const endpoint = 'https://rg-phd-openai-uehara.openai.azure.com/';
  const deploymentId = 'gpt-4o-mini';
  const apiVersion = '2024-12-01-preview';
  const url = `${endpoint}openai/deployments/${deploymentId}/chat/completions?api-version=${apiVersion}`;

  const payload = {
    messages: [
      {
        role: 'system',
        content: 'You are a skilled tech writer creating high-quality AI industry insights.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
    temperature: 0.7,
    max_tokens: 2000,
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
    throw new Error(`Azure OpenAI error ${status}: ${content}`);
  }

  const result = JSON.parse(content);
  return result.choices?.[0]?.message?.content || '';
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
  const prompt = `Create a professional blog article header image (1200x630px) with Swiss design aesthetic.
Title: "${title}"
Category: ${category}
Style: Minimalist, geometric, clean typography. Use colors: dark gray (#5e5e5e), red (#c1000a), light surface (#f9f9fb).
Include the title and category label. Use modern sans-serif font. Add geometric shapes or accent bars in red.
NO text overlay - just design elements. Professional tech/AI industry look.`;

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
  const imageUrl = result.data?.[0]?.url;

  if (!imageUrl) {
    throw new Error(`No image URL returned from Azure OpenAI. Response: ${JSON.stringify(result)}`);
  }

  // Fetch the image and convert to base64
  const imageResponse = UrlFetchApp.fetch(imageUrl);
  const imageBlob = imageResponse.getBlob();
  const base64Image = Utilities.base64Encode(imageBlob.getBytes());

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
    slug: p.id.replace(/-/g, '').substring(0, 12), // Use shorter ID as slug
    title: p.properties.Title.title[0]?.plain_text || '',
    category: p.properties.Category?.rich_text[0]?.plain_text || '',
    date: new Date().toISOString().split('T')[0],
    abstract: p.properties.Abstract?.rich_text[0]?.plain_text || '',
    image: `/posts/images/${p.id.replace(/-/g, '').substring(0, 12)}.jpg`,
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

  const properties = {
    'Name': { title: [{ text: { content: blogTitle } }] },
    'Publication Date': { date: { start: new Date().toISOString().split('T')[0] } },
    'Source URLs': { url: l1SourceUrl },
    'Sub Category': { rich_text: [{ text: { content: l1Category } }] },
    'Contents Summary': { rich_text: [{ text: { content: l1Summary } }] },
    '実務への使い道': { rich_text: [{ text: { content: 'AIのビジネス応用に関する実務的な洞察' } }] },
  };

  const pageData = {
    parent: { database_id: config.l2_db_id },
    properties: properties,
    children: blocks,
  };

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

function markdownToNotionBlocks(mdText) {
  const blocks = [];
  const lines = mdText.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('## ')) {
      blocks.push({
        object: 'block',
        type: 'heading_2',
        heading_2: { rich_text: [{ type: 'text', text: { content: trimmed.substring(3) } }] }
      });
    } else if (trimmed.startsWith('### ')) {
      blocks.push({
        object: 'block',
        type: 'heading_3',
        heading_3: { rich_text: [{ type: 'text', text: { content: trimmed.substring(4) } }] }
      });
    } else if (trimmed.startsWith('- ')) {
      blocks.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: { rich_text: [{ type: 'text', text: { content: trimmed.substring(2) } }] }
      });
    } else if (trimmed.startsWith('* ')) {
      blocks.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: { rich_text: [{ type: 'text', text: { content: trimmed.substring(2) } }] }
      });
    } else {
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: { rich_text: [{ type: 'text', text: { content: trimmed } }] }
      });
    }
  }

  return blocks;
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
  const l2Pages = notionQueryDatabase(config.l2_db_id, config.notion_api_key);
  const selectedL2 = l2Pages.filter(p => data.l2EntryIds.includes(p.id));
  const l2Titles = selectedL2.map(p => p.properties.Name.title[0]?.plain_text || '');
  const l2Summaries = selectedL2.map(p => p.properties['Contents Summary']?.rich_text[0]?.plain_text || '');
  const l2SourceUrls = selectedL2.map(p => p.properties['Source URLs']?.url || '');
  const l2Categories = selectedL2.map(p => p.properties['Sub Category']?.rich_text[0]?.plain_text || '');

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
  const insightContent = azureGenerateText(contentPrompt, config.azure_openapi_key);

  // Extract abstract (first 200 chars)
  const abstract = insightContent.substring(0, 200);

  // Convert markdown to Notion blocks
  const blocks = markdownToNotionBlocks(insightContent);

  const properties = {
    'Title': { title: [{ text: { content: generatedTitle } }] },
    'Abstract': { rich_text: [{ text: { content: abstract } }] },
    'Category': { rich_text: [{ text: { content: generatedCategory } }] },
    'Source Article URLs': { rich_text: [{ text: { content: l2SourceUrls.join(', ') } }] },
  };

  const pageData = {
    parent: { database_id: config.l3_db_id },
    properties: properties,
    children: blocks,
  };

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
  const pages = notionQueryDatabase(config.l3_db_id, config.notion_api_key);
  const entries = pages.map(p => ({
    id: p.id,
    title: p.properties.Title.title[0]?.plain_text || '',
    abstract: p.properties.Abstract?.rich_text[0]?.plain_text || '',
    category: p.properties.Category?.rich_text[0]?.plain_text || '',
    sourceUrls: p.properties['Source Article URLs']?.rich_text[0]?.plain_text || '',
    notionUrl: p.url,
  }));

  return { success: true, data: entries };
}

function handleL4Publish(data, config) {
  const l3Pages = notionQueryDatabase(config.l3_db_id, config.notion_api_key);
  const l3Page = l3Pages.find(p => p.id === data.l3EntryId);

  if (!l3Page) {
    throw new Error('L3 entry not found');
  }

  const title = l3Page.properties.Title.title[0]?.plain_text || '';
  const abstract = l3Page.properties.Abstract?.rich_text[0]?.plain_text || '';
  const category = l3Page.properties.Category?.rich_text[0]?.plain_text || '';
  const date = new Date().toISOString().split('T')[0];

  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50);
  const mdContent = `---\ntitle: "${title}"\ncategory: "${category}"\ndate: "${date}"\nabstract: "${abstract}"\nimage: "/posts/images/${slug}.jpg"\nnotionId: "${l3Page.id}"\n---\n\n${abstract}\n`;

  const { url, imageUrl } = githubCreatePost(slug, mdContent, config.gh_token, title, category, config.azure_openapi_key);
  githubUpdateManifest({ slug, title, category, date, abstract, image: imageUrl }, config.gh_token);

  return {
    success: true,
    data: {
      id: l3Page.id,
      title,
      slug,
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
      case 'L2_CREATE':
        response = handleL2Create(data, config);
        break;
      case 'L2_LIST':
        response = handleL2List(config);
        break;
      case 'L3_CREATE':
        response = handleL3Create(data, config);
        break;
      case 'L3_LIST':
        response = handleL3List(config);
        break;
      case 'L4_PUBLISH':
        response = handleL4Publish(data, config);
        break;
      case 'L4_LIST':
        response = handleL4List(config);
        break;
      case 'REBUILD_MANIFEST':
        response = rebuildManifestFromNotion(config);
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
      supportedActions: ['L1_SAVE', 'L1_LIST', 'L2_CREATE', 'L2_LIST', 'L3_CREATE', 'L3_LIST', 'L4_PUBLISH', 'L4_LIST']
    })
  ).setMimeType(ContentService.MimeType.JSON);
}
