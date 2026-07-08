#!/usr/bin/env node
// build-pr-metrics-github.mjs — Epic-016 Phase 3 (the authoritative PR-automation
// builder, per project / any repo).
//
// The git-log builder (build-pr-metrics.mjs) derives counts + churn from the
// LOCAL repo and can only guess the autopilot split from commit authorship —
// which is useless once every squash-merge is authored by the one push identity.
// This builder reads the **authoritative GitHub merge metadata** for ANY repo
// (so it works for an external project like PSVL/asp-cloud, not just this repo):
//
//   - merged PRs in the trailing window (Search API);
//   - per PR: merged_at (day), additions/deletions (churn), author;
//   - the autopilot signal — a PR is **autopilot-merged** iff its review/comment
//     thread carries a pr-autopilot green consensus marker
//     (`<!-- autopilot:review:{slug}:green -->`) AND it does NOT carry the
//     `autopilot:needs-human` label (i.e. pr-autopilot reviewed-and-merged it
//     with no human hand-off). Everything else is human-involved.
//   - contributors: the reviewer slugs that signed off (kind: agent) — the
//     personas doing the review work — plus the PR authors (kind: human).
//   - escalations (Epic-019 Story 1): PRs labelled `autopilot:needs-human` in
//     the window, bucketed by their `autopilot:reason:*` labels into
//     pr_summary.escalation_reasons, plus eligible_escalations (the non-L0/L1
//     share). PRs missing a reason label bucket as "unspecified".
//
// Writes the same `PERF#{scope}/PR` roll-up the /performance endpoint reads
// (shape mirrors PerfPrRow). Standalone (fetch + a token); preview with --dry-run.
//
// Usage:
//   GITHUB_TOKEN=... node workforce/scripts/build-pr-metrics-github.mjs \
//     --repo PSVL/asp-cloud --scope asp-cloud [--days 28] \
//     [--publish-ddb --table wf-table-prod] [--dry-run]

const GREEN_MARKER_RE = /<!--\s*autopilot:review:[a-z0-9-]+:green\s*-->/i;
const REVIEWER_SLUG_RE = /<!--\s*autopilot:review:([a-z0-9-]+):green\s*-->/gi;
const NEEDS_HUMAN_LABEL = "autopilot:needs-human";
// Epic-019 Story 1: the escalation-reason label family stamped by the
// pr-autopilot scripts (taxonomy: workforce/docs/pr-escalation-reasons.md).
// Mirrored here (like NEEDS_HUMAN_LABEL) rather than imported from the skill.
const REASON_LABEL_PREFIX = "autopilot:reason:";
// Epic-019 Story 2c: flaky-rerun telemetry. The rerun engine
// (workforce/skills/pr-autopilot/flaky-rerun.mjs) stamps `autopilot:reran` +
// an audit marker carrying the rerun check names; this builder counts reruns
// and rerun-then-pass per check so a RACY check (repeatedly passing only on
// rerun) is detectable — over-threshold checks get a WARN line (eviction +
// issue-filing stays a manual/sweep step, never automated here).
const RERAN_LABEL = "autopilot:reran";
const RERUN_MARKER_RE = /<!--\s*autopilot:rerun:\d+\s+checks=([^>]*?)\s*-->/g;
// A check that passed-on-rerun this many times in the window is racy, not
// flaky — the allowlist entry should be evicted and an issue opened.
const RERUN_PASS_WARN_THRESHOLD = 3;

// ── pure aggregation (unit-tested) ───────────────────────────────────────────

/** Decide a merged PR's automation class + the reviewer slugs that signed off. */
export function classifyPr({ bodies = [], labels = [] }) {
  const needsHuman = labels.some((l) => String(l || "").toLowerCase() === NEEDS_HUMAN_LABEL);
  const slugs = new Set();
  for (const b of bodies) {
    REVIEWER_SLUG_RE.lastIndex = 0;
    let m;
    while ((m = REVIEWER_SLUG_RE.exec(String(b || ""))) !== null) slugs.add(m[1].toLowerCase());
  }
  const hasGreen = bodies.some((b) => GREEN_MARKER_RE.test(String(b || "")));
  return { autopilotMerged: hasGreen && !needsHuman, reviewers: [...slugs] };
}

