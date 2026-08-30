// Render a scraped Discord day into a markdown day-log.
//
// The luckyhat-ms scraper committed JSON only. JSON is the right *archival*
// shape (lossless, re-processable) but the wrong *reading* shape: the consumer
// of a knowledge store is a person skimming or an agent given the file as
// context, and both read markdown far better than a nested message array. So
// we commit both — markdown as the primary artefact, JSON as the sidecar.

/** YAML-safe scalar: quote and escape anything that could break the block. */
function yamlString(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function timeOfDay(iso) {
  return iso.slice(11, 16);
}

/** Indent continuation lines so a multi-line message stays inside its bullet. */
function indentBody(content) {
  return content
    .split("\n")
    .map((line, i) => (i === 0 ? line : `  ${line}`))
    .join("\n");
}

function renderMessage(message) {
  const parts = [`- **${message.user}** \`${timeOfDay(message.timestamp)}\``];
  if (message.bot) parts[0] += " _(bot)_";

  const body = message.content.trim();
  parts.push(body ? `\n  ${indentBody(body)}` : "\n  _(no text content)_");

  for (const attachment of message.attachments) {
    parts.push(`\n  - 📎 [${attachment.name}](${attachment.url})`);
  }
  if (message.embeds_count > 0) parts.push(`\n  - _${message.embeds_count} embed(s)_`);
  if (message.reactions_count > 0) parts.push(`\n  - _${message.reactions_count} reaction(s)_`);

  return parts.join("");
}

/**
 * @param {object} scrape  the object returned by scrapeGuild()
 * @param {string} day     `YYYY-MM-DD`, the day the window covers
 */
export function renderDiscordDayLog(scrape, day) {
  const frontmatter = [
    "---",
    `source: discord`,
    `server: ${yamlString(scrape.server_name)}`,
    `server_id: ${yamlString(scrape.server_id)}`,
    `day: ${day}`,
    `window_start: ${scrape.start_time}`,
    `window_end: ${scrape.end_time}`,
    `scraped_at: ${scrape.scraped_at}`,
    `total_messages: ${scrape.total_messages}`,
    "---",
    "",
  ];

  const title = [`# Discord — ${scrape.server_name} — ${day}`, ""];

  if (scrape.channels.length === 0) {
    return [...frontmatter, ...title, "_No messages in this window._", ""].join("\n");
  }

  const body = [];
  for (const channel of scrape.channels) {
    const label = channel.isThread ? `#${channel.name} (thread)` : `#${channel.name}`;
    const context = channel.category ? ` · ${channel.category}` : "";
    body.push(`## ${label}${context}`, "");
    for (const message of channel.messages) body.push(renderMessage(message));
    body.push("");
  }

  return [...frontmatter, ...title, ...body].join("\n");
}
