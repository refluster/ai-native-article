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
//   - Status ∈ {ready, published}                  ("live" = what the site serves.
//                                                   fetch-notion.mjs exports every
//                                                   row with NO Status filter, and
//                                                   the post-GAS cadences write
//                                                   Status=ready with nothing left
//                                                   to flip it to published — that
//                                                   value survives only on legacy
//                                                   migrated rows. Requiring
//                                                   "published" alone starved this
//                                                   picker of every cadence-authored
//                                                   article. draft/archived stay out.)
//   - podcastStatus is empty or "none"             (no podcast exists yet)
//   - SourceURLs is non-empty                      (citable — an article with no
//                                                   sources can't produce a
//                                                   compliant episode and would
//                                                   block the oldest-first queue)
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
    case "status": return prop.status?.name ?? "";
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

  const sourceUrlsOf = (props) =>
    (propText(props.SourceURLs) ||
      propText(props["Source Article URLs"]) ||
      propText(props["Source URLs"])).trim();

  // Base eligibility: a live (site-visible) Type=analysis article with no
  // podcast yet. "Live" = Status ready OR published — see the header note:
  // the site publishes every row regardless of Status, the cadences write
  // `ready`, and nothing flips ready→published since the GAS L4 batch retired
  // (2026-06-28). draft/archived (and any unknown value) remain excluded.
  const LIVE_STATUSES = new Set(["ready", "published"]);
  const base = pages.filter((p) => {
    const props = p.properties ?? {};
    if (propText(props.Type) !== "analysis") return false;
    if (!LIVE_STATUSES.has(propText(props.Status).trim().toLowerCase())) return false;
    const podStatus = propText(props.podcastStatus).trim().toLowerCase();
    if (podStatus && podStatus !== "none") return false; // already has a podcast in flight/done
    return true;
  });

  // Citable-only: an article with NO SourceURLs cannot become a compliant
  // episode — the script needs a non-empty citation list (C-1; publish-notion
  // exit-2s on empty citations). Being oldest-first, an uncitable article would
  // otherwise permanently block the picker (the whole queue stalls on one
  // un-podcastable row). Skip it so the picker advances to the next citable
  // article. To podcast such an article, add its SourceURLs in Notion.
  const eligible = base
    .filter((p) => sourceUrlsOf(p.properties ?? {}))
    .sort((a, b) => (a.created_time ?? "").localeCompare(b.created_time ?? ""));

  // Observability (no silent caps — governance-mechanisms.md): surface HOW MANY
  // eligible-but-uncitable rows were skipped, so the perpetually-un-podcast
  // backlog is visible on stderr rather than growing silently.
  const uncitableSkipped = base.length - eligible.length;
  if (uncitableSkipped > 0) {
    console.error(`pick-article.mjs: skipped ${uncitableSkipped} uncitable analysis article(s) with empty SourceURLs — add SourceURLs in Notion to podcast them`);
  }

  if (eligible.length === 0) {
    console.log(JSON.stringify({ skip: true, reason: "no live (ready/published) analysis article with SourceURLs and without a podcast" }));
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