/** Aggregate per-PR facts into the PERF#{scope}/PR roll-up body. */
export function aggregate(prs, { sinceIso } = {}) {
  const byDate = new Map();
  const contrib = new Map();
  const humans = new Set();
  let total = { prs: 0, autopilot_merged: 0, additions: 0, deletions: 0 };

  for (const pr of prs) {
    const date = (pr.merged_at || "").slice(0, 10);
    if (!date) continue;
    const d = byDate.get(date) ?? { date, prs: 0, autopilot_merged: 0, additions: 0, deletions: 0 };
    d.prs += 1;
    d.additions += pr.additions || 0;
    d.deletions += pr.deletions || 0;
    if (pr.autopilotMerged) d.autopilot_merged += 1;
    byDate.set(date, d);

    total.prs += 1;
    total.additions += pr.additions || 0;
    total.deletions += pr.deletions || 0;
    if (pr.autopilotMerged) total.autopilot_merged += 1;

    for (const slug of pr.reviewers || []) {
      const c = contrib.get(slug) ?? { handle: slug, kind: "agent", prs: 0 };
      c.prs += 1;
      contrib.set(slug, c);
    }
    if (pr.author) {
      const c = contrib.get(pr.author) ?? { handle: pr.author, kind: "human", prs: 0 };
      c.prs += 1;
      contrib.set(pr.author, c);
      if (!pr.autopilotMerged) humans.add(pr.author);
    }
  }

  const pr_daily = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  return {
    window: { start: pr_daily[0]?.date ?? sinceIso, end: pr_daily.at(-1)?.date ?? sinceIso },
    pr_daily,
    pr_summary: {
      total_prs: total.prs,
      autopilot_merged: total.autopilot_merged,
      autopilot_share: total.prs > 0 ? +(total.autopilot_merged / total.prs).toFixed(3) : 0,
      total_additions: total.additions,
      total_deletions: total.deletions,
      humans_involved: [...humans].sort(),
    },
    pr_contributors: [...contrib.values()].sort((a, b) => b.prs - a.prs),
  };
}

/** Epic-019 Story 1: bucket escalated (needs-human) PRs by their
 *  `autopilot:reason:*` labels. A PR carrying several reason labels counts in
 *  each bucket; one carrying none lands in "unspecified" — the AC's coverage
 *  gap made visible, never silently dropped. `eligible_escalations` = the
 *  escalations NOT reasoned `l0l1-path`, i.e. the non-structural share the
 *  Epic-019 Story-3 verdict gates on. */
export function aggregateEscalations(prs) {
  const escalation_reasons = {};
  let eligible = 0;
  for (const pr of prs) {
    const codes = [
      ...new Set(
        (pr.labels || [])
          .map((l) => String(l || "").toLowerCase())
          .filter((l) => l.startsWith(REASON_LABEL_PREFIX))
          .map((l) => l.slice(REASON_LABEL_PREFIX.length)),
      ),
    ];
    for (const c of codes.length > 0 ? codes : ["unspecified"]) {
      escalation_reasons[c] = (escalation_reasons[c] || 0) + 1;
    }
    if (!codes.includes("l0l1-path")) eligible += 1;
  }
  return { escalated_prs: prs.length, eligible_escalations: eligible, escalation_reasons };
}

/** Epic-019 Story 2c: aggregate `autopilot:reran` PRs into per-check rerun
 *  counts. items = [{ merged, labels, bodies }] (one per reran-labelled PR).
 *  A rerun "then passed" when the PR merged OR carries no
 *  `autopilot:reason:checks-failing` label (i.e. the rerun did not end in the
 *  still-failing escalation). A labelled PR whose audit marker is missing
 *  buckets its checks as "unspecified" — the gap stays visible, never
 *  dropped. Returns { reran_prs, per_check, warn } where warn lists checks at
 *  or over RERUN_PASS_WARN_THRESHOLD rerun-then-passes (racy, not flaky). */
