import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveWindow, parseInstant, dayKey, timestampToSnowflake } from "./window.mjs";

test("defaults to the whole of yesterday, UTC", () => {
  const now = new Date("2026-08-29T13:47:00Z");
  const { since, until } = resolveWindow({ now });
  assert.equal(since.toISOString(), "2026-08-28T00:00:00.000Z");
  assert.equal(until.toISOString(), "2026-08-29T00:00:00.000Z");
  assert.equal(dayKey(since), "2026-08-28");
});

test("accepts the compact form inherited from the luckyhat-ms scrapers", () => {
  const { since, until } = resolveWindow({ since: "20260828T130000", until: "20260828T190000" });
  assert.equal(since.toISOString(), "2026-08-28T13:00:00.000Z");
  assert.equal(until.toISOString(), "2026-08-28T19:00:00.000Z");
});

test("accepts ISO-8601 and treats a bare Z instant as UTC", () => {
  assert.equal(parseInstant("2026-08-28T05:00:00Z", "--since").toISOString(), "2026-08-28T05:00:00.000Z");
});

test("--since alone implies a 24h window ending at midnight today", () => {
  const now = new Date("2026-08-29T13:47:00Z");
  const { since, until } = resolveWindow({ since: "20260820T000000", now });
  assert.equal(since.toISOString(), "2026-08-20T00:00:00.000Z");
  assert.equal(until.toISOString(), "2026-08-29T00:00:00.000Z");
});

test("rejects a malformed instant rather than silently defaulting", () => {
  assert.throws(() => resolveWindow({ since: "yesterday" }), /not a valid instant/);
});

test("rejects an inverted window", () => {
  assert.throws(
    () => resolveWindow({ since: "20260828T190000", until: "20260828T130000" }),
    /empty window/,
  );
});

test("snowflake encodes the discord epoch offset in the high bits", () => {
  // The discord epoch itself is snowflake 0.
  assert.equal(timestampToSnowflake(new Date(1420070400000)), "0");
  // One millisecond later is 1 << 22.
  assert.equal(timestampToSnowflake(new Date(1420070400001)), String(1 << 22));
  // Pre-epoch instants clamp to 0 rather than going negative.
  assert.equal(timestampToSnowflake(new Date(0)), "0");
});
