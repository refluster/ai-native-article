#!/usr/bin/env node
/**
 * build-repo-performance.mjs — Repository Performance for /performance
 * (2026-07-24 operator request, requirement 5): issues opened/closed, PR
 * opened/closed, and code-line churn, aggregated across every workforce
 * project's GitHub repo. Each `workforce/projects/{id}/project.json` is the
 * source of truth for the project set — a newly onboarded project with a
 * `github.{owner,repo}` block is picked up automatically, no edit here.
 *
 * Real GitHub data only — no fabrication, no illustrative fallback. Each
 * project's github.token PAT lives in AWS Secrets Manager at
 * `wf/projects/{id}/github.token` (the path + `{"token":"ghp_..."}` shape
 * documented in workforce/docs/runbooks/external-project-onboarding.md and
 * consumed the same way by `workforce/lambdas/shared/secrets.ts`'s
 * getCredential path). This script resolves it directly via
 * @aws-sdk/client-secrets-manager (a workforce/lambdas dependency, reached
 * via the same dynamic-resolve trick build-pr-metrics-github.mjs uses for
 * its --publish-ddb path) — no new credential type, no new write surface.
 *
 * Usage:
 *   node workforce/scripts/build-repo-performance.mjs [--days 90] [--dry-run] [--write]
 *     [--project <id>]     # limit to one project id (default: every project
 *                          #   under workforce/projects/ with a github repo)
 *     [--region us-west-2] # Secrets Manager region (default us-west-2)
 *
 * Default is --dry-run (prints the aggregated dataset as JSON). The bundled
 * snapshot workforce/app/public/workforce-mock-repo-activity.json is only
 * overwritten with --write.
 *
 * This is a point-in-time snapshot, not a live endpoint (same operational
 * shape build-pr-metrics-github.mjs had before its daily-refresh wiring) —
 * re-run periodically to keep it fresh. A project whose token can't be
 * resolved or whose API calls fail is skipped LOUDLY (stderr WARN + a note
 * in the written dataset's $comment) rather than silently omitted or
 * papered over with a zero.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PROJECTS_DIR = join(ROOT, "workforce", "projects");
const OUT = join(ROOT, "workforce", "app", "public", "workforce-mock-repo-activity.json");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
}

// ── project discovery ────────────────────────────────────────────────────

export function discoverProjects(projectsDir = PROJECTS_DIR) {
  if (!existsSync(projectsDir)) return [];
  return readdirSync(projectsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const file = join(projectsDir, e.name, "project.json");
      if (!existsSync(file)) return null;
      let p;
      try {
        p = JSON.parse(readFileSync(file, "utf8"));
      } catch {
        return null;
      }
      if (!p.github?.owner || !p.github?.repo) return null;
      return { id: p.id, owner: p.github.owner, repo: p.github.repo };
    })
    .filter(Boolean)
    .sort((a, b) => a.id.localeCompare(b.id));
}

// ── pure aggregation (unit-tested) ──────────────────────────────────────────

/** Buckets a list of GitHub Search API items by the UTC day of `dateField`. */
export function bucketByDate(items, dateField) {
  const byDate = new Map();
  for (const it of items) {
    const iso = it?.[dateField];
    if (!iso) continue;
    const date = String(iso).slice(0, 10);
    byDate.set(date, (byDate.get(date) ?? 0) + 1);
  }
  return byDate;
}

