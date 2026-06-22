#!/usr/bin/env node
/**
 * build-pr-metrics.mjs — derive the git-true subset of the Epic-016 PR
 * automation series (Metric 3) from local git history, offline.
 *
 * What git authoritatively knows, and this script derives:
 *   - daily merged-PR count  — commits on the branch whose subject ends in
 *     `(#NNN)` (the squash-merge convention); one such commit == one PR.
 *   - churn                  — additions / deletions per PR via `--numstat`.
 *   - contributors           — commit author (%an) + every `Co-Authored-By:`
 *     trailer, split agent vs human by the --agents allowlist.
 *
 * What git does NOT know (and the live endpoint must supply): which PRs were
 * merged by pr-autopilot with no human in the loop. That lives in GitHub PR
 * metadata (mergedBy / the `autopilot:*` labels), not in the commit graph.
 * This script approximates it with a documented proxy — a PR is counted
 * autopilot-merged when *every* author/co-author is in the --agents allowlist
 * (i.e. no human authored it) — and prints the assumption loudly. Treat the
 * autopilot split as an estimate until the live /performance reducer reads the
 * authoritative GitHub merge metadata.
 *
 * Usage:
 *   node workforce/scripts/build-pr-metrics.mjs [--days 30] [--branch main]
 *        [--agents nadia,ren,maya,...] [--humans refluster] [--dry-run]
 *        [--write]   # patch workforce/app/public/workforce-mock-performance.json
 *
 * Default is --dry-run (print the derived workforce PR block as JSON). The
 * illustrative mock is only overwritten with --write.
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MOCK = join(ROOT, 'workforce/app/public/workforce-mock-performance.json');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

const DAYS = Number(arg('days', 30));
const BRANCH = arg('branch', 'HEAD');
const AGENTS = new Set(
  String(arg('agents', 'nadia,ren,maya,freya,hana,mateo,sana,aoi,yuki,kai'))
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);
const WRITE = process.argv.includes('--write');
const DRY = !WRITE || process.argv.includes('--dry-run');

const since = new Date();
since.setUTCDate(since.getUTCDate() - DAYS);
const sinceIso = since.toISOString().slice(0, 10);

// One record per commit: a unit-separated log so multi-line bodies survive.
// %x1e = record sep, %x1f = field sep.
const RS = '\x1e';
const FS = '\x1f';
let raw;
try {
  raw = execSync(
    `git log ${BRANCH} --since=${sinceIso} --no-merges --pretty=format:%H${FS}%cI${FS}%an${RS}`,
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
} catch (err) {
  console.error('git log failed:', err.message);
  process.exit(1);
}

const PR_RE = /\(#(\d+)\)\s*$/m;
const COAUTHOR_RE = /Co-Authored-By:\s*([^<\n]+?)\s*</gi;

const records = raw.split(RS).map((r) => r.trim()).filter(Boolean);
const byDate = new Map(); // date -> { prs, autopilot_merged, additions, deletions }
const contrib = new Map(); // handle -> { kind, prs }
const humansInvolved = new Set();
let totals = { prs: 0, autopilot_merged: 0, additions: 0, deletions: 0 };

function handleKind(name) {
  return AGENTS.has(name.trim().toLowerCase()) ? 'agent' : 'human';
}
function bump(handle, isAuthor) {
  const key = handle.trim();
  if (!key) return;
  const kind = handleKind(key);
  const c = contrib.get(key) ?? { kind, prs: 0 };
  if (isAuthor) c.prs += 1;
  contrib.set(key, c);
  return kind;
}

for (const rec of records) {
  const [sha, cIso, author] = rec.split(FS);
  // Full message (subject + body) — the squash `(#NNN)` marker is on the
  // subject; Co-Authored-By trailers are in the body.
  const full = execSync(`git show -s --format=%s%n%b ${sha}`, {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (!PR_RE.test(full)) continue;

  const date = cIso.slice(0, 10);
  const d = byDate.get(date) ?? { prs: 0, autopilot_merged: 0, additions: 0, deletions: 0 };

  // Churn for this commit.
  const numstat = execSync(`git show --numstat --format= ${sha}`, {
    cwd: ROOT,
    encoding: 'utf8',
  });
  let add = 0;
  let del = 0;
  for (const line of numstat.split('\n')) {
    const m = line.match(/^(\d+|-)\t(\d+|-)\t/);
    if (m) {
      add += m[1] === '-' ? 0 : Number(m[1]);
      del += m[2] === '-' ? 0 : Number(m[2]);
    }
  }

  // Authors: %an + Co-Authored-By trailers.
  const authorKind = bump(author, true);
  let anyHuman = authorKind === 'human';
  let coMatch;
  COAUTHOR_RE.lastIndex = 0;
  while ((coMatch = COAUTHOR_RE.exec(full)) !== null) {
    const k = bump(coMatch[1], false);
    if (k === 'human') anyHuman = true;
  }
  if (authorKind === 'human') humansInvolved.add(author.trim());

  const autopilot = !anyHuman; // proxy: no human author == autopilot-merged
  d.prs += 1;
  d.additions += add;
  d.deletions += del;
  if (autopilot) d.autopilot_merged += 1;
  byDate.set(date, d);

  totals.prs += 1;
  totals.additions += add;
  totals.deletions += del;
  if (autopilot) totals.autopilot_merged += 1;
}

const pr_daily = [...byDate.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([date, v]) => ({ date, ...v }));

const block = {
  window: { start: pr_daily[0]?.date ?? sinceIso, end: pr_daily.at(-1)?.date ?? sinceIso },
  pr_daily,
  pr_summary: {
    total_prs: totals.prs,
    autopilot_merged: totals.autopilot_merged,
    autopilot_share: totals.prs > 0 ? +(totals.autopilot_merged / totals.prs).toFixed(3) : 0,
    total_additions: totals.additions,
    total_deletions: totals.deletions,
    humans_involved: [...humansInvolved].sort(),
  },
  pr_contributors: [...contrib.entries()]
    .map(([handle, c]) => ({ handle, kind: c.kind, prs: c.prs }))
    .filter((c) => c.kind === 'human' || c.prs > 0)
    .sort((a, b) => b.prs - a.prs),
};

console.error(
  `derived ${totals.prs} PRs over ${DAYS}d (${block.window.start}→${block.window.end}); ` +
    `autopilot proxy = "no human author" → ${block.pr_summary.autopilot_share * 100}% ` +
    `(estimate; authoritative split needs GitHub merge metadata).`,
);

if (DRY) {
  console.log(JSON.stringify(block, null, 2));
  process.exit(0);
}

const ds = JSON.parse(readFileSync(MOCK, 'utf8'));
ds.generated_at = new Date().toISOString();
ds.workforce = {
  ...ds.workforce,
  window: block.window,
  pr_daily: block.pr_daily,
  pr_summary: block.pr_summary,
  pr_contributors: block.pr_contributors,
};
writeFileSync(MOCK, JSON.stringify(ds, null, 2) + '\n');
console.error(`patched workforce PR block in ${MOCK}`);
