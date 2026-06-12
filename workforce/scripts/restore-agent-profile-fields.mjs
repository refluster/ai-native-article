#!/usr/bin/env node
// restore-agent-profile-fields.mjs — one-shot repair for the ADR-0007
// step-6a write-through miss.
//
// What happened: step 6a (PR #293) taught wf-seed-agents to copy the
// profile blocks (owner_email / jd / identity / experience / memory) and
// the org edges (reports_to / lateral, formerly _org.json) onto the
// AGENT#{slug}/META rows. But the seed's two-master interregnum guard
// skipped every row already stamped config_owner="ddb" — which by then
// was ALL of them — so the new fields never landed in DDB. Step 6b
// (PR #294) deleted the seed and the git tree, leaving the manifest to
// build a flat org (every agent depth 0) from `reports_to ?? []`.
//
// What this does: for each agent present in the last pre-deletion git
// snapshot, PATCH the missing fields through wf-agents-api — the single
// writer per ADR-0007 — so every write passes the S14/S17/S18/G3
// validators and lands an AUDIT# row (actor "operator"). DDB stays the
// source of truth; the git snapshot is one-shot repair input, not a
// revived mirror.
//
// Idempotent: a field already present (non-null) on the row is left
// alone unless --force is given; agents with nothing missing are
// skipped. Fail loud (W-4): any non-200 PATCH is reported and the
// script exits non-zero.
//
// Usage (operator machine, AWS creds in scope — aws-vault / SSO / env):
//   node workforce/scripts/restore-agent-profile-fields.mjs [stage] [flags]
//     stage        dev | prod (default: prod)
//     --dry-run    print the would-be patches, write nothing
//     --force      overwrite present fields from the snapshot too
//     --agents a,b restrict to a comma-separated slug list
//
// After a prod run, redeploy the console so the manifest rebuilds from
// the repaired rows:
//   gh workflow run deploy-workforce-console.yml
//
// Requires: `aws` CLI on PATH, run from a checkout of this repo (the
// snapshot is read via `git show`).

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Last commit that still carries workforce/agents/** + _org.json — the
// parent of the step-6b deletion commit (PR #294). Immutable history;
// pinning the full SHA keeps the repair input reproducible.
const SNAPSHOT_SHA = "c4e0422a436730c10ce3d97013729a54b3127b50";

// The seven fields step 6a moved onto the META row.
const PROFILE_FIELDS = ["owner_email", "jd", "identity", "experience", "memory"];
const EDGE_FIELDS = ["reports_to", "lateral"];

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");

const args = process.argv.slice(2);
const stage = (args.find((a) => !a.startsWith("--")) ?? "prod").trim();
if (!/^(dev|prod)$/.test(stage)) {
  console.error(`Invalid stage "${stage}". Expected dev or prod.`);
  process.exit(2);
}
const dryRun = args.includes("--dry-run");
const force = args.includes("--force");
const agentsFlagIdx = args.indexOf("--agents");
const onlyAgents =
  agentsFlagIdx !== -1 && args[agentsFlagIdx + 1]
    ? args[agentsFlagIdx + 1].split(",").map((s) => s.trim()).filter(Boolean)
    : null;

const functionName = `wf-agents-api-${stage}`;
const region = process.env.AWS_REGION ?? "us-west-2";
const tmp = mkdtempSync(join(tmpdir(), "wf-restore-profile-"));

function gitShow(path) {
  return execFileSync("git", ["show", `${SNAPSHOT_SHA}:${path}`], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
}

function snapshotSlugs() {
  const entries = execFileSync(
    "git",
    ["ls-tree", "--name-only", `${SNAPSHOT_SHA}:workforce/agents`],
    { cwd: REPO_ROOT, encoding: "utf8" },
  )
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => /^[a-z]+$/.test(s));
  if (entries.length === 0) {
    throw new Error(`no agent dirs under ${SNAPSHOT_SHA}:workforce/agents — wrong snapshot?`);
  }
  return entries;
}

/** Invoke wf-agents-api with a synthesized API GW HTTP API v2 event —
 *  the same handler the live routes run, so validation + audit apply. */
