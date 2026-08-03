#!/usr/bin/env node
// L1 source picker for the article-level2 (L1→L2) skill — the read half of
// the GAS handleL2Batch coverage logic, as a deterministic CCR script. The
// LLM owns the prose; this script owns "which uncovered L1 source do we cover
// next", so the selection can't drift from the GAS rule.
//
// It queries the L1 source DB and the unified Articles DB (Type=explanation)
// using the injected Notion integration token, then returns an L1 source whose
// Source URL is not yet covered by an explanation. Same filters as
// handleL2Batch: skip example.com fixtures, skip rows with `L2 Skip`=true,
// oldest-first by created_time.
//
// A pick is only returned if its source body could actually be fetched
// ---------------------------------------------------------------------
// The previous version returned `pending[0]` unconditionally. When the oldest
// uncovered row was a bot-walled URL (reuters.com — HTTP 401 direct, and the
// reader fallback 403), the skill's hard rule "if you cannot quote the source,
// do not publish" meant the fire produced nothing — and because nothing was
// written back, the *next* fire picked the very same row. One unfetchable row
// stalled the entire queue indefinitely: every L1 source registered behind it
// waited forever. Combined with the fact that no failure was recorded
// anywhere, this was invisible.
//
// So this script now walks the queue instead of peeking at its head:
//
//   for each uncovered row, oldest first (up to MAX_CANDIDATES):
//     fetch the body (scripts/lib/source-fetch.mjs: direct → reader)
//     groundable? → return it, with the body already on disk
//     not groundable? → record the failure on the L1 row, try the next row
//
// A row that fails MAX_ATTEMPTS times is treated as blocked and drops out of
// the queue, so a permanently dead URL costs a bounded number of retries
// instead of blocking every successor forever. Nothing is ever silently
// dropped: the attempt count, the last error and its timestamp are written
// back to the L1 row (C-4), and the blocked count is reported on stderr.
//
// The CCR session never reads Secrets Manager: NOTION_API_KEY arrives inline
// from the task's `credentials["notion.integration_token"].apiKey` and is
// passed through as an env var by the runner. The DB ids are NOT secret (they
// are already committed in newsletter/pipeline/normalize-categories.mjs), so
// they live as constants below — overridable by env for tests / migrations.
//
// Usage:
//   NOTION_API_KEY="<credentials['notion.integration_token'].apiKey>" \
//     node workforce/skills/article-level2/pick-l1-source.mjs
//
// Stdout (single JSON line):
//   { "l1PageId", "title", "summary", "sourceUrl", "category",
//     "bodyFile", "bodyChars", "fetchedVia" }   ← cover this one; the source
//                                                 text is at bodyFile
//   { "skip": true, "reason": "..." }           ← nothing coverable this fire
//
// Contract note — the body is handed over on the FILESYSTEM
// ---------------------------------------------------------
// `bodyFile` points at a file in os.tmpdir(). That assumes the picker and the
// prompt that consumes it run in the same container, which is true of the
// agent-runner today and is written down here because it is exactly the kind
// of assumption that survives unnoticed until the runner topology changes.
// If they are ever split, the body has to travel in the payload instead.
//
// Exit codes:
//   0  — printed a pick OR a {skip:true} (both are valid outcomes)
//   1  — bad env
//   3  — Notion API / network error

import { ensureProxyAwareEntry } from "../../../scripts/lib/proxy-bootstrap.mjs";
ensureProxyAwareEntry(import.meta.url);

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { fetchSourceBody } from "../../../scripts/lib/source-fetch.mjs";

const NOTION_VERSION = "2022-06-28";
const NOTION_API = "https://api.notion.com/v1";

// Non-secret DB ids (mirror the unified Articles DB in
// newsletter/pipeline/normalize-categories.mjs). Env overrides allow test/migration.
const L1_DB_ID = process.env.L1_DB_ID || "32fd0f0b-e61e-80bd-89bf-f94965d05e80";
const UNIFIED_DB_ID = process.env.UNIFIED_DB_ID || "34fd0f0b-e61e-817a-9f6b-dc65b0d5b4cc";

/** Env override that fails loud instead of poisoning every comparison: a
 *  typo'd L2_MAX_ATTEMPTS would otherwise yield NaN, make every `<` false,
 *  and silently reduce the walk to `pending.slice(0, NaN)` === []. */
function intEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) {
    console.error(`pick-l1-source.mjs: ${name} must be a positive integer (got "${raw}")`);
    process.exit(1);
  }
  return Math.floor(n);
}

// How many rows we are willing to try fetching in one fire. Bounds the
// runtime of a fire when the head of the queue is a run of dead URLs.
const MAX_CANDIDATES = intEnv("L2_MAX_CANDIDATES", 6);
// After this many failed fetches a row is considered blocked and leaves the
// queue. Deliberately > 1: readers throttle, and hosts have bad days.
const MAX_ATTEMPTS = intEnv("L2_MAX_ATTEMPTS", 5);
// Hard wall-clock budget for the candidate walk. Worst case per candidate is
// ~192s (45s direct + 3 reader legs at 45s + 12s backoff); six of those would
// be ~19 minutes of a CCR session spent to return {skip:true}. The walk stops
// at the budget and reports how many rows it never reached, rather than
// running until the session is killed mid-walk.
const WALK_BUDGET_MS = intEnv("L2_WALK_BUDGET_MS", 300_000);

