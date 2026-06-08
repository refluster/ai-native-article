#!/usr/bin/env node
// Detects drift between *declared* project membership (version control:
// workforce/projects/{id}/project.json:members[]) and *runtime* membership
// (the DDB PROJECT#{id}/MEMBER#{slug} rows that actually gate writes).
//
// Why this exists (the failure it would have caught):
//   project.json:members[] is declared intent. The runtime authz source is
//   the MEMBER# rows, written ONLY by `seed-projects.mjs` run by hand. On
//   2026-06-07 five agents (theo, vikram, noor, aanya, elena) were added to
//   agent-workforce/project.json but seed-projects was never re-run, so
//   their MEMBER# rows never existed. Every engagement write for them
//   returned 403 not_a_member for ~8h — their work silently absent from the
//   track record (a C-4 "fail loud, not silent" violation). Nothing detected
//   the gap. This check is that detector.
//
// Why SCHEDULED, not a pre-merge PR gate:
//   Runtime membership only catches up to a project.json edit AFTER the post-
//   merge `seed-projects` step runs. So a pre-merge comparison would FALSE-
//   POSITIVE on the very PR that adds a member (declared, not-yet-seeded).
//   The real failure mode is drift that PERSISTS untouched by any PR — which
//   a periodic run catches and a PR gate cannot. Mirrors the cadence of
//   check-api-routes.mjs (a between-deploys drift sentinel).
//
// Read-only: issues a public `GET {API_BASE}/projects/{id}/members` per
// active project. No AWS credentials, no secrets, no writes.
//
// Usage:
//   node workforce/scripts/check-project-membership-drift.mjs [--project <id>]
//   WF_AGENTS_API_BASE=https://<host>/<stage> node ...   # override prod host
//   WF_MEMBERSHIP_DRIFT_ALLOW_OFFLINE=1 node ...          # network error -> warn, not fail
//
// Exit codes:
//   0  — every active project's declared members[] matches runtime membership.
//   1  — drift found (declared-but-unseeded and/or seeded-but-undeclared).
//   2  — could not reach the API (unless WF_MEMBERSHIP_DRIFT_ALLOW_OFFLINE=1),
//        or a usage/IO error. A check that cannot read runtime fails loud
//        rather than passing green having verified nothing.

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const WORKFORCE_ROOT = join(HERE, "..");
const REPO_ROOT = join(WORKFORCE_ROOT, "..");
const PROJECTS_DIR = join(WORKFORCE_ROOT, "projects");

// Same wf-agents-api host the skills' write scripts target (post-feed.mjs
// DEFAULT_API_URL). Stable across SAM updates of the same stack; edit here
// if the stack id/stage changes.
const DEFAULT_API_BASE =
  "https://sjhikazsf9.execute-api.us-west-2.amazonaws.com/prod";
const API_BASE = (process.env.WF_AGENTS_API_BASE ?? DEFAULT_API_BASE).replace(/\/+$/, "");
const ALLOW_OFFLINE = process.env.WF_MEMBERSHIP_DRIFT_ALLOW_OFFLINE === "1";

// Members the runtime auto-adds that never appear in project.json members[].
// `_operator` is seeded by the credentials-api on first credential mint
// (credentials-api/handler.ts) and is intentionally not a declared agent.
const SYSTEM_MEMBERS = new Set(["_operator"]);

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

function listProjectFiles() {
  if (!existsSync(PROJECTS_DIR)) return [];
  return readdirSync(PROJECTS_DIR)
    .map((name) => join(PROJECTS_DIR, name))
    .filter((p) => statSync(p).isDirectory())
    .map((dir) => join(dir, "project.json"))
    .filter((f) => existsSync(f));
}

async function liveMembers(projectId) {
  const url = `${API_BASE}/projects/${encodeURIComponent(projectId)}/members`;
  let res;
  try {
    res = await fetch(url, { headers: { accept: "application/json" } });
  } catch (err) {
    throw new OfflineError(`GET ${url} failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (res.status < 200 || res.status >= 300) {
    const body = await res.text().catch(() => "");
    throw new OfflineError(`GET ${url} returned HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json().catch(() => ({}));
  const items = Array.isArray(json.items) ? json.items : [];
  // The endpoint already excludes revoked rows by default.
  return new Set(items.map((r) => r.agent_slug).filter(Boolean));
}

class OfflineError extends Error {}

function diff(declared, live) {
  const missing = [...declared].filter((s) => !live.has(s)).sort(); // declared, not seeded -> the 403 cause
  const extra = [...live]
    .filter((s) => !declared.has(s) && !SYSTEM_MEMBERS.has(s))
    .sort(); // seeded, not in version control
  return { missing, extra };
}

async function main() {
  const only = arg("project");
  const files = listProjectFiles();
  if (files.length === 0) {
    console.log("workforce/projects/: no project.json files; nothing to check.");
    return 0;
  }

  let drifted = 0;
  let checked = 0;
  let offline = 0;

  for (const file of files) {
    const data = JSON.parse(readFileSync(file, "utf8"));
    if (only && data.id !== only) continue;
    if ((data.status ?? "active") !== "active") {
      console.log(`- ${data.id}: status="${data.status}" — skipped (only active projects are gated).`);
      continue;
    }
    const declared = new Set(data.members ?? []);
    let live;
    try {
      live = await liveMembers(data.id);
    } catch (err) {
      if (err instanceof OfflineError) {
        offline++;
        const rel = relative(REPO_ROOT, file);
        if (ALLOW_OFFLINE) {
          console.warn(`- ${data.id}: WARN could not reach runtime (${rel}): ${err.message}`);
          continue;
        }
        console.error(`- ${data.id}: ERROR could not reach runtime: ${err.message}`);
        continue;
      }
      throw err;
    }
    checked++;
    const { missing, extra } = diff(declared, live);
    if (missing.length === 0 && extra.length === 0) {
      console.log(`- ${data.id}: OK (${declared.size} declared, all seeded).`);
      continue;
    }
    drifted++;
    console.error(`- ${data.id}: DRIFT (${relative(REPO_ROOT, file)})`);
    if (missing.length) {
      console.error(
        `    declared but NOT seeded (roster drift; informational only since the membership write-gate was removed 2026-06-08): ${missing.join(", ")}`,
      );
    }
    if (extra.length) {
      console.error(
        `    seeded but NOT in project.json (version-control drift): ${extra.join(", ")}`,
      );
    }
  }

  console.log("");
  if (!ALLOW_OFFLINE && offline > 0) {
    console.error(
      `FAIL — ${offline} project(s) unreachable. A membership check that cannot read runtime fails loud.\n` +
        `       Set WF_MEMBERSHIP_DRIFT_ALLOW_OFFLINE=1 to downgrade unreachability to a warning.`,
    );
    return 2;
  }
  if (drifted > 0) {
    console.error(
      `FAIL — ${drifted} project(s) drifted between project.json and runtime membership.\n` +
        `       Reconcile with:  node workforce/scripts/seed-projects.mjs prod\n` +
        `       (idempotent — existing members no-op; missing ones are added).`,
    );
    return 1;
  }
  console.log(`OK — ${checked} active project(s) in sync (declared members[] == runtime).`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("check-project-membership-drift failed:", err?.message ?? err);
    process.exit(2);
  });
