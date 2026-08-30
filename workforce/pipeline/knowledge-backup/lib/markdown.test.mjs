import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDiscordDayLog } from "./markdown.mjs";

const scrape = (channels, total) => ({
  server_name: 'Lucky "Hat"',
  server_id: "123",
  scraped_at: "2026-08-29T00:05:00.000Z",
  start_time: "2026-08-28T00:00:00.000Z",
  end_time: "2026-08-29T00:00:00.000Z",
  total_messages: total,
  skipped_channels: [],
  channels,
});

const message = (over = {}) => ({
  message_id: "1",
  user: "Kohu",
  username: "kohu",
  user_id: "9",
  bot: false,
  content: "hello",
  timestamp: "2026-08-28T07:30:00.000Z",
  edited_at: null,
  attachments: [],
  embeds_count: 0,
  reactions_count: 0,
  reply_to: null,
  ...over,
});

test("renders frontmatter, channel sections and messages", () => {
  const md = renderDiscordDayLog(
    scrape([{ id: "c", name: "general", category: "Ops", isThread: false, messages: [message()] }], 1),
    "2026-08-28",
  );
  assert.match(md, /^---\nsource: discord\n/);
  assert.match(md, /day: 2026-08-28/);
  assert.match(md, /total_messages: 1/);
  assert.match(md, /## #general · Ops/);
  assert.match(md, /- \*\*Kohu\*\* `07:30`/);
  assert.match(md, /\n {2}hello/);
});

test("escapes quotes in the server name so the frontmatter stays parseable", () => {
  const md = renderDiscordDayLog(scrape([], 0), "2026-08-28");
  assert.match(md, /server: "Lucky \\"Hat\\""/);
});

test("indents continuation lines to keep a multi-line message in its bullet", () => {
  const md = renderDiscordDayLog(
    scrape([{ id: "c", name: "g", category: null, isThread: false, messages: [message({ content: "one\ntwo" })] }], 1),
    "2026-08-28",
  );
  assert.match(md, /\n {2}one\n {2}two/);
});

test("marks threads, bots, attachments and reactions", () => {
  const md = renderDiscordDayLog(
    scrape(
      [
        {
          id: "t",
          name: "design-thread",
          category: null,
          isThread: true,
          messages: [
            message({
              bot: true,
              content: "",
              attachments: [{ name: "spec.pdf", url: "https://cdn/spec.pdf" }],
              reactions_count: 3,
              embeds_count: 1,
            }),
          ],
        },
      ],
      1,
    ),
    "2026-08-28",
  );
  assert.match(md, /## #design-thread \(thread\)/);
  assert.match(md, /_\(bot\)_/);
  assert.match(md, /_\(no text content\)_/);
  assert.match(md, /📎 \[spec\.pdf\]\(https:\/\/cdn\/spec\.pdf\)/);
  assert.match(md, /_1 embed\(s\)_/);
  assert.match(md, /_3 reaction\(s\)_/);
});

test("an empty day still renders a valid document", () => {
  const md = renderDiscordDayLog(scrape([], 0), "2026-08-28");
  assert.match(md, /_No messages in this window\._/);
});
