#!/usr/bin/env node
// Deterministic L2-explanation writer — invoked by the CCR agent-runner
// after it has *generated* the briefing-document markdown. The LLM owns the
// judgment (the prose); this script owns the structurally-exact Notion write
// so the failure class "LLM hand-edits the page JSON and guesses the schema
// wrong" cannot recur. Same shape as feed-post/post-feed.mjs.
//
// It POSTs a new page into the unified Articles DB using the injected Notion
// integration token. The row carries Author + Type=explanation +
// Status=ready (queued; the GAS L4 batch flips it to published) so it lands on
// kohuehara.xyz and newsletter/pipeline/fetch-notion.mjs surfaces the byline (AuthorChip).
//
// The CCR session never reads Secrets Manager: NOTION_API_KEY arrives inline
// from the task's `credentials["notion.integration_token"].apiKey` and is
// passed through as an env var by the runner. The target DB id is NOT secret
// (the unified Articles DB id is already committed in
// newsletter/pipeline/normalize-categories.mjs), so it's a constant below — overridable by
// NOTION_DB_ID for tests / migrations.
//
// W-1 (editorial integrity): the script refuses an empty / too-short body,
// rejects LLM-failure prelude artefacts, and rejects a body whose last line
// looks cut off mid-content (C-1), failing loud (exit 2) rather than landing
// a degraded article. The cut-off check is the canonical heuristic from
// scripts/lib/truncation.mjs — with the GAS cron paused this skill is the
// generation path, so the R-5-equivalent guard must fire here, per-article,
// rather than only at the R-10 deploy gate where one bad body blocks the
// whole site deploy.
//
// Body is read from a FILE (not an arg) so multi-line / Unicode prose can't be
// mangled by shell quoting. The first `# ` line is used as the page Title and
// stripped from the body blocks (so the rendered article doesn't repeat it).
//
// Usage:
//   NOTION_API_KEY="<credentials['notion.integration_token'].apiKey>" \
//     node workforce/skills/article-level2/publish-notion.mjs \
//       --author elena --type explanation --status ready \
//       --body-file /tmp/article.md \
//       [--source-url https://...] \
//       [--tags "AI Productivity,Org Transformation"]  # 3–5 flat tags from scripts/lib/tags.mjs
//       [--abstract-file /tmp/abstract.txt]  # L2 lead → Abstract
//
// Exit codes:
//   0  — page created
//   1  — bad args / env / body-file unreadable / no H1 title
//   2  — W-1 editorial guard failed (empty/short body, LLM-artefact prelude,
//        or cut-off last line)
//   3  — Notion API error / network error

import { ensureProxyAwareEntry } from "../../../scripts/lib/proxy-bootstrap.mjs";
ensureProxyAwareEntry(import.meta.url);

import { readFileSync } from "node:fs";
import { isTruncatedMarkdown, lastNonEmptyLine } from "../../../scripts/lib/truncation.mjs";
import { validateTags } from "../../../scripts/lib/tags.mjs";

const NOTION_VERSION = "2022-06-28";
const NOTION_API = "https://api.notion.com/v1";
// Non-secret target DB id (the unified Articles DB; mirror of the default in
// newsletter/pipeline/normalize-categories.mjs). Overridable by NOTION_DB_ID for tests.
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

// Tags — flat vocabulary (ADR-0003). The retired A–E canonicalisation lived
// here; the single source of truth is now scripts/lib/tags.mjs. The agent
// picks 3–5 tags from that vocabulary (see SKILL.md) and passes them via
// --tags; validateTags drops anything not in the controlled set (never
// invents). Splits on comma so the runner can pass one shell arg.
function parseTags(raw) {
  return validateTags((raw || "").split(",").map((t) => t.trim()).filter(Boolean));
}

const apiKey = process.env.NOTION_API_KEY;
const databaseId = UNIFIED_DB_ID;
const author = arg("author");
const articleType = arg("type") ?? "explanation";
const status = arg("status") ?? "ready";
const bodyFile = arg("body-file");
const sourceUrl = arg("source-url");
const tagsArg = arg("tags");               // comma-separated vocabulary tags (3–5)
const abstractFile = arg("abstract-file"); // optional lead/summary file

// Valid Status options on the unified Articles DB (mirror of the live select).
// L2 explanations land as `ready` (queued, not yet live); the GAS L4 batch
// flips them to `published`. (--status lets a backfill override.)
const VALID_STATUS = new Set(["draft", "ready", "published", "archived"]);

if (!apiKey) { console.error("publish-notion.mjs: NOTION_API_KEY env var is required (from credentials['notion.integration_token'].apiKey)"); process.exit(1); }
if (!author) { console.error("publish-notion.mjs: --author <slug> is required"); process.exit(1); }
if (articleType !== "explanation" && articleType !== "analysis") {
  console.error(`publish-notion.mjs: --type must be explanation|analysis (got "${articleType}")`);
  process.exit(1);
}
if (!VALID_STATUS.has(status)) {
  console.error(`publish-notion.mjs: --status must be one of ${[...VALID_STATUS].join("|")} (got "${status}")`);
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

// Optional abstract (the L2 lead / source summary → the Abstract column, same
// role as l1Summary in the GAS L2 write). Read from a file so multi-line /
// Unicode prose isn't mangled by shell quoting, exactly like --body-file.
let abstract = "";
if (abstractFile) {
  try {
    abstract = readFileSync(abstractFile, "utf8").trim();
  } catch (err) {
    console.error(`publish-notion.mjs: cannot read --abstract-file "${abstractFile}": ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
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
if (isTruncatedMarkdown(trimmed)) {
  console.error(`publish-notion.mjs: body looks cut off mid-content (last line: "${lastNonEmptyLine(trimmed)}") — refusing to publish a truncated explanation (W-1)`);
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

// Property names mirror the live unified Articles DB exactly (same contract as
// the GAS L2 write in newsletter/gas/src/Code.gs): Title (title), Type/Status (select),
// Author/SourceURLs (rich_text), Date. There is no Name/Kind/SourceURL(url)
// column — writing those returns HTTP 400 validation_error.
const properties = {
  Title: { title: [{ text: { content: title.slice(0, 2000) } }] },
  Author: { rich_text: [{ text: { content: author } }] },
  Type: { select: { name: articleType } },
  Status: { select: { name: status } },
  Date: { date: { start: new Date().toISOString().slice(0, 10) } },
};
// Coverage (pick-l1-source.mjs) keys on SourceURLs rich_text, so the next fire
// sees this source as covered and won't re-pick it.
if (sourceUrl) properties.SourceURLs = { rich_text: [{ text: { content: sourceUrl } }] };

// Abstract — the L2 lead (mirror of l1Summary in the GAS L2 write). Optional;
// only set when an --abstract-file was supplied and non-empty.
if (abstract) properties.Abstract = { rich_text: [{ text: { content: abstract.slice(0, 2000) } }] };

// Tags — the flat vocabulary tags (ADR-0003), the many-to-many
// field that drives the reader sidebar/filter. Category (single) carries the
// primary tag for legacy single-category consumers. Tags outside the
// vocabulary are dropped by validateTags; if --tags was given but nothing
// validated, publish untagged rather than block (W-1 governs the body, not
// tags) — but say so loudly.
const tags = parseTags(tagsArg);
if (tagsArg && tags.length === 0) {
  console.warn(`publish-notion.mjs: --tags "${tagsArg}" had no valid vocabulary tags — publishing untagged (see scripts/lib/tags.mjs TAGS)`);
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
    console.log(`publish-notion.mjs: created — Author=${author} Type=${articleType} Status=${status} "${title}" ${url}`);
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
