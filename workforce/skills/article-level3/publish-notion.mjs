#!/usr/bin/env node
// Deterministic L3-analysis writer — invoked by the CCR agent-runner after it
// has *synthesised* the analysis markdown from the picked L2 sample. The LLM
// owns the judgment (the inductive synthesis); this script owns the
// structurally-exact Notion write so the failure class "LLM hand-edits the page
// JSON and guesses the schema wrong" cannot recur. Sibling of
// article-level2/publish-notion.mjs — same contract, Type=analysis instead of
// explanation, plus the L3-specific source/category shape.
//
// It POSTs a new page into the unified Articles DB using the injected Notion
// integration token. The row carries Author + Type=analysis + Status=ready
// (queued; the GAS L4 batch generates the hero image and flips it to published)
// so it lands on kohuehara.xyz and newsletter/pipeline/fetch-notion.mjs surfaces the byline
// (AuthorChip).
//
// L3 differs from L2 on two writes (mirror of newsletter/gas/src/Code.gs handleL3Create):
//   • SourceURLs   — the COMMA-JOINED source L2 URLs (not a single URL). This is
//     both the "References" surface and the reuse-avoidance key pick-l2-sources
//     reads back on the next fire.
//   • CategoriesMulti — TWO tags: the majority A–E canonical bucket of the source
//     L2s (--category) + an optional free-form "テーマ1 × テーマ2" synthesis theme
//     (--theme). Category (rich_text) carries the canonical bucket.
//
// The CCR session never reads Secrets Manager: NOTION_API_KEY arrives inline
// from the task's `credentials["notion.integration_token"].apiKey`. The target
// DB id is NOT secret, so it's a constant below — overridable by NOTION_DB_ID.
//
// W-1 (editorial integrity): refuses an empty / too-short body and rejects
// LLM-failure prelude artefacts (C-1), failing loud (exit 2) rather than landing
// a degraded article. The floor is higher than L2's: an L3 synthesis is
// ~3000–4000 字, so anything under MIN_BODY_CHARS is a truncated generation.
//
// Body is read from a FILE (not an arg) so multi-line / Unicode prose can't be
// mangled by shell quoting. The first `# ` line is the page Title, stripped from
// the body blocks.
//
// Usage:
//   NOTION_API_KEY="<credentials['notion.integration_token'].apiKey>" \
//     node workforce/skills/article-level3/publish-notion.mjs \
//       --author elena --type analysis --status ready \
//       --body-file /tmp/l3-article.md \
//       --abstract-file /tmp/l3-abstract.txt \
//       --source-urls "https://a, https://b, https://c" \
//       --category "B" \                  # majority A–E bucket from the picker
//       [--theme "担い手の交代 × ツールの民主化"]   # free-form synthesis theme
//
// Exit codes:
//   0  — page created
//   1  — bad args / env / body-file unreadable / no H1 title
//   2  — W-1 editorial guard failed (empty/short body or LLM-artefact prelude)
//   3  — Notion API error / network error

import { readFileSync } from "node:fs";

const NOTION_VERSION = "2022-06-28";
const NOTION_API = "https://api.notion.com/v1";
const UNIFIED_DB_ID = process.env.NOTION_DB_ID || "34fd0f0b-e61e-817a-9f6b-dc65b0d5b4cc";
// An L3 analysis is ~3000–4000 字; floor well above that to catch truncation
// while tolerating a terse synthesis. Higher than L2's 200-char floor.
const MIN_BODY_CHARS = 400;
const ARTEFACT_PRELUDE =
  /^\s*(as an ai|here is|here's|i apologize|i'm sorry|certainly!|sure,|of course)/i;

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

// Canonical A–E bucket — mirror of newsletter/gas/src/Code.gs CATEGORY_NAMES +
// canonicalCategoryFor. The picker already computed the majority bucket; this
// re-canonicalises so a bare letter ("B") or a canonical label both resolve.
const CATEGORY_NAMES = {
  A: "A: AI Hyper-productivity",
  B: "B: Role Blurring",
  C: "C: New Roles/FDE",
  D: "D: Big Tech Layoffs & AI Pivot",
  E: "E: Rethinking SDLC",
};
function canonicalCategory(text) {
  const trimmed = (text || "").trim();
  if (!trimmed) return "";
  if (/^[A-E]$/i.test(trimmed)) return CATEGORY_NAMES[trimmed.toUpperCase()] || "";
  const m = trimmed.match(/^([A-E])[\s:：][\s\S]*$/i);
  if (m) return CATEGORY_NAMES[m[1].toUpperCase()] || "";
  return ""; // free-form / unmappable → leave canonical unset (don't guess)
}

const apiKey = process.env.NOTION_API_KEY;
const databaseId = UNIFIED_DB_ID;
const author = arg("author");
const articleType = arg("type") ?? "analysis";
const status = arg("status") ?? "ready";
const bodyFile = arg("body-file");
const sourceUrls = arg("source-urls");      // comma-joined source L2 URLs
const category = arg("category");           // majority A–E letter or canonical label
const theme = arg("theme");                 // optional free-form synthesis theme
const abstractFile = arg("abstract-file");

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
  console.error(`publish-notion.mjs: body is ${trimmed.length} chars (< ${MIN_BODY_CHARS}) — refusing to publish a truncated/empty analysis (W-1)`);
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
  console.error("publish-notion.mjs: body has no `# Title` H1 on its own line — the L3 format requires one (exit 1)");
  process.exit(1);
}
const title = lines[h1Idx].replace(/^#\s+/, "").trim();
const bodyLines = lines.slice(0, h1Idx).concat(lines.slice(h1Idx + 1));

const children = markdownToBlocks(bodyLines.join("\n"));

// Property names mirror the live unified Articles DB exactly (same contract as
// the GAS L3 write): Title (title), Type/Status (select), Author/SourceURLs as
// rich_text, Date.
const properties = {
  Title: { title: [{ text: { content: title.slice(0, 2000) } }] },
  Author: { rich_text: [{ text: { content: author } }] },
  Type: { select: { name: articleType } },
  Status: { select: { name: status } },
  Date: { date: { start: new Date().toISOString().slice(0, 10) } },
};

// SourceURLs — comma-joined source L2 URLs. This is what pick-l2-sources reads
// back to avoid re-synthesising the same sample on the next fire, so always set
// it when sources are known.
if (sourceUrls) properties.SourceURLs = { rich_text: [{ text: { content: sourceUrls.slice(0, 2000) } }] };

if (abstract) properties.Abstract = { rich_text: [{ text: { content: abstract.slice(0, 2000) } }] };

// Category + CategoriesMulti — the canonical bucket (majority vote of sources)
// plus an optional free-form synthesis theme, mirroring the GAS L3 two-tag
// write. A free-form / unmappable --category leaves the canonical unset rather
// than guessing; the theme tag is still added when present.
const canonical = canonicalCategory(category);
const tags = [];
if (canonical) tags.push(canonical);
if (theme && theme.trim()) tags.push(theme.trim().slice(0, 100));
if (canonical) properties.Category = { rich_text: [{ text: { content: canonical } }] };
if (tags.length) properties.CategoriesMulti = { multi_select: tags.map((name) => ({ name })) };

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

// Minimal Markdown → Notion blocks. Handles H1-3, bullet lists, and paragraphs
// (blank-line separated). Notion accepts ≤ 100 children per request; we cap
// conservatively. Per-block rich_text is capped at 2000 chars (Notion's limit).
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
