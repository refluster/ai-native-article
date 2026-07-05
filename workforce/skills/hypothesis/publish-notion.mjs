#!/usr/bin/env node
// Deterministic hypothesis-article writer — invoked by the CCR agent-runner
// after it has *generated* the hypothesis markdown. The LLM owns the
// judgment (the product-hypothesis prose); this script owns the
// structurally-exact Notion write so the failure class "LLM hand-edits the
// page JSON and guesses the schema wrong" cannot recur. Same contract and
// W-1 guard shape as article-level2/publish-notion.mjs and
// article-level3/publish-notion.mjs — Type is always "analysis".
//
// Publishes Author=maya, Type=analysis, Status=ready into the unified
// Articles DB so the GAS L4 batch / deploy-article-site.yml pipeline picks
// it up and surfaces it on kohuehara.xyz with the Maya AuthorChip byline.
//
// The CCR session never reads Secrets Manager: NOTION_API_KEY arrives inline
// from the task's `credentials["notion.integration_token"].apiKey`. The
// target DB id is NOT secret (committed constant).
//
// W-1 (editorial integrity): refuses empty / too-short body, rejects
// LLM-failure prelude artefacts, and rejects a body whose last line looks
// cut off mid-content (C-1) — fails loud (exit 2) rather than publishing a
// degraded hypothesis article.
//
// Usage:
//   NOTION_API_KEY="<credentials['notion.integration_token'].apiKey>" \
//     node workforce/skills/hypothesis/publish-notion.mjs \
//       --author maya --status ready \
//       --body-file /tmp/hypothesis.md \
//       --abstract-file /tmp/hypothesis-abstract.txt \
//       --tags "AI Strategy,Agentic AI"
//
// Exit codes:
//   0  — page created
//   1  — bad args / env / body-file unreadable / no H1 title
//   2  — W-1 editorial guard failed (short body, LLM-artefact prelude,
//        cut-off last line, or 401/403 auth error)
//   3  — Notion API error / network error

import { readFileSync } from "node:fs";
import { isTruncatedMarkdown, lastNonEmptyLine } from "../../../scripts/lib/truncation.mjs";
import { validateTags } from "../../../scripts/lib/tags.mjs";

const NOTION_VERSION = "2022-06-28";
const NOTION_API = "https://api.notion.com/v1";
// Non-secret unified Articles DB id (mirror of newsletter/pipeline/normalize-categories.mjs).
// Overridable by NOTION_DB_ID for tests.
const UNIFIED_DB_ID = process.env.NOTION_DB_ID || "34fd0f0b-e61e-817a-9f6b-dc65b0d5b4cc";
// A hypothesis article is ~1500–2500 字; anything below this floor is almost
// certainly truncated / empty and must not land on the site (C-1 / W-1).
const MIN_BODY_CHARS = 400;
// Type is always "analysis" for hypothesis articles (mirrors validate-skills
// ARTICLE_TYPES and the unified DB Type select).
const ARTICLE_TYPE = "analysis";
// LLM-failure preludes — rejected in the first 50 chars.
const ARTEFACT_PRELUDE =
  /^\s*(as an ai|here is|here's|i apologize|i'm sorry|certainly!|sure,|of course)/i;

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

function parseTags(raw) {
  return validateTags((raw || "").split(",").map((t) => t.trim()).filter(Boolean));
}

const apiKey = process.env.NOTION_API_KEY;
const databaseId = UNIFIED_DB_ID;
const author = arg("author") ?? "maya";
const status = arg("status") ?? "ready";
const bodyFile = arg("body-file");
const tagsArg = arg("tags");
const abstractFile = arg("abstract-file");

const VALID_STATUS = new Set(["draft", "ready", "published", "archived"]);