export function aggregateReruns(items, { warnThreshold = RERUN_PASS_WARN_THRESHOLD } = {}) {
  const per_check = {};
  let reran_prs = 0;
  for (const it of items) {
    reran_prs += 1;
    const labels = (it.labels || []).map((l) => String(l || "").toLowerCase());
    const passed = it.merged === true || !labels.includes(`${REASON_LABEL_PREFIX}checks-failing`);
    const checks = new Set();
    for (const b of it.bodies || []) {
      const re = new RegExp(RERUN_MARKER_RE.source, "g");
      let m;
      while ((m = re.exec(String(b || ""))) !== null) {
        for (const name of m[1].split("|").map((s) => s.trim()).filter(Boolean)) checks.add(name);
      }
    }
    if (checks.size === 0) checks.add("unspecified");
    for (const name of checks) {
      const c = (per_check[name] ??= { reruns: 0, rerun_then_pass: 0 });
      c.reruns += 1;
      if (passed) c.rerun_then_pass += 1;
    }
  }
  const warn = Object.entries(per_check)
    .filter(([name, c]) => name !== "unspecified" && c.rerun_then_pass >= warnThreshold)
    .map(([name]) => name)
    .sort();
  return { reran_prs, per_check, warn };
}

// ── CLI / IO ─────────────────────────────────────────────────────────────────

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
}

