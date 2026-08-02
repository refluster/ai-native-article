#!/usr/bin/env node
// performance-refresh/refresh.mjs — the deterministic half of the
// "performance-refresh" Cadence. The LLM owns the judgment (is the surface
// healthy? what changed? what is frozen?); THIS script owns every write, so
// the failure class "the agent hand-rolls an API call and guesses the roll-up
// schema wrong" cannot recur.
//
// What it does, per fire:
//   1. Runs workforce/scripts/build-pr-metrics-github.mjs --publish-ddb for
//      every project scope with a GitHub repo → refreshes PERF#{scope}/PR.
//   2. Runs workforce/scripts/build-repo-performance.mjs --publish-ddb →
//      refreshes PERF#{scope}/REPO for every project + the workforce aggregate.
//   3. Reads back GET /performance and reports, per scope, how fresh each
//      block now is.
//
// It writes a machine-readable JSON report to --out, which the agent reads to
// write its observation. It does NOT post to the feed (that is post.mjs) and
// it does NOT touch the repo or open a PR.
//
// The lifecycle funnel (PERF#{scope}/LIFECYCLE) is NOT refreshed here — that
// is the wf-performance-reducer Lambda's daily job (EventBridge 02:00 UTC).
// This script only *observes* its freshness so a stalled reducer is visible.
//
// AWS: uses the ambient credentials of the execution environment (the CCR
// session's AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY). Region defaults to
// us-west-2, where the data plane and wf/projects/* secrets live.
//
// Usage:
//   node workforce/skills/performance-refresh/refresh.mjs \
//     [--days 90] [--table wf-table-prod] [--region us-west-2] \
//     [--out /tmp/performance-refresh-report.json] [--dry-run]
//
// Exit codes:
//   0 — every refresh leg succeeded
//   2 — at least one leg failed or came back degraded (partial data); the
//       report names which. NOT a hard error: the agent still posts, and
//       saying "X is stale/degraded" is the whole point of the cadence.
//   3 — nothing could be refreshed at all (no scopes, or every leg threw)

import "../../../scripts/lib/proxy-bootstrap.mjs";

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const PROJECTS_DIR = join(ROOT, "workforce", "projects");
const API_BASE = process.env.WORKFORCE_AGENTS_API_BASE || "https://workforce-api.kohuehara.xyz";

// The console's default view (GET /performance, no project) reads the
// `workforce` scope — which is NOT any project's id, so iterating
// workforce/projects/ alone silently leaves the most-viewed deck frozen.
// (That is exactly how the PR block stayed stuck at 2026-06-23 while the
// per-project scopes looked fine.) The workforce scope tracks the workforce's
// own repo, i.e. the `agent-workforce` project's repo.
const WORKFORCE_SCOPE = "workforce";
const WORKFORCE_SCOPE_SOURCE_PROJECT = "agent-workforce";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
}

/** Every project with a GitHub repo — the scopes whose PR block can refresh. */
export function repoScopes(projectsDir = PROJECTS_DIR) {
  if (!existsSync(projectsDir)) return [];
  return readdirSync(projectsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const file = join(projectsDir, e.name, "project.json");
      if (!existsSync(file)) return null;
      try {
        const p = JSON.parse(readFileSync(file, "utf8"));
        if (!p.github?.owner || !p.github?.repo) return null;
        return { scope: p.id, repo: `${p.github.owner}/${p.github.repo}` };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.scope.localeCompare(b.scope));
}

/** Hours between an ISO timestamp and now; Infinity when unparseable/absent. */
export function ageHours(iso, now = Date.now()) {
  const t = Date.parse(iso ?? "");
  return Number.isFinite(t) ? (now - t) / 3_600_000 : Infinity;
}

/** Classify one block's freshness against the daily cadence. `stale` is the
 *  signal the agent must report — a block that stopped moving is exactly the
 *  failure this cadence exists to make visible. */
export function freshness(updatedAt, { staleHours = 30, now = Date.now() } = {}) {
  const hours = ageHours(updatedAt, now);
  if (!Number.isFinite(hours)) return { state: "missing", hours: null };
  return { state: hours > staleHours ? "stale" : "fresh", hours: Math.round(hours * 10) / 10 };
}

async function secretsClient(region) {
  const { createRequire } = await import("node:module");
  const { pathToFileURL } = await import("node:url");
  const req = createRequire(join(ROOT, "workforce", "lambdas", "package.json"));
  const mod = await import(pathToFileURL(req.resolve("@aws-sdk/client-secrets-manager")).href);
  return { sm: new mod.SecretsManagerClient({ region }), GetSecretValueCommand: mod.GetSecretValueCommand };
}

// AWS error names that mean "this session has no usable identity" rather than
// "this one secret is missing". Distinguishing them is the whole point of H4
// below — see assertAwsIdentity.
const NO_IDENTITY_ERRORS = new Set([
  "CredentialsProviderError",
  "UnrecognizedClientException",
  "InvalidClientTokenId",
  "InvalidSignatureException",
  "ExpiredToken",
  "ExpiredTokenException",
  "AccessDeniedException",
  "AccessDenied",
  "UnauthorizedOperation",
]);

export function isNoIdentityError(err) {
  const name = err?.name ?? "";
  const code = err?.Code ?? err?.$metadata?.httpStatusCode;
  return NO_IDENTITY_ERRORS.has(name) || code === 403;
}

/** H4 (`wf:hana`, #502): a fire with NO ambient AWS identity would otherwise
 *  fail every scope's secret lookup identically and report N separate
 *  "token unresolved" gaps — sending the operator to provision four secrets
 *  that were never the problem. One infrastructure fault must render as ONE
 *  loud line, not N misattributed symptoms, especially in the surface whose
 *  entire job is making faults legible. So: probe the identity ONCE up front
 *  and abort the whole run if it is absent. */
async function assertAwsIdentity(region) {
  const { sm } = await secretsClient(region);
  try {
    const provider = sm.config.credentials;
    const creds = typeof provider === "function" ? await provider() : await provider;
    if (!creds?.accessKeyId) throw Object.assign(new Error("no accessKeyId"), { name: "CredentialsProviderError" });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) };
  }
}

