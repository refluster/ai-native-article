#!/usr/bin/env node
// ledger-watch/post.mjs — deterministic write for the "ledger-watch" Cadence,
// invoked by the CCR agent-runner AFTER the persona has read the ledger's
// worklist, re-read the primary pages and produced (a) a structured
// observation payload and (b) a short human-readable status line. The LLM owns
// the judgment; this script owns the two writes and their order:
//
//   1. validate the payload locally against the ledger's own validation
//      (mirrored in ./ledger-payload.mjs) — before any network call — then
//      read the ledger's known program codes from its public worklist, so a
//      run the ledger would refuse or mark `rejected` never spends a receipt;
//   2. serialise the payload ONCE and hash those exact bytes (sha256);
//   3. POST /feed a kind:"observation" post whose body is the status line
//      plus the line `ledger-receipt: sha256:<hex>`;
//   4. read the post back (R-18 / ML-028) — exit 2 unless the published body
//      and slug are ours — and keep its post_id;
//   5. POST {attestation:{agent_slug, post_id}, payload:<that same string>}
//      to <ledger>/v1/observations, retrying only on network errors / 5xx;
//   6. print one compact JSON result line on stdout.
//
// Why a feed receipt instead of a ledger token. The workforce holds no
// credential for the project ledger and adding a credential type is an
// Epic-010 trust-boundary change. The ledger instead trusts what a permitted
// desk has publicly receipted on the workforce feed: it re-reads
// GET /agents/{slug}/posts, finds post_id, and checks the receipt hash against
// sha256(payload). The only secret here is the existing feed-write token.
//
// The ledger URL is NOT a constant: it comes from the binding
// (binding.config.ledger_api_url → --ledger-url), because the ledger exists
// only after its project deploys and this skill should serve other ledgers
// later. Missing → exit 1 (C-4: fail loud, never guess a host).
//
// Usage:
//   FEED_WRITE_TOKEN=<credentials['workforce.feed_write_token']> \
//     node workforce/skills/ledger-watch/post.mjs \
//       --agent <slug> --skill-version 0.1.0 \
//       --payload-file /tmp/ledger-watch-<slug>-<suffix>.json \
//       --summary-file /tmp/ledger-watch-<slug>-<suffix>.md \
//       --ledger-url https://<id>.execute-api.<region>.amazonaws.com
//
// Env (dev / tests only): FEED_WRITE_TOKEN_API_URL overrides the feed URL;
// LEDGER_API_URL is used when --ledger-url is absent; LEDGER_RETRY_ATTEMPTS
// (default 3) and LEDGER_RETRY_BASE_MS (default 2000) shape the retry.
//
// Exit codes:
//   0  — feed receipt verified + ledger accepted every observation
//        (auto_applied / pending_review / duplicate)
//   1  — bad args / env / unreadable file / payload not JSON / no ledger URL
//   2  — validation or auth: local payload/summary validation, feed 401/422,
//        read-back mismatch, ledger 400/401/403/413, or any observation the
//        ledger returned as `rejected`
//   3  — network / 5xx after retries / unexpected response
// Any non-zero exit after step 3 reports `orphan_receipt` with the post_id.

import { ensureProxyAwareEntry } from "../../../scripts/lib/proxy-bootstrap.mjs";
ensureProxyAwareEntry(import.meta.url);

import { readFileSync } from "node:fs";
import {
  DISPOSITIONS,
  MAX_REQUEST_BYTES,
  composeReceiptBody,
  sha256Hex,
  validatePayload,
  validateSummary,
} from "./ledger-payload.mjs";

// The workforce feed write endpoint (same constant as daily-research/post.mjs).
const DEFAULT_API_URL = "https://sjhikazsf9.execute-api.us-west-2.amazonaws.com/prod/feed";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

const result = { ok: false, agent: undefined, stage: "args" };
function finish(code, extra = {}) {
  Object.assign(result, extra);
  console.log(JSON.stringify(result));
  process.exit(code);
}
function fail(code, msg, extra = {}) {
  console.error(`post.mjs: ${msg}`);
  finish(code, { error: msg, ...extra });
}

