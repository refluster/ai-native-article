// Minimal Notion API wrapper. One operation: insert a page into the
// article database with title, body, author, kind, sourceUrl, provenance.
// Existing GAS L4 picks it up by `status=ready_for_L4`.

import { getSecret, type NotionSecret } from "./secrets.js";

const NOTION_VERSION = "2022-06-28";
const NOTION_API = "https://api.notion.com/v1";

export interface InsertArticleInput {
  title: string;
  bodyMarkdown: string;
  author: string;
  kind: string;
  sourceUrl?: string;
  provenance?: string;
}

export interface InsertArticleResult {
  pageId: string;
  url: string;
}

export async function insertArticle(input: InsertArticleInput): Promise<InsertArticleResult> {
  const { apiKey, databaseId } = await getSecret<NotionSecret>("wf/notion");

  const properties: Record<string, unknown> = {
    Name: { title: [{ text: { content: input.title.slice(0, 2000) } }] },
    Author: { select: { name: input.author } },
    Kind: { select: { name: input.kind } },
    Status: { select: { name: "ready_for_L4" } },
  };
  if (input.sourceUrl) properties["SourceURL"] = { url: input.sourceUrl };
  if (input.provenance) {
    properties["Provenance"] = { select: { name: input.provenance } };
  }

  // Notion API accepts up to 100 block children per request; long
  // articles must be split into multiple requests. v1: assume body fits
  // (L0->L1 articles are < 1500 words, well under the per-block limit).
  // Add chunked-append in a follow-up when articles grow.
  const children = toRichBlocks(input.bodyMarkdown);

  const res = await fetch(`${NOTION_API}/pages`, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${apiKey}`,
      "notion-version": NOTION_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      parent: { database_id: databaseId },
      properties,
      children,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`notion ${res.status}: ${body.slice(0, 500)}`);
  }
  const data = (await res.json()) as { id: string; url: string };
  return { pageId: data.id, url: data.url };
}

// Treat each non-empty line as a paragraph block. v1 keeps this dumb on
// purpose — the article markdown is the source of truth in S3; Notion
// is just the publish pipeline target. Richer block conversion is a
// follow-up if needed.
function toRichBlocks(md: string): Array<Record<string, unknown>> {
  return md
    .split(/\n\s*\n/)
    .map((para) => para.trim())
    .filter((para) => para.length > 0)
    .slice(0, 90) // safety: Notion accepts up to 100 children per request
    .map((para) => ({
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: [{ type: "text", text: { content: para.slice(0, 2000) } }],
      },
    }));
}
