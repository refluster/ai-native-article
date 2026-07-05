#!/usr/bin/env node
// monthly-report/post.mjs — deterministic write for the "monthly-report" Cadence,
// invoked by the CCR agent-runner AFTER it has *generated* the report markdown.
// The LLM owns the judgment (the letter); this script owns the structurally-exact
// Notion write so the failure class "LLM hand-edits the page JSON and guesses the
// schema wrong" cannot recur. Modeled on article-level2/publish-notion.mjs (the
// canonical W-1-guarded Notion write), with one material difference: a monthly
// report is ~10 letter pages, far past Notion's 100-blocks-per-request cap, so
// this script APPENDS the remainder in 100-block batches instead of silently
// slicing at 100 (a silent cut is exactly the degradation W-1 exists to refuse).
//
// It POSTs a new page into the unified Articles DB using the injected Notion
// integration token, with the dedicated Tags/Category "Monthly Report" so the
// reports are filterable as their own series in the DB and the reader UI.
//
// The CCR session never reads Secrets Manager: NOTION_API_KEY arrives inline
// from the task's `credentials["notion.integration_token"].apiKey`. The target
// DB id is NOT secret (already committed in newsletter/pipeline) — a constant
// below, overridable by NOTION_DB_ID for tests / migrations.
//
// Usage:
//   NOTION_API_KEY="<credentials['notion.integration_token'].apiKey>" \
//     node workforce/skills/monthly-report/post.mjs \
//       --agent maya \
//       --body-file /tmp/monthly-report-body.md \
//       [--abstract-file /tmp/abstract.txt] \
//       [--tags "AI Strategy,Agentic AI"]   # optional extra vocabulary tags
//       [--status published]                # draft|ready|published|archived
//
// Exit codes:
//   0 — page created (all blocks landed)
//   1 — bad args / env / body-file unreadable / no H1 title
//   2 — W-1 editorial guard failed (short body, LLM-artefact prelude, cut-off
//       last line) or auth rejected
//   3 — Notion API / network error (including a failed batch append — the page
//       is then INCOMPLETE and the error says so; do not leave it silently)

import { readFileSync } from "node:fs";
import { isTruncatedMarkdown, lastNonEmptyLine } from "../../../scripts/lib/truncation.mjs";
import { validateTags } from "../../../scripts/lib/tags.mjs";

const NOTION_VERSION = "2022-06-28";
const NOTION_API = "https://api.notion.com/v1";
// Non-secret target DB id (the unified Articles DB). Overridable for tests.
const UNIFIED_DB_ID = process.env.NOTION_DB_ID || "34fd0f0b-e61e-817a-9f6b-dc65b0d5b4cc";
// The dedicated series tag. A constant, not an LLM choice — every monthly
// report carries it so the series is one filter away in the DB / reader UI.
const REPORT_TAG = "Monthly Report";
// A monthly report is a ~10-page letter (≳ 8,000 chars of Japanese prose).
// Anything under this floor is a failed / truncated generation, not a report.
const MIN_BODY_CHARS = 3000;
// Notion hard limits: 100 blocks per create/append request, 2000 chars per
// rich_text element.
const BLOCKS_PER_REQUEST = 100;
const RICH_TEXT_MAX = 2000;
const ARTEFACT_PRELUDE =
  /^\s*(as an ai|here is|here's|i apologize|i'm sorry|certainly!|sure,|of course)/i;

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

const apiKey = process.env.NOTION_API_KEY;
const agent = arg("agent");
const bodyFile = arg("body-file");
const abstractFile = arg("abstract-file");
const tagsArg = arg("tags");
const status = arg("status") ?? "published";

const VALID_STATUS = new Set(["draft", "ready", "published", "archived"]);

if (!apiKey) { console.error("post.mjs: NOTION_API_KEY env var is required (from credentials['notion.integration_token'].apiKey)"); process.exit(1); }
if (!agent) { console.error("post.mjs: --agent <slug> is required"); process.exit(1); }
if (!bodyFile) { console.error("post.mjs: --body-file <path> is required"); process.exit(1); }
if (!VALID_STATUS.has(status)) {
  console.error(`post.mjs: --status must be one of ${[...VALID_STATUS].join("|")} (got "${status}")`);
  process.exit(1);
}

