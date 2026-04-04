/**
 * AI Content Pipeline - Google Apps Script
 * Handles L1→L4 article creation and publishing
 */

function getConfig() {
  const props = PropertiesService.getScriptProperties();
  return {
    gh_token: props.getProperty('GH_TOKEN') || '',
    notion_api_key: props.getProperty('NOTION_API_KEY') || '',
    azure_openapi_key: props.getProperty('AZURE_OPENAPI_KEY') || '',
    l1_db_id: '32fd0f0b-e61e-80bd-89bf-f94965d05e80',
    l2_db_id: props.getProperty('L2_DB_ID') || '',
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
  const endpoint = 'https://koh-uehara-ai.openai.azure.com/';
  const deploymentId = 'gpt-4o-mini';
  const apiVersion = '2024-08-01-preview';
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
  const result = githubRequest('GET', '/contents/public/posts/manifest.json?ref=gh-pages', token);
  const content = Utilities.newBlob(Utilities.base64Decode(result.content)).getDataAsString();
  return JSON.parse(content);
}

function githubUpdateManifest(entry, token) {
  const manifest = githubReadManifest(token);
  manifest.push(entry);
  manifest.sort((a, b) => b.date.localeCompare(a.date));

  const result = githubRequest('GET', '/contents/public/posts/manifest.json?ref=gh-pages', token);
  const sha = result.sha;

  githubRequest('PUT', '/contents/public/posts/manifest.json', token, {
    message: `Add article: ${entry.title}`,
    content: Utilities.base64Encode(JSON.stringify(manifest, null, 2)),
    branch: 'gh-pages',
    sha,
  });
}

function githubCreatePost(slug, mdContent, token) {
  const result = githubRequest('PUT', `/contents/public/posts/${slug}.md`, token, {
    message: `Add article: ${slug}`,
    content: Utilities.base64Encode(mdContent),
    branch: 'gh-pages',
  });

  return {
    url: result.content?.html_url || '',
    slug,
  };
}

// ─── HANDLERS ────────────────────────────────────────────────────────────────

function handleL1Save(data, config) {
  const properties = {
    'Title': { title: [{ text: { content: data.title } }] },
    'Source URL': { url: data.sourceUrl },
    'Category': { rich_text: [{ text: { content: data.category } }] },
    'Contents Summary': { rich_text: [{ text: { content: data.contentsSummary } }] },
    'Publication Date': { date: { start: data.publicationDate } },
  };

  const result = notionCreatePage(config.l1_db_id, properties, config.notion_api_key);
  return {
    success: true,
    data: { ...data, id: result.id, notionUrl: result.url },
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
  const selectedL1 = l1Pages.filter(p => data.l1EntryIds.includes(p.id));
  const l1Titles = selectedL1.map(p => p.properties.Title.title[0]?.plain_text || '');
  const l1Summaries = selectedL1.map(p => p.properties['Contents Summary'].rich_text[0]?.plain_text || '');

  const sourceList = l1Titles.map((t, i) => `- ${t}: ${l1Summaries[i]}`).join('\n');
  const prompt = `Based on these AI industry news items:\n\n${sourceList}\n\nWrite a comprehensive blog article (800-1200 words) that synthesizes themes, explains implications, includes examples, and discusses opportunities and challenges. Format as Markdown with # for headings.`;
  const blogContent = azureGenerateText(prompt, config.azure_openapi_key);

  const properties = {
    'Title': { title: [{ text: { content: data.title } }] },
    'L1 References': { relation: data.l1EntryIds.map(id => ({ id })) },
    'Content': { rich_text: [{ text: { content: blogContent.substring(0, 2000) } }] },
    'Status': { rich_text: [{ text: { content: 'draft' } }] },
  };

  const result = notionCreatePage(config.l2_db_id, properties, config.notion_api_key);
  return {
    success: true,
    data: {
      id: result.id,
      title: data.title,
      l1EntryIds: data.l1EntryIds,
      blogContent,
      status: 'draft',
      notionUrl: result.url,
    },
  };
}

function handleL4Publish(data, config) {
  const l3Pages = notionQueryDatabase(config.l3_db_id, config.notion_api_key);
  const selectedL3 = l3Pages.filter(p => data.l3EntryIds.includes(p.id));

  const publishedEntries = [];

  selectedL3.forEach(l3Page => {
    const title = l3Page.properties.Title.title[0]?.plain_text || '';
    const abstract = l3Page.properties.Abstract?.rich_text[0]?.plain_text || '';
    const category = l3Page.properties.Category?.rich_text[0]?.plain_text || '';
    const date = new Date().toISOString().split('T')[0];

    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50);
    const mdContent = `---\ntitle: "${title}"\ncategory: "${category}"\ndate: "${date}"\nabstract: "${abstract}"\nnotionId: "${l3Page.id}"\n---\n\n${abstract}\n`;

    const { url } = githubCreatePost(slug, mdContent, config.gh_token);
    githubUpdateManifest({ slug, title, category, date, abstract }, config.gh_token);

    notionUpdatePage(l3Page.id, {
      'Status': { rich_text: [{ text: { content: 'published' } }] },
    }, config.notion_api_key);

    publishedEntries.push({
      id: l3Page.id,
      title,
      slug,
      publishedUrl: url,
      status: 'published',
    });
  });

  return { success: true, data: publishedEntries };
}

// ─── HTTP ENTRY POINT ────────────────────────────────────────────────────────

function doPost(e) {
  try {
    const action = e.parameter.action;
    const data = e.postData.contents ? JSON.parse(e.postData.contents) : {};
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
      case 'L4_PUBLISH':
        response = handleL4Publish(data, config);
        break;
      default:
        response = { success: false, error: `Unknown action: ${action}` };
    }

    return ContentService.createTextOutput(JSON.stringify(response)).setMimeType(
      ContentService.MimeType.JSON
    );
  } catch (error) {
    return ContentService.createTextOutput(
      JSON.stringify({ success: false, error: error.message })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}
