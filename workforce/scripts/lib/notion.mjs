// Shared Notion read helpers for the workforce skill scripts.
//
// `propText()` was copy-pasted across the podcast pickers, and the copies had
// already drifted: podcast-publish/pick-episodes.mjs was missing the `date` and
// `multi_select` cases that podcast-script/pick-article.mjs carried. That is the
// #393 failure shape — one reader learns a property type, the others don't, and
// episodes get silently misclassified. One module, one reader, so they cannot
// diverge again.
//
// Kept dependency-free (global fetch, Node 18+) so a skill script can import it
// without any bundling step, the same way the skills already import
// scripts/lib/truncation.mjs.

import "../../../scripts/lib/proxy-bootstrap.mjs";

export const NOTION_VERSION = "2022-06-28";
export const NOTION_API = "https://api.notion.com/v1";

// Non-secret constant (already committed in article-level2 + the pipeline),
// overridable by NOTION_DB_ID for tests.
export const UNIFIED_DB_ID =
  process.env.NOTION_DB_ID || "34fd0f0b-e61e-817a-9f6b-dc65b0d5b4cc";

/**
 * Read a Notion property of any supported type down to plain text.
 *
 * The `status` and `select` cases are deliberately both present and distinct:
 * `podcastStatus` is a `status`-type property, and a reader that only knows
 * `select` silently returns "" for every episode — the #393 bug.
 *
 * An unsupported type returns "" rather than throwing: callers filter on the
 * result, and a Notion schema addition should not crash a picker mid-cadence.
 */
export function propText(prop) {
  if (!prop) return "";
  switch (prop.type) {
    case "title": return (prop.title ?? []).map((t) => t.plain_text).join("");
    case "rich_text": return (prop.rich_text ?? []).map((t) => t.plain_text).join("");
    case "date": return prop.date?.start ?? "";
    case "url": return prop.url ?? "";
    case "select": return prop.select?.name ?? "";
    case "status": return prop.status?.name ?? "";
    case "multi_select": return (prop.multi_select ?? []).map((o) => o.name).join(", ");
    default: return "";
  }
}

/** Page through a Notion database query until the cursor is exhausted. */
export async function queryAll(apiKey, databaseId) {
  const pages = [];
  let cursor;
  do {
    const res = await fetch(`${NOTION_API}/databases/${databaseId}/query`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "notion-version": NOTION_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify(cursor ? { start_cursor: cursor, page_size: 100 } : { page_size: 100 }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`query ${databaseId} → HTTP ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = await res.json();
    pages.push(...(data.results ?? []));
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return pages;
}

/** Stable fallback slug for a page with no LegacySlug. */
export function slugFromId(id) {
  return String(id).replace(/-/g, "").slice(0, 12);
}