// Operational columns this script maintains on the L1 rows. Created on demand
// (see ensureAttemptSchema) so no manual Notion migration is required.
const P_ATTEMPTS = "L2 Attempts";
const P_LAST_ERROR = "L2 Last Error";
const P_LAST_ATTEMPT = "L2 Last Attempt";

const apiKey = process.env.NOTION_API_KEY;

if (!apiKey) {
  console.error(
    "pick-l1-source.mjs: NOTION_API_KEY is required (credentials['notion.integration_token'].apiKey)",
  );
  process.exit(1);
}

const headers = {
  authorization: `Bearer ${apiKey}`,
  "notion-version": NOTION_VERSION,
  "content-type": "application/json",
};

async function queryAll(databaseId) {
  const pages = [];
  let cursor;
  do {
    const res = await fetch(`${NOTION_API}/databases/${databaseId}/query`, {
      method: "POST",
      headers,
      body: JSON.stringify(cursor ? { start_cursor: cursor, page_size: 100 } : { page_size: 100 }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`query ${databaseId} → HTTP ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = await res.json();
    pages.push(...(data.results ?? []));
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return pages;
}

// Mirror of handleL2Batch's covered-URL set: unified rows with
// Type=explanation, source URL from `SourceURLs` (rich_text) or legacy
// `Source URLs` (url).
function coveredUrls(unifiedPages) {
  const set = new Set();
  for (const p of unifiedPages) {
    const type = p.properties?.Type?.select?.name ?? "";
    if (type !== "explanation") continue;
    const u =
      p.properties?.SourceURLs?.rich_text?.[0]?.plain_text ||
      p.properties?.["Source URLs"]?.url ||
      "";
    if (u) set.add(u.trim());
  }
  return set;
}

const attemptsOf = (page) => page.properties?.[P_ATTEMPTS]?.number ?? 0;

/** Add the operational columns to the L1 DB if they are missing. Called once,
 *  lazily, the first time we need to record a failure — so a fresh database
 *  (or a restored backup) self-heals instead of erroring out. */
let schemaEnsured = false;
async function ensureAttemptSchema() {
  if (schemaEnsured) return;
  const res = await fetch(`${NOTION_API}/databases/${L1_DB_ID}`, { headers });
  if (!res.ok) throw new Error(`read database → HTTP ${res.status}`);
  const db = await res.json();
  const missing = {};
  if (!db.properties?.[P_ATTEMPTS]) missing[P_ATTEMPTS] = { number: {} };
  if (!db.properties?.[P_LAST_ERROR]) missing[P_LAST_ERROR] = { rich_text: {} };
  if (!db.properties?.[P_LAST_ATTEMPT]) missing[P_LAST_ATTEMPT] = { date: {} };
  if (Object.keys(missing).length > 0) {
    const patch = await fetch(`${NOTION_API}/databases/${L1_DB_ID}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ properties: missing }),
    });
    if (!patch.ok) {
      const body = await patch.text().catch(() => "");
      throw new Error(`add L2-attempt columns → HTTP ${patch.status}: ${body.slice(0, 200)}`);
    }
    console.error(`pick-l1-source.mjs: added L1 columns ${Object.keys(missing).join(", ")}`);
  }
  schemaEnsured = true;
}

// Set when a bookkeeping write fails. If attempts can't be persisted, the
// eviction budget never advances and a run of dead heads re-stalls the queue —
// the exact ML-018 failure, bounded to MAX_CANDIDATES rows instead of one.
// That must not be visible only on a stderr nobody reads (C-4), so it is
// surfaced in the machine-readable {skip:true} reason.
let bookkeepingBroken = null;

/** Record a failed fetch on the L1 row. Best-effort: a bookkeeping failure
 *  must not abort the fire, but it is always reported on stderr and in the
 *  outcome payload. */
