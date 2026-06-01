#!/usr/bin/env node
// L1 source picker for the article-level2 (L1→L2) skill — the read half of
// the GAS handleL2Batch coverage logic, as a deterministic CCR script. The
// LLM owns the prose; this script owns "which uncovered L1 source do we cover
// next", so the selection can't drift from the GAS rule.
//
// It queries the L1 source DB and the unified Articles DB (Type=explanation)
// using the injected Notion integration token, then prints the oldest L1
// source whose Source URL is not yet covered by an explanation. Same filters
// as handleL2Batch: skip example.com fixtures, skip rows with `L2 Skip`=true,
// oldest-first by created_time.
//
// The CCR session never reads Secrets Manager: NOTION_API_KEY arrives inline
// from the task's `credentials["notion.integration_token"].apiKey` and is
// passed through as an env var by the runner. The DB ids are NOT secret (they
// are already committed in gas/src/Code.gs and scripts/normalize-categories.mjs),
// so they live as constants below — overridable by env for tests / migrations.
//
// Usage:
//   NOTION_API_KEY="<credentials['notion.integration_token'].apiKey>" \
//     node workforce/skills/article-level2/pick-l1-source.mjs
//
// Stdout (single JSON line):
//   { "l1PageId", "title", "summary", "sourceUrl", "category" }   ← cover this one
//   { "skip": true, "reason": "..." }                              ← nothing to do
//
// Exit codes:
//   0  — printed a pick OR a {skip:true} (both are valid outcomes)
//   1  — bad env
//   3  — Notion API / network error

const NOTION_VERSION = "2022-06-28";
const NOTION_API = "https://api.notion.com/v1";

// Non-secret DB ids (mirror gas/src/Code.gs:l1_db_id and the unified Articles
// DB in scripts/normalize-categories.mjs). Env overrides allow test/migration.
const L1_DB_ID = process.env.L1_DB_ID || "32fd0f0b-e61e-80bd-89bf-f94965d05e80";
const UNIFIED_DB_ID = process.env.UNIFIED_DB_ID || "34fd0f0b-e61e-817a-9f6b-dc65b0d5b4cc";

const apiKey = process.env.NOTION_API_KEY;
const l1DbId = L1_DB_ID;
const unifiedDbId = UNIFIED_DB_ID;

if (!apiKey) { console.error("pick-l1-source.mjs: NOTION_API_KEY is required (credentials['notion.integration_token'].apiKey)"); process.exit(1); }

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

// Mirror of handleL2Batch's covered-URL set: unified rows with
// Type=explanation, source URL from `SourceURLs` (rich_text) or legacy
// `Source URLs` (url).
function coveredUrls(unifiedPages) {
  const set = new Set();
  for (const p of unifiedPages) {
    const type = p.properties?.Type?.select?.name ?? "";
    if (type !== "explanation") continue;
    const u =
      p.properties?.SourceURLs?.rich_text?.[0]?.plain_text ||
      p.properties?.["Source URLs"]?.url ||
      "";
    if (u) set.add(u.trim());
  }
  return set;
}

try {
  const [l1Pages, unifiedPages] = await Promise.all([queryAll(l1DbId), queryAll(unifiedDbId)]);
  const covered = coveredUrls(unifiedPages);

  const pending = l1Pages
    .filter((p) => {
      const u = p.properties?.["Source URL"]?.url;
      if (!u || covered.has(u.trim())) return false;
      if (/^https?:\/\/(www\.)?example\.com(\/|$)/i.test(u)) return false; // test fixtures
      if (p.properties?.["L2 Skip"]?.checkbox === true) return false;       // operator skip
      return true;
    })
    .sort((a, b) => (a.created_time ?? "").localeCompare(b.created_time ?? "")); // oldest-first

  if (pending.length === 0) {
    console.log(JSON.stringify({ skip: true, reason: "no uncovered L1 sources" }));
    process.exit(0);
  }

  const p = pending[0];
  console.log(
    JSON.stringify({
      l1PageId: p.id,
      title: p.properties?.Title?.title?.[0]?.plain_text ?? "",
      summary: p.properties?.["Contents Summary"]?.rich_text?.[0]?.plain_text ?? "",
      sourceUrl: p.properties?.["Source URL"]?.url ?? "",
      category: p.properties?.Category?.rich_text?.[0]?.plain_text ?? "",
    }),
  );
  process.exit(0);
} catch (err) {
  console.error(`pick-l1-source.mjs: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(3);
}