// W-4 read-back (R-18). A 2xx proves the feed accepted *a* body, not *ours*:
// a batched fire shares one /tmp, so a sibling task can overwrite the summary
// file between our read and our POST (ML-028). Re-GET the post and compare.
// Returns { postId, error }: error is null when verified, else a
// human-readable mismatch string.
async function verifyReadBack(createdText, sentBody, feedUrl, slug) {
  let postId;
  try {
    postId = JSON.parse(createdText).post_id;
  } catch {
    return { error: `read-back: 2xx response was not JSON, cannot verify: ${createdText.slice(0, 200)}` };
  }
  if (!postId) return { error: `read-back: 2xx response carried no post_id: ${createdText.slice(0, 200)}` };
  const detailUrl = `${feedUrl.replace(/\/+$/, "")}/${encodeURIComponent(postId)}?agent_slug=${encodeURIComponent(slug)}`;
  let res;
  try {
    res = await fetch(detailUrl, { headers: { accept: "application/json" } });
  } catch (err) {
    return { postId, error: `read-back: GET ${detailUrl} failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!res.ok) return { postId, error: `read-back: GET ${detailUrl} returned HTTP ${res.status}` };
  const detail = await res.json().catch(() => null);
  if (!detail || typeof detail.body !== "string") return { postId, error: `read-back: detail for ${postId} carried no body` };
  if (detail.agent_slug !== slug) {
    return { postId, error: `read-back MISMATCH: post ${postId} is attributed to "${detail.agent_slug}", not "${slug}"` };
  }
  if (detail.body.trim() !== sentBody.trim()) {
    return {
      postId,
      error:
        `read-back MISMATCH: post ${postId} does not carry the body this run sent — another concurrent task very ` +
        `likely overwrote --summary-file. Published head: ${JSON.stringify(detail.body.slice(0, 120))}`,
    };
  }
  return { postId, error: null };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One ledger call with bounded retry on network errors / 5xx only.
async function callLedger(url, requestBody, { attempts, baseMs }) {
  let last = "";
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, {
        method: requestBody === undefined ? "GET" : "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: requestBody,
        signal: AbortSignal.timeout(30_000),
      });
      const text = await res.text().catch(() => "");
      if (res.status < 500) return { status: res.status, text, attempts: i };
      last = `HTTP ${res.status}: ${text.slice(0, 300)}`;
    } catch (err) {
      last = `network: ${err instanceof Error ? err.message : String(err)}`;
    }
    console.error(`post.mjs: ledger attempt ${i}/${attempts} failed (${last})`);
    if (i < attempts) await sleep(baseMs * 2 ** (i - 1));
  }
  return { status: null, text: last, attempts };
}

function resolveLedgerUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const loopback = u.hostname === "127.0.0.1" || u.hostname === "localhost";
  if (u.protocol !== "https:" && !(u.protocol === "http:" && loopback)) return null;
  if (u.search || u.hash) return null;
  return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
}

// ── 0. args / env / files ────────────────────────────────────────────────────
const feedUrl = process.env["FEED_WRITE_TOKEN_API_URL"] || DEFAULT_API_URL;
const token = process.env["FEED_WRITE_TOKEN"];
const agent = arg("agent");
const skillVersion = arg("skill-version");
const payloadFile = arg("payload-file");
const summaryFile = arg("summary-file");
const ledgerRaw = arg("ledger-url") || process.env["LEDGER_API_URL"];
result.agent = agent;

if (!token) fail(1, "FEED_WRITE_TOKEN env var is required (from credentials['workforce.feed_write_token'])");
if (!agent || !/^[a-z]+$/.test(agent)) fail(1, "--agent <slug> is required (^[a-z]+$)");
if (!skillVersion || !/^\d+\.\d+\.\d+$/.test(skillVersion)) fail(1, "--skill-version <semver> is required");
if (!payloadFile) fail(1, "--payload-file <path> is required");
if (!summaryFile) fail(1, "--summary-file <path> is required");
if (!ledgerRaw) {
  fail(1, "--ledger-url is required (binding.config.ledger_api_url). Not guessing a ledger host — fix the binding config.");
}
const ledgerBase = resolveLedgerUrl(ledgerRaw);
if (!ledgerBase) fail(1, `--ledger-url "${ledgerRaw}" must be an https:// base URL with no query or fragment`);
const ledgerUrl = `${ledgerBase}/v1/observations`;
result.ledger = ledgerUrl;

let rawPayloadText;
let summary;
try {
  rawPayloadText = readFileSync(payloadFile, "utf8");
} catch (err) {
  fail(1, `cannot read --payload-file "${payloadFile}": ${err instanceof Error ? err.message : String(err)}`);
}
try {
  summary = readFileSync(summaryFile, "utf8");
} catch (err) {
  fail(1, `cannot read --summary-file "${summaryFile}": ${err instanceof Error ? err.message : String(err)}`);
}
let parsed;
try {
  parsed = JSON.parse(rawPayloadText);
} catch (err) {
  fail(1, `--payload-file is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
}

// ── 1. local validation — nothing has touched the network yet ───────────────
result.stage = "validate";
const { errors, payload } = validatePayload(parsed, { agent, skillVersion, now: new Date() });
const summaryErrors = validateSummary(summary);
const allErrors = [...errors, ...summaryErrors];
if (allErrors.length > 0) {
  for (const e of allErrors) console.error(`post.mjs: invalid ${e}`);
  fail(2, `${allErrors.length} validation error(s); nothing was posted`, { validation_errors: allErrors });
}

// ── 1b. known program codes (public worklist) ───────────────────────────────
// The ledger rejects an observation on a code it does not hold (unless it is
// a new_program). Read the codes it holds before spending the receipt.
const attempts = Math.max(1, Number(process.env["LEDGER_RETRY_ATTEMPTS"] || 3));
const baseMs = Math.max(0, Number(process.env["LEDGER_RETRY_BASE_MS"] ?? 2000));
{
  const wl = await callLedger(`${ledgerBase}/v1/worklist?agent=${encodeURIComponent(agent)}&limit=1`, undefined, { attempts, baseMs });
  let known = null;
  if (wl.status === 200) {
    try {
      const codes = JSON.parse(wl.text)?.discovery?.known_codes;
      if (Array.isArray(codes)) known = new Set(codes);
    } catch { /* handled below */ }
  }
  if (!known) fail(3, `could not read the ledger's known program codes from GET /v1/worklist (${wl.status ?? "network"}: ${String(wl.text).slice(0, 200)}); nothing was posted`);
  const { errors: codeErrors } = validatePayload(payload, { agent, skillVersion, now: new Date(), knownCodes: known });
  if (codeErrors.length > 0) {
    for (const e of codeErrors) console.error(`post.mjs: invalid ${e}`);
    fail(2, `${codeErrors.length} validation error(s) against the ledger's program codes; nothing was posted`, { validation_errors: codeErrors });
  }
}

// ── 2. serialise once; hash exactly what will be sent ───────────────────────
const payloadString = JSON.stringify(payload);
const receiptHex = sha256Hex(payloadString);
const body = composeReceiptBody(summary, receiptHex);
const ledgerRequest = JSON.stringify({ attestation: { agent_slug: agent, post_id: "" }, payload: payloadString });
if (Buffer.byteLength(ledgerRequest, "utf8") + 64 > MAX_REQUEST_BYTES) {
  fail(2, `ledger request would exceed ${MAX_REQUEST_BYTES} bytes; trim the evidence quotes`);
}
result.receipt_sha256 = receiptHex;
result.observations = payload.observations.length;

// ── 3. feed receipt ──────────────────────────────────────────────────────────
result.stage = "feed";
console.error(`post.mjs: POST ${feedUrl} (receipt sha256:${receiptHex.slice(0, 12)}…)`);
let created;
try {
  const res = await fetch(feedUrl, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ agent_slug: agent, kind: "observation", body, skill_version: skillVersion }),
  });
  const text = await res.text().catch(() => "");
  if (res.status === 401 || res.status === 422) fail(2, `feed rejected the receipt (HTTP ${res.status}): ${text.slice(0, 300)}`);
  if (res.status < 200 || res.status >= 300) fail(3, `feed returned unexpected HTTP ${res.status}: ${text.slice(0, 300)}`);
  created = text;
} catch (err) {
  fail(3, `feed POST failed: ${err instanceof Error ? err.message : String(err)}`);
}

// ── 4. read-back ─────────────────────────────────────────────────────────────
result.stage = "read-back";
const rb = await verifyReadBack(created, body, feedUrl, agent);
if (rb.postId) result.post_id = rb.postId;
if (rb.error) {
  // A wrong body under our slug must never be attested to the ledger.
  fail(2, rb.error, rb.postId ? { orphan_receipt: { post_id: rb.postId, reason: "read-back mismatch; ledger not called" } } : {});
}
const postId = rb.postId;

// ── 5. ledger ────────────────────────────────────────────────────────────────
result.stage = "ledger";
const orphan = (reason) => ({ orphan_receipt: { post_id: postId, reason } });
console.error(`post.mjs: POST ${ledgerUrl} (attestation post ${postId}, ${payload.observations.length} observation(s))`);
const lr = await callLedger(
  ledgerUrl,
  JSON.stringify({ attestation: { agent_slug: agent, post_id: postId }, payload: payloadString }),
  { attempts, baseMs },
);
result.ledger_attempts = lr.attempts;
if (lr.status === null) {
  fail(3, `ledger unreachable after ${lr.attempts} attempt(s): ${lr.text}. The feed receipt ${postId} is an orphan.`, orphan(lr.text));
}
if ([400, 401, 403, 413].includes(lr.status)) {
  fail(2, `ledger refused the submission (HTTP ${lr.status}): ${lr.text.slice(0, 400)}. The feed receipt ${postId} is an orphan.`, orphan(`HTTP ${lr.status}`));
}
if (lr.status !== 200 && lr.status !== 201) {
  fail(3, `ledger returned unexpected HTTP ${lr.status}: ${lr.text.slice(0, 400)}. The feed receipt ${postId} is an orphan.`, orphan(`HTTP ${lr.status}`));
}
let reply;
try {
  reply = JSON.parse(lr.text);
} catch {
  fail(3, `ledger 2xx was not JSON: ${lr.text.slice(0, 200)}`, orphan("unparseable ledger reply"));
}
const results = Array.isArray(reply?.results) ? reply.results : null;
if (!results || results.length !== payload.observations.length || results.some((r) => !DISPOSITIONS.has(r?.disposition))) {
  fail(3, `ledger reply does not carry one known disposition per observation: ${lr.text.slice(0, 300)}`, orphan("malformed ledger reply"));
}

// ── 6. report ────────────────────────────────────────────────────────────────
const counts = { auto_applied: 0, pending_review: 0, duplicate: 0, rejected: 0 };
const rows = results.map((r, i) => {
  counts[r.disposition] += 1;
  const o = payload.observations[r.index ?? i] ?? payload.observations[i];
  return {
    index: r.index ?? i,
    id: r.id,
    program_code: o?.program_code,
    change_type: o?.change_type,
    disposition: r.disposition,
    ...(r.reason ? { reason: r.reason } : {}),
  };
});
result.stage = "done";
result.run_id = reply.run_id;
result.counts = counts;
result.results = rows;
if (counts.rejected > 0) {
  console.error(`post.mjs: the ledger rejected ${counts.rejected} of ${rows.length} observation(s); the rest were recorded.`);
  finish(2, { ok: false, error: "partial: some observations were rejected by the ledger" });
}
console.error(`post.mjs: receipt ${postId} verified; ledger run ${reply.run_id} recorded ${rows.length} observation(s).`);
finish(0, { ok: true });
