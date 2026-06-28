// Minimal Notion API wrapper. Operations:
//   - insertArticle: insert a page into the unified Articles DB (legacy path).
//   - insertL1Source / findL1SourceByUrl: register / look up a row in the L1
//     source DB — the non-GAS replacement for the retired GAS `L1_SAVE`
//     capture, used by the wf-l1-source-register Lambda. No LLM call.

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

// ── L1 source capture (non-GAS replacement for GAS handleL1Save) ───────────

/** Only `apiKey` is read for L1 writes; the L1 DB id is passed explicitly
 *  (it is a different DB from `wf/notion`'s `databaseId`, the Articles DB). */
export interface NotionApiSecret {
  apiKey: string;
}

export interface InsertL1SourceInput {
  apiKey: string;
  databaseId: string;
  url: string;
  title?: string;
  category?: string;
  summary?: string;
  publicationDate?: string; // YYYY-MM-DD
}

export interface L1SourceRef {
  pageId: string;
  url: string;
}

function notionHeaders(apiKey: string): Record<string, string> {
  return {
    authorization: `Bearer ${apiKey}`,
    "notion-version": NOTION_VERSION,
    "content-type": "application/json",
  };
}

// Property names mirror the schema pick-l1-source.mjs reads and the retired
// GAS handleL1Save wrote: Title (title), Source URL (url), Category
// (rich_text), Contents Summary (rich_text), Publication Date (date).
// Title defaults to the URL when absent — no model is consulted.
export async function insertL1Source(
  input: InsertL1SourceInput,
): Promise<L1SourceRef> {
  const properties: Record<string, unknown> = {
    Title: { title: [{ text: { content: (input.title || input.url).slice(0, 2000) } }] },
    "Source URL": { url: input.url },
  };
  if (input.category) {
    properties["Category"] = { rich_text: [{ text: { content: input.category.slice(0, 200) } }] };
  }
  if (input.summary) {
    properties["Contents Summary"] = { rich_text: [{ text: { content: input.summary.slice(0, 2000) } }] };
  }
  if (input.publicationDate) {
    properties["Publication Date"] = { date: { start: input.publicationDate } };
  }

  const res = await fetch(`${NOTION_API}/pages`, {
    method: "POST",
    headers: notionHeaders(input.apiKey),
    body: JSON.stringify({ parent: { database_id: input.databaseId }, properties }),
  });
  if (!res.ok) {
    throw new Error(`notion ${res.status}: ${(await res.text()).slice(0, 500)}`);
  }
  const data = (await res.json()) as { id: string; url: string };
  return { pageId: data.id, url: data.url };
}

export interface L1SourceRow {
  id: string;
  title: string;
  sourceUrl: string;
  category: string;
  contentsSummary: string;
  publicationDate: string;
  notionUrl: string;
  createdAt: string;
}

const txt = (rt: unknown): string => {
  const arr = rt as Array<{ plain_text?: string }> | undefined;
  return (arr ?? []).map((t) => t?.plain_text ?? "").join("");
};

/** Recent L1 source rows for the Capture UI list/streak. Newest-first. */
export async function listL1Sources(args: {
  apiKey: string;
  databaseId: string;
  limit?: number;
}): Promise<L1SourceRow[]> {
  const res = await fetch(`${NOTION_API}/databases/${args.databaseId}/query`, {
    method: "POST",
    headers: notionHeaders(args.apiKey),
    body: JSON.stringify({
      sorts: [{ timestamp: "created_time", direction: "descending" }],
      page_size: Math.min(args.limit ?? 50, 100),
    }),
  });
  if (!res.ok) {
    throw new Error(`notion ${res.status}: ${(await res.text()).slice(0, 500)}`);
  }
  const data = (await res.json()) as {
    results?: Array<{
      id: string;
      url: string;
      created_time: string;
      properties: Record<string, { type: string; [k: string]: unknown }>;
    }>;
  };
  return (data.results ?? []).map((p) => {
    const props = p.properties ?? {};
    const prop = (name: string) => props[name] as Record<string, unknown> | undefined;
    return {
      id: p.id,
      title: txt(prop("Title")?.title),
      sourceUrl: (prop("Source URL")?.url as string) ?? "",
      category: txt(prop("Category")?.rich_text),
      contentsSummary: txt(prop("Contents Summary")?.rich_text),
      publicationDate: ((prop("Publication Date")?.date as { start?: string } | undefined)?.start) ?? "",
      notionUrl: p.url,
      createdAt: p.created_time,
    };
  });
}

/** Idempotency lookup: returns the first L1 row whose `Source URL` equals
 *  `url`, or null. Lets the capture endpoint dedupe re-submits. */
export async function findL1SourceByUrl(args: {
  apiKey: string;
  databaseId: string;
  url: string;
}): Promise<L1SourceRef | null> {
  const res = await fetch(`${NOTION_API}/databases/${args.databaseId}/query`, {
    method: "POST",
    headers: notionHeaders(args.apiKey),
    body: JSON.stringify({
      filter: { property: "Source URL", url: { equals: args.url } },
      page_size: 1,
    }),
  });
  if (!res.ok) {
    throw new Error(`notion ${res.status}: ${(await res.text()).slice(0, 500)}`);
  }
  const data = (await res.json()) as { results?: Array<{ id: string; url: string }> };
  const hit = data.results?.[0];
  return hit ? { pageId: hit.id, url: hit.url } : null;
}
