#!/usr/bin/env node
// restore-podcast-collided-audio.mjs — one-shot repair for the podcast
// slug-collision bug (2026-05 → 2026-09).
//
// What happened: wf-podcast slugged an episode by the FIRST 12 hex of its
// Notion page id. This workspace's ids are `XXXd0f0b-e61e-8…` — a time prefix
// plus a workspace constant — so every page created the same day got the same
// slug. That slug was both the MP3 key (podcast/audio/{slug}.mp3) and the feed
// GUID: each later synthesis overwrote the earlier episode's audio, and
// Spotify dropped every item whose GUID repeated: 88 of 168 published
// episodes were hidden (32 collision groups), 56 of them with overwritten audio.
//
// What this does: the overwritten audio survives as prior S3 object versions
// (the bucket is versioned). The committed plan maps every affected page to
// the exact version that holds its audio — matched by transcribing each
// version's opening and comparing it to each script's opening. For each
// entry this copies that version to the page's own collision-free key
// (podcast/audio/{last-12-hex}.mp3, stamped with `page-id` metadata as
// wf-podcast now does) and repoints the page's Notion `audioUrl` at it. Every
// member of a collision group moves, so each gets a GUID Spotify has never
// seen. The old shared keys are left in place, unreferenced.
//
// Idempotent: an entry whose page already points at its new key, with the
// new key already stamped for that page, is skipped. Fail loud (C-4): a new
// key owned by another page, or a page whose audioUrl is neither the old nor
// the new key, stops the run before anything is written.
//
// Usage (operator machine or CI, AWS creds in scope):
//   node workforce/scripts/restore-podcast-collided-audio.mjs [--apply] [--plan <file>]
//     --apply   write (default: dry run — print the plan, write nothing)
//     --plan    default: workforce/scripts/backups/podcast-collision-restore-20260927.json
//
// Afterwards rebuild the feed (wf-podcast must already carry the GUID-from-
// audioUrl fix, or the feed keeps the shared GUIDs):
//   node workforce/skills/podcast-publish/build-rss.mjs
//
// Requires: `aws` CLI on PATH. The Notion key is read from the same Secrets
// Manager entry wf-podcast uses.

import { ensureProxyAwareEntry } from "../../scripts/lib/proxy-bootstrap.mjs";
ensureProxyAwareEntry(import.meta.url);

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { slugFromId } from "./lib/notion.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REGION = process.env.AWS_REGION ?? "us-west-2";
const BUCKET = process.env.BUCKET_NAME ?? "wf-bucket-533266988941-us-west-2-prod";
const NOTION_SECRET_ID = process.env.NOTION_SECRET_ID ?? "wf/projects/agent-workforce/notion.integration_token";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const planIdx = args.indexOf("--plan");
const planPath = planIdx >= 0 ? args[planIdx + 1] : join(HERE, "backups", "podcast-collision-restore-20260927.json");
const plan = JSON.parse(readFileSync(planPath, "utf8")).entries;

// stderr is captured, not echoed: head-object's expected 404 for a not-yet-
// restored key would otherwise print an alarming "[ERROR] … Not Found" per entry.
const aws = (...a) =>
  execFileSync("aws", [...a, "--region", REGION, "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const headMeta = (key) => {
  try {
    return JSON.parse(aws("s3api", "head-object", "--bucket", BUCKET, "--key", key)).Metadata ?? {};
  } catch (err) {
    if (/Not Found|404/.test(String(err.stderr ?? err.message))) return null;
    throw err;
  }
};

const notionKey = JSON.parse(
  JSON.parse(aws("secretsmanager", "get-secret-value", "--secret-id", NOTION_SECRET_ID)).SecretString,
).apiKey;
const notion = async (path, init = {}) => {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    ...init,
    headers: { authorization: `Bearer ${notionKey}`, "notion-version": "2022-06-28", "content-type": "application/json" },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`notion ${res.status} ${path}: ${JSON.stringify(body).slice(0, 300)}`);
  return body;
};

// Pass 1 — validate everything before writing anything (read-only).
const work = [];
let checked = 0;
for (const e of plan) {
  process.stderr.write(`\rchecking ${++checked}/${plan.length} (read-only)…`);
  const page = await notion(`/pages/${e.pageId}`);
  const audioUrl = page.properties?.audioUrl?.url ?? "";
  const base = audioUrl.replace(/\/podcast\/audio\/[^/]+$/, "");
  const oldKey = `podcast/audio/${e.oldKey}.mp3`;
  const newKey = `podcast/audio/${slugFromId(e.pageId)}.mp3`;
  const newUrl = `${base}/${newKey}`;
  const owner = headMeta(newKey);
  if (owner && owner["page-id"] !== e.pageId) {
    throw new Error(`${newKey} already exists for ${owner["page-id"] ?? "an unknown page"} — refusing (${e.title})`);
  }
  if (audioUrl === newUrl && owner) {
    console.log(`skip  ${e.pageId}  already restored → ${newKey}`);
    continue;
  }
  if (!audioUrl.endsWith(`/${oldKey}`) && audioUrl !== newUrl) {
    throw new Error(`page ${e.pageId} audioUrl is ${audioUrl}, expected …/${oldKey} — refusing (${e.title})`);
  }
  work.push({ ...e, oldKey, newKey, newUrl });
}

process.stderr.write("\n");
for (const w of work) console.log(`${apply ? "apply" : "plan "}  ${w.oldKey}@${w.versionId} → ${w.newKey}  ${w.title}`);
if (!apply) {
  console.log(`\ndry run: ${work.length} to restore, ${plan.length - work.length} already done. Re-run with --apply to write.`);
  process.exit(0);
}

// Pass 2 — copy the pinned version, then repoint Notion.
let written = 0;
for (const w of work) {
  aws(
    "s3api", "copy-object",
    "--bucket", BUCKET,
    "--copy-source", `${BUCKET}/${w.oldKey}?versionId=${encodeURIComponent(w.versionId)}`,
    "--key", w.newKey,
    "--content-type", "audio/mpeg",
    "--metadata", `page-id=${w.pageId}`,
    "--metadata-directive", "REPLACE",
  );
  await notion(`/pages/${w.pageId}`, { method: "PATCH", body: JSON.stringify({ properties: { audioUrl: { url: w.newUrl } } }) });
  console.log(`done  ${++written}/${work.length}  ${w.newKey}`);
}
console.log(`\nrestored ${work.length}. Rebuild the feed: node workforce/skills/podcast-publish/build-rss.mjs`);