let body;
try {
  body = readFileSync(bodyFile, "utf8");
} catch (err) {
  console.error(`post.mjs: cannot read --body-file "${bodyFile}": ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

let abstract = "";
if (abstractFile) {
  try {
    abstract = readFileSync(abstractFile, "utf8").trim();
  } catch (err) {
    console.error(`post.mjs: cannot read --abstract-file "${abstractFile}": ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

// ── W-1 editorial guards (fail loud, do not publish) ───────────────────────
const trimmed = body.trim();
if (trimmed.length < MIN_BODY_CHARS) {
  console.error(`post.mjs: body is ${trimmed.length} chars (< ${MIN_BODY_CHARS}) — refusing to publish a truncated/empty report (W-1)`);
  process.exit(2);
}
if (ARTEFACT_PRELUDE.test(trimmed.slice(0, 50))) {
  console.error("post.mjs: body opens with an LLM-failure prelude — refusing to publish (W-1)");
  process.exit(2);
}
if (isTruncatedMarkdown(trimmed)) {
  console.error(`post.mjs: body looks cut off mid-content (last line: "${lastNonEmptyLine(trimmed)}") — refusing to publish a truncated report (W-1)`);
  process.exit(2);
}

// First `# ` line is the page Title; strip it from the body blocks.
const lines = trimmed.split(/\r?\n/);
const h1Idx = lines.findIndex((l) => /^#\s+\S/.test(l));
if (h1Idx === -1) {
  console.error("post.mjs: body has no `# Title` H1 on its own line — the report format requires one (exit 1)");
  process.exit(1);
}
const title = lines[h1Idx].replace(/^#\s+/, "").trim();
const bodyLines = lines.slice(0, h1Idx).concat(lines.slice(h1Idx + 1));

const blocks = markdownToBlocks(bodyLines.join("\n"));

// Extra vocabulary tags are optional and validated against the flat vocabulary
// (ADR-0003); the dedicated series tag is prepended unconditionally.
const extraTags = validateTags((tagsArg || "").split(",").map((t) => t.trim()).filter(Boolean));
const tags = [REPORT_TAG, ...extraTags.filter((t) => t !== REPORT_TAG)];

// Property names mirror the live unified Articles DB exactly (same contract as
// article-level2/publish-notion.mjs). Type=report marks the row as the
// monthly-report series (the site fetcher renders unknown types as analysis).
const properties = {
  Title: { title: [{ text: { content: title.slice(0, RICH_TEXT_MAX) } }] },
  Author: { rich_text: [{ text: { content: agent } }] },
  Type: { select: { name: "report" } },
  Status: { select: { name: status } },
  Date: { date: { start: new Date().toISOString().slice(0, 10) } },
  Category: { rich_text: [{ text: { content: REPORT_TAG } }] },
  Tags: { multi_select: tags.map((name) => ({ name })) },
};
if (abstract) properties.Abstract = { rich_text: [{ text: { content: abstract.slice(0, RICH_TEXT_MAX) } }] };

async function notion(path, method, payload) {
  const res = await fetch(`${NOTION_API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${apiKey}`,
      "notion-version": NOTION_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text().catch(() => "");
  return { res, text };
}

try {
  const first = blocks.slice(0, BLOCKS_PER_REQUEST);
  const rest = blocks.slice(BLOCKS_PER_REQUEST);

  const { res, text } = await notion("/pages", "POST", {
    parent: { database_id: UNIFIED_DB_ID },
    properties,
    children: first,
  });
  if (res.status === 401 || res.status === 403) {
    console.error(`post.mjs: auth rejected (HTTP ${res.status}) — project credential bag misconfigured: ${text.slice(0, 400)}`);
    process.exit(2);
  }
  if (!res.ok) {
    console.error(`post.mjs: Notion API error (HTTP ${res.status}): ${text.slice(0, 400)}`);
    process.exit(3);
  }
  let pageId = "";
  let url = "";
  try { ({ id: pageId, url } = JSON.parse(text)); } catch { /* non-JSON ok body */ }

  // Append the remainder in 100-block batches. A failed append leaves the page
  // incomplete — that is a C-1 state, so it must exit loud (3), never 0.
  for (let i = 0; i < rest.length; i += BLOCKS_PER_REQUEST) {
    const batch = rest.slice(i, i + BLOCKS_PER_REQUEST);
    const { res: r2, text: t2 } = await notion(`/blocks/${pageId}/children`, "PATCH", { children: batch });
    if (!r2.ok) {
      console.error(`post.mjs: batch append failed at block ${BLOCKS_PER_REQUEST + i} (HTTP ${r2.status}) — page ${url} is INCOMPLETE: ${t2.slice(0, 400)}`);
      process.exit(3);
    }
  }

  console.log(`post.mjs: created — Author=${agent} Type=report Status=${status} blocks=${blocks.length} "${title}" ${url}`);
  process.exit(0);
} catch (err) {
  console.error(`post.mjs: fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(3);
}

// Minimal Markdown → Notion blocks (same dialect as publish-notion.mjs: H1-3,
// bullets, blank-line paragraphs), except long text is split across multiple
// rich_text elements instead of sliced at 2000 chars — a report paragraph must
// never be silently cut.
function markdownToBlocks(md) {
  const out = [];
  let para = [];
  const flushPara = () => {
    if (para.length === 0) return;
    pushText("paragraph", para.join(" "));
    para = [];
  };
  const chunk = (content) => {
    const parts = [];
    for (let i = 0; i < content.length; i += RICH_TEXT_MAX) {
      parts.push({ type: "text", text: { content: content.slice(i, i + RICH_TEXT_MAX) } });
    }
    return parts;
  };
  const pushText = (type, content) => {
    out.push({ object: "block", type, [type]: { rich_text: chunk(content) } });
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
  return out;
}
