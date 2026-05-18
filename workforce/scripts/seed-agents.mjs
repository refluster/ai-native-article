#!/usr/bin/env node
// Triggers the wf-seed-agents-{stage} Lambda and pretty-prints the result.
//
// Use after a fresh `sam deploy` to seed the AGENT#{slug}/META rows from
// the file tree at workforce/agents/{slug}/.
//
// Usage:
//   node workforce/scripts/seed-agents.mjs [stage]      (default: dev)
//
// Requires the operator's AWS credentials to be available (env vars,
// SSO session, or `aws-vault`).

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const stage = (process.argv[2] ?? "dev").trim();
if (!/^(dev|prod)$/.test(stage)) {
  console.error(`Invalid stage "${stage}". Expected dev or prod.`);
  process.exit(2);
}

const functionName = `wf-seed-agents-${stage}`;
const tmp = mkdtempSync(join(tmpdir(), "wf-seed-"));
const outPath = join(tmp, "out.json");

console.log(`Invoking ${functionName} ...`);

try {
  const stderr = execFileSync(
    "aws",
    [
      "lambda",
      "invoke",
      "--function-name",
      functionName,
      "--invocation-type",
      "RequestResponse",
      "--cli-binary-format",
      "raw-in-base64-out",
      outPath,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  // stderr contains the AWS CLI confirmation line "StatusCode: 200"; print
  // it so the operator sees the StatusCode value too.
  if (stderr) process.stderr.write(stderr);
} catch (err) {
  console.error("aws lambda invoke failed:", err.message ?? err);
  process.exit(1);
}

const raw = readFileSync(outPath, "utf8");
let parsed;
try {
  parsed = JSON.parse(raw);
} catch {
  console.error("Lambda returned non-JSON output:");
  console.error(raw);
  process.exit(1);
}

console.log(JSON.stringify(parsed, null, 2));

if (parsed && Array.isArray(parsed.errors) && parsed.errors.length > 0) {
  console.error(`\nSeed completed with ${parsed.errors.length} error(s); exit 1.`);
  process.exit(1);
}

const upserts = parsed?.upserts ?? [];
const summary = upserts.reduce(
  (acc, row) => ({ ...acc, [row.action]: (acc[row.action] ?? 0) + 1 }),
  {},
);
const summaryStr = Object.entries(summary)
  .map(([k, v]) => `${v} ${k}`)
  .join(", ");
console.log(`\nSeed OK — ${parsed?.scanned ?? 0} agent(s) scanned: ${summaryStr || "no changes"}.`);