/** Each project's PAT lives at wf/projects/{id}/github.token — a single
 *  ambient GITHUB_TOKEN would silently 404 on the external repos, so every PR
 *  leg gets its own resolved token injected into the child env. */
async function resolveGithubToken(projectId, region) {
  const { sm, GetSecretValueCommand } = await secretsClient(region);
  const secretId = `wf/projects/${projectId}/github.token`;
  const out = await sm.send(new GetSecretValueCommand({ SecretId: secretId }));
  if (!out.SecretString) throw new Error(`${secretId} has no SecretString`);
  const parsed = JSON.parse(out.SecretString);
  if (typeof parsed?.token !== "string") throw new Error(`${secretId} missing "token" field`);
  return parsed.token;
}

function run(label, file, args, { dry, env }) {
  if (dry) {
    console.error(`[dry-run] would run: ${file} ${args.join(" ")}`);
    return { label, ok: true, dry: true };
  }
  try {
    const stdout = execFileSync("node", [file, ...args], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, ...(env ?? {}) },
    });
    return { label, ok: true, tail: stdout.trim().split("\n").slice(-3).join(" | ") };
  } catch (err) {
    // exit 2 from a builder = published but degraded/partial, not a hard fail.
    const degraded = err?.status === 2;
    const stderr = String(err?.stderr ?? err?.message ?? "").trim();
    return {
      label,
      ok: degraded,
      degraded,
      error: degraded ? undefined : stderr.split("\n").slice(-3).join(" | "),
      tail: stderr.split("\n").slice(-3).join(" | "),
    };
  }
}

