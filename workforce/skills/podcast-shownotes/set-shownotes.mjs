#!/usr/bin/env node
// podcast-shownotes writer — set the `podcastShowNotes` parameter on one
// audio-ready episode. Celeste (VP, External Comms) writes the show-notes
// framing (a short summary / why-it-matters lead); this script owns the
// deterministic Notion write. The RSS build leads each <item><description>
// with these notes, then the mandatory citations follow.
//
// NOTION_API_KEY from credentials["notion.integration_token"].apiKey.
//
// Usage:
//   NOTION_API_KEY=… node set-shownotes.mjs --page-id <id> --notes-file /tmp/notes.txt
//
// Exit: 0 written, 1 bad args/env/file, 2 empty notes / auth, 3 Notion error.

import { readFileSync } from "node:fs";

const NOTION_VERSION = "2022-06-28";
const NOTION_API = "https://api.notion.com/v1";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}
const apiKey = process.env.NOTION_API_KEY;
const pageId = arg("page-id");
const notesFile = arg("notes-file");
if (!apiKey) { console.error("set-shownotes.mjs: NOTION_API_KEY is required"); process.exit(1); }
if (!pageId) { console.error("set-shownotes.mjs: --page-id is required"); process.exit(1); }
if (!notesFile) { console.error("set-shownotes.mjs: --notes-file is required"); process.exit(1); }

let notes;
try { notes = readFileSync(notesFile, "utf8").trim(); }
catch (err) { console.error(`set-shownotes.mjs: cannot read --notes-file: ${err instanceof Error ? err.message : String(err)}`); process.exit(1); }
if (!notes) { console.error("set-shownotes.mjs: notes are empty — refusing to write blank show-notes (exit 2)"); process.exit(2); }

// Chunk into ≤2000-char rich_text objects so nothing is silently dropped.
const chunks = [];
for (let i = 0; i < notes.length; i += 2000) chunks.push({ type: "text", text: { content: notes.slice(i, i + 2000) } });

try {
  const res = await fetch(`${NOTION_API}/pages/${pageId}`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${apiKey}`, "notion-version": NOTION_VERSION, "content-type": "application/json" },
    body: JSON.stringify({ properties: { podcastShowNotes: { rich_text: chunks } } }),
  });
  const text = await res.text().catch(() => "");
  if (res.ok) { console.log(`set-shownotes.mjs: page ${pageId} podcastShowNotes set (${notes.length} chars)`); process.exit(0); }
  if (res.status === 401 || res.status === 403) { console.error(`set-shownotes.mjs: auth rejected (HTTP ${res.status})`); process.exit(2); }
  console.error(`set-shownotes.mjs: Notion API error (HTTP ${res.status}): ${text.slice(0, 300)}`);
  process.exit(3);
} catch (err) {
  console.error(`set-shownotes.mjs: fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(3);
}
