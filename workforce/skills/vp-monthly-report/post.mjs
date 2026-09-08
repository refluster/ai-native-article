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
// One thing this wrapper DOES own: the VP series' structure contract
// (letter-structure.mjs) — the transfer chapter and the parseable hypothesis
// scoreboard that make the series a running research programme instead of a
// monthly restart. That is a series-specific editorial shape, not a second
// copy of W-1, so it lives here and runs BEFORE the forward: a body that
// cannot be scored next month is refused at exit 2 rather than published and
// discovered a month later.
//
// Usage (identical CLI to monthly-report/post.mjs):
//   NOTION_API_KEY="<credentials['notion.integration_token'].apiKey>" \
//     node workforce/skills/vp-monthly-report/post.mjs \
//       --agent dario \
//       --body-file /tmp/vp-monthly-report-body.md \
//       [--abstract-file /tmp/abstract.txt] [--tags "..."] [--status published]
//
// Exit codes: forwarded verbatim from monthly-report/post.mjs
//   0 created | 1 bad args | 2 W-1 guard / VP structure guard / auth | 3 Notion API error.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { checkLetterStructure } from "./letter-structure.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const CANONICAL = join(HERE, "..", "monthly-report", "post.mjs");

// ── VP series structure guard (runs before the canonical write) ────────────
// Arg parsing is intentionally minimal and forgiving: anything malformed is
// left to the canonical writer's own validation (exit 1), so the two scripts
// never disagree about what a bad invocation is.
const bodyFileIdx = process.argv.indexOf("--body-file");
const bodyFile = bodyFileIdx >= 0 ? process.argv[bodyFileIdx + 1] : undefined;
if (bodyFile) {
  let body;
  try {
    body = readFileSync(bodyFile, "utf8");
  } catch {
    body = null; // unreadable → the canonical writer reports it as exit 1
  }
  if (body !== null) {
    const { errors, prev, prevNone, next } = checkLetterStructure(body);
    if (errors.length) {
      console.error("vp-monthly-report/post.mjs: the letter does not carry the VP series structure — refusing to publish:");
      for (const e of errors) console.error(`  - ${e}`);
      console.error(
        "  The series contract (SKILL.md Stage 3): a 「読者の組織にとっての含意」 chapter, and a\n" +
          "  「仮説スコアボード」 section that scores last month's hypotheses and opens 2-3 new ones,\n" +
          "  each with the observation that would refute it. Next month's letter reads its verdicts\n" +
          "  back out of this page, so an unparseable scoreboard breaks the series, not just this letter.",
      );
      process.exit(2);
    }
    const scored = prevNone ? "first letter (no previous hypotheses)" : `${prev.length} previous hypothes(es) scored`;
    console.log(`vp-monthly-report/post.mjs: structure OK — ${scored}, ${next.length} new hypothes(es) opened.`);
  }
}

const res = spawnSync(process.execPath, [CANONICAL, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
});
if (res.error) {
  console.error(`vp-monthly-report/post.mjs: failed to spawn canonical writer ${CANONICAL}: ${res.error.message}`);
  process.exit(3);
}
process.exit(res.status ?? 3);
