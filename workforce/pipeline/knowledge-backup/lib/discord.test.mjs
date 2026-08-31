import { ensureProxyAwareEntry } from "../../../../scripts/lib/proxy-bootstrap.mjs";
ensureProxyAwareEntry(import.meta.url);

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { DiscordClient, normaliseMessage, scrapeGuild } from "./discord.mjs";

const ok = (value) => ({ ok: true, status: 200, headers: new Headers(), text: async () => JSON.stringify(value) });
const err = (status) => ({ ok: false, status, headers: new Headers(), text: async () => "{}" });

const msg = (id, iso) => ({
  id,
  author: { id: "9", username: "kohu", global_name: "Kohu", bot: false },
  content: `m${id}`,
  timestamp: iso,
  attachments: [],
  embeds: [],
  reactions: [],
});

test("normaliseMessage keeps the archival subset and sums reaction counts", () => {
  const n = normaliseMessage({
    ...msg("1", "2026-08-28T07:30:00.000Z"),
    edited_timestamp: "2026-08-28T07:31:00.000Z",
    attachments: [{ filename: "a.png", url: "https://cdn/a.png" }],
    embeds: [{}, {}],
    reactions: [{ count: 2 }, { count: 3 }],
    referenced_message: { id: "0" },
  });
  assert.equal(n.user, "Kohu");
  assert.equal(n.reactions_count, 5);
  assert.equal(n.embeds_count, 2);
  assert.equal(n.reply_to, "0");
  assert.deepEqual(n.attachments, [{ name: "a.png", url: "https://cdn/a.png" }]);
});

test("normaliseMessage survives a missing author and empty content", () => {
  const n = normaliseMessage({ id: "1", timestamp: "2026-08-28T00:00:00.000Z" });
  assert.equal(n.user, "unknown");
  assert.equal(n.content, "");
  assert.equal(n.bot, false);
});

test("fetchMessages stops at the `until` boundary and returns oldest-first", async () => {
  // One page, newest-first as Discord returns it; the last message is past the
  // window end and must be excluded.
  mock.method(globalThis, "fetch", async () =>
    ok([
      msg("3", "2026-08-29T00:30:00.000Z"), // after `until` -> dropped
      msg("2", "2026-08-28T12:00:00.000Z"),
      msg("1", "2026-08-28T01:00:00.000Z"),
    ]),
  );
  const client = new DiscordClient("t");
  const got = await client.fetchMessages("c", new Date("2026-08-28T00:00:00Z"), new Date("2026-08-29T00:00:00Z"));
  assert.deepEqual(got.map((m) => m.id), ["1", "2"]);
  mock.restoreAll();
});

test("fetchMessages pages forward until a short page", async () => {
  const full = Array.from({ length: 100 }, (_, i) =>
    msg(String(200 - i), `2026-08-28T${String(Math.floor(i / 10)).padStart(2, "0")}:00:00.000Z`),
  );
  let call = 0;
  mock.method(globalThis, "fetch", async () => {
    call++;
    return call === 1 ? ok(full) : ok([msg("999", "2026-08-28T23:00:00.000Z")]);
  });
  const client = new DiscordClient("t");
  const got = await client.fetchMessages("c", new Date("2026-08-28T00:00:00Z"), new Date("2026-08-29T00:00:00Z"));
  assert.equal(got.length, 101);
  assert.equal(call, 2);
  mock.restoreAll();
});

function guildStub({ channelResults }) {
  return async (url) => {
    if (url.includes("/threads/active")) return ok({ threads: [] });
    if (/\/guilds\/\d+\/channels/.test(url)) {
      return ok(Object.keys(channelResults).map((id, i) => ({ id, name: `ch${i}`, type: 0, parent_id: null })));
    }
    if (/\/guilds\/\d+$/.test(url)) return ok({ id: "1", name: "Guild" });
    const id = url.match(/\/channels\/(\w+)\//)?.[1];
    const outcome = channelResults[id];
    return outcome === "forbidden" ? err(403) : ok(outcome);
  };
}

test("a forbidden channel is skipped, not fatal", async () => {
  mock.method(
    globalThis,
    "fetch",
    guildStub({ channelResults: { a: "forbidden", b: [msg("1", "2026-08-28T05:00:00.000Z")] } }),
  );
  const scrape = await scrapeGuild(
    new DiscordClient("t"),
    "1",
    new Date("2026-08-28T00:00:00Z"),
    new Date("2026-08-29T00:00:00Z"),
    () => {},
  );
  assert.equal(scrape.total_messages, 1);
  assert.equal(scrape.channels.length, 1);
  assert.deepEqual(scrape.skipped_channels, ["ch0"]);
  mock.restoreAll();
});

test("EVERY channel forbidden is a broken token — fail loud, never an empty day", async () => {
  mock.method(globalThis, "fetch", guildStub({ channelResults: { a: "forbidden", b: "forbidden" } }));
  await assert.rejects(
    () =>
      scrapeGuild(new DiscordClient("t"), "1", new Date("2026-08-28T00:00:00Z"), new Date("2026-08-29T00:00:00Z"), () => {}),
    /bot token is invalid or the bot was never added/,
  );
  mock.restoreAll();
});

test("channels with no messages in the window are omitted from the log", async () => {
  mock.method(globalThis, "fetch", guildStub({ channelResults: { a: [], b: [] } }));
  const scrape = await scrapeGuild(
    new DiscordClient("t"),
    "1",
    new Date("2026-08-28T00:00:00Z"),
    new Date("2026-08-29T00:00:00Z"),
    () => {},
  );
  assert.equal(scrape.channels.length, 0);
  assert.equal(scrape.total_messages, 0);
  mock.restoreAll();
});
