#!/usr/bin/env node
// Emit the set of (project × source) backup runs as a GitHub Actions matrix.
//
// The workflow can't read workforce/projects/**/knowledge-backup.json in an
// expression, so this script is the bridge: it loads and VALIDATES every
// project config, then prints one matrix row per enabled source. Validation
// happening here means a malformed config fails the discover job with a named
// cause, before any credential is injected into a runner.
//
// Each row carries the *names* of the secrets that row needs, never values —
// the workflow resolves them through the `secrets` context.
//
// Usage:
//   node workforce/pipeline/knowledge-backup/plan.mjs            # JSON matrix
//   node workforce/pipeline/knowledge-backup/plan.mjs --human    # readable
//   node workforce/pipeline/knowledge-backup/plan.mjs --project X  # one project
//
// Exit codes:
//   0  a matrix was printed (possibly empty — no project opts in yet)
//   1  a config is malformed (fail loud, C-4)

import { parseArgs } from "./lib/env.mjs";
import { loadAllProjects, loadProject } from "./lib/projects.mjs";

export function buildMatrix(projects) {
  const rows = [];
  for (const project of projects) {
    if (project.status === "paused") continue;
    const base = {
      project: project.projectId,
      store: project.store.repo,
      branch: project.store.branch,
      store_token_secret: project.env.storeToken,
    };
    if (project.discord) {
      rows.push({ ...base, source: "discord", source_secret: project.env.discordBotToken });
    }
    if (project.notion) {
      rows.push({ ...base, source: "notion", source_secret: project.env.notionApiKey });
    }
  }
  return rows;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const projects =
    typeof args.project === "string" ? [loadProject(args.project)] : loadAllProjects();
  const rows = buildMatrix(projects);

  if (args.human) {
    if (rows.length === 0) {
      console.log("no project declares a knowledge backup yet");
      return;
    }
    for (const row of rows) {
      console.log(`${row.project.padEnd(24)} ${row.source.padEnd(8)} -> ${row.store}#${row.branch}`);
    }
    return;
  }

  console.log(JSON.stringify(rows));
}

// Only run when invoked directly, so the tests can import buildMatrix.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (err) {
    console.error(`✗ knowledge-backup plan failed: ${err.message}`);
    process.exitCode = 1;
  }
}
