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
//
// `summary` cap (#684): the server (agents-api handler.ts) hard-slices the
// top-level `summary` — and `artifact.summary` — to 512 chars on write. That
// cap is deliberate and matches the file-deliverable preview convention; the
// bug #684 fixed was that NOTHING on this side knew, so a 640-1300 char
// summary silently lost its tail mid-word and this script still reported
// success. Two mitigations now live here:
//   1. This script truncates deliberately BEFORE sending, at a word boundary,
//      with an explicit "…[truncated]" marker — so a caller who writes past
//      the limit sees exactly what was cut, instead of the server silently
//      shortening it mid-word.
//   2. After the POST, it reads the row back (GET /agents/{slug}/executions,
//      matching the verifyReadBack() discipline ML-020/R-18 already applies
//      to the feed writers — a 2xx proves the endpoint accepted *a* body, not
//      that the stored summary is the one this run actually sent) and exits
//      non-zero on a mismatch. The read goes through a GSI (agents-api
//      handler.ts's own comment: `ConsistentRead` is rejected on any GSI
//      query), so it retries briefly before treating an absence as a
//      failure — a design mismatch, not eventual-consistency noise.

import { ensureProxyAwareEntry } from "../../scripts/lib/proxy-bootstrap.mjs";
ensureProxyAwareEntry(import.meta.url);

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const SUMMARY_MAX = 512;
const TRUNCATION_MARKER = " …[truncated]";

/**
 * Deliberately cut an over-long summary at a word boundary and mark it, so
 * the loss is visible in the stored record itself rather than an invisible
 * server-side mid-word slice (#684). Exported shape kept simple (pure
 * string -> {text, truncated}) so it's trivially testable.
 */
export function truncateSummary(text, maxLen = SUMMARY_MAX) {
  if (text.length <= maxLen) return { text, truncated: false };
  const budget = maxLen - TRUNCATION_MARKER.length;
  let cut = text.slice(0, budget);
  const lastSpace = cut.lastIndexOf(" ");
  // Only back off to the word boundary if it doesn't throw away more than
  // half the budget — a summary with one 300-char "word" (no spaces) should
  // still get a hard cut rather than an empty-looking result.
  if (lastSpace > budget * 0.5) cut = cut.slice(0, lastSpace);
  return { text: cut + TRUNCATION_MARKER, truncated: true };
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Read the just-written engagement back and confirm the stored summary
 * matches what this run sent (post caller-side truncation). Returns null on
 * a verified match, or a string describing the failure otherwise. Mirrors
 * the feed writers' (workforce/skills/.../post.mjs) verifyReadBack() —
 * ML-020/R-18's pattern, ported to the engagement write path (#684).
 */
export async function verifyEngagementReadBack(apiBase, agentSlug, engagementId, sentSummary) {
  const url = `${apiBase}/agents/${encodeURIComponent(agentSlug)}/executions?limit=10`;
  const attempts = 3;
  for (let i = 1; i <= attempts; i++) {
    let res;
    try {
      res = await fetch(url, { headers: { accept: "application/json" } });
    } catch (err) {
      return `read-back: GET ${url} failed: ${err instanceof Error ? err.message : String(err)}`;
    }
    if (!res.ok) return `read-back: GET ${url} returned HTTP ${res.status}`;
    const parsed = await res.json().catch(() => null);
    const items = Array.isArray(parsed?.items) ? parsed.items : null;
    if (!items) return `read-back: GET ${url} response carried no items[]`;
    const row = items.find((it) => it.exec_ulid === engagementId);
    if (row) {
      if ((row.summary ?? "") !== sentSummary) {
        return (
          `read-back MISMATCH: engagement ${engagementId} does not carry the summary this ` +
          `run sent. sent=${JSON.stringify(sentSummary.slice(0, 120))} ` +
          `stored=${JSON.stringify((row.summary ?? "").slice(0, 120))}`
        );
      }
      return null; // verified
    }
    // GSI1 read — not eligible for ConsistentRead (agents-api handler.ts's
    // own comment on this route). Give a freshly-written row a brief window
    // to appear before calling it a failure.
    if (i < attempts) await sleep(400 * i);
  }
  return `read-back: engagement ${engagementId} not found in the last 10 executions after ${attempts} attempts`;
}

const API_BASE = (process.env.WF_API_BASE || "https://workforce-api.kohuehara.xyz").replace(/\/$/, "");

// Wrapped in main() — importing this module (tests) must not mint a token,
// shell out to `aws`, or POST. Only run as CLI (guard at the bottom).
async function main() {
  const REGION = process.env.AWS_REGION || "us-west-2";
  const TABLE = process.env.WF_TABLE || "wf-table-prod";
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
    return 1;
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
  //
  // #684: truncate deliberately, at a word boundary, BEFORE the server ever
  // sees an over-long string — the server's own 512-char slice is silent and
  // mid-word, so relying on it loses the tail invisibly.
  let sentSummary;
  if (summary) {
    const { text: truncated, truncated: didTruncate } = truncateSummary(summary);
    if (didTruncate) {
      console.error(
        `record-engagement.mjs: summary is ${summary.length} chars, over the server's ` +
          `${SUMMARY_MAX}-char cap — truncated at a word boundary with a marker before sending ` +
          `(was going to be silently cut mid-word otherwise). Stored text: ${JSON.stringify(truncated)}`,
      );
    }
    sentSummary = truncated;
    body.summary = sentSummary;
  }
  // Attach an artifact only for a real deliverable link. A text-only
  // engagement (a pr-review / committee verdict has no file) carries its
  // result in `summary` above — no fake file metadata required.
  if (uri) {
    body.artifact = {
      uri,
      content_hash: "0".repeat(64),
      content_type: contentType,
      size_bytes: Buffer.byteLength(sentSummary || uri, "utf8"),
      summary: sentSummary || "",
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
    return 2;
  }

  // #684: a 201 proves the endpoint accepted *a* body, not *ours* — read the
  // row back before trusting it, the same discipline ML-020/R-18 already
  // requires of the feed writers.
  let engagementId;
  try {
    engagementId = JSON.parse(text)?.engagement?.engagement_id;
  } catch {
    console.error(`record-engagement.mjs: 201 response was not JSON, cannot verify: ${text.slice(0, 200)}`);
    return 2;
  }
  if (!engagementId) {
    console.error(`record-engagement.mjs: 201 response carried no engagement.engagement_id: ${text.slice(0, 200)}`);
    return 2;
  }
  if (sentSummary) {
    const mismatch = await verifyEngagementReadBack(API_BASE, agent, engagementId, sentSummary);
    if (mismatch) {
      console.error(`record-engagement.mjs: ${mismatch}`);
      return 2;
    }
  }
  console.log(`recorded + read-back verified: ${agent} · ${skill} · ${project} · ${status}`);
  console.log(text);
  return 0;
}

// Run as CLI only when invoked directly; importing (tests) has no side effect.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  process.exit(await main());
}