async function recordFailure(page, reason) {
  try {
    await ensureAttemptSchema();
    const next = attemptsOf(page) + 1;
    const res = await fetch(`${NOTION_API}/pages/${page.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        properties: {
          [P_ATTEMPTS]: { number: next },
          [P_LAST_ERROR]: { rich_text: [{ text: { content: reason.slice(0, 1900) } }] },
          [P_LAST_ATTEMPT]: { date: { start: new Date().toISOString() } },
        },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(
        `pick-l1-source.mjs: could not record attempt on ${page.id} → HTTP ${res.status}: ${body.slice(0, 200)}`,
      );
      return;
    }
    console.error(
      `pick-l1-source.mjs: attempt ${next}/${MAX_ATTEMPTS} failed for ${page.properties?.["Source URL"]?.url} — ${reason}` +
        (next >= MAX_ATTEMPTS ? " [now blocked; leaves the queue]" : ""),
    );
  } catch (err) {
    bookkeepingBroken = err instanceof Error ? err.message : String(err);
    console.error(
      `pick-l1-source.mjs: could not record attempt on ${page.id}: ${bookkeepingBroken}`,
    );
  }
}

try {
  const [l1Pages, unifiedPages] = await Promise.all([queryAll(L1_DB_ID), queryAll(UNIFIED_DB_ID)]);
  const covered = coveredUrls(unifiedPages);

  const uncovered = l1Pages
    .filter((p) => {
      const u = p.properties?.["Source URL"]?.url;
      if (!u || covered.has(u.trim())) return false;
      if (/^https?:\/\/(www\.)?example\.com(\/|$)/i.test(u)) return false; // test fixtures
      if (p.properties?.["L2 Skip"]?.checkbox === true) return false; // operator skip
      return true;
    })
    .sort((a, b) => (a.created_time ?? "").localeCompare(b.created_time ?? "")); // oldest-first

  const blocked = uncovered.filter((p) => attemptsOf(p) >= MAX_ATTEMPTS);
  const pending = uncovered.filter((p) => attemptsOf(p) < MAX_ATTEMPTS);

  if (blocked.length > 0) {
    console.error(
      `pick-l1-source.mjs: ${blocked.length} row(s) blocked after ${MAX_ATTEMPTS} failed fetches ` +
        `(clear "${P_ATTEMPTS}" in Notion to retry, or tick "L2 Skip" to retire):`,
    );
    for (const p of blocked) {
      console.error(
        `    ${p.properties?.["Source URL"]?.url} — ${p.properties?.[P_LAST_ERROR]?.rich_text?.[0]?.plain_text ?? "?"}`,
      );
    }
  }

  if (pending.length === 0) {
    console.log(
      JSON.stringify({
        skip: true,
        reason:
          blocked.length > 0
            ? `no coverable L1 sources (${blocked.length} blocked after ${MAX_ATTEMPTS} failed fetches)`
            : "no uncovered L1 sources",
      }),
    );
    process.exit(0);
  }

  const tried = [];
  const deadline = Date.now() + WALK_BUDGET_MS;
  const willTry = pending.slice(0, MAX_CANDIDATES);
  let untried = willTry.length;
  for (const page of willTry) {
    if (Date.now() > deadline) break;
    untried--;
    const sourceUrl = page.properties?.["Source URL"]?.url ?? "";
    const result = await fetchSourceBody(sourceUrl);

    if (!result.ok) {
      tried.push(`${sourceUrl} (${result.reason})`);
      // A verdict that is only about the reader being throttled says nothing
      // about the source, so it must not count toward eviction — otherwise a
      // bad hour permanently drops a perfectly good row. The queue still
      // advances either way, because we move to the next candidate regardless.
      if (result.transient) {
        console.error(
          `pick-l1-source.mjs: transient failure for ${sourceUrl} (not counted toward ${MAX_ATTEMPTS}) — ${result.reason}`,
        );
      } else {
        await recordFailure(page, result.reason);
      }
      continue;
    }

    const bodyFile = join(tmpdir(), `l2-source-${page.id.replace(/-/g, "")}.md`);
    writeFileSync(bodyFile, result.text);

    console.log(
      JSON.stringify({
        l1PageId: page.id,
        title: page.properties?.Title?.title?.[0]?.plain_text ?? "",
        summary: page.properties?.["Contents Summary"]?.rich_text?.[0]?.plain_text ?? "",
        sourceUrl,
        category: page.properties?.Category?.rich_text?.[0]?.plain_text ?? "",
        bodyFile,
        bodyChars: result.chars,
        fetchedVia: result.via,
      }),
    );
    process.exit(0);
  }

  // Every candidate we were willing to try this fire failed to fetch. Their
  // attempt counters have been incremented, so a later fire reaches further
  // down the queue instead of retrying the same head forever.
  console.error(
    `pick-l1-source.mjs: none of the ${tried.length} candidate(s) tried this fire yielded a groundable body:`,
  );
  for (const t of tried) console.error(`    ${t}`);
  if (untried > 0) {
    console.error(
      `pick-l1-source.mjs: walk budget (${WALK_BUDGET_MS}ms) exhausted with ${untried} candidate(s) untried`,
    );
  }
  console.log(
    JSON.stringify({
      skip: true,
      reason:
        `no groundable source among the ${tried.length} oldest uncovered row(s); ` +
        `${pending.length} pending, ${blocked.length} blocked` +
        (untried > 0 ? `, ${untried} untried (walk budget exhausted)` : "") +
        (bookkeepingBroken ? `; ATTEMPTS NOT PERSISTED (${bookkeepingBroken}) — queue will re-stall` : ""),
    }),
  );
  process.exit(0);
} catch (err) {
  console.error(`pick-l1-source.mjs: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(3);
}
