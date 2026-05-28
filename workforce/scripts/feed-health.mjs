#!/usr/bin/env node
// CLI entry for the feed-health sweep — Epic-011 Story 4 (#131).
//
// Calls the same `runFeedHealth()` core as the runner adapter
// (`workforce/skills/feed-health/handler.ts`), but maps the outcome
// to a CLI exit code per SKILL.md:
//
//   0  — clean sweep
//   1  — at least one violation
//   2  — sweep envelope exceeded
//   >10 — unhandled error
//
// Used by .github/workflows/feed-health.yml on the nightly cron and
// the workforce-data-plane post-deploy trigger.
//
// Env vars (required for the default AWS SDK paths):
//   AWS_REGION        — e.g. us-west-2
//   STAGE             — e.g. prod, dev
//   TABLE_NAME        — e.g. wf-table-prod
//   BUCKET_NAME       — e.g. wf-bucket-{acct}-us-west-2-prod
//
// Implementation note: we shell out to `tsx` to run the TypeScript
// handler directly so this CLI doesn't need a build step. CI installs
// tsx alongside the existing lambda-build deps.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const HANDLER = join(HERE, "..", "skills", "feed-health", "run-cli.ts");

const child = spawn("npx", ["--yes", "tsx", HANDLER], {
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`feed-health: killed by signal ${signal}`);
    process.exit(128);
  }
  process.exit(code ?? 11);
});
