// Notion ingest: find pages edited in the window, export each to markdown.
//
// Difference from the luckyhat-ms scraper worth stating, because it changes the
// operational contract: that version walked a hard-coded list of databases and
// diffed every page's content hash against the file already in GitHub, needing
// a GitHub file listing + content fetch per page. Here the *search* endpoint
// does the differencing — `last_edited_time` descending, stop once we are past
// the window — so a quiet day costs one request and the GitHub side needs no
// cache at all (an unchanged tree simply produces no commit, see github-store).

import { ensureProxyAwareEntry } from "../../../../scripts/lib/proxy-bootstrap.mjs";
ensureProxyAwareEntry(import.meta.url);

import { requestJson, Pacer } from "./http.mjs";

const API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

// Notion's published guidance is an average of ~3 requests/second.
const PACER = new Pacer(3);

// Blocks nest arbitrarily; a runaway recursion on a pathological page would
// burn the rate limit for no benefit. Six levels is deeper than any prose page.
const MAX_BLOCK_DEPTH = 6;

function headers(token) {
  return {
    authorization: `Bearer ${token}`,
    "notion-version": NOTION_VERSION,
    "content-type": "application/json",
  };
}

export class NotionClient {
  constructor(token) {
    this.token = token;
  }

  #request(path, options = {}) {
    return requestJson(`${API}${path}`, { ...options, headers: headers(this.token) }, { pacer: PACER });
  }

  /**
   * Pages edited within [since, until), newest first. Only pages shared with
   * the integration are visible — that is the access boundary, and it is the
   * operator's to widen in Notion, not ours.
   */
  async findPagesEditedIn(since, until) {
    const sinceMs = since.getTime();
    const untilMs = until.getTime();
    const pages = [];
    let cursor;

    for (;;) {
      const body = {
        filter: { property: "object", value: "page" },
        sort: { direction: "descending", timestamp: "last_edited_time" },
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
      };
      const res = await this.#request("/search", { method: "POST", body: JSON.stringify(body) });

      let older = false;
      for (const page of res.results) {
        const edited = new Date(page.last_edited_time).getTime();
        if (edited >= untilMs) continue; // edited after the window closed
        if (edited < sinceMs) {
          // Results are sorted newest-first, so everything from here is older.
          older = true;
          break;
        }
        pages.push(page);
      }

      if (older || !res.has_more) break;
      cursor = res.next_cursor;
    }

    return pages;
  }

  async fetchBlocks(blockId, depth = 0) {
    if (depth >= MAX_BLOCK_DEPTH) return [];
    const blocks = [];
    let cursor;

    for (;;) {
      const query = new URLSearchParams({ page_size: "100" });
      if (cursor) query.set("start_cursor", cursor);
      const res = await this.#request(`/blocks/${blockId}/children?${query}`);

      for (const block of res.results) {
        blocks.push(block);
        if (block.has_children) {
          block.__children = await this.fetchBlocks(block.id, depth + 1);
        }
      }

      if (!res.has_more) break;
      cursor = res.next_cursor;
    }

    return blocks;
  }

  fetchDatabase(databaseId) {
    return this.#request(`/databases/${databaseId}`);
  }

  fetchPage(pageId) {
    return this.#request(`/pages/${pageId}`);
  }
}

/** Concatenate a Notion rich-text array, preserving links and code spans. */
export function richTextToMarkdown(richText = []) {
  return richText
    .map((run) => {
      let text = run.plain_text ?? "";
      const { bold, italic, code, strikethrough } = run.annotations ?? {};
      if (code) text = `\`${text}\``;
      if (bold) text = `**${text}**`;
      if (italic) text = `_${text}_`;
      if (strikethrough) text = `~~${text}~~`;
      if (run.href) text = `[${text}](${run.href})`;
      return text;
    })
    .join("");
}

const HEADING_PREFIX = { heading_1: "#", heading_2: "##", heading_3: "###" };

