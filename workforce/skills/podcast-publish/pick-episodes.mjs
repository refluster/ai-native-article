#!/usr/bin/env node
// podcast-publish picker — list up to N oldest episodes at a given podcastStatus,
// so the publish cadence can set the voice + show-notes params on each. Mirror of
// the article-level2 picker shape (query the unified DB, filter, oldest-first)
// keyed on the `status`-type podcastStatus property.
//
// Output (stdout, single JSON line): { episodes: [{pageId, slug, title}, …] }
// (empty array ⇒ nothing to do — the skill skips, producing no write).
//
// NOTION_API_KEY from credentials["notion.integration_token"].apiKey. DB id is
// a non-secret constant (overridable by NOTION_DB_ID).
//
// Usage:
//   NOTION_API_KEY=… node pick-episodes.mjs --status approved [--limit 5]
//
// Exit: 0 printed (pick or empty), 1 bad env, 3 Notion/network error.

const NOTION_VERSION = "2022-06-28";
const NOTION_API = "https://api.notion.com/v1";
const UNIFIED_DB_ID = process.env.NOTION_DB_ID || "34fd0f0b-e61e-817a-9f6b-dc65b0d5b4cc";

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}
const apiKey = process.env.NOTION_API_KEY;
const status = (arg("status", "") || "").toLowerCase();
const limit = Number(arg("limit", "5"));
if (!apiKey) { console.error("pick-episodes.mjs: NOTION_API_KEY is required"); process.exit(1); }
if (!status) { console.error("pick-episodes.mjs: --status <podcastStatus> is required"); process.exit(1); }

function propText(prop) {
  if (!prop) return "";
  switch (prop.type) {
    case "title": return (prop.title ?? []).map((t) => t.plain_text).join("");
    case "rich_text": return (prop.rich_text ?? []).map((t) => t.plain_text).join("");
    case "url": return prop.url ?? "";
    case "select": return prop.select?.name ?? "";
    case "status": return prop.status?.name ?? "";
    default: return "";
  }
}
async function queryAll(databaseId) {
  const pages = []; let cursor;
  do {
    const res = await fetch(`${NOTION_API}/databases/${databaseId}/query`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "notion-version": NOTION_VERSION, "content-type": "application/json" },
      body: JSON.stringify(cursor ? { start_cursor: cursor, page_size: 100 } : { page_size: 100 }),
    });
    if (!res.ok) throw new Error(`query ${databaseId} → HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    pages.push(...(data.results ?? []));
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return pages;
}
const slugFromId = (id) => String(id).replace(/-/g, "").slice(0, 12);

try {
  const pages = await queryAll(UNIFIED_DB_ID);
  const episodes = pages
    .filter((p) => propText(p.properties?.podcastStatus).toLowerCase() === status)
    .sort((a, b) => (a.created_time ?? "").localeCompare(b.created_time ?? ""))
    .slice(0, Math.max(0, limit))
    .map((p) => ({
      pageId: p.id,
      slug: propText(p.properties?.LegacySlug) || slugFromId(p.id),
      title: propText(p.properties?.Title),
    }));
  console.log(JSON.stringify({ episodes }));
  process.exit(0);
} catch (err) {
  console.error(`pick-episodes.mjs: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(3);
}