async function readBack(scope) {
  const url =
    scope === "workforce"
      ? `${API_BASE}/performance`
      : `${API_BASE}/projects/${encodeURIComponent(scope)}/performance`;
  try {
    const res = await fetch(url);
    if (!res.ok) return { scope, reachable: false, status: res.status };
    const s = await res.json();
    return {
      scope,
      reachable: true,
      lifecycle: {
        points: s.lifecycle?.length ?? 0,
        last_date: s.lifecycle?.at?.(-1)?.date ?? null,
      },
      pr: {
        points: s.pr_daily?.length ?? 0,
        last_date: s.pr_daily?.at?.(-1)?.date ?? null,
        total_prs: s.pr_summary?.total_prs ?? 0,
      },
      repo: s.repo
        ? {
            updated_at: s.repo.updated_at,
            freshness: freshness(s.repo.updated_at),
            repos: s.repo.repos ?? [],
            degraded_signals: s.repo.degraded_signals ?? [],
          }
        : null,
    };
  } catch (err) {
    return { scope, reachable: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function main() {
  const DAYS = String(arg("days", 90));
  const TABLE = String(arg("table", process.env.TABLE_NAME || "wf-table-prod"));
  const REGION = String(arg("region", process.env.AWS_REGION || "us-west-2"));
  const OUT = String(arg("out", "/tmp/performance-refresh-report.json"));
  const dry = process.argv.includes("--dry-run");

  const projectScopes = repoScopes();
  if (projectScopes.length === 0) {
    console.error("refresh.mjs: no project scopes with a GitHub repo — nothing to refresh");
    return 3;
  }
  process.env.AWS_REGION = REGION;

  // The workforce aggregate scope rides on the agent-workforce project's repo
  // and credential, but publishes under scope "workforce" — see the constant's
  // note above; omitting it leaves the console's default deck frozen.
  const wfSource = projectScopes.find((s) => s.scope === WORKFORCE_SCOPE_SOURCE_PROJECT);
  const scopes = [
    ...(wfSource
      ? [{ scope: WORKFORCE_SCOPE, repo: wfSource.repo, tokenProject: WORKFORCE_SCOPE_SOURCE_PROJECT }]
      : []),
    ...projectScopes.map((s) => ({ ...s, tokenProject: s.scope })),
  ];
  if (!wfSource) {
    console.error(
      `refresh.mjs: WARN project "${WORKFORCE_SCOPE_SOURCE_PROJECT}" not found — the workforce-scope PR block will NOT refresh`,
    );
  }

  // H4: one infrastructure fault must not render as N project gaps. Probe the
  // identity once; if it is absent, that IS the finding — fail the whole run
  // with a single line instead of blaming every project's secret in turn.
  if (!dry) {
    const identity = await assertAwsIdentity(REGION);
    if (!identity.ok) {
      const msg =
        `refresh.mjs: no AWS identity available to this fire (${identity.error}) — ` +
        `cannot resolve any wf/projects/*/github.token. This is ONE infrastructure condition, ` +
        `not ${scopes.length} missing project secrets: do not provision secrets in response to this.`;
      console.error(msg);
      writeFileSync(
        OUT,
        `${JSON.stringify(
          {
            generated_at: new Date().toISOString(),
            fatal: "aws-identity-absent",
            detail: identity.error,
            scopes: scopes.map((s) => s.scope),
            legs: [],
            observed: [],
            verdict: { failed: ["aws-identity-absent"], degraded: [], stale_repo_scopes: [], missing_repo_scopes: [], lifecycle_last_dates: {} },
          },
          null,
          2,
        )}\n`,
      );
      return 3;
    }
  }

  const legs = [];

  // 1. PR metrics, per scope (each needs its own repo + its own PAT).
  for (const { scope, repo, tokenProject } of scopes) {
    let token;
    if (!dry) {
      try {
        token = await resolveGithubToken(tokenProject, REGION);
      } catch (err) {
        // Identity was proven present above, so an auth-class error here means
        // it was revoked mid-run — again one fault, not a per-project gap.
        if (isNoIdentityError(err)) {
          console.error(
            `refresh.mjs: AWS identity lost mid-run at scope "${scope}" (${err?.name}) — aborting rather than reporting per-project gaps`,
          );
          return 3;
        }
        // Otherwise: this scope's secret genuinely is not provisioned. A real,
        // reportable gap — never a silent skip that reads as "no activity".
        legs.push({
          label: `pr:${scope}`,
          ok: false,
          error: `token unresolved: ${err instanceof Error ? err.message : String(err)}`,
        });
        continue;
      }
    }
    legs.push(
      run(`pr:${scope}`, join(ROOT, "workforce/scripts/build-pr-metrics-github.mjs"), [
        "--repo", repo,
        "--scope", scope,
        "--days", DAYS,
        "--publish-ddb",
        "--table", TABLE,
      ], { dry, env: token ? { GITHUB_TOKEN: token } : undefined }),
    );
  }

  // 2. Repository activity — one pass writes every scope + the aggregate.
  legs.push(
    run("repo:all", join(ROOT, "workforce/scripts/build-repo-performance.mjs"), [
      "--days", DAYS,
      "--publish-ddb",
      "--table", TABLE,
      "--region", REGION,
    ], { dry }),
  );

  // 3. Read back what the console will actually serve.
  // `scopes` already leads with the workforce aggregate, so no need to prepend
  // it again (doing so double-fetched it and made the report ambiguous).
  const observed = dry ? [] : await Promise.all(scopes.map((s) => s.scope).map(readBack));

  const failedLegs = legs.filter((l) => !l.ok);
  const degradedLegs = legs.filter((l) => l.degraded);
  const report = {
    generated_at: new Date().toISOString(),
    days: Number(DAYS),
    table: TABLE,
    scopes: scopes.map((s) => s.scope),
    legs,
    observed,
    // The three questions the agent's note must answer.
    verdict: {
      failed: failedLegs.map((l) => l.label),
      degraded: degradedLegs.map((l) => l.label),
      stale_repo_scopes: observed
        .filter((o) => o.repo?.freshness?.state === "stale")
        .map((o) => o.scope),
      missing_repo_scopes: observed.filter((o) => o.reachable && !o.repo).map((o) => o.scope),
      lifecycle_last_dates: Object.fromEntries(
        observed.filter((o) => o.reachable).map((o) => [o.scope, o.lifecycle?.last_date ?? null]),
      ),
    },
  };

  writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
  console.error(
    `refresh.mjs: ${legs.length} leg(s) — ${failedLegs.length} failed, ${degradedLegs.length} degraded; report -> ${OUT}`,
  );

  if (legs.every((l) => !l.ok)) return 3;
  return failedLegs.length > 0 || degradedLegs.length > 0 ? 2 : 0;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  process.exit(await main());
}
