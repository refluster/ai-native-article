// Tests for the L1→L2 queue plan. Run with `npm run test:scripts`.

import { test } from "node:test";
import assert from "node:assert/strict";

import { planQueue } from "./l1-queue.mjs";

const DAY = 86_400_000;
const now = Date.parse("2026-10-18T12:00:00Z");
const opts = { now, maxAttempts: 5, retryCycles: 2, cooldownMs: 7 * DAY };
const row = (id, attempts, created, lastAttempt = null) => ({ id, attempts, created, lastAttempt });
const ids = (rows) => rows.map((r) => r.id);

test("a declined head row drops behind untried rows instead of stalling the queue", () => {
  // The 2026-10 stall: the oldest row was handed out, skipped, and re-picked forever.
  const { eligible } = planQueue(
    [row("tweet", 1, "2026-10-09"), row("layerx", 0, "2026-10-09T01"), row("cnbc", 0, "2026-10-13")],
    opts,
  );
  assert.deepEqual(ids(eligible), ["layerx", "cnbc", "tweet"]);
});

test("ties on attempts keep oldest-first", () => {
  const { eligible } = planQueue([row("b", 0, "2026-10-02"), row("a", 0, "2026-10-01")], opts);
  assert.deepEqual(ids(eligible), ["a", "b"]);
});

test("a blocked row cools down, then gets another try", () => {
  const recent = new Date(now - 2 * DAY).toISOString();
  const old = new Date(now - 8 * DAY).toISOString();
  const { eligible, cooling } = planQueue(
    [row("cooling", 5, "2026-09-01", recent), row("due", 5, "2026-09-01", old)],
    opts,
  );
  assert.deepEqual(ids(cooling), ["cooling"]);
  assert.deepEqual(ids(eligible), ["due"]);
});

test("retry cycles are bounded", () => {
  const old = new Date(now - 30 * DAY).toISOString();
  const { eligible, retired } = planQueue([row("dead", 7, "2026-08-01", old)], opts);
  assert.deepEqual(ids(eligible), []);
  assert.deepEqual(ids(retired), ["dead"]);
});

test("a cooled-down retry still sorts behind every fresh row", () => {
  const old = new Date(now - 8 * DAY).toISOString();
  const { eligible } = planQueue([row("retry", 5, "2026-08-01", old), row("fresh", 0, "2026-10-17")], opts);
  assert.deepEqual(ids(eligible), ["fresh", "retry"]);
});
