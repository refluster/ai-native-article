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
// Articles DB so the deploy-article-site.yml pipeline picks it up and
// surfaces it on kohuehara.xyz with the Maya AuthorChip byline.
//
// BILINGUAL (ADR-0005): every article is published in BOTH languages. The
// Japanese body writes the row; the English body writes an `EN` child page
// under it, which newsletter/pipeline/fetch-notion.mjs exports as
// `<slug>.en.md`. `--body-en-file` is REQUIRED, not optional — the site's
// promise is that every article has both editions, so a fire that produced
// only Japanese is a failed fire and must say so (C-4) rather than quietly
// adding a row that the English reader will only ever see as a fallback.
// Both bodies clear the same W-1 guards, and all guards run BEFORE any
// write, so a bad English body publishes nothing at all.
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
//       --body-en-file /tmp/hypothesis.en.md \
//       [--abstract-file /tmp/hypothesis-abstract.txt] \
//       [--abstract-en-file /tmp/hypothesis-abstract.en.txt] \
//       [--tags "AI Strategy,Agentic AI"]
//
// Exit codes:
//   0  — page created, in both editions
//   1  — bad args / env / body-file unreadable / no H1 title
//   2  — W-1 editorial guard failed (short body, LLM-artefact prelude,
//        cut-off last line, or 401/403 auth error) in EITHER edition
//   3  — Notion API error / network error; nothing was created
//   4  — the row was created but its English edition could not be written.
//        The article exists and is Japanese-only. Report the page URL on
//        stderr; the operator (or a re-run of backfill-en.mjs) completes it.

import { ensureProxyAwareEntry } from "../../../scripts/lib/proxy-bootstrap.mjs";
ensureProxyAwareEntry(import.meta.url);

import { readFileSync } from "node:fs";
import { isTruncatedMarkdown, lastNonEmptyLine } from "../../../scripts/lib/truncation.mjs";
import { validateTags } from "../../../scripts/lib/tags.mjs";
import {
  chunkBlocks,
  markdownToBlocks,
  writeEnChildPage,
} from "../../../scripts/lib/notion-i18n.mjs";

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
const bodyEnFile = arg("body-en-file");       // REQUIRED — the English edition (ADR-0005)
const tagsArg = arg("tags");
const abstractFile = arg("abstract-file");
const abstractEnFile = arg("abstract-en-file"); // optional English abstract

const VALID_STATUS = new Set(["draft", "ready", "published", "archived"]);

if (!apiKey) {
  console.error("publish-notion.mjs: NOTION_API_KEY env var is required (from credentials['notion.integration_token'].apiKey)");
  process.exit(1);
}
if (!bodyFile) {
  console.error("publish-notion.mjs: --body-file <path> is required");
  process.exit(1);
}
if (!bodyEnFile) {
  console.error("publish-notion.mjs: --body-en-file <path> is required — every article publishes in both editions (ADR-0005)");
  process.exit(1);
}
if (!VALID_STATUS.has(status)) {
  console.error(`publish-notion.mjs: --status must be one of ${[...VALID_STATUS].join("|")} (got "${status}")`);
  process.exit(1);
}

