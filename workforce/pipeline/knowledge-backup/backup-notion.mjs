#!/usr/bin/env node
// Notion -> knowledge-store daily backup (Layer 1 ingest, ADR-0026).
//
// Deterministic: no LLM. Finds every page the integration can see that was
// edited inside the window, exports each to markdown, and commits the batch as
// ONE commit. Unlike the day-partitioned Discord log this is a *mirror* — a
// page keeps one stable path across edits, so the store's git history is the
// page's edit history.
//
// Usage:
//   node workforce/pipeline/knowledge-backup/backup-notion.mjs \
//     [--since YYYYMMDDTHHMMSS] [--until YYYYMMDDTHHMMSS] [--dry-run]
//
// Env (all required unless noted):
//   NOTION_API_KEY         integration token; sees only pages shared with it
//   KNOWLEDGE_REPO         "owner/name" of the knowledge store
//   KNOWLEDGE_REPO_TOKEN   token with contents:write on that repo
//   KNOWLEDGE_REPO_BRANCH  optional, defaults to "main"
//
// Exit codes:
//   0  committed, or nothing changed in the window
//   1  configuration / upstream failure (fail loud, C-4)

import { ensureProxyAwareEntry } from "../../../scripts/lib/proxy-bootstrap.mjs";
ensureProxyAwareEntry(import.meta.url);

import { parseArgs, requireEnv } from "./lib/env.mjs";
import { resolveWindow, dayKey } from "./lib/window.mjs";
import {
  NotionClient,
  blocksToMarkdown,
  notionPagePath,
  pageTitle,
  renderNotionPage,
  resolveParentName,
} from "./lib/notion.mjs";
import { commitFiles } from "./lib/github-store.mjs";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = Boolean(args["dry-run"]);

  const { since, until } = resolveWindow({ since: args.since, until: args.until });
  const day = dayKey(since);
  console.log(`Notion backup — window ${since.toISOString()} .. ${until.toISOString()} (day ${day})`);

  const client = new NotionClient(requireEnv("NOTION_API_KEY"));
  const pages = await client.findPagesEditedIn(since, until);
  console.log(`${pages.length} page(s) edited in window`);

  if (pages.length === 0) {
    console.log("no edits in window — nothing to commit");
    return;
  }

  const parentCache = new Map();
  const files = [];
  for (const page of pages) {
    const title = pageTitle(page);
    const parentName = await resolveParentName(client, page, parentCache);
    const blocks = await client.fetchBlocks(page.id);
    const markdown = blocksToMarkdown(blocks);
    files.push({
      path: notionPagePath(page, title, parentName),
      content: renderNotionPage(page, title, markdown, parentName),
    });
    console.log(`  ${title} -> ${files[files.length - 1].path}`);
  }

  const result = await commitFiles({
    repo: requireEnv("KNOWLEDGE_REPO"),
    token: requireEnv("KNOWLEDGE_REPO_TOKEN"),
    branch: process.env.KNOWLEDGE_REPO_BRANCH || "main",
    files,
    message: `notion: ${day} (${files.length} page(s) edited)`,
    dryRun,
  });

  console.log(
    result.committed ? `committed ${result.sha}` : `no commit — ${result.reason}`,
  );
}

main().catch((err) => {
  console.error(`✗ notion backup failed: ${err.message}`);
  process.exitCode = 1;
});
