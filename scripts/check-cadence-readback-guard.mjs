#!/usr/bin/env node
// check-cadence-readback-guard.mjs — R-16 mechanical gate.
//
// Any bundled Cadence write-script that (a) reads its deliverable from a
// caller-supplied `--body-file` and (b) POSTs it to the shared feed endpoint
// must verify the write by read-back before it exits 0. A 2xx only proves the
// endpoint accepted *a* body — not that it accepted *ours*.
//
// Why this exists (ML-020 / ML-028; see PR #546)
// ------------------------------------------------
// A batched CCR fire runs every (agent x skill) task of a tick in ONE session
// on ONE filesystem (workforce/docs/routines/agent-runner.md, "Fire payload —
// batched tasks"). Every affected skill body told its task to write the
// deliverable to a fixed, non-unique temp path. Under real concurrency a
// sibling task's write can land between another task's `readFileSync` and
// its own POST, so the write-script publishes the SIBLING's prose under ITS
// OWN slug and still exits 0 — the C-4 silent-degradation class, and not
// agent-remediable (`POST /feed` has no delete counterpart; ADR-0017). This
// recurred at least three times: 2026-08-05 (post 00MSFJC7FZ...), the
// 2026-08-13/14 fires (ML-028's first entries), and the 2026-08-17 fire
// (4 more wrongly-attributed posts across 2 skills in one tick).
//
// The fix, applied first to feed-post/post-feed.mjs (PR #546) and ported to
// grid-watch/post.mjs + attention-ledger/post.mjs: after a 2xx, re-`GET
// /feed/{post_id}?agent_slug=` and exit 2 unless the published `agent_slug`
// and body are the ones this run actually sent. This gate asserts every
// script in the discovered population carries that guard, by requiring a
// call to a function named `verifyReadBack` — the same convention check-
// proxy-bootstrap.mjs (R-14) uses for its own load-bearing call.
//
// Population + KNOWN_GAPS
// ------------------------
// The population is discovered, not hand-maintained: any `workforce/skills/
// */*.mjs` that (1) is not a `*-tests.ts`/`*.test.*` file, (2) reads a
// `--body-file`-shaped CLI arg via readFileSync, and (3) POSTs to the shared
// `.../prod/feed` endpoint. A hand-maintained allowlist would go stale the
// way R-14's did (ML-025) — a new cadence copying the old pattern must be
// caught by discovery, not missed because nobody remembered to list it.
//
// KNOWN_GAPS below is a dated, cited exceptions list for scripts already
// discovered but not yet fixed — so this gate can land today without turning
// CI red on pre-existing gaps this PR does not touch. Each entry names the
// PR that owns closing it. Remove an entry the moment its PR merges; leaving
// a stale exception here defeats the gate the same way a stale skip would.
//
// No silent cap: running this gate's discovery against `main` on 2026-08-17
// (the PR that adds this gate) surfaced 11 MORE scripts sharing the identical
// vulnerable pattern beyond the 3 #546 already covers and the 2 this PR
// fixes — meaning the defect class reaches 16 of the ~28 feed-writing
// cadence skills, not the 3-5 previously tracked. All 11 are listed below
// rather than silently narrowing the population back down to make the gate
// pass quietly; closing each is follow-up work (see docs/follow-ups.md,
// FU-040 addendum), not a condition of landing this gate.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = new URL("..", import.meta.url).pathname;
const SKILLS_DIR = join(REPO_ROOT, "workforce", "skills");

// 2026-08-17: known to POST to the shared feed endpoint from a --body-file
// without a read-back guard yet. Each is fixed in PR #546 (open since
// 2026-08-05, unanimous-green review, blocked on a stale merge conflict) —
// remove the entry as soon as #546 (or its rebase) merges.
const KNOWN_GAPS = new Set([
  "feed-post/post-feed.mjs", // PR #546 (open since 2026-08-05, unanimous-green, blocked on merge conflict)
  "daily-research/post.mjs", // PR #546
  "reader-signal/post.mjs", // PR #546
  // Discovered 2026-08-17 by this gate's own first run against `main` —
  // same vulnerable pattern, not yet ported to verifyReadBack(). Untracked
  // by any open PR as of this commit; follow-up, not a blocker for landing
  // the gate itself (see docs/follow-ups.md FU-040 addendum).
  "audience-loop/post.mjs",
  "budget-runway-review/post.mjs",
  "editorial-desk/post.mjs",
  "india-grid-watch/post.mjs",
  "memory-hygiene/post.mjs",
  "org-metrics-pulse/post.mjs",
  "performance-refresh/post.mjs",
  "red-team-audit/post.mjs",
  "research-sync/post.mjs",
  "skill-maturity-report/post.mjs",
  "verification-sweep/post.mjs",
]);

