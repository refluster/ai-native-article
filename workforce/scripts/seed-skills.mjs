#!/usr/bin/env node
// Triggers wf-seed-skills-{stage} via `aws lambda invoke` and prints
// the result. Mirror of seed-agents.mjs but for the skill repository.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const stage = (process.argv[2] ?? "dev").trim();
if (!/^(dev|prod)$/.test(stage)) {
  console.error(`Invalid stage "${stage}". Expected dev or prod.`);
  process.exit(2);
}

const functionName = `wf-seed-skills-${stage}`;
const tmp = mkdtempSync(join(tmpdir(), "wf-seed-skills-"));
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
console.log(`\nSeed OK — ${parsed?.scanned ?? 0} skill(s) scanned: ${summaryStr || "no changes"}.`);
