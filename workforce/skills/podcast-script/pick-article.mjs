#!/usr/bin/env node
// podcast-script picker — choose ONE analysis (L3/L4) article that has no
// podcast yet, oldest first, so the Cadence turns the back-catalogue into
// episodes deterministically. Mirror of article-level2/pick-l1-source.mjs in
// shape (query the unified Articles DB, apply the coverage filter, oldest-first,
// emit JSON or a skip), but the "coverage" key here is the article's own
// `podcastStatus` property rather than a separate covered-URL set.
//
// Eligibility (all must hold):
//   - Type == "analysis"                          (the L3/L4 synthesis articles)
//   - Status == "published"                        (only cast what's live)
//   - podcastStatus is empty or "none"             (no podcast exists yet)
//
// Output (stdout, single JSON line):
//   { pageId, slug, title, sourceUrls, date }      — the chosen article, or
//   { skip: true, reason }                          — nothing eligible this fire
//
// The chosen article's BODY is not returned here (it can be large); the SKILL
// instructs the agent to ground the script in the published article markdown
// (kohuehara.xyz) and the cited sources. `sourceUrls` is the citation seed.
//
// NOTION_API_KEY comes from the task's injected
// credentials["notion.integration_token"].apiKey. The unified DB id is a
// non-secret constant (already committed in article-level2 + the pipeline),
// overridable by NOTION_DB_ID for tests.
//
// Exit codes:
//   0  — printed a pick OR a skip (both are success; read the JSON)
//   1  — bad env (no API key)
//   3  — Notion API / network error

const NOTION_VERSION = "2022-06-28";
const NOTION_API = "https://api.notion.com/v1";
const UNIFIED_DB_ID = process.env.NOTION_DB_ID || "34fd0f0b-e61e-817a-9f6b-dc65b0d5b4cc";

const apiKey = process.env.NOTION_API_KEY;
if (!apiKey) {
  console.error("pick-article.mjs: NOTION_API_KEY is required (credentials['notion.integration_token'].apiKey)");
  process.exit(1);
}

function propText(prop) {
  if (!prop) return "";
  switch (prop.type) {
    case "title": return (prop.title ?? []).map((t) => t.plain_text).join("");
    case "rich_text": return (prop.rich_text ?? []).map((t) => t.plain_text).join("");
    case "date": return prop.date?.start ?? "";
    case "url": return prop.url ?? "";
    case "select": return prop.select?.name ?? "";
    case "multi_select": return (prop.multi_select ?? []).map((o) => o.name).join(", ");
    default: return "";
  }
}

async function queryAll(databaseId) {
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

function slugFromId(id) {
  return String(id).replace(/-/g, "").slice(0, 12);
}

try {
  const pages = await queryAll(UNIFIED_DB_ID);
  const eligible = pages
    .filter((p) => {
      const props = p.properties ?? {};
      if (propText(props.Type) !== "analysis") return false;
      if (propText(props.Status) !== "published") return false;
      const podStatus = propText(props.podcastStatus).trim().toLowerCase();
      if (podStatus && podStatus !== "none") return false; // already has a podcast in flight/done
      return true;
    })
    .sort((a, b) => (a.created_time ?? "").localeCompare(b.created_time ?? ""));

  if (eligible.length === 0) {
    console.log(JSON.stringify({ skip: true, reason: "no published analysis article without a podcast" }));
    process.exit(0);
  }

  const page = eligible[0];
  const props = page.properties ?? {};
  const legacySlug = propText(props.LegacySlug);
  const slug = legacySlug || slugFromId(page.id);
  const out = {
    pageId: page.id,
    slug,
    title: propText(props.Title),
    sourceUrls:
      propText(props.SourceURLs) ||
      propText(props["Source Article URLs"]) ||
      propText(props["Source URLs"]),
    date: propText(props.Date) || (page.created_time ?? "").slice(0, 10),
  };
  console.log(JSON.stringify(out));
  process.exit(0);
} catch (err) {
  console.error(`pick-article.mjs: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(3);
}
