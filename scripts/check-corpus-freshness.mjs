#!/usr/bin/env node
// check-corpus-freshness.mjs — R-15 mechanical gate.
//
// The article pipeline is a cadence: article-level2 fires every 6h and
// article-level3 every 6h, so in steady state the published corpus gains
// several rows a day. Nothing anywhere noticed when it stopped.
//
// On 2026-07-26 both cadences began failing inside their CCR session (Node's
// fetch bypassing the agent proxy — see scripts/lib/proxy-bootstrap.mjs). The
// orchestrator recorded 28 consecutive *successful* dispatches, the agent's
// last_run_at stayed null, no RUN row was ever written, and no alert fired.
// The outage was found seven days later, by hand, because a reader noticed one
// specific article had never appeared.
//
// Every layer was individually "fine"; the only observable that actually moved
// was the one nobody was watching — whether new articles are still arriving.
// This gate watches exactly that, and nothing else.
//
// It reads the deployed manifest (the same artefact the site serves) and fails
// if the newest article of a given type is older than its budget. That makes a
// dead generation path raise an alarm within a day instead of never (C-4). It
// runs on a daily schedule (.github/workflows/corpus-freshness.yml), not as a
// PR gate — see the note in ci.yml.
//
// Usage:
//   node scripts/check-corpus-freshness.mjs
//   MANIFEST_URL=… MAX_AGE_DAYS=7 node scripts/check-corpus-freshness.mjs
//
// Exit: 0 fresh (or explicitly waived) · 1 stale · 3 manifest unreadable

import "./lib/proxy-bootstrap.mjs";

// The deploy artefact, read from the gh-pages branch rather than from
// kohuehara.xyz: the SPA's rewrite rules serve 404.html for /posts/* to a
// plain HTTP client, so the public origin cannot be polled for this.
const MANIFEST_URL =
  process.env.MANIFEST_URL ||
  "https://raw.githubusercontent.com/refluster/ai-native-article/gh-pages/posts/manifest.json";

// Generous relative to the real cadence (4 explanations + 4 analyses a day):
// only a genuine multi-day stall trips this, never a quiet weekend.
const MAX_AGE_DAYS = Number(process.env.MAX_AGE_DAYS || 5);

// Escape hatch for a deliberate pause (cadence disabled on purpose, Notion
// migration in flight). Set in the workflow with a reason, don't edit the
// threshold — a lowered threshold is indistinguishable from a working gate.
if (process.env.SKIP_FRESHNESS_CHECK) {
  console.log(
    `⚠️  R-15 skipped: SKIP_FRESHNESS_CHECK=${process.env.SKIP_FRESHNESS_CHECK}`,
  );
  process.exit(0);
}

const TYPES = ["explanation", "analysis"];

let manifest;
try {
  const res = await fetch(MANIFEST_URL, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  manifest = await res.json();
} catch (err) {
  console.error(
    `❌  R-15: could not read the published manifest at ${MANIFEST_URL}: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(3);
}

const rows = Array.isArray(manifest) ? manifest : (manifest.posts ?? manifest.items ?? []);
if (rows.length === 0) {
  console.error(`❌  R-15: manifest at ${MANIFEST_URL} contains no articles.`);
  process.exit(1);
}

const now = Date.now();
const stale = [];
const report = [];

for (const type of TYPES) {
  const dates = rows
    .filter((r) => (r.type ?? "") === type)
    .map((r) => Date.parse(r.date ?? ""))
    .filter(Number.isFinite);

  if (dates.length === 0) {
    stale.push(`${type}: no articles of this type in the manifest at all`);
    continue;
  }

  const newest = Math.max(...dates);
  const ageDays = (now - newest) / 86_400_000;
  const iso = new Date(newest).toISOString().slice(0, 10);
  report.push(`${type}: newest ${iso} (${ageDays.toFixed(1)}d old, ${dates.length} total)`);
  if (ageDays > MAX_AGE_DAYS) {
    stale.push(`${type}: newest article is ${iso}, ${ageDays.toFixed(1)} days old (budget ${MAX_AGE_DAYS}d)`);
  }
}

for (const line of report) console.log(`    ${line}`);

if (stale.length > 0) {
  console.error(`\n❌  R-15: the article pipeline has stopped producing.\n`);
  for (const line of stale) console.error(`      ${line}`);
  console.error(
    `\n    This gate fires when generation dies silently. Triage, in order:\n` +
      `      1. Run the picker by hand — does it return a pick or exit non-zero?\n` +
      `           NOTION_API_KEY=… node workforce/skills/article-level2/pick-l1-source.mjs\n` +
      `      2. Is the L1 queue empty, or is every row blocked? The picker's\n` +
      `         stderr names blocked rows and their last error.\n` +
      `      3. Check the wf-orchestrator-prod logs: are the cadences still being\n` +
      `         dispatched? A dispatch that "succeeds" proves nothing about what\n` +
      `         happened inside the CCR session.\n` +
      `      4. Is Notion reachable from the session at all? See\n` +
      `         scripts/lib/proxy-bootstrap.mjs for the failure this gate was born from.\n\n` +
      `    Deliberate pause? Set SKIP_FRESHNESS_CHECK="<reason>" rather than\n` +
      `    raising MAX_AGE_DAYS.\n`,
  );
  process.exit(1);
}

console.log(`\n✅  R-15: corpus is fresh (every type within ${MAX_AGE_DAYS} days).`);