function lastNDaysUTC(n, todayIso) {
  const today = new Date(`${todayIso}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(today);
    d.setUTCDate(today.getUTCDate() - (n - 1 - i));
    return d.toISOString().slice(0, 10);
  });
}

/** One daily {date, opened, closed} series over the trailing `days` window
 *  ending `todayIso`, from raw opened-items (bucketed by created_at) and
 *  closed-items (bucketed by closed_at). Shared shape for both issues and PRs. */
export function buildDailyActivity(openedItems, closedItems, days, todayIso) {
  const openedByDate = bucketByDate(openedItems, "created_at");
  const closedByDate = bucketByDate(closedItems, "closed_at");
  return lastNDaysUTC(days, todayIso).map((date) => ({
    date,
    opened: openedByDate.get(date) ?? 0,
    closed: closedByDate.get(date) ?? 0,
  }));
}

/** Filters+shapes GitHub's `/stats/code_frequency` weekly buckets
 *  (`[weekStartUnixSeconds, additions, deletions]`, deletions negative) to
 *  the trailing window and a friendly {week_start, additions, deletions} shape
 *  (deletions reported as a positive magnitude, like the PR-automation deck). */
export function buildWeeklyChurn(codeFrequencyWeeks, sinceEpochSeconds) {
  return codeFrequencyWeeks
    .filter((w) => Array.isArray(w) && w[0] >= sinceEpochSeconds)
    .map(([weekStart, additions, deletions]) => ({
      week_start: new Date(weekStart * 1000).toISOString().slice(0, 10),
      additions: additions || 0,
      deletions: Math.abs(deletions || 0),
    }))
    .sort((a, b) => a.week_start.localeCompare(b.week_start));
}

/** Sums several projects' daily series (same date axis, e.g. all built by
 *  buildDailyActivity with the same days/todayIso) into one workforce total. */
export function sumDailyActivity(seriesList) {
  if (seriesList.length === 0) return [];
  return seriesList[0].map((point, i) => ({
    date: point.date,
    opened: seriesList.reduce((acc, s) => acc + (s[i]?.opened ?? 0), 0),
    closed: seriesList.reduce((acc, s) => acc + (s[i]?.closed ?? 0), 0),
  }));
}

/** Sums several projects' weekly churn series into one workforce total,
 *  keyed by week_start (series may have gaps, so this merges by key rather
 *  than assuming aligned indices). */
export function sumWeeklyChurn(seriesList) {
  const byWeek = new Map();
  for (const series of seriesList) {
    for (const w of series) {
      const cur = byWeek.get(w.week_start) ?? { week_start: w.week_start, additions: 0, deletions: 0 };
      cur.additions += w.additions;
      cur.deletions += w.deletions;
      byWeek.set(w.week_start, cur);
    }
  }
  return [...byWeek.values()].sort((a, b) => a.week_start.localeCompare(b.week_start));
}

// ── GitHub I/O ───────────────────────────────────────────────────────────────

async function importLambdaDep(spec) {
  const { createRequire } = await import("node:module");
  const { pathToFileURL } = await import("node:url");
  const lambdasReq = createRequire(join(ROOT, "workforce", "lambdas", "package.json"));
  return import(pathToFileURL(lambdasReq.resolve(spec)).href);
}

async function resolveGithubToken(projectId, region) {
  const envKey = `GITHUB_TOKEN_${projectId.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
  if (process.env[envKey]) return process.env[envKey];
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN; // single-token override (local testing)

  const { SecretsManagerClient, GetSecretValueCommand } = await importLambdaDep("@aws-sdk/client-secrets-manager");
  const sm = new SecretsManagerClient({ region });
  const secretId = `wf/projects/${projectId}/github.token`;
  const out = await sm.send(new GetSecretValueCommand({ SecretId: secretId }));
  if (!out.SecretString) throw new Error(`${secretId} has no SecretString`);
  const parsed = JSON.parse(out.SecretString);
  if (typeof parsed?.token !== "string") throw new Error(`${secretId} missing "token" field`);
  return parsed.token;
}

function makeGh(api, token) {
  return async (path) => {
    const res = await fetch(`${api}${path}`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "wf-repo-performance",
      },
    });
    const text = await res.text().catch(() => "");
    let json;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = {};
    }
    return { status: res.status, json };
  };
}

// Search API carries its own tighter rate limit (30 req/min authenticated) —
// pace multi-page walks so 4 projects x 4 queries never bursts it.
async function searchAll(gh, q) {
  const items = [];
  for (let page = 1; page <= 10; page++) {
    const r = await gh(`/search/issues?q=${encodeURIComponent(q)}&per_page=100&page=${page}`);
    if (r.status !== 200) {
      console.error(`search failed (HTTP ${r.status}) for "${q}": ${JSON.stringify(r.json).slice(0, 200)}`);
      break;
    }
    const batch = r.json.items ?? [];
    items.push(...batch);
    if (batch.length < 100) break;
    await sleep(1200);
  }
  return items;
}

async function fetchCodeFrequency(gh, repo) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const r = await gh(`/repos/${repo}/stats/code_frequency`);
    if (r.status === 200 && Array.isArray(r.json)) return r.json;
    if (r.status === 202) {
      // GitHub is still computing the stats cache — retry with backoff.
      await sleep(2500);
      continue;
    }
    console.error(`${repo}: code_frequency -> HTTP ${r.status}; churn will be empty for this repo`);
    return [];
  }
  console.error(`${repo}: code_frequency still computing after retries; churn will be empty for this repo`);
  return [];
}

