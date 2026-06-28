#!/usr/bin/env node
// Deterministic podcast-script writer — invoked by the CCR agent-runner after
// it has *generated* the narration script + the source citations. The LLM owns
// the judgment (the spoken-word script, the citation list); this script owns
// the structurally-exact Notion write so the failure class "LLM hand-edits the
// page JSON and guesses the schema wrong" cannot recur. Same shape as
// article-level2/publish-notion.mjs, with two differences:
//
//   1. It UPDATES an existing article page (PATCH /pages/{page_id}) rather than
//      creating one — the script attaches to the article it adapts (C-2: the
//      article's Notion page stays the source of truth).
//   2. It adds a CITATION GUARD: an empty/whitespace --citations-file is the
//      mechanical implementation of the team's mandatory-citation policy
//      (Idris / ADR-0016) — exit 2, never publish an uncited derivative.
//
// Properties written (Story 4 schema — operator pre-creates them):
//   podcastScript  (rich_text)  ← the narration script, chunked ≤2000-char/item
//   podcastSources (rich_text)  ← the source citations (mandatory, non-empty)
//   podcastStatus  (select)     ← "script-ready"
//
// W-1 (editorial integrity): refuses an empty/too-short script, an LLM-failure
// prelude, or a script whose last line looks cut off mid-content (the canonical
// scripts/lib/truncation.mjs heuristic) — failing loud (exit 2) rather than
// attaching a degraded script. The audio step (Story 5) only picks up
// script-ready pages, so the guard must fire here, per-episode.
//
// NOTION_API_KEY comes from the task's injected
// credentials["notion.integration_token"].apiKey.
//
// Usage:
//   NOTION_API_KEY="<apiKey>" \
//     node workforce/skills/podcast-script/publish-notion.mjs \
//       --page-id <article notion page id, from pick-article.mjs> \
//       --script-file /tmp/script.md \
//       --citations-file /tmp/citations.txt \
//       [--status script-ready]
//
// Exit codes:
//   0  — page updated (podcastStatus=script-ready)
//   1  — bad args / env / file unreadable
//   2  — W-1 editorial guard failed (empty/short/truncated script, artefact
//        prelude) OR empty citations (citation guard) OR 401/403 auth
//   3  — Notion API error / network error

import { readFileSync } from "node:fs";
import { isTruncatedMarkdown, lastNonEmptyLine } from "../../../scripts/lib/truncation.mjs";

const NOTION_VERSION = "2022-06-28";
const NOTION_API = "https://api.notion.com/v1";
// A ~10-minute single-narrator script is several thousand chars; anything
// shorter than this floor is almost certainly truncated/empty (C-1).
const MIN_SCRIPT_CHARS = 600;
const ARTEFACT_PRELUDE =
  /^\s*(as an ai|here is|here's|i apologize|i'm sorry|certainly!|sure,|of course)/i;

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

const apiKey = process.env.NOTION_API_KEY;
const pageId = arg("page-id");
const scriptFile = arg("script-file");
const citationsFile = arg("citations-file");
const status = arg("status") ?? "script-ready";

const VALID_STATUS = new Set(["none", "script-ready", "audio-ready", "published"]);

if (!apiKey) { console.error("publish-notion.mjs: NOTION_API_KEY env var is required (from credentials['notion.integration_token'].apiKey)"); process.exit(1); }
if (!pageId) { console.error("publish-notion.mjs: --page-id <notion page id> is required (from pick-article.mjs)"); process.exit(1); }
if (!scriptFile) { console.error("publish-notion.mjs: --script-file <path> is required"); process.exit(1); }
if (!citationsFile) { console.error("publish-notion.mjs: --citations-file <path> is required"); process.exit(1); }
if (!VALID_STATUS.has(status)) {
  console.error(`publish-notion.mjs: --status must be one of ${[...VALID_STATUS].join("|")} (got "${status}")`);
  process.exit(1);
}

function readFileOrDie(path, label) {
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    console.error(`publish-notion.mjs: cannot read ${label} "${path}": ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

const script = readFileOrDie(scriptFile, "--script-file");
const citations = readFileOrDie(citationsFile, "--citations-file");

// ── Citation guard (mandatory-citation policy — Idris / ADR-0016) ───────────
// An empty or whitespace-only citations file is a hard fail: a podcast derived
// from third-party news must carry its sources, mechanically, every episode.
if (citations.trim().length === 0) {
  console.error("publish-notion.mjs: --citations-file is empty — refusing to attach an uncited podcast script (mandatory-citation guard, ADR-0016). exit 2");
  process.exit(2);
}

// ── W-1 editorial guards on the script (fail loud, do not attach) ───────────
const trimmed = script.trim();
if (trimmed.length < MIN_SCRIPT_CHARS) {
  console.error(`publish-notion.mjs: script is ${trimmed.length} chars (< ${MIN_SCRIPT_CHARS}) — refusing to attach a truncated/empty script (W-1)`);
  process.exit(2);
}
if (ARTEFACT_PRELUDE.test(trimmed.slice(0, 50))) {
  console.error("publish-notion.mjs: script opens with an LLM-failure prelude — refusing to attach (W-1)");
  process.exit(2);
}
if (isTruncatedMarkdown(trimmed)) {
  console.error(`publish-notion.mjs: script looks cut off mid-content (last line: "${lastNonEmptyLine(trimmed)}") — refusing to attach a truncated script (W-1)`);
  process.exit(2);
}

// Notion rich_text: each text object's content is capped at 2000 chars. A long
// script is chunked across multiple objects in the same property so NOTHING is
// dropped (silent truncation would be the exact C-1 failure we guard against).
function richTextChunks(str) {
  const MAX = 2000;
  const out = [];
  for (let i = 0; i < str.length; i += MAX) {
    out.push({ type: "text", text: { content: str.slice(i, i + MAX) } });
  }
  // Notion caps a property's rich_text array at 100 objects (200k chars) — far
  // beyond any plausible script; assert rather than silently drop.
  if (out.length > 100) {
    console.error(`publish-notion.mjs: ${str.length} chars exceeds the 100×2000 Notion rich_text property limit — split the episode (W-1, fail loud)`);
    process.exit(2);
  }
  return out;
}

const properties = {
  podcastScript: { rich_text: richTextChunks(trimmed) },
  podcastSources: { rich_text: richTextChunks(citations.trim()) },
  podcastStatus: { select: { name: status } },
};

try {
  const res = await fetch(`${NOTION_API}/pages/${pageId}`, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "notion-version": NOTION_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify({ properties }),
  });
  const text = await res.text().catch(() => "");
  if (res.ok) {
    console.log(`publish-notion.mjs: updated page ${pageId} — podcastStatus=${status}, script ${trimmed.length} chars, citations ${citations.trim().length} chars`);
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
