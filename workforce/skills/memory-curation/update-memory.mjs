#!/usr/bin/env node
// Deterministic memory writer — invoked by the CCR agent-runner after the
// LLM has *distilled* the revised MEMORY.md. The LLM owns the judgment
// (what the record means); this script owns the structurally-exact write,
// so the "LLM hand-edits JSON and guesses the schema wrong" failure class
// cannot recur (same division as feed-post/post-feed.mjs).
//
// It POSTs to the authenticated `POST /agents/{slug}/memory` endpoint
// (ADR-0020), which re-validates the ADR-0019 content contract and the
// shrink guard server-side before writing the `memory` profile block and
// landing an AUDIT row. The client-side pre-check here exists only to
// fail fast with a named reason before the network round-trip; the server
// copy (lambdas/shared/memory-contract.ts) is the authoritative gate.
//
// Body is read from a FILE (not an arg) so multi-line / Unicode prose
// can't be mangled by shell quoting.
//
// The write TOKEN is injected per-fire
// (credentials['workforce.memory_write_token'].token); the endpoint URL is
// not a secret and is embedded here as this skill's single source of
// truth. Override with MEMORY_API_BASE only for non-prod stages.
//
// Usage:
//   MEMORY_WRITE_TOKEN=<token> \
//     node workforce/skills/memory-curation/update-memory.mjs \
//       --agent freya --body-file /tmp/memory-freya.md [--allow-shrink]
//
// Exit codes:
//   0 — memory written (HTTP 200)
//   1 — bad args / env / body-file unreadable / local contract pre-check
//   2 — endpoint rejected the write (HTTP 422 contract/shrink, 401 auth, 404 slug)
//   3 — network / unexpected error

import { readFileSync } from "node:fs";

const DEFAULT_API_BASE = "https://sjhikazsf9.execute-api.us-west-2.amazonaws.com/prod";
const API_BASE = (process.env.MEMORY_API_BASE ?? DEFAULT_API_BASE).replace(/\/+$/, "");

// Mirrors lambdas/shared/memory-contract.ts (the authoritative server copy).
const MEMORY_BLOCK_MAX_CHARS = 16 * 1024;
const MEMORY_MIN_CHARS = 200;

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

const token = process.env.MEMORY_WRITE_TOKEN;
const agent = arg("agent");
const bodyFile = arg("body-file");
const allowShrink = process.argv.includes("--allow-shrink");

if (!token) {
  console.error("MEMORY_WRITE_TOKEN env var is required (credentials['workforce.memory_write_token'].token)");
  process.exit(1);
}
if (!agent || !/^[a-z]+$/.test(agent)) {
  console.error(`--agent must be a lowercase slug (got "${agent ?? ""}")`);
  process.exit(1);
}
if (!bodyFile) {
  console.error("--body-file is required");
  process.exit(1);
}

let body;
try {
  body = readFileSync(bodyFile, "utf8");
} catch (err) {
  console.error(`cannot read --body-file ${bodyFile}: ${err.message}`);
  process.exit(1);
}

// Fail-fast local pre-check of the ADR-0019 contract.
const violations = [];
if (!/^# MEMORY — /m.test(body)) violations.push('missing "# MEMORY — <Name> (<Role>)" title');
if (!/Curated:\s*\d{4}-\d{2}-\d{2}/.test(body)) violations.push('missing "Curated: YYYY-MM-DD" token');
if (!/^## Mission anchor$/m.test(body)) violations.push('missing "## Mission anchor" section');
if (body.trim().length < MEMORY_MIN_CHARS) violations.push(`body under ${MEMORY_MIN_CHARS} chars`);
if (body.length > MEMORY_BLOCK_MAX_CHARS) violations.push(`body over the ${MEMORY_BLOCK_MAX_CHARS}-char ceiling`);
if (violations.length > 0) {
  console.error(`memory document fails the ADR-0019 contract locally:\n  - ${violations.join("\n  - ")}`);
  process.exit(1);
}

try {
  const res = await fetch(`${API_BASE}/agents/${encodeURIComponent(agent)}/memory`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(allowShrink ? { body, allow_shrink: true } : { body }),
  });
  const text = await res.text();
  if (res.status === 200) {
    console.log(`memory written for ${agent}: ${text}`);
    process.exit(0);
  }
  console.error(`endpoint rejected the write for ${agent}: HTTP ${res.status} ${text}`);
  process.exit(res.status === 401 || res.status === 404 || res.status === 422 ? 2 : 3);
} catch (err) {
  console.error(`network error writing memory for ${agent}: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(3);
}
