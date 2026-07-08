#!/usr/bin/env node
// vp-monthly-report/post.mjs — deterministic write for the "vp-monthly-report"
// Cadence. A VP letter is the same artefact class as the President's monthly
// letter: same unified Articles DB, same `Monthly Report` series tag, same
// Type=report, same W-1 editorial guards, same chunked block append. The write
// contract is therefore OWNED by workforce/skills/monthly-report/post.mjs (the
// canonical monthly-letter write) and this script only forwards to it — a thin
// wrapper, not a copy, so the W-1 guard never forks into drifting copies
// (the exact failure class newsletter/docs/architecture-source-of-truth.md
// exists to prevent). C3-cadence-write-script is satisfied by this file; the
// guard logic stays single-sourced.
//
// The two letters differ only in judgment (SKILL.md), not in write shape:
// Author=<vp slug> and the H1 title's 「— ○○編」 distinguish the VP series
// inside the shared `Monthly Report` tag.
//
// Usage (identical CLI to monthly-report/post.mjs):
//   NOTION_API_KEY="<credentials['notion.integration_token'].apiKey>" \
//     node workforce/skills/vp-monthly-report/post.mjs \
//       --agent dario \
//       --body-file /tmp/vp-monthly-report-body.md \
//       [--abstract-file /tmp/abstract.txt] [--tags "..."] [--status published]
//
// Exit codes: forwarded verbatim from monthly-report/post.mjs
//   0 created | 1 bad args | 2 W-1 guard / auth | 3 Notion API error.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const CANONICAL = join(HERE, "..", "monthly-report", "post.mjs");

const res = spawnSync(process.execPath, [CANONICAL, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
});
if (res.error) {
  console.error(`vp-monthly-report/post.mjs: failed to spawn canonical writer ${CANONICAL}: ${res.error.message}`);
  process.exit(3);
}
process.exit(res.status ?? 3);
