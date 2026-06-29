#!/usr/bin/env node
// podcast-cast writer — set the `podcastVoice` parameter on one approved
// episode. The Producer (odette) makes the casting judgment (which JA Neural
// voice fits the article); this script owns the deterministic Notion write so
// the LLM can't mangle the page schema. The downstream CI synthesis reads
// podcastVoice (else falls back to a random pool voice).
//
// NOTION_API_KEY from credentials["notion.integration_token"].apiKey.
//
// Usage:
//   NOTION_API_KEY=… node set-voice.mjs --page-id <id> --voice <Takumi|Kazuha|Tomoko>
//
// Exit: 0 written, 1 bad args/env, 2 voice not in the pool / auth, 3 Notion error.

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
if (!apiKey) { console.error("set-voice.mjs: NOTION_API_KEY is required"); process.exit(1); }
if (!pageId) { console.error("set-voice.mjs: --page-id is required"); process.exit(1); }
if (!voice) { console.error("set-voice.mjs: --voice is required"); process.exit(1); }
if (!VOICE_POOL.includes(voice)) {
  console.error(`set-voice.mjs: voice "${voice}" not in the JA Neural pool ${JSON.stringify(VOICE_POOL)} (exit 2)`);
  process.exit(2);
}

try {
  const res = await fetch(`${NOTION_API}/pages/${pageId}`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${apiKey}`, "notion-version": NOTION_VERSION, "content-type": "application/json" },
    body: JSON.stringify({ properties: { podcastVoice: { rich_text: [{ type: "text", text: { content: voice } }] } } }),
  });
  const text = await res.text().catch(() => "");
  if (res.ok) { console.log(`set-voice.mjs: page ${pageId} podcastVoice=${voice}`); process.exit(0); }
  if (res.status === 401 || res.status === 403) { console.error(`set-voice.mjs: auth rejected (HTTP ${res.status})`); process.exit(2); }
  console.error(`set-voice.mjs: Notion API error (HTTP ${res.status}): ${text.slice(0, 300)}`);
  process.exit(3);
} catch (err) {
  console.error(`set-voice.mjs: fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(3);
}
