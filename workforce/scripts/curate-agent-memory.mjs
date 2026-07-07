#!/usr/bin/env node
// curate-agent-memory.mjs — write curated long-term memory blocks onto
// AGENT#{slug}/META rows through wf-agents-api (the single writer per
// ADR-0007, so the S17 profile-block validation + AUDIT# trail apply).
//
// Input: workforce/seed/memory/{slug}.json — operator-approved, grounded
// memory blocks (see that directory's README for the W-2 "one-shot input,
// not a mirror" posture and the no-invented-entries rule).
//
// Merge semantics (append-only by convention, types/agent.ts): the current
// row's entries are kept and input entries with new ids are appended;
// an input entry whose id already exists on the row is skipped. Use
// --replace to overwrite the whole block instead (e.g. to amend wording
// of an already-landed entry). `last_updated` always takes the input
// file's value.
//
// Fail loud (W-4): shape violations, the 16 KB S17 ceiling, and any
// non-200 API response are reported and the script exits non-zero.
//
// Usage (operator machine or the dispatch workflow — AWS creds in scope):
//   node workforce/scripts/curate-agent-memory.mjs [stage] [flags]
//     stage        dev | prod (default: prod)
//     --dry-run    print the would-be memory blocks, write nothing
//     --replace    overwrite the row's memory block instead of merging
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

const MEMORY_KINDS = ["fact", "decision", "preference", "person"];
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
const replace = args.includes("--replace");
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

/** Validate one input file against the AgentMemory shape
 *  (workforce/app/src/types/agent.ts). Returns a list of violations. */
function validateMemory(slug, mem) {
  const v = [];
  if (typeof mem !== "object" || mem === null || Array.isArray(mem)) {
    return [`${slug}: memory must be a plain object`];
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(mem.last_updated ?? "")) {
    v.push(`${slug}: last_updated must be an ISO date (YYYY-MM-DD)`);
  }
  if (!Array.isArray(mem.entries)) {
    v.push(`${slug}: entries must be an array`);
    return v;
  }
  const seen = new Set();
  for (const [i, e] of mem.entries.entries()) {
    const at = `${slug}: entries[${i}]`;
    if (!/^[0-9A-Z]{8}$/.test(e?.id ?? "")) v.push(`${at}.id must be 8 chars of [0-9A-Z]`);
    if (seen.has(e?.id)) v.push(`${at}.id "${e.id}" is duplicated in the file`);
    seen.add(e?.id);
    if (!MEMORY_KINDS.includes(e?.kind)) v.push(`${at}.kind must be one of ${MEMORY_KINDS.join("|")}`);
    if (typeof e?.subject !== "string" || e.subject.split(/\s+/).length > 5 || e.subject.length === 0) {
      v.push(`${at}.subject must be 1-5 words`);
    }
    if (typeof e?.body !== "string" || e.body.length === 0) v.push(`${at}.body must be a non-empty string`);
  }
  if (JSON.stringify(mem).length > PROFILE_BLOCK_MAX_CHARS) {
    v.push(`${slug}: memory block exceeds the ${PROFILE_BLOCK_MAX_CHARS}-char S17 ceiling`);
  }
  return v;
}

const files = readdirSync(SEED_DIR).filter((f) => /^[a-z]+\.json$/.test(f));
const slugs = (onlyAgents ?? files.map((f) => f.replace(/\.json$/, ""))).sort();

console.log(
  `curate-agent-memory: ${slugs.length} agent(s), stage=${stage}${dryRun ? ", DRY-RUN" : ""}${replace ? ", REPLACE" : ""}`,
);

let written = 0;
let unchanged = 0;
const failures = [];

for (const slug of slugs) {
  let input;
  try {
    input = JSON.parse(readFileSync(join(SEED_DIR, `${slug}.json`), "utf8"));
  } catch (err) {
    failures.push({ slug, reason: `unreadable seed file: ${err.message}` });
    continue;
  }
  const violations = validateMemory(slug, input);
  if (violations.length > 0) {
    failures.push({ slug, reason: violations.join("; ") });
    continue;
  }

  const current = invokeRoute("GET", slug);
  if (current.statusCode !== 200) {
    failures.push({ slug, reason: `GET -> HTTP ${current.statusCode} (row missing in DDB?)` });
    continue;
  }
  const existing = current.body?.memory ?? { last_updated: "", entries: [] };
  const existingEntries = Array.isArray(existing.entries) ? existing.entries : [];

  let next;
  if (replace) {
    next = input;
  } else {
    const have = new Set(existingEntries.map((e) => e.id));
    const fresh = input.entries.filter((e) => !have.has(e.id));
    if (fresh.length === 0) {
      console.log(`  ${slug}: all ${input.entries.length} entries already on the row — unchanged`);
      unchanged += 1;
      continue;
    }
    next = { last_updated: input.last_updated, entries: [...existingEntries, ...fresh] };
  }
  if (JSON.stringify(next).length > PROFILE_BLOCK_MAX_CHARS) {
    failures.push({ slug, reason: `merged memory block exceeds the ${PROFILE_BLOCK_MAX_CHARS}-char S17 ceiling` });
    continue;
  }

  if (dryRun) {
    console.log(
      `  ${slug}: would PATCH memory — ${next.entries.length} entries (${existingEntries.length} existing), last_updated ${next.last_updated}`,
    );
    written += 1;
    continue;
  }

  const res = invokeRoute("PATCH", slug, { memory: next });
  if (res.statusCode === 200) {
    console.log(`  ${slug}: PATCHed memory — ${next.entries.length} entries`);
    written += 1;
  } else {
    failures.push({ slug, reason: `PATCH -> HTTP ${res.statusCode}: ${JSON.stringify(res.body)}` });
  }
}

console.log(
  `\ndone: ${written} ${dryRun ? "to write" : "written"}, ${unchanged} unchanged, ${failures.length} failed`,
);
if (failures.length > 0) {
  for (const f of failures) console.error(`  FAIL ${f.slug}: ${f.reason}`);
  process.exit(1);
}
