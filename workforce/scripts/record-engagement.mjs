#!/usr/bin/env node
// record-engagement.mjs — record an agent's work in the Track Record from an
// interactive / operator-credentialed context (Claude Code session, manual run).
//
// ADR-0005 item 5 generalised: the engagement endpoint is the one activity sink.
// The cron path mints its token in the orchestrator; THIS is the ad-hoc path —
// an operator-credentialed session mints a short-lived token itself (needs AWS
// creds = the trust gate) and POSTs the engagement. No static secret.
//
// Two steps, both done here:
//   1. mint  → DynamoDB UpdateItem AUTH#ENGAGEMENT / TOKEN#{token} (via aws CLI)
//   2. record → POST {API_BASE}/agents/{slug}/engagements with that bearer
//
// Usage:
//   node workforce/scripts/record-engagement.mjs \
//     --agent sora --skill article-level2 --project editorial \
//     --status ok \
//     --summary "Published L2: 2026年のデータセンターインフラ…" \
//     --uri https://kohuehara.xyz/posts/abc
//
// Env:
//   AWS_REGION           default us-west-2
//   WF_TABLE             default wf-table-prod
//   WF_API_BASE          default https://workforce-api.kohuehara.xyz
//   ENGAGEMENT_TTL_SEC   default 900 (15 min — ad-hoc tokens are short-lived)

import { ensureProxyAwareEntry } from "../../scripts/lib/proxy-bootstrap.mjs";
ensureProxyAwareEntry(import.meta.url);

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const REGION = process.env.AWS_REGION || "us-west-2";
const TABLE = process.env.WF_TABLE || "wf-table-prod";
const API_BASE = (process.env.WF_API_BASE || "https://workforce-api.kohuehara.xyz").replace(/\/$/, "");
const TTL_SEC = parseInt(process.env.ENGAGEMENT_TTL_SEC || "900", 10);

const agent = arg("agent");
const skill = arg("skill");
const project = arg("project");
const status = arg("status", "ok");
const summary = arg("summary");
const uri = arg("uri");
const skillVersion = arg("skill-version", "0.0.0");
const contentType = arg("content-type", "text/markdown");

if (!agent || !skill || !project) {
  console.error("required: --agent --skill --project (and --summary for a deliverable). See header.");
  process.exit(1);
}

// 1. Mint a short-lived token in DynamoDB (requires AWS creds = the trust gate).
const token = randomBytes(24).toString("base64url");
const nowMs = Date.now();
const expiresAt = new Date(nowMs + TTL_SEC * 1000).toISOString();
const ttlEpoch = Math.floor(nowMs / 1000) + TTL_SEC;
execFileSync("aws", [
  "dynamodb", "update-item",
  "--table-name", TABLE,
  "--region", REGION,
  "--key", JSON.stringify({ pk: { S: "AUTH#ENGAGEMENT" }, sk: { S: `TOKEN#${token}` } }),
  "--update-expression", "SET expires_at = :e, #ttl = :t, minted_at = :m",
  "--expression-attribute-names", JSON.stringify({ "#ttl": "ttl" }),
  "--expression-attribute-values", JSON.stringify({
    ":e": { S: expiresAt },
    ":t": { N: String(ttlEpoch) },
    ":m": { S: new Date(nowMs).toISOString() },
  }),
], { stdio: ["ignore", "ignore", "inherit"] });

// 2. POST the engagement with that bearer.
const body = {
  project_id: project,
  skill_name: skill,
  skill_version: skillVersion,
  started_at: new Date(nowMs).toISOString(),
  ended_at: new Date().toISOString(),
  status,
  execution_surface: "ccr",
};
// The business line is the top-level `summary` — that is the field the
// agents-api records as the engagement summary (handler.ts) and the
// RUNS·DELIVERABLES deck renders directly. It used to be smuggled inside a
// fabricated `artifact`, which left this field empty (the deck only surfaced
// it via a view-side fallback) and produced a FULLY blank row whenever no
// summary was passed. Send it where it belongs.
if (summary) body.summary = summary;
// Attach an artifact only for a real deliverable link. A text-only
// engagement (a pr-review / committee verdict has no file) carries its
// result in `summary` above — no fake file metadata required.
if (uri) {
  body.artifact = {
    uri,
    content_hash: "0".repeat(64),
    content_type: contentType,
    size_bytes: Buffer.byteLength(summary || uri, "utf8"),
    summary: summary || "",
  };
}

const res = await fetch(`${API_BASE}/agents/${encodeURIComponent(agent)}/engagements`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
  body: JSON.stringify(body),
});
const text = await res.text();
if (!res.ok) {
  console.error(`engagement POST failed: ${res.status} ${text}`);
  process.exit(2);
}
console.log(`recorded: ${agent} · ${skill} · ${project} · ${status}`);
console.log(text);
