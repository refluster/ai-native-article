#!/usr/bin/env node
// L2-sample picker for the article-level3 (L2→L3) skill — the read half of the
// GAS handleL3Batch sampling logic, as a deterministic CCR script. The LLM owns
// the synthesis (the analysis prose); this script owns "which 3 L2 explanations
// do we synthesise next", so the selection can't drift from the GAS rule.
//
// Unlike article-level2's coverage-based picker (every uncovered L1 gets exactly
// one explanation), L3 is *sampling-based*: it draws a small rolling sample of
// recent L2 explanations and looks for the deeper principle connecting them.
// GAS keeps that sampling honest with two pieces of mutable Script-Property
// state — L3_LAST_RUN_AT and L3_RECENTLY_USED_L2_IDS. A Cadence fire is
// stateless, so this picker RECONSTRUCTS both from Notion (no extra store):
//
//   • "last run"      → the created_time of the most recent analysis (L3) row.
//                       L2s created after it are the "fresh" pool (the
//                       fresh-entry gate: at least one new L2 since the last L3).
//   • "recently used" → the SourceURLs recorded on the most recent L3 rows.
//                       publish-notion.mjs stamps each L3 with its source L2
//                       URLs, so the reuse-avoidance set is derivable from the
//                       corpus itself. Reuse is keyed on the L2's own SourceURL
//                       (a stable per-L2 identity — it's the L1 it covered).
//
// Same gating as handleL3Batch: 14-day recent window, sample size 3, skip when
// no fresh L2 has arrived or fewer than 3 L2s exist in the window.
//
// The CCR session never reads Secrets Manager: NOTION_API_KEY arrives inline
// from the task's `credentials["notion.integration_token"].apiKey` and is passed
// through as an env var by the runner. The unified DB id is NOT secret (already
// committed in scripts/normalize-categories.mjs), so it's a constant below —
// overridable by env for tests / migrations.
//
// Usage:
//   NOTION_API_KEY="<credentials['notion.integration_token'].apiKey>" \
//     node workforce/skills/article-level3/pick-l2-sources.mjs
//
// Stdout (single JSON line):
//   { "sources": [ { l2PageId, title, abstract, sourceUrl, category }, x3 ],
//     "canonicalCategory": "B: Role Blurring",   ← majority A–E bucket of the 3
//     "sourceUrls": "https://… , https://…" }    ← comma-joined, for --source-urls
//   { "skip": true, "reason": "..." }            ← nothing to do this fire
//
// Exit codes:
//   0  — printed a pick OR a {skip:true} (both are valid outcomes)
//   1  — bad env
//   3  — Notion API / network error

const NOTION_VERSION = "2022-06-28";
const NOTION_API = "https://api.notion.com/v1";

// Non-secret unified Articles DB id (mirror of the default in
// scripts/normalize-categories.mjs and article-level2's scripts). Env override
// allows test/migration.
const UNIFIED_DB_ID = process.env.UNIFIED_DB_ID || process.env.NOTION_DB_ID || "34fd0f0b-e61e-817a-9f6b-dc65b0d5b4cc";

// Sampling parameters — mirror of gas/src/Code.gs L3_* constants.
const L3_RECENT_DAYS = Number(process.env.L3_RECENT_DAYS || 14);
const L3_SAMPLE_SIZE = Number(process.env.L3_SAMPLE_SIZE || 3);
const L3_AVOID_REUSE_COUNT = Number(process.env.L3_AVOID_REUSE_COUNT || 10);

// Canonical A–E buckets — mirror of gas/src/Code.gs CATEGORY_NAMES +
// canonicalCategoryFor + pickCanonicalFromSources, so the L3 row groups under
// the same controlled bucket the GAS synthesis would have chosen (majority vote
// across the source L2s' categories).
const CATEGORY_NAMES = {
  A: "A: AI Hyper-productivity",
  B: "B: Role Blurring",
  C: "C: New Roles/FDE",
  D: "D: Big Tech Layoffs & AI Pivot",
  E: "E: Rethinking SDLC",
};
function canonicalCategoryFor(text) {
  const trimmed = (text || "").trim();
  if (!trimmed) return "";
  if (/^[A-E]$/i.test(trimmed)) return CATEGORY_NAMES[trimmed.toUpperCase()] || "";
  const m = trimmed.match(/^([A-E])[\s:：][\s\S]*$/i);
  if (m) return CATEGORY_NAMES[m[1].toUpperCase()] || "";
  return "";
}
function pickCanonicalFromSources(categories) {
  const counts = {};
  for (const c of categories) {
    const canonical = canonicalCategoryFor(c);
    if (!canonical) continue;
    counts[canonical] = (counts[canonical] || 0) + 1;
  }
  let best = "";
  let bestN = 0;
  for (const k of Object.keys(counts)) {
    if (counts[k] > bestN) { best = k; bestN = counts[k]; }
  }
  return best;
}

