#!/usr/bin/env node
import { ensureProxyAwareEntry } from "../../../scripts/lib/proxy-bootstrap.mjs";
ensureProxyAwareEntry(import.meta.url);

// Discord -> knowledge-store daily backup (Layer 1 ingest, ADR-0026),
// scoped to one project (ADR-0028).
//
// Deterministic: no LLM, no judgment, no persona. Reads one closed UTC day of
// messages from every channel the project's bot can see and commits a markdown
// day-log (plus a lossless JSON sidecar) to THAT PROJECT's knowledge store as
// ONE commit. Re-running the same day is a no-op — see lib/github-store.mjs.
//
// Usage:
//   node workforce/pipeline/knowledge-backup/backup-discord.mjs \
//     --project <id> [--since YYYYMMDDTHHMMSS] [--until ...] [--dry-run]
//
// Config: workforce/projects/{id}/knowledge-backup.json (store repo + guild id).
// Credentials come from the env names that config derives — see lib/projects.mjs:
//   KB_{PROJECT}_STORE_TOKEN, KB_{PROJECT}_DISCORD_BOT_TOKEN
//
// Exit codes:
//   0  committed, nothing to commit, or the project's backup is paused
//   1  configuration / upstream failure (fail loud, C-4)

import { parseArgs, requireEnv } from "./lib/env.mjs";
import { resolveWindow, dayKey } from "./lib/window.mjs";
import { loadProject } from "./lib/projects.mjs";
import { DiscordClient, scrapeGuild } from "./lib/discord.mjs";
import { renderDiscordDayLog } from "./lib/markdown.mjs";
import { commitFiles } from "./lib/github-store.mjs";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = Boolean(args["dry-run"]);
  if (typeof args.project !== "string") throw new Error("--project <id> is required");

  const project = loadProject(args.project);
  if (project.status === "paused") {
    console.log(`project ${project.projectId}: backup paused — skipping`);
    return;
  }
  if (!project.discord) {
    console.log(`project ${project.projectId}: no discord source declared — skipping`);
    return;
  }

  const { since, until } = resolveWindow({ since: args.since, until: args.until });
  const day = dayKey(since);
  console.log(
    `Discord backup — project ${project.projectId} -> ${project.store.repo} — window ${since.toISOString()} .. ${until.toISOString()} (day ${day})`,
  );

  const client = new DiscordClient(requireEnv(project.env.discordBotToken));
  const scrape = await scrapeGuild(client, project.discord.server_id, since, until);
  console.log(`collected ${scrape.total_messages} messages across ${scrape.channels.length} channels`);

  // A day with no messages is a real, expected outcome — write nothing rather
  // than commit an empty log. (This is the ingest analogue of a cadence's skip
  // path: producing no artefact is the correct result, not a failure.)
  if (scrape.total_messages === 0) {
    console.log("no messages in window — nothing to commit");
    return;
  }

  const [year, month] = day.split("-");
  const files = [
    { path: `discord/${year}/${month}/${day}.md`, content: renderDiscordDayLog(scrape, day) },
    { path: `discord/raw/${year}/${month}/${day}.json`, content: `${JSON.stringify(scrape, null, 2)}\n` },
  ];

  const result = await commitFiles({
    repo: project.store.repo,
    token: requireEnv(project.env.storeToken),
    branch: project.store.branch,
    files,
    message: `discord: ${day} (${scrape.total_messages} messages, ${scrape.channels.length} channels)`,
    dryRun,
  });

  console.log(result.committed ? `committed ${result.sha}` : `no commit — ${result.reason}`);
}

main().catch((err) => {
  console.error(`✗ discord backup failed: ${err.message}`);
  process.exitCode = 1;
});