function invokeRoute(method, slug, body) {
  const event = {
    version: "2.0",
    routeKey: `${method} /agents/{slug}`,
    rawPath: `/agents/${slug}`,
    pathParameters: { slug },
    requestContext: { http: { method, path: `/agents/${slug}` } },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };
  const payloadPath = join(tmp, `payload-${method}-${slug}.json`);
  const outPath = join(tmp, `out-${method}-${slug}.json`);
  writeFileSync(payloadPath, JSON.stringify(event));
  execFileSync(
    "aws",
    [
      "lambda", "invoke",
      "--function-name", functionName,
      "--region", region,
      "--invocation-type", "RequestResponse",
      "--cli-binary-format", "raw-in-base64-out",
      "--payload", `file://${payloadPath}`,
      outPath,
    ],
    { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" },
  );
  const raw = JSON.parse(readFileSync(outPath, "utf8"));
  if (raw?.errorMessage) {
    throw new Error(`${functionName} threw: ${raw.errorMessage}`);
  }
  return { statusCode: raw.statusCode, body: raw.body ? JSON.parse(raw.body) : undefined };
}

const org = JSON.parse(gitShow("workforce/agents/_org.json")).topology ?? {};
const slugs = (onlyAgents ?? snapshotSlugs()).sort();

console.log(
  `restore-agent-profile-fields: ${slugs.length} agent(s), stage=${stage}, snapshot=${SNAPSHOT_SHA.slice(0, 7)}${dryRun ? ", DRY-RUN" : ""}${force ? ", FORCE" : ""}`,
);

let patched = 0;
let skipped = 0;
const failures = [];

for (const slug of slugs) {
  let snapshot;
  try {
    snapshot = JSON.parse(gitShow(`workforce/agents/${slug}/agent.json`));
  } catch {
    failures.push({ slug, reason: `no agent.json in snapshot for "${slug}"` });
    continue;
  }

  const current = invokeRoute("GET", slug);
  if (current.statusCode !== 200) {
    failures.push({ slug, reason: `GET -> HTTP ${current.statusCode} (row missing in DDB?)` });
    continue;
  }
  const row = current.body;

  const patch = {};
  for (const f of PROFILE_FIELDS) {
    const snapVal = snapshot[f] ?? null;
    if (snapVal === null) continue; // nothing to restore
    if (force || row[f] === undefined || row[f] === null) patch[f] = snapVal;
  }
  for (const f of EDGE_FIELDS) {
    const snapVal = org[slug]?.[f] ?? [];
    if (force || row[f] === undefined) patch[f] = snapVal;
  }

  const fields = Object.keys(patch);
  if (fields.length === 0) {
    console.log(`  ${slug}: complete — nothing missing, skipped`);
    skipped += 1;
    continue;
  }

  if (dryRun) {
    console.log(`  ${slug}: would PATCH [${fields.join(", ")}]`);
    patched += 1;
    continue;
  }

  const res = invokeRoute("PATCH", slug, patch);
  if (res.statusCode === 200) {
    console.log(`  ${slug}: PATCHed [${fields.join(", ")}]`);
    patched += 1;
  } else {
    failures.push({
      slug,
      reason: `PATCH -> HTTP ${res.statusCode}: ${JSON.stringify(res.body)}`,
    });
  }
}

console.log(
  `\ndone: ${patched} ${dryRun ? "to patch" : "patched"}, ${skipped} already complete, ${failures.length} failed`,
);
if (failures.length > 0) {
  for (const f of failures) console.error(`  FAIL ${f.slug}: ${f.reason}`);
  process.exit(1);
}
if (!dryRun && patched > 0) {
  console.log(
    "\nNext: redeploy the console so the manifest rebuilds from the repaired rows:\n  gh workflow run deploy-workforce-console.yml",
  );
}