if (!apiKey) {
  console.error("publish-notion.mjs: NOTION_API_KEY env var is required (from credentials['notion.integration_token'].apiKey)");
  process.exit(1);
}
if (!bodyFile) {
  console.error("publish-notion.mjs: --body-file <path> is required");
  process.exit(1);
}
if (!VALID_STATUS.has(status)) {
  console.error(`publish-notion.mjs: --status must be one of ${[...VALID_STATUS].join("|")} (got "${status}")`);
  process.exit(1);
}

let body;
try {
  body = readFileSync(bodyFile, "utf8");
} catch (err) {
  console.error(`publish-notion.mjs: cannot read --body-file "${bodyFile}": ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

let abstract = "";
if (abstractFile) {
  try {
    abstract = readFileSync(abstractFile, "utf8").trim();
  } catch (err) {
    console.error(`publish-notion.mjs: cannot read --abstract-file "${abstractFile}": ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

// ── W-1 editorial guards ────────────────────────────────────────────────────
const trimmed = body.trim();
if (trimmed.length < MIN_BODY_CHARS) {
  console.error(`publish-notion.mjs: body is ${trimmed.length} chars (< ${MIN_BODY_CHARS}) — refusing to publish a truncated/empty hypothesis article (W-1)`);
  process.exit(2);
}
if (ARTEFACT_PRELUDE.test(trimmed.slice(0, 50))) {
  console.error("publish-notion.mjs: body opens with an LLM-failure prelude — refusing to publish (W-1)");
  process.exit(2);
}
if (isTruncatedMarkdown(trimmed)) {
  console.error(`publish-notion.mjs: body looks cut off mid-content (last line: "${lastNonEmptyLine(trimmed)}") — refusing to publish a truncated hypothesis article (W-1)`);
  process.exit(2);
}

// First `# ` line is the title; strip it from the body blocks.
const lines = trimmed.split(/\r?\n/);
const h1Idx = lines.findIndex((l) => /^#\s+\S/.test(l));
if (h1Idx === -1) {
  console.error("publish-notion.mjs: body has no `# Title` H1 on its own line (exit 1)");
  process.exit(1);
}
const title = lines[h1Idx].replace(/^#\s+/, "").trim();
const bodyLines = lines.slice(0, h1Idx).concat(lines.slice(h1Idx + 1));

const children = markdownToBlocks(bodyLines.join("\n"));

const properties = {
  Title: { title: [{ text: { content: title.slice(0, 2000) } }] },
  Author: { rich_text: [{ text: { content: author } }] },
  Type: { select: { name: ARTICLE_TYPE } },
  Status: { select: { name: status } },
  Date: { date: { start: new Date().toISOString().slice(0, 10) } },
};

if (abstract) {
  properties.Abstract = { rich_text: [{ text: { content: abstract.slice(0, 2000) } }] };
}

const tags = parseTags(tagsArg);
if (tagsArg && tags.length === 0) {
  console.warn(`publish-notion.mjs: --tags "${tagsArg}" had no valid vocabulary tags — publishing untagged`);
}
if (tags.length) {
  properties.Category = { rich_text: [{ text: { content: tags[0] } }] };
  properties.Tags = { multi_select: tags.map((name) => ({ name })) };
}

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
    console.log(`publish-notion.mjs: created — Author=${author} Type=${ARTICLE_TYPE} Status=${status} "${title}" ${url}`);
    process.exit(0);
  }
  if (res.status === 401 || res.status === 403) {
    console.error(`publish-notion.mjs: auth rejected (HTTP ${res.status}) — project credential misconfigured: ${text.slice(0, 400)}`);
    process.exit(2);
  }
  console.error(`publish-notion.mjs: Notion API error (HTTP ${res.status}): ${text.slice(0, 400)}`);
  process.exit(3);
} catch (err) {
  console.error(`publish-notion.mjs: fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(3);
}

// Minimal Markdown → Notion blocks. Handles H1-3, bullet lists, paragraphs.
// Notion accepts ≤ 100 children per request; cap conservatively at 100.
// Per-block rich_text is capped at 2000 chars (Notion's limit).
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
