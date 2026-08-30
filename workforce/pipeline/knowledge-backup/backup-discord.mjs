#!/usr/bin/env node
// Discord -> knowledge-store daily backup (Layer 1 ingest, ADR-0026).
//
// Deterministic: no LLM, no judgment, no persona. Reads one closed UTC day of
// messages from every channel the bot can see and commits a markdown day-log
// (plus a lossless JSON sidecar) to the knowledge-store repository as ONE
// commit. Re-running the same day is a no-op — see lib/github-store.mjs.
//
// Usage:
//   node workforce/pipeline/knowledge-backup/backup-discord.mjs \
//     [--since YYYYMMDDTHHMMSS] [--until YYYYMMDDTHHMMSS] [--dry-run]
//
// Env (all required unless noted):
//   DISCORD_BOT_TOKEN      bot token with the Message Content intent
//   DISCORD_SERVER_ID      guild id to walk
//   KNOWLEDGE_REPO         "owner/name" of the knowledge store
//   KNOWLEDGE_REPO_TOKEN   token with contents:write on that repo
//   KNOWLEDGE_REPO_BRANCH  optional, defaults to "main"
//
// Exit codes:
//   0  committed, or nothing to commit
//   1  configuration / upstream failure (fail loud, C-4)

import { ensureProxyAwareEntry } from "../../../scripts/lib/proxy-bootstrap.mjs";
ensureProxyAwareEntry(import.meta.url);

import { parseArgs, requireEnv } from "./lib/env.mjs";
import { resolveWindow, dayKey } from "./lib/window.mjs";
import { DiscordClient, scrapeGuild } from "./lib/discord.mjs";
import { renderDiscordDayLog } from "./lib/markdown.mjs";
import { commitFiles } from "./lib/github-store.mjs";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = Boolean(args["dry-run"]);

  const { since, until } = resolveWindow({ since: args.since, until: args.until });
  const day = dayKey(since);
  console.log(`Discord backup — window ${since.toISOString()} .. ${until.toISOString()} (day ${day})`);

  const client = new DiscordClient(requireEnv("DISCORD_BOT_TOKEN"));
  const scrape = await scrapeGuild(client, requireEnv("DISCORD_SERVER_ID"), since, until);
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
    {
      path: `discord/${year}/${month}/${day}.md`,
      content: renderDiscordDayLog(scrape, day),
    },
    {
      path: `discord/raw/${year}/${month}/${day}.json`,
      content: `${JSON.stringify(scrape, null, 2)}\n`,
    },
  ];

  const result = await commitFiles({
    repo: requireEnv("KNOWLEDGE_REPO"),
    token: requireEnv("KNOWLEDGE_REPO_TOKEN"),
    branch: process.env.KNOWLEDGE_REPO_BRANCH || "main",
    files,
    message: `discord: ${day} (${scrape.total_messages} messages, ${scrape.channels.length} channels)`,
    dryRun,
  });

  console.log(
    result.committed ? `committed ${result.sha}` : `no commit — ${result.reason}`,
  );
}

main().catch((err) => {
  console.error(`✗ discord backup failed: ${err.message}`);
  process.exitCode = 1;
});