const apiKey = process.env.NOTION_API_KEY;
const unifiedDbId = UNIFIED_DB_ID;

if (!apiKey) { console.error("pick-l2-sources.mjs: NOTION_API_KEY is required (credentials['notion.integration_token'].apiKey)"); process.exit(1); }

async function queryAll(databaseId) {
  const pages = [];
  let cursor;
  do {
    const res = await fetch(`${NOTION_API}/databases/${databaseId}/query`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "notion-version": NOTION_VERSION,
        "content-type": "application/json",
      },
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

function typeOf(p) { return p.properties?.Type?.select?.name ?? ""; }
function sourceUrlOf(p) {
  return (
    p.properties?.SourceURLs?.rich_text?.[0]?.plain_text ||
    p.properties?.["Source URLs"]?.url ||
    ""
  ).trim();
}
function asL2(p) {
  return {
    l2PageId: p.id,
    title: p.properties?.Title?.title?.[0]?.plain_text ?? "",
    abstract: p.properties?.Abstract?.rich_text?.[0]?.plain_text ?? "",
    sourceUrl: sourceUrlOf(p),
    category: p.properties?.Category?.rich_text?.[0]?.plain_text ?? "",
    created_time: p.created_time ?? "",
  };
}

// Fisher-Yates shuffle (mirror of handleL3Batch). Nondeterministic by design —
// the GAS picker shuffled too; the sample varies fire-to-fire on purpose.
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

try {
  const pages = await queryAll(unifiedDbId);

  const l2 = pages.filter((p) => typeOf(p) === "explanation").map(asL2);
  const l3 = pages
    .filter((p) => typeOf(p) === "analysis")
    .sort((a, b) => (b.created_time ?? "").localeCompare(a.created_time ?? "")); // newest-first

  // "last run" proxy: the newest analysis row's created_time. No L3 yet → "",
  // which (like an empty L3_LAST_RUN_AT in GAS) treats all recent L2 as fresh,
  // so the very first run isn't blocked.
  const lastRunAt = l3[0]?.created_time ?? "";

  // "recently used" set: the source URLs stamped on the most recent L3 rows.
  // Keyed on URL (each L2's own SourceURL is a stable per-L2 identity).
  const avoid = new Set();
  for (const row of l3.slice(0, L3_AVOID_REUSE_COUNT)) {
    const urls = (row.properties?.SourceURLs?.rich_text?.[0]?.plain_text ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const u of urls) avoid.add(u);
  }

  const cutoff = new Date(Date.now() - L3_RECENT_DAYS * 86400 * 1000).toISOString();
  const recent = l2.filter((p) => (p.created_time || "") >= cutoff);
  const isNew = (p) => !lastRunAt || (p.created_time || "") > lastRunAt;
  const freshL2 = recent.filter(isNew);

  if (freshL2.length === 0) {
    console.log(JSON.stringify({ skip: true, reason: `no new L2 since last L3 (${lastRunAt || "never"})` }));
    process.exit(0);
  }
  if (recent.length < L3_SAMPLE_SIZE) {
    console.log(JSON.stringify({ skip: true, reason: `only ${recent.length} L2 in last ${L3_RECENT_DAYS}d (need ${L3_SAMPLE_SIZE})` }));
    process.exit(0);
  }

  const isReused = (p) => p.sourceUrl && avoid.has(p.sourceUrl);

  // Required pick: one L2 from the fresh pool. Prefer non-reused within fresh.
  const freshNonReused = freshL2.filter((p) => !isReused(p));
  const freshPool = freshNonReused.length > 0 ? freshNonReused : freshL2;
  const required = shuffle(freshPool.slice())[0];

  // Fill the rest from the full recent pool (minus the required pick),
  // preferring non-reused so the sample bridges genuinely distinct sources.
  const fillCandidates = recent.filter((p) => p.l2PageId !== required.l2PageId);
  const fillNonReused = fillCandidates.filter((p) => !isReused(p));
  const fillPool = fillNonReused.length >= L3_SAMPLE_SIZE - 1 ? fillNonReused : fillCandidates;
  const fills = shuffle(fillPool.slice()).slice(0, L3_SAMPLE_SIZE - 1);

  const picked = [required, ...fills];
  const canonicalCategory = pickCanonicalFromSources(picked.map((p) => p.category));
  const sourceUrls = picked.map((p) => p.sourceUrl).filter(Boolean).join(", ");

  console.log(
    JSON.stringify({
      sources: picked.map(({ l2PageId, title, abstract, sourceUrl, category }) => ({
        l2PageId,
        title,
        abstract,
        sourceUrl,
        category,
      })),
      canonicalCategory,
      sourceUrls,
      requiredNewL2Id: required.l2PageId,
    }),
  );
  process.exit(0);
} catch (err) {
  console.error(`pick-l2-sources.mjs: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(3);
}