function listSkillScripts() {
  const out = [];
  for (const skill of readdirSync(SKILLS_DIR)) {
    const dir = join(SKILLS_DIR, skill);
    if (!statSync(dir).isDirectory()) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".mjs")) continue;
      if (file.includes("-tests")) continue;
      out.push({ skill, file, path: join(dir, file), rel: `${skill}/${file}` });
    }
  }
  return out;
}

// Strip line + block comments and string literals before scanning, the same
// discipline check-proxy-bootstrap.mjs uses, so a mention in a comment or an
// example string can't fake a pass or a match.
function stripNoise(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/`(?:\\.|[^`\\])*`/g, "``")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");
}

// Checked against the SOURCE (not the noise-stripped copy) — the `--flag`
// name and the endpoint URL are string literals, and stripNoise() blanks
// string contents by design (so a mention *inside* a comment or an example
// string can't fake a match either — the check below runs on the raw source
// specifically for the two literals that only ever legitimately appear as
// string content, never as live code).
function readsBodyFileArg(src) {
  return /arg\(\s*["']body-file["']\s*\)/.test(src) && /readFileSync/.test(src);
}

function postsToSharedFeedEndpoint(src) {
  return /execute-api[^"'`]*\/prod\/feed/.test(src) && /method:\s*["']POST["']/.test(src);
}

function hasReadBackGuard(codeNoNoise) {
  return /verifyReadBack\s*\(/.test(codeNoNoise);
}

function main() {
  const scripts = listSkillScripts();
  const inPopulation = [];
  for (const s of scripts) {
    const src = readFileSync(s.path, "utf8");
    const noise = stripNoise(src);
    if (readsBodyFileArg(src) && postsToSharedFeedEndpoint(src)) {
      inPopulation.push({ ...s, guarded: hasReadBackGuard(noise) });
    }
  }

  const missing = inPopulation.filter((s) => !s.guarded && !KNOWN_GAPS.has(s.rel));
  const staleGaps = [...KNOWN_GAPS].filter(
    (rel) => !inPopulation.some((s) => s.rel === rel && !s.guarded),
  );

  if (staleGaps.length > 0) {
    console.error("R-16: KNOWN_GAPS entries no longer reflect reality — remove them:");
    for (const g of staleGaps) console.error(`  - ${g} (now guarded, or no longer matches the population)`);
    process.exitCode = 1;
  }

  if (missing.length > 0) {
    console.error(
      `R-16: ${missing.length} cadence write-script(s) POST a --body-file payload to the shared ` +
        `feed endpoint without a verifyReadBack() read-back guard (ML-020/ML-028):`,
    );
    for (const s of missing) console.error(`  - ${s.rel}`);
    console.error(
      "\nA 2xx from POST /feed proves the endpoint accepted *a* body, not *ours* — under a " +
        "batched fire, a sibling task can overwrite --body-file first and this exits 0 anyway. " +
        "Port the verifyReadBack() pattern from workforce/skills/grid-watch/post.mjs.",
    );
    process.exitCode = 1;
  }

  if (process.exitCode) return;
  const fixed = inPopulation.filter((s) => s.guarded).length;
  console.log(
    `✅ R-16: ${fixed} of ${inPopulation.length} feed-writing cadence script(s) carry the ` +
      `read-back guard; the other ${KNOWN_GAPS.size} are cited, tracked KNOWN_GAPS (3 pending ` +
      `PR #546, 11 pending follow-up — see docs/follow-ups.md).`,
  );
}

main();
