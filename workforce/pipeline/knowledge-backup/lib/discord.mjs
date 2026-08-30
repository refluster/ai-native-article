// Discord ingest over the REST API.
//
// The luckyhat-ms scraper used discord.py, which means opening a gateway
// WebSocket, waiting for READY, walking the cached guild, then closing the
// socket. None of that is needed to read history: the REST endpoints accept a
// bot token directly. Dropping the gateway removes the dependency (this file
// has none), removes the WebSocket egress requirement — which matters because
// hosted runners commonly allow HTTPS and nothing else — and removes the
// "client never fired on_ready" hang class entirely.

import { ensureProxyAwareEntry } from "../../../../scripts/lib/proxy-bootstrap.mjs";
ensureProxyAwareEntry(import.meta.url);

import { requestJson, Pacer, HttpError } from "./http.mjs";
import { timestampToSnowflake } from "./window.mjs";

const API = "https://discord.com/api/v10";

// Channel types worth archiving as conversation. 0 = text, 5 = announcement,
// 10/11/12 = threads (announcement/public/private).
const TEXTUAL_CHANNEL_TYPES = new Set([0, 5, 10, 11, 12]);

const MESSAGE_PAGE = 100;

function headers(token) {
  return {
    authorization: `Bot ${token}`,
    "user-agent": "ai-native-article-knowledge-backup",
    "content-type": "application/json",
  };
}

export class DiscordClient {
  constructor(token) {
    this.token = token;
    // Discord's global limit is 50 req/s; we stay far under it and let the
    // 429 handler in requestJson cover per-route buckets.
    this.pacer = new Pacer(10);
  }

  #get(path) {
    return requestJson(`${API}${path}`, { headers: headers(this.token) }, { pacer: this.pacer });
  }

  getGuild(guildId) {
    return this.#get(`/guilds/${guildId}`);
  }

  async listTextChannels(guildId) {
    const channels = await this.#get(`/guilds/${guildId}/channels`);
    const byId = new Map(channels.map((c) => [c.id, c]));
    // Active threads live on a separate endpoint; archived ones are out of
    // scope (a day-log wants live conversation, not the archive).
    const { threads = [] } = await this.#get(`/guilds/${guildId}/threads/active`);

    return [...channels, ...threads]
      .filter((c) => TEXTUAL_CHANNEL_TYPES.has(c.type))
      .map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        isThread: c.type >= 10,
        category: byId.get(c.parent_id)?.name ?? null,
      }));
  }

  /**
   * Every message in [since, until) for one channel, oldest first.
   *
   * `after` paging walks forward from the window start, so the number of
   * requests is proportional to the messages IN the window, not to the
   * channel's history.
   */
  async fetchMessages(channelId, since, until) {
    const untilMs = until.getTime();
    const collected = [];
    let after = timestampToSnowflake(since);

    for (;;) {
      const page = await this.#get(
        `/channels/${channelId}/messages?limit=${MESSAGE_PAGE}&after=${after}`,
      );
      if (page.length === 0) break;

      // `after` paging returns newest-first within the page.
      const ascending = [...page].reverse();
      let reachedEnd = false;
      for (const message of ascending) {
        if (new Date(message.timestamp).getTime() >= untilMs) {
          reachedEnd = true;
          break;
        }
        collected.push(message);
      }
      if (reachedEnd || page.length < MESSAGE_PAGE) break;
      after = ascending[ascending.length - 1].id;
    }

    return collected;
  }
}

/** The subset of a Discord message worth keeping in a durable archive. */
export function normaliseMessage(message) {
  return {
    message_id: message.id,
    user: message.author?.global_name || message.author?.username || "unknown",
    username: message.author?.username ?? null,
    user_id: message.author?.id ?? null,
    bot: Boolean(message.author?.bot),
    content: message.content ?? "",
    timestamp: message.timestamp,
    edited_at: message.edited_timestamp ?? null,
    attachments: (message.attachments ?? []).map((a) => ({ name: a.filename, url: a.url })),
    embeds_count: (message.embeds ?? []).length,
    reactions_count: (message.reactions ?? []).reduce((n, r) => n + (r.count ?? 0), 0),
    reply_to: message.referenced_message?.id ?? null,
  };
}

/**
 * Walk every readable channel in the guild for the window.
 *
 * A channel the bot cannot read is skipped, not fatal — a server almost always
 * has private channels the integration was never invited to. But if EVERY
 * channel is forbidden the token or its scopes are broken, and that must fail
 * loud (C-4) rather than commit an empty day.
 */
export async function scrapeGuild(client, guildId, since, until, log = console.log) {
  const guild = await client.getGuild(guildId);
  const channels = await client.listTextChannels(guildId);
  log(`guild "${guild.name}" — ${channels.length} textual channels`);

  const collected = [];
  const forbidden = [];
  let total = 0;

  for (const channel of channels) {
    let messages;
    try {
      messages = await client.fetchMessages(channel.id, since, until);
    } catch (err) {
      if (err instanceof HttpError && (err.status === 403 || err.status === 401)) {
        forbidden.push(channel.name);
        continue;
      }
      throw err;
    }
    if (messages.length === 0) continue;
    total += messages.length;
    collected.push({ ...channel, messages: messages.map(normaliseMessage) });
    log(`  #${channel.name}: ${messages.length} messages`);
  }

  if (forbidden.length === channels.length && channels.length > 0) {
    throw new Error(
      `every one of the ${channels.length} channels returned 403/401 — the bot token is invalid or the bot was never added to guild ${guildId}`,
    );
  }
  if (forbidden.length > 0) {
    log(`  (skipped ${forbidden.length} channel(s) the bot cannot read: ${forbidden.join(", ")})`);
  }

  return {
    server_name: guild.name,
    server_id: guild.id,
    scraped_at: new Date().toISOString(),
    start_time: since.toISOString(),
    end_time: until.toISOString(),
    total_messages: total,
    skipped_channels: forbidden,
    channels: collected,
  };
}
