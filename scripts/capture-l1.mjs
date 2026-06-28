#!/usr/bin/env node
// capture-l1 — desktop entrypoint for the mechanical L1 source capture.
//
// POSTs a source URL (plus optional title/category/summary/publicationDate)
// to the wf-l1-source-register Lambda, which registers it as a row in the
// Notion L1 source DB. No LLM is involved — this is a thin HTTP client.
//
// The same endpoint backs the iOS Shortcut (Share Sheet → POST). This CLI is
// the desktop equivalent.
//
// Env:
//   L1_CAPTURE_ENDPOINT  (required) — e.g. https://<api-id>.execute-api.us-west-2.amazonaws.com/dev/l1/register
//   L1_CAPTURE_TOKEN     (required) — the bearer token (Secrets Manager wf/api/l1-source-write-token)
//
// Usage:
//   node scripts/capture-l1.mjs <url> [--title T] [--category A-E] [--summary S] [--date YYYY-MM-DD]
//
// Exit codes: 0 created/deduped · 1 bad args/env · 3 HTTP/network error

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith("--"));
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
};

const endpoint = process.env.L1_CAPTURE_ENDPOINT;
const token = process.env.L1_CAPTURE_TOKEN;

if (!url || !/^https?:\/\/\S+$/i.test(url)) {
  console.error("capture-l1: first arg must be an http(s) URL");
  console.error("usage: node scripts/capture-l1.mjs <url> [--title T] [--category A-E] [--summary S] [--date YYYY-MM-DD]");
  process.exit(1);
}
if (!endpoint || !token) {
  console.error("capture-l1: L1_CAPTURE_ENDPOINT and L1_CAPTURE_TOKEN env vars are required");
  process.exit(1);
}

const payload = { url };
const title = flag("title");
const category = flag("category");
const summary = flag("summary");
const date = flag("date");
if (title) payload.title = title;
if (category) payload.category = category;
if (summary) payload.summary = summary;
if (date) payload.publicationDate = date;

try {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`capture-l1: HTTP ${res.status}: ${text.slice(0, 300)}`);
    process.exit(3);
  }
  let body = {};
  try { body = JSON.parse(text); } catch { /* non-JSON ok */ }
  console.log(`capture-l1: ${body.deduped ? "already registered" : "registered"} — ${body.url || "(no url)"}`);
  process.exit(0);
} catch (err) {
  console.error(`capture-l1: request failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(3);
}