function renderBlock(block, indent = "") {
  const type = block.type;
  const data = block[type] ?? {};
  const text = richTextToMarkdown(data.rich_text);
  const lines = [];

  switch (type) {
    case "heading_1":
    case "heading_2":
    case "heading_3":
      lines.push(`${HEADING_PREFIX[type]} ${text}`);
      break;
    case "paragraph":
      lines.push(indent + text);
      break;
    case "bulleted_list_item":
      lines.push(`${indent}- ${text}`);
      break;
    case "numbered_list_item":
      lines.push(`${indent}1. ${text}`);
      break;
    case "to_do":
      lines.push(`${indent}- [${data.checked ? "x" : " "}] ${text}`);
      break;
    case "quote":
      lines.push(`${indent}> ${text}`);
      break;
    case "callout":
      lines.push(`${indent}> ${data.icon?.emoji ? `${data.icon.emoji} ` : ""}${text}`);
      break;
    case "code":
      lines.push(`${indent}\`\`\`${data.language ?? ""}`, indent + text, `${indent}\`\`\``);
      break;
    case "divider":
      lines.push(`${indent}---`);
      break;
    case "toggle":
      lines.push(`${indent}- ${text}`);
      break;
    case "image":
    case "file":
    case "pdf": {
      const url = data.external?.url ?? data.file?.url ?? "";
      const caption = richTextToMarkdown(data.caption) || type;
      lines.push(`${indent}${type === "image" ? "!" : ""}[${caption}](${url})`);
      break;
    }
    case "bookmark":
    case "embed":
    case "link_preview":
      lines.push(`${indent}<${data.url ?? ""}>`);
      break;
    case "child_page":
      lines.push(`${indent}- 📄 ${data.title ?? ""} _(child page)_`);
      break;
    case "child_database":
      lines.push(`${indent}- 🗄 ${data.title ?? ""} _(child database)_`);
      break;
    case "table":
    case "table_row":
      // Rows render through their children below; the table wrapper itself
      // carries no text.
      break;
    default:
      // Unknown / unsupported block. Keep a marker rather than dropping
      // content silently — a gap in an archive should be visible.
      if (text) lines.push(`${indent}${text}`);
      else lines.push(`${indent}_[unsupported block: ${type}]_`);
  }

  for (const child of block.__children ?? []) {
    lines.push(...renderBlock(child, `${indent}  `));
  }
  return lines;
}

export function blocksToMarkdown(blocks) {
  const out = [];
  for (const block of blocks) out.push(...renderBlock(block));
  return out.join("\n");
}

/** Best-effort page title from whichever property holds it. */
export function pageTitle(page) {
  const properties = page.properties ?? {};
  for (const value of Object.values(properties)) {
    if (value?.type === "title") {
      const text = richTextToMarkdown(value.title);
      if (text.trim()) return text.trim();
    }
  }
  return "Untitled";
}

/**
 * Filesystem-safe slug. Non-ASCII (Japanese titles are the common case here)
 * survives — git and GitHub handle UTF-8 paths fine, and a transliterated or
 * hash-only name would make the store unbrowsable.
 */
export function slugify(title) {
  const slug = title
    .normalize("NFC")
    .replace(/[\\/:*?"<>|#\[\]]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return slug || "untitled";
}

/**
 * Stable path for a page's markdown export.
 *
 * The page id suffix is deliberate: the luckyhat-ms scraper keyed paths on the
 * title alone, so renaming a Notion page orphaned its old file and created a
 * second one. Keying on the immutable id means a rename moves the file (git
 * records it as a rename) instead of forking the history.
 */
export function notionPagePath(page, title, parentName) {
  const id = page.id.replace(/-/g, "").slice(0, 8);
  const folder = parentName ? slugify(parentName) : "_pages";
  return `notion/${folder}/${slugify(title)}--${id}.md`;
}

/** Render one exported page: frontmatter + body. */
export function renderNotionPage(page, title, markdown, parentName) {
  const frontmatter = [
    "---",
    "source: notion",
    `title: ${JSON.stringify(title)}`,
    `page_id: ${JSON.stringify(page.id)}`,
    ...(parentName ? [`parent: ${JSON.stringify(parentName)}`] : []),
    `url: ${JSON.stringify(page.url ?? "")}`,
    `created_time: ${page.created_time}`,
    `last_edited_time: ${page.last_edited_time}`,
    "---",
    "",
    `# ${title}`,
    "",
  ];
  return `${frontmatter.join("\n")}${markdown}\n`;
}

/**
 * Resolve a page's parent container name (database title or parent page
 * title), memoised per run — a day's edits usually cluster in a few databases.
 */
export async function resolveParentName(client, page, cache) {
  const parent = page.parent ?? {};
  const key = parent.database_id ?? parent.page_id;
  if (!key) return null; // workspace-level page
  if (cache.has(key)) return cache.get(key);

  let name = null;
  try {
    const object = parent.database_id
      ? await client.fetchDatabase(parent.database_id)
      : await client.fetchPage(parent.page_id);
    name = parent.database_id
      ? richTextToMarkdown(object.title).trim() || null
      : pageTitle(object);
  } catch {
    // A parent the integration cannot read is not fatal: the page still
    // exports, it just lands in the fallback folder.
    name = null;
  }
  cache.set(key, name);
  return name;
}
