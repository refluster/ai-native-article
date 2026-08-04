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
// BILINGUAL (ADR-0005): every article is published in BOTH languages. The
// Japanese body writes the row; the English body writes an `EN` child page
// under it, which newsletter/pipeline/fetch-notion.mjs exports as
// `<slug>.en.md`. `--body-en-file` is therefore REQUIRED, not optional — the
// site's promise is that every article has both editions, so a fire that
// produced only Japanese is a failed fire and must say so (C-4) rather than
// quietly adding a row that the English reader will only ever see as a
// fallback. Both bodies clear the same W-1 guards, and all guards run BEFORE
// any write, so a bad English body publishes nothing at all.
//
// Usage:
//   NOTION_API_KEY="<credentials['notion.integration_token'].apiKey>" \
//     node workforce/skills/article-level2/publish-notion.mjs \
//       --author elena --type explanation --status ready \
//       --body-file /tmp/article.md \
//       --body-en-file /tmp/article.en.md \
//       [--source-url https://...] \
//       [--tags "AI Productivity,Org Transformation"]  # 3–5 flat tags from scripts/lib/tags.mjs
//       [--abstract-file /tmp/abstract.txt]  # L2 lead → Abstract
//       [--abstract-en-file /tmp/abstract.en.txt]  # English lead → EN page
//
// Exit codes:
//   0  — page created, in both editions
//   1  — bad args / env / body-file unreadable / no H1 title
//   2  — W-1 editorial guard failed (empty/short body, LLM-artefact prelude,
//        or cut-off last line) in EITHER edition
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
const bodyEnFile = arg("body-en-file");       // REQUIRED — the English edition (ADR-0005)
const sourceUrl = arg("source-url");
const tagsArg = arg("tags");                  // comma-separated vocabulary tags (3–5)
const abstractFile = arg("abstract-file");    // optional lead/summary file
const abstractEnFile = arg("abstract-en-file"); // optional English lead

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
if (!bodyEnFile) {
  console.error("publish-notion.mjs: --body-en-file <path> is required — every article publishes in both editions (ADR-0005)");
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

// Optional abstract (the L2 lead / source summary → the Abstract column, same
// role as l1Summary in the GAS L2 write). Read from a file so multi-line /
// Unicode prose isn't mangled by shell quoting, exactly like --body-file.
const abstract = abstractFile ? readOrExit(abstractFile, "abstract-file").trim() : "";
const abstractEn = abstractEnFile ? readOrExit(abstractEnFile, "abstract-en-file").trim() : "";

// ── W-1 editorial guards (fail loud, do not publish) ───────────────────────
// Applied identically to both editions, and to BOTH before anything is
// written: a translated body that got cut off is exactly as unpublishable as a
// Japanese one (C-1), and failing after the row exists would leave the corpus
// in the half-published state the guard exists to prevent.
function assertPublishable(text, edition) {
  const t = text.trim();
  if (t.length < MIN_BODY_CHARS) {
    console.error(`publish-notion.mjs: ${edition} body is ${t.length} chars (< ${MIN_BODY_CHARS}) — refusing to publish a truncated/empty explanation (W-1)`);
    process.exit(2);
  }
  if (ARTEFACT_PRELUDE.test(t.slice(0, 50))) {
    console.error(`publish-notion.mjs: ${edition} body opens with an LLM-failure prelude — refusing to publish (W-1)`);
    process.exit(2);
  }
  if (isTruncatedMarkdown(t)) {
    console.error(`publish-notion.mjs: ${edition} body looks cut off mid-content (last line: "${lastNonEmptyLine(t)}") — refusing to publish a truncated explanation (W-1)`);
    process.exit(2);
  }
  return t;
}

// First `# ` line is the title; strip it from the body blocks.
function splitTitle(text, edition) {
  const lines = text.split(/\r?\n/);
  const h1Idx = lines.findIndex((l) => /^#\s+\S/.test(l));
  if (h1Idx === -1) {
    console.error(`publish-notion.mjs: ${edition} body has no \`# Title\` H1 on its own line — the L2 format requires one (exit 1)`);
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
// page exists — the old code silently sliced it off, which is a C-1 hole that
// only stayed hidden because a ~3000字 article usually lands under the cap.
const [children, ...overflow] = chunkBlocks(blocks);

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
    console.error(`publish-notion.mjs: auth rejected (HTTP ${err.status}) — project credential bag misconfigured: ${err.message}`);
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
    `publish-notion.mjs: created — Author=${author} Type=${articleType} Status=${status} ` +
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
