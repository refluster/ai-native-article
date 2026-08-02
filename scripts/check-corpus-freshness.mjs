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
// It reads the manifest that deploy-article-site.yml writes to gh-pages and
// fails if the newest article of a given type is older than its budget, so a
// dead generation path raises an alarm within a day instead of never (C-4).
// It runs on a daily schedule (.github/workflows/corpus-freshness.yml), not as
// a PR gate — see the note in ci.yml.
//
// Scope: gh-pages is the end of the *pipeline*, which is what this gate is
// about. It is not necessarily what the public origin serves — as of
// 2026-08-02 kohuehara.xyz answers with a different, create-react-app site,
// and every /posts/* and /article/* path 404s there, including for articles
// that have been in the corpus for months. Whether that is intended is a
// separate question, and this gate deliberately does not try to answer it:
// conflating "generation stopped" with "the domain points elsewhere" would
// make the alarm mean two things and therefore nothing.
//
// Usage:
//   node scripts/check-corpus-freshness.mjs
//   MANIFEST_URL=… MAX_AGE_DAYS=7 node scripts/check-corpus-freshness.mjs
//
// Exit: 0 fresh (or explicitly waived) · 1 stale · 3 manifest unreadable

import { ensureProxyAwareEntry } from "./lib/proxy-bootstrap.mjs";
ensureProxyAwareEntry(import.meta.url);

// Read from the gh-pages branch rather than from kohuehara.xyz — see the
// scope note above: the public origin does not serve this artefact at all.
const MANIFEST_URL =
  process.env.MANIFEST_URL ||
  "https://raw.githubusercontent.com/refluster/ai-native-article/gh-pages/posts/manifest.json";

// Generous relative to the real cadence (4 explanations + 4 analyses a day):
// only a genuine multi-day stall trips this, never a quiet weekend.
const MAX_AGE_DAYS = Number(process.env.MAX_AGE_DAYS || 5);

// Escape hatch for a deliberate pause (cadence disabled on purpose, Notion
// migration in flight). Set in the workflow with a reason, don't edit the
// threshold — a lowered threshold is indistinguishable from a working gate.
const waiver = (process.env.SKIP_FRESHNESS_CHECK ?? "").trim();
if (waiver) {
  // Truthiness alone would let SKIP_FRESHNESS_CHECK=0 or =false disable the
  // gate, which is the opposite of what someone typing those means. The
  // variable documents itself as taking a reason, so demand one.
  if (/^(0|false|no|off)$/i.test(waiver) || waiver.length < 4) {
    console.error(
      `❌  R-15: SKIP_FRESHNESS_CHECK must be a reason, not "${waiver}". ` +
        `A waiver with no durable record is the silent-absorption channel §6.2 exists to prevent.`,
    );
    process.exit(1);
  }
  const note = `⚠️  R-15 waived: ${waiver}`;
  console.log(note);
  // Make the waiver visible in the run that used it, not just in whoever's
  // shell set the variable.
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n${note}\n`);
  }
  process.exit(0);
}

const TYPES = ["explanation", "analysis"];

// A 30-second blip on an external, unauthenticated host must not read as
// "the pipeline is dead". Bounded timeout + two retries; still exits 3 (a
// distinct code from "stale") if the artefact is genuinely unreadable.
async function readManifest() {
  const backoff = [2_000, 6_000];
  let lastErr;
  for (let attempt = 0; attempt <= backoff.length; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, backoff[attempt - 1]));
    try {
      const res = await fetch(MANIFEST_URL, {
        redirect: "follow",
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

let manifest;
try {
  manifest = await readManifest();
} catch (err) {
  console.error(
    `❌  R-15: could not read the published manifest at ${MANIFEST_URL} after 3 attempts: ${err instanceof Error ? err.message : String(err)}`,
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
    // `date` comes from the Notion Date property, which is agent/operator
    // writable. One mistyped or future-dated row would pin `newest` forward
    // and hold this gate green no matter how dead generation is — the gate
    // would silently stop being a gate.
    .filter((d) => Number.isFinite(d) && d <= now);

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
