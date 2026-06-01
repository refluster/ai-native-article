#!/usr/bin/env node
// Deterministic L2-explanation writer — invoked by the CCR agent-runner
// after it has *generated* the briefing-document markdown. The LLM owns the
// judgment (the prose); this script owns the structurally-exact Notion write
// so the failure class "LLM hand-edits the page JSON and guesses the schema
// wrong" cannot recur. Same shape as feed-post/post-feed.mjs.
//
// It POSTs a new page into the unified Articles DB using the injected Notion
// integration token. The row carries Author + Type=explanation +
// Status=ready_for_L4 so the existing GAS L4 batch publishes it to
// kohuehara.xyz and scripts/fetch-notion.mjs surfaces the byline (AuthorChip).
//
// The CCR session never reads Secrets Manager: NOTION_API_KEY arrives inline
// from the task's `credentials["notion.integration_token"].apiKey` and is
// passed through as an env var by the runner. The target DB id is NOT secret
// (the unified Articles DB id is already committed in
// scripts/normalize-categories.mjs), so it's a constant below — overridable by
// NOTION_DB_ID for tests / migrations.
//
// W-1 (editorial integrity): the script refuses an empty / too-short body and
// rejects LLM-failure prelude artefacts (C-1), failing loud (exit 2) rather
// than landing a degraded article.
//
// Body is read from a FILE (not an arg) so multi-line / Unicode prose can't be
// mangled by shell quoting. The first `# ` line is used as the page Title and
// stripped from the body blocks (so the rendered article doesn't repeat it).
//
// Usage:
//   NOTION_API_KEY="<credentials['notion.integration_token'].apiKey>" \
//     node workforce/skills/article-level2/publish-notion.mjs \
//       --author elena --type explanation --kind article \
//       --body-file /tmp/article.md [--source-url https://...]
//
// Exit codes:
//   0  — page created
//   1  — bad args / env / body-file unreadable / no H1 title
//   2  — W-1 editorial guard failed (empty/short body or LLM-artefact prelude)
//   3  — Notion API error / network error

import { readFileSync } from "node:fs";

const NOTION_VERSION = "2022-06-28";
const NOTION_API = "https://api.notion.com/v1";
// Non-secret target DB id (the unified Articles DB; mirror of the default in
// scripts/normalize-categories.mjs). Overridable by NOTION_DB_ID for tests.
const UNIFIED_DB_ID = process.env.NOTION_DB_ID || "34fd0f0b-e61e-817a-9f6b-dc65b0d5b4cc";
// An L2 explanation is ~3000 字; anything shorter than this floor is almost
// certainly a truncated / empty generation and must not be published (C-1).
const MIN_BODY_CHARS = 200;
// LLM-failure preludes — rejected in the first 50 chars (mirror of the
// feed-post POST /feed server-side guard).
const ARTEFACT_PRELUDE =
  /^\s*(as an ai|here is|here's|i apologize|i'm sorry|certainly!|sure,|of course)/i;

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

const apiKey = process.env.NOTION_API_KEY;
const databaseId = UNIFIED_DB_ID;
const author = arg("author");
const articleType = arg("type") ?? "explanation";
const kind = arg("kind") ?? "article";
const bodyFile = arg("body-file");
const sourceUrl = arg("source-url");

if (!apiKey) { console.error("publish-notion.mjs: NOTION_API_KEY env var is required (from credentials['notion.integration_token'].apiKey)"); process.exit(1); }
if (!author) { console.error("publish-notion.mjs: --author <slug> is required"); process.exit(1); }
if (articleType !== "explanation" && articleType !== "analysis") {
  console.error(`publish-notion.mjs: --type must be explanation|analysis (got "${articleType}")`);
  process.exit(1);
}
if (!bodyFile) { console.error("publish-notion.mjs: --body-file <path> is required"); process.exit(1); }