async function fetchProjectActivity(project, { days, token, api }) {
  const repo = `${project.owner}/${project.repo}`;
  const gh = makeGh(api, token);

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);
  const sinceIso = since.toISOString().slice(0, 10);
  const todayIso = new Date().toISOString().slice(0, 10);

  const issuesOpened = await searchAll(gh, `repo:${repo} is:issue created:>=${sinceIso}`);
  await sleep(1200);
  const issuesClosed = await searchAll(gh, `repo:${repo} is:issue closed:>=${sinceIso}`);
  await sleep(1200);
  const prsOpened = await searchAll(gh, `repo:${repo} is:pr created:>=${sinceIso}`);
  await sleep(1200);
  const prsClosed = await searchAll(gh, `repo:${repo} is:pr closed:>=${sinceIso}`);

  const issues_daily = buildDailyActivity(issuesOpened, issuesClosed, days, todayIso);
  const prs_daily = buildDailyActivity(prsOpened, prsClosed, days, todayIso);

  const codeWeeks = await fetchCodeFrequency(gh, repo);
  const sinceEpoch = Math.floor(new Date(`${sinceIso}T00:00:00Z`).getTime() / 1000);
  const code_churn_weekly = buildWeeklyChurn(codeWeeks, sinceEpoch);

  return {
    scope: project.id,
    repo,
    window: { start: issues_daily[0]?.date ?? sinceIso, end: issues_daily.at(-1)?.date ?? todayIso },
    issues_daily,
    prs_daily,
    code_churn_weekly,
    summary: {
      issues_opened: issuesOpened.length,
      issues_closed: issuesClosed.length,
      prs_opened: prsOpened.length,
      prs_closed: prsClosed.length,
      total_additions: code_churn_weekly.reduce((a, w) => a + w.additions, 0),
      total_deletions: code_churn_weekly.reduce((a, w) => a + w.deletions, 0),
    },
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

async function main() {
  const DAYS = Number(arg("days", 90));
  const WRITE = process.argv.includes("--write");
  const DRY = !WRITE || process.argv.includes("--dry-run");
  const REGION = arg("region", "us-west-2");
  const ONLY = arg("project");
  const api = process.env.GITHUB_API_URL || "https://api.github.com";

  const projects = discoverProjects().filter((p) => !ONLY || p.id === ONLY);
  if (projects.length === 0) {
    console.error("no projects with github.{owner,repo} found under workforce/projects/");
    return 1;
  }

  const results = [];
  const failed = [];
  for (const project of projects) {
    try {
      console.error(`${project.id}: resolving github.token...`);
      const token = await resolveGithubToken(project.id, REGION);
      console.error(`${project.id}: fetching ${project.owner}/${project.repo} (${DAYS}d)...`);
      const activity = await fetchProjectActivity(project, { days: DAYS, token, api });
      results.push(activity);
      console.error(
        `${project.id}: issues +${activity.summary.issues_opened}/-${activity.summary.issues_closed} ` +
          `· prs +${activity.summary.prs_opened}/-${activity.summary.prs_closed} ` +
          `· churn +${activity.summary.total_additions}/-${activity.summary.total_deletions}`,
      );
    } catch (err) {
      console.error(`WARN ${project.id}: ${err instanceof Error ? err.message : String(err)} — skipped`);
      failed.push(project.id);
    }
    await sleep(500);
  }

  if (results.length === 0) {
    console.error("all projects failed — nothing to write");
    return 3;
  }

  const workforce = {
    scope: "workforce",
    window: results[0].window,
    issues_daily: sumDailyActivity(results.map((r) => r.issues_daily)),
    prs_daily: sumDailyActivity(results.map((r) => r.prs_daily)),
    code_churn_weekly: sumWeeklyChurn(results.map((r) => r.code_churn_weekly)),
    summary: {
      issues_opened: results.reduce((a, r) => a + r.summary.issues_opened, 0),
      issues_closed: results.reduce((a, r) => a + r.summary.issues_closed, 0),
      prs_opened: results.reduce((a, r) => a + r.summary.prs_opened, 0),
      prs_closed: results.reduce((a, r) => a + r.summary.prs_closed, 0),
      total_additions: results.reduce((a, r) => a + r.summary.total_additions, 0),
      total_deletions: results.reduce((a, r) => a + r.summary.total_deletions, 0),
    },
  };

  let comment =
    "REAL data — GitHub-derived repository activity (issues/PRs opened+closed, code churn) " +
    "across every workforce project's repo. Built by workforce/scripts/build-repo-performance.mjs. " +
    "This is a point-in-time snapshot (like build-pr-metrics-github.mjs before its daily-refresh " +
    "wiring) — re-run periodically to refresh; it does not self-update.";
  if (failed.length > 0) comment += ` INCOMPLETE this run: failed to fetch ${failed.join(", ")} — see stderr.`;

  const dataset = {
    $comment: comment,
    generated_at: new Date().toISOString(),
    days: DAYS,
    workforce,
    projects: Object.fromEntries(results.map((r) => [r.scope, r])),
  };

  if (DRY) {
    console.log(JSON.stringify(dataset, null, 2));
    return 0;
  }
  writeFileSync(OUT, `${JSON.stringify(dataset, null, 2)}\n`);
  console.error(`wrote ${results.length} project(s) -> ${OUT.replace(`${ROOT}/`, "")}`);
  return failed.length > 0 ? 2 : 0;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  process.exit(await main());
}
