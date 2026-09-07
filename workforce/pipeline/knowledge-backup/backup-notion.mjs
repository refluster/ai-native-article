#!/usr/bin/env node
import { ensureProxyAwareEntry } from "../../../scripts/lib/proxy-bootstrap.mjs";
ensureProxyAwareEntry(import.meta.url);

// Notion -> knowledge-store daily backup (Layer 1 ingest, ADR-0026),
// scoped to one project (ADR-0028).
//
// Deterministic: no LLM. Finds every page the project's integration can see
// that was edited inside the window, exports each to markdown, and commits the
// batch to THAT PROJECT's knowledge store as ONE commit. Unlike the
// day-partitioned Discord log this is a *mirror* — a page keeps one stable path
// across edits, so the store's git history is the page's edit history.
//
// Usage:
//   node workforce/pipeline/knowledge-backup/backup-notion.mjs \
//     --project <id> [--since YYYYMMDDTHHMMSS] [--until ...] [--dry-run]
//
// Config: workforce/projects/{id}/knowledge-backup.json (store repo).
// Credentials come from the env names that config derives — see lib/projects.mjs:
//   KB_{PROJECT}_STORE_TOKEN, KB_{PROJECT}_NOTION_API_KEY
//
// The integration token IS the scope: it sees exactly the pages shared with it,
// which is how one project's backup stays inside one project's workspace.
//
// Exit codes:
//   0  committed, nothing changed, or the project's backup is paused
//   1  configuration / upstream failure (fail loud, C-4)

import { parseArgs, requireEnv } from "./lib/env.mjs";
import { resolveWindow, dayKey } from "./lib/window.mjs";
import { loadProject } from "./lib/projects.mjs";
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
  if (typeof args.project !== "string") throw new Error("--project <id> is required");

  const project = loadProject(args.project);
  if (project.status === "paused") {
    console.log(`project ${project.projectId}: backup paused — skipping`);
    return;
  }
  if (!project.notion) {
    console.log(`project ${project.projectId}: no notion source declared — skipping`);
    return;
  }

  const { since, until } = resolveWindow({ since: args.since, until: args.until });
  const day = dayKey(since);
  console.log(
    `Notion backup — project ${project.projectId} -> ${project.store.repo} — window ${since.toISOString()} .. ${until.toISOString()} (day ${day})`,
  );

  const client = new NotionClient(requireEnv(project.env.notionApiKey));
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
    files.push({
      path: notionPagePath(page, title, parentName),
      content: renderNotionPage(page, title, blocksToMarkdown(blocks), parentName),
    });
    console.log(`  ${title} -> ${files[files.length - 1].path}`);
  }

  const result = await commitFiles({
    repo: project.store.repo,
    token: requireEnv(project.env.storeToken),
    branch: project.store.branch,
    files,
    message: `notion: ${day} (${files.length} page(s) edited)`,
    dryRun,
  });

  console.log(result.committed ? `committed ${result.sha}` : `no commit — ${result.reason}`);
}

main().catch((err) => {
  console.error(`✗ notion backup failed: ${err.message}`);
  process.exitCode = 1;
});