let body;
try {
  body = readFileSync(bodyFile, "utf8");
} catch (err) {
  console.error(`publish-notion.mjs: cannot read --body-file "${bodyFile}": ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

// ── W-1 editorial guards (fail loud, do not publish) ───────────────────────
const trimmed = body.trim();
if (trimmed.length < MIN_BODY_CHARS) {
  console.error(`publish-notion.mjs: body is ${trimmed.length} chars (< ${MIN_BODY_CHARS}) — refusing to publish a truncated/empty explanation (W-1)`);
  process.exit(2);
}
if (ARTEFACT_PRELUDE.test(trimmed.slice(0, 50))) {
  console.error(`publish-notion.mjs: body opens with an LLM-failure prelude — refusing to publish (W-1)`);
  process.exit(2);
}

// First `# ` line is the title; strip it from the body blocks.
const lines = trimmed.split(/\r?\n/);
const h1Idx = lines.findIndex((l) => /^#\s+\S/.test(l));
if (h1Idx === -1) {
  console.error("publish-notion.mjs: body has no `# Title` H1 on its own line — the L2 format requires one (exit 1)");
  process.exit(1);
}
const title = lines[h1Idx].replace(/^#\s+/, "").trim();
const bodyLines = lines.slice(0, h1Idx).concat(lines.slice(h1Idx + 1));

const children = markdownToBlocks(bodyLines.join("\n"));

const properties = {
  Name: { title: [{ text: { content: title.slice(0, 2000) } }] },
  Author: { select: { name: author } },
  Type: { select: { name: articleType } },
  Kind: { select: { name: kind } },
  Status: { select: { name: "ready_for_L4" } },
};
if (sourceUrl) properties.SourceURL = { url: sourceUrl };

try {
  const res = await fetch(`${NOTION_API}/pages`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "notion-version": NOTION_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify({ parent: { database_id: databaseId }, properties, children }),
  });
  const text = await res.text().catch(() => "");
  if (res.ok) {
    let url = "";
    try { url = JSON.parse(text).url ?? ""; } catch { /* non-JSON ok body */ }
    console.log(`publish-notion.mjs: created — Author=${author} Type=${articleType} "${title}" ${url}`);
    process.exit(0);
  }
  if (res.status === 401 || res.status === 403) {
    console.error(`publish-notion.mjs: auth rejected (HTTP ${res.status}) — project credential bag misconfigured: ${text.slice(0, 400)}`);
    process.exit(2);
  }
  console.error(`publish-notion.mjs: Notion API error (HTTP ${res.status}): ${text.slice(0, 400)}`);
  process.exit(3);
} catch (err) {
  console.error(`publish-notion.mjs: fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(3);
}

// Minimal Markdown → Notion blocks. Handles H1-3, bullet lists, and
// paragraphs (blank-line separated). Notion accepts ≤ 100 children per
// request; we cap conservatively. Per-block rich_text is capped at 2000
// chars (Notion's limit).
function markdownToBlocks(md) {
  const out = [];
  let para = [];
  const flushPara = () => {
    if (para.length === 0) return;
    pushText("paragraph", para.join(" "));
    para = [];
  };
  const pushText = (type, content) => {
    out.push({
      object: "block",
      type,
      [type]: { rich_text: [{ type: "text", text: { content: content.slice(0, 2000) } }] },
    });
  };
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") { flushPara(); continue; }
    let m;
    if ((m = line.match(/^###\s+(.+)/))) { flushPara(); pushText("heading_3", m[1]); }
    else if ((m = line.match(/^##\s+(.+)/))) { flushPara(); pushText("heading_2", m[1]); }
    else if ((m = line.match(/^#\s+(.+)/))) { flushPara(); pushText("heading_2", m[1]); }
    else if ((m = line.match(/^[-*]\s+(.+)/))) { flushPara(); pushText("bulleted_list_item", m[1]); }
    else { para.push(line); }
  }
  flushPara();
  return out.slice(0, 100);
}
