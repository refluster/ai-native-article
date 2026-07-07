#!/usr/bin/env node
// curate-agent-memory.mjs — write curated semantic MEMORY.md documents onto
// AGENT#{slug}/META rows through wf-agents-api (the single writer per
// ADR-0007, so the S17 profile-block validation + AUDIT# trail apply).
//
// Decision record: ADR-0019 (agent semantic memory). Input:
// workforce/seed/memory/{slug}.md — operator-approved, grounded,
// semantic-level memory documents (see that directory's README for the W-2
// "one-shot input, not a mirror" posture and the content rules).
//
// Write semantics: whole-document replace. The MEMORY.md document is the
// curation unit — unlike the retired entries[] deck there is no id-level
// merge; re-running with an unchanged file is a no-op (the API's diff
// check writes nothing and audits nothing).
//
// Fail loud (W-4): a malformed document, the 16 KB S17 ceiling, and any
// non-200 API response are reported and the script exits non-zero.
//
// Usage (operator machine or the dispatch workflow — AWS creds in scope):
//   node workforce/scripts/curate-agent-memory.mjs [stage] [flags]
//     stage        dev | prod (default: prod)
//     --dry-run    print the would-be memory blocks, write nothing
//     --agents a,b restrict to a comma-separated slug list
//
// After a prod run the console needs no redeploy — the profile page
// hydrates memory live from GET /agents/{slug}.

import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Mirrors PROFILE_BLOCK_MAX_CHARS in workforce/lambdas/shared/agent-config.ts
// so a too-big block fails here with a named reason instead of a raw S17
// violation from the API.
const PROFILE_BLOCK_MAX_CHARS = 16 * 1024;

const HERE = dirname(fileURLToPath(import.meta.url));
const SEED_DIR = join(HERE, "..", "seed", "memory");

const args = process.argv.slice(2);
const stage = (args.find((a) => !a.startsWith("--")) ?? "prod").trim();
if (!/^(dev|prod)$/.test(stage)) {
  console.error(`Invalid stage "${stage}". Expected dev or prod.`);
  process.exit(2);
}
const dryRun = args.includes("--dry-run");
const agentsFlagIdx = args.indexOf("--agents");
const onlyAgents =
  agentsFlagIdx !== -1 && args[agentsFlagIdx + 1]
    ? args[agentsFlagIdx + 1].split(",").map((s) => s.trim()).filter(Boolean)
    : null;

const functionName = `wf-agents-api-${stage}`;
const region = process.env.AWS_REGION ?? "us-west-2";
const tmp = mkdtempSync(join(tmpdir(), "wf-curate-memory-"));

/** Invoke wf-agents-api with a synthesized API GW HTTP API v2 event —
 *  the same handler the live routes run, so validation + audit apply.
 *  (Same pattern as restore-agent-profile-fields.mjs.) */
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

/** Validate one MEMORY.md against the seed/memory README contract.
 *  Returns { violations, last_updated }. */
function validateMemoryDoc(slug, body) {
  const violations = [];
  if (!/^# MEMORY — /m.test(body)) {
    violations.push(`${slug}: missing "# MEMORY — <Name> (<Role>)" title`);
  }
  const curated = body.match(/Curated:\s*(\d{4}-\d{2}-\d{2})/);
  if (!curated) {
    violations.push(`${slug}: missing machine-readable "Curated: YYYY-MM-DD" token`);
  }
  if (!/^## Mission anchor$/m.test(body)) {
    violations.push(`${slug}: missing "## Mission anchor" section (the MVV anchor is mandatory)`);
  }
  if (body.trim().length < 200) {
    violations.push(`${slug}: body suspiciously short (<200 chars) — refuse to write a hollow memory`);
  }
  if (body.length > PROFILE_BLOCK_MAX_CHARS) {
    violations.push(`${slug}: body exceeds the ${PROFILE_BLOCK_MAX_CHARS}-char S17 ceiling`);
  }
  return { violations, last_updated: curated?.[1] ?? null };
}

const files = readdirSync(SEED_DIR).filter((f) => /^[a-z]+\.md$/.test(f) && f !== "readme.md");
const slugs = (onlyAgents ?? files.map((f) => f.replace(/\.md$/, ""))).sort();

console.log(
  `curate-agent-memory: ${slugs.length} agent(s), stage=${stage}${dryRun ? ", DRY-RUN" : ""}`,
);

let written = 0;
const failures = [];

for (const slug of slugs) {
  let body;
  try {
    body = readFileSync(join(SEED_DIR, `${slug}.md`), "utf8");
  } catch (err) {
    failures.push({ slug, reason: `unreadable seed file: ${err.message}` });
    continue;
  }
  const { violations, last_updated } = validateMemoryDoc(slug, body);
  if (violations.length > 0) {
    failures.push({ slug, reason: violations.join("; ") });
    continue;
  }

  const memory = { last_updated, body };
  if (JSON.stringify(memory).length > PROFILE_BLOCK_MAX_CHARS) {
    failures.push({ slug, reason: `serialized memory block exceeds the ${PROFILE_BLOCK_MAX_CHARS}-char S17 ceiling` });
    continue;
  }

  if (dryRun) {
    console.log(
      `  ${slug}: would PATCH memory — ${body.length} chars, curated ${last_updated}`,
    );
    written += 1;
    continue;
  }

  const res = invokeRoute("PATCH", slug, { memory });
  if (res.statusCode === 200) {
    console.log(`  ${slug}: PATCHed memory — ${body.length} chars, curated ${last_updated}`);
    written += 1;
  } else {
    failures.push({ slug, reason: `PATCH -> HTTP ${res.statusCode}: ${JSON.stringify(res.body)}` });
  }
}

console.log(
  `\ndone: ${written} ${dryRun ? "to write" : "written"}, ${failures.length} failed`,
);
if (failures.length > 0) {
  for (const f of failures) console.error(`  FAIL ${f.slug}: ${f.reason}`);
  process.exit(1);
}
