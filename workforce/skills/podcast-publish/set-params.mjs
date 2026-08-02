#!/usr/bin/env node
// podcast-publish param writer — set the publish-side judgment parameters on one
// `approved` episode in a single Notion PATCH: the narrator voice (Odette's
// casting, folded into Celeste's cadence) and the show-notes framing (Celeste).
// The CI synthesis reads podcastVoice (else random); the CI publish leads the
// feed <description> with podcastShowNotes, then the mandatory citations.
//
// This owns the deterministic Notion write so the LLM can't mangle the page
// schema. At least one of --voice / --notes-file must be given.
//
// NOTION_API_KEY from credentials["notion.integration_token"].apiKey.
//
// Usage:
//   NOTION_API_KEY=… node set-params.mjs --page-id <id> \
//     [--voice <Takumi|Kazuha|Tomoko>] [--notes-file /tmp/notes.txt]
//
// Exit: 0 written, 1 bad args/env/file, 2 voice not in pool / empty notes / auth,
//       3 Notion error.

import "../../../scripts/lib/proxy-bootstrap.mjs";

import { readFileSync } from "node:fs";

const NOTION_VERSION = "2022-06-28";
const NOTION_API = "https://api.notion.com/v1";
// Mirror of JA_NEURAL_VOICES in the wf-podcast Lambda. Casting outside the pool
// is rejected so synthesis never gets an unsupported VoiceId.
const VOICE_POOL = ["Takumi", "Kazuha", "Tomoko"];

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}
const apiKey = process.env.NOTION_API_KEY;
const pageId = arg("page-id");
const voice = arg("voice");
const notesFile = arg("notes-file");

if (!apiKey) { console.error("set-params.mjs: NOTION_API_KEY is required"); process.exit(1); }
if (!pageId) { console.error("set-params.mjs: --page-id is required"); process.exit(1); }
if (!voice && !notesFile) { console.error("set-params.mjs: at least one of --voice / --notes-file is required"); process.exit(1); }

const properties = {};

if (voice !== undefined) {
  if (!VOICE_POOL.includes(voice)) {
    console.error(`set-params.mjs: voice "${voice}" not in the JA Neural pool ${JSON.stringify(VOICE_POOL)} (exit 2)`);
    process.exit(2);
  }
  properties.podcastVoice = { rich_text: [{ type: "text", text: { content: voice } }] };
}

if (notesFile !== undefined) {
  let notes;
  try { notes = readFileSync(notesFile, "utf8").trim(); }
  catch (err) { console.error(`set-params.mjs: cannot read --notes-file: ${err instanceof Error ? err.message : String(err)}`); process.exit(1); }
  if (!notes) { console.error("set-params.mjs: notes are empty — refusing to write blank show-notes (exit 2)"); process.exit(2); }
  // Chunk into ≤2000-char rich_text objects so nothing is silently dropped.
  const chunks = [];
  for (let i = 0; i < notes.length; i += 2000) chunks.push({ type: "text", text: { content: notes.slice(i, i + 2000) } });
  properties.podcastShowNotes = { rich_text: chunks };
}

try {
  const res = await fetch(`${NOTION_API}/pages/${pageId}`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${apiKey}`, "notion-version": NOTION_VERSION, "content-type": "application/json" },
    body: JSON.stringify({ properties }),
  });
  const text = await res.text().catch(() => "");
  if (res.ok) { console.log(`set-params.mjs: page ${pageId} set ${Object.keys(properties).join(" + ")}`); process.exit(0); }
  if (res.status === 401 || res.status === 403) { console.error(`set-params.mjs: auth rejected (HTTP ${res.status})`); process.exit(2); }
  console.error(`set-params.mjs: Notion API error (HTTP ${res.status}): ${text.slice(0, 300)}`);
  process.exit(3);
} catch (err) {
  console.error(`set-params.mjs: fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(3);
}