async function main() {
  const repo = arg("repo");
  const scope = arg("scope");
  const DAYS = Number(arg("days", 28));
  const DRY = process.argv.includes("--dry-run");
  const PUBLISH = process.argv.includes("--publish-ddb");
  const TABLE = arg("table", process.env.TABLE_NAME || "wf-table-prod");
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!repo || !/^[^/]+\/[^/]+$/.test(repo)) { console.error("--repo <owner>/<repo> required"); return 1; }
  if (!scope) { console.error("--scope <scopeId> required (e.g. workforce, asp-cloud)"); return 1; }
  if (!token) { console.error("GITHUB_TOKEN (or GH_TOKEN) required"); return 1; }

  const api = process.env.GITHUB_API_URL || "https://api.github.com";
  const gh = async (path) => {
    const res = await fetch(`${api}${path}`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "wf-pr-metrics-gh" },
    });
    const text = await res.text().catch(() => "");
    let json; try { json = text ? JSON.parse(text) : {}; } catch { json = {}; }
    return { status: res.status, json };
  };

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - DAYS);
  const sinceIso = since.toISOString().slice(0, 10);

  // 1. merged PRs in the window (Search API, paginated).
  const merged = [];
  for (let page = 1; page <= 10; page++) {
    const q = encodeURIComponent(`repo:${repo} is:pr is:merged merged:>=${sinceIso}`);
    const r = await gh(`/search/issues?q=${q}&per_page=100&page=${page}`);
    if (r.status !== 200) { console.error(`search -> HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`); return 3; }
    const items = r.json.items ?? [];
    merged.push(...items);
    if (items.length < 100) break;
  }

  // 1b. escalated PRs in the window (Epic-019): every PR — open or closed —
  // carrying the needs-human label and updated in the window. Reason labels
  // ride along on the Search items, so no per-PR GETs are needed.
  const escalatedItems = [];
  for (let page = 1; page <= 10; page++) {
    const q = encodeURIComponent(`repo:${repo} is:pr label:"${NEEDS_HUMAN_LABEL}" updated:>=${sinceIso}`);
    const r = await gh(`/search/issues?q=${q}&per_page=100&page=${page}`);
    if (r.status !== 200) { console.error(`escalation search -> HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`); return 3; }
    const items = r.json.items ?? [];
    escalatedItems.push(...items);
    if (items.length < 100) break;
  }
  const escalations = aggregateEscalations(
    escalatedItems.map((it) => ({ labels: Array.isArray(it.labels) ? it.labels.map((l) => l?.name) : [] })),
  );

  // 1c. flaky-rerun telemetry (Epic-019 Story 2c): PRs labelled
  // `autopilot:reran` in the window. The audit marker comment carries the
  // rerun check names, so fetch each item's comments (reruns are rare — max 1
  // per PR — so this stays cheap).
  const reranItems = [];
  for (let page = 1; page <= 10; page++) {
    const q = encodeURIComponent(`repo:${repo} is:pr label:"${RERAN_LABEL}" updated:>=${sinceIso}`);
    const r = await gh(`/search/issues?q=${q}&per_page=100&page=${page}`);
    if (r.status !== 200) { console.error(`rerun search -> HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`); return 3; }
    const items = r.json.items ?? [];
    reranItems.push(...items);
    if (items.length < 100) break;
  }
  const reranFacts = [];
  for (const it of reranItems) {
    const c = await gh(`/repos/${repo}/issues/${it.number}/comments?per_page=100`);
    reranFacts.push({
      merged: Boolean(it.pull_request?.merged_at),
      labels: Array.isArray(it.labels) ? it.labels.map((l) => l?.name) : [],
      bodies: Array.isArray(c.json) ? c.json.map((x) => x.body) : [],
    });
  }
  const reruns = aggregateReruns(reranFacts);
  for (const name of reruns.warn) {
    console.error(
      `WARN check '${name}' passed on rerun ${reruns.per_check[name].rerun_then_pass}x in ${DAYS}d ` +
        `(threshold ${RERUN_PASS_WARN_THRESHOLD}) — racy, not flaky: evict it from flaky-checks.json and open an issue (Epic-019 Story 2c)`,
    );
  }

  // 2. per PR: churn + merged_at + author + the autopilot signal.
  const prs = [];
  for (const it of merged) {
    const n = it.number;
    const [detail, comments, reviews] = await Promise.all([
      gh(`/repos/${repo}/pulls/${n}`),
      gh(`/repos/${repo}/issues/${n}/comments?per_page=100`),
      gh(`/repos/${repo}/pulls/${n}/reviews?per_page=100`),
    ]);
    const p = detail.json || {};
    const bodies = [
      ...(Array.isArray(comments.json) ? comments.json.map((c) => c.body) : []),
      ...(Array.isArray(reviews.json) ? reviews.json.map((c) => c.body) : []),
    ];
    const labels = Array.isArray(it.labels) ? it.labels.map((l) => l.name) : [];
    const { autopilotMerged, reviewers } = classifyPr({ bodies, labels });
    prs.push({
      merged_at: p.merged_at || it.closed_at,
      additions: p.additions || 0,
      deletions: p.deletions || 0,
      author: p.user?.login || it.user?.login,
      autopilotMerged,
      reviewers,
    });
  }

  const block = aggregate(prs, { sinceIso });
  // Epic-019: the escalation-reason funnel lives on the same PERF#{scope}/PR
  // item (R-N2: no new store), inside pr_summary — as does the Story-2c
  // flaky-rerun roll-up (warn is print-only, not stored).
  Object.assign(block.pr_summary, escalations, {
    flaky_reruns: { reran_prs: reruns.reran_prs, per_check: reruns.per_check },
  });
  console.error(
    `${repo} (scope ${scope}): ${block.pr_summary.total_prs} merged PR(s) over ${DAYS}d ` +
      `(${block.window.start}→${block.window.end}); autopilot ${Math.round(block.pr_summary.autopilot_share * 100)}% ` +
      `(${block.pr_summary.autopilot_merged}/${block.pr_summary.total_prs}); escalated ${escalations.escalated_prs} ` +
      `(eligible ${escalations.eligible_escalations}); reviewers: ` +
      block.pr_contributors.filter((c) => c.kind === "agent").map((c) => `${c.handle}:${c.prs}`).join(", "),
  );

  if (DRY || !PUBLISH) {
    console.log(JSON.stringify({ pk: `PERF#${scope}`, sk: "PR", scope, ...block }, null, 2));
    return 0;
  }

  const { createRequire } = await import("node:module");
  const { pathToFileURL, fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const lambdasReq = createRequire(join(dirname(fileURLToPath(import.meta.url)), "..", "lambdas", "package.json"));
  const importLambdaDep = (spec) => import(pathToFileURL(lambdasReq.resolve(spec)).href);
  const { DynamoDBClient } = await importLambdaDep("@aws-sdk/client-dynamodb");
  const { DynamoDBDocumentClient, PutCommand } = await importLambdaDep("@aws-sdk/lib-dynamodb");
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
  await ddb.send(new PutCommand({ TableName: TABLE, Item: { pk: `PERF#${scope}`, sk: "PR", scope, updated_at: new Date().toISOString(), ...block } }));
  console.error(`published PERF#${scope}/PR to ${TABLE}`);
  return 0;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  process.exit(await main());
}