function readOrExit(path, flag) {
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    console.error(`publish-notion.mjs: cannot read --${flag} "${path}": ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

const body = readOrExit(bodyFile, "body-file");
const bodyEn = readOrExit(bodyEnFile, "body-en-file");

const abstract = abstractFile ? readOrExit(abstractFile, "abstract-file").trim() : "";
const abstractEn = abstractEnFile ? readOrExit(abstractEnFile, "abstract-en-file").trim() : "";

// ── W-1 editorial guards (fail loud, do not publish) ───────────────────────
// Applied identically to both editions, and to BOTH before anything is
// written: a translated body that got cut off is exactly as unpublishable as
// a Japanese one (C-1), and failing after the row exists would leave the
// corpus in the half-published state the guard exists to prevent.
function assertPublishable(text, edition) {
  const t = text.trim();
  if (t.length < MIN_BODY_CHARS) {
    console.error(`publish-notion.mjs: ${edition} body is ${t.length} chars (< ${MIN_BODY_CHARS}) — refusing to publish a truncated/empty hypothesis article (W-1)`);
    process.exit(2);
  }
  if (ARTEFACT_PRELUDE.test(t.slice(0, 50))) {
    console.error(`publish-notion.mjs: ${edition} body opens with an LLM-failure prelude — refusing to publish (W-1)`);
    process.exit(2);
  }
  if (isTruncatedMarkdown(t)) {
    console.error(`publish-notion.mjs: ${edition} body looks cut off mid-content (last line: "${lastNonEmptyLine(t)}") — refusing to publish a truncated hypothesis article (W-1)`);
    process.exit(2);
  }
  return t;
}

// First `# ` line is the title; strip it from the body blocks.
function splitTitle(text, edition) {
  const lines = text.split(/\r?\n/);
  const h1Idx = lines.findIndex((l) => /^#\s+\S/.test(l));
  if (h1Idx === -1) {
    console.error(`publish-notion.mjs: ${edition} body has no \`# Title\` H1 on its own line (exit 1)`);
    process.exit(1);
  }
  return {
    title: lines[h1Idx].replace(/^#\s+/, "").trim(),
    body: lines.slice(0, h1Idx).concat(lines.slice(h1Idx + 1)).join("\n"),
  };
}

const trimmed = assertPublishable(body, "Japanese");
const trimmedEn = assertPublishable(bodyEn, "English");
const { title, body: bodyWithoutTitle } = splitTitle(trimmed, "Japanese");
const { title: titleEn, body: bodyEnWithoutTitle } = splitTitle(trimmedEn, "English");

const blocks = markdownToBlocks(bodyWithoutTitle);
// Notion caps `children` at 100 per request. The rest is appended after the
// page exists so a long hypothesis article publishes whole or fails loud.
const [children, ...overflow] = chunkBlocks(blocks);

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

/**
 * One Notion request. Throws an Error carrying `.status` and `.body` on any
 * non-2xx so the caller can map HTTP status onto this script's exit codes —
 * and so `writeEnChildPage` can stay a pure, injectable helper.
 */
async function notionFetch(method, path, payload) {
  const res = await fetch(`${NOTION_API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${apiKey}`,
      "notion-version": NOTION_VERSION,
      "content-type": "application/json",
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    const err = new Error(`Notion ${method} ${path} → HTTP ${res.status}: ${text.slice(0, 400)}`);
    err.status = res.status;
    throw err;
  }
  try { return JSON.parse(text); } catch { return {}; }
}

let page;
try {
  page = await notionFetch("POST", "/pages", {
    parent: { database_id: databaseId },
    properties,
    children,
  });
  for (const chunk of overflow) {
    await notionFetch("PATCH", `/blocks/${page.id}/children`, { children: chunk });
  }
} catch (err) {
  if (err.status === 401 || err.status === 403) {
    console.error(`publish-notion.mjs: auth rejected (HTTP ${err.status}) — project credential misconfigured: ${err.message}`);
    process.exit(2);
  }
  console.error(`publish-notion.mjs: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(3);
}

// English edition (ADR-0005) — an `EN` child page under the row we just
// created. Its body already cleared the same W-1 guards, so the only way this
// fails now is a Notion/network fault, which is exit 4: the article exists but
// is Japanese-only, and that is a different operator action from "nothing was
// published".
try {
  const en = await writeEnChildPage({
    parentPageId: page.id,
    en: { title: titleEn, abstract: abstractEn, body: bodyEnWithoutTitle },
    notionFetch,
  });
  console.log(
    `publish-notion.mjs: created — Author=${author} Type=${ARTICLE_TYPE} Status=${status} ` +
      `"${title}" ${page.url ?? ""} (+ EN edition "${titleEn}", ${en.blocks} blocks)`,
  );
  process.exit(0);
} catch (err) {
  console.error(
    `publish-notion.mjs: the row was created but its English edition failed to write: ` +
      `${err instanceof Error ? err.message : String(err)}`,
  );
  console.error(`  Japanese article is live at ${page.url ?? page.id}. Complete it with:`);
  console.error(`  node newsletter/pipeline/backfill-en.mjs --page-id ${page.id}`);
  process.exit(4);
}
