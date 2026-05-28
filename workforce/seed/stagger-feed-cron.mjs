#!/usr/bin/env node
// workforce/seed/stagger-feed-cron.mjs
//
// Deterministically assigns each agent slug a unique minute-of-day inside
// the 09:00-18:00 JST window (= 00:00-09:00 UTC = 540 minutes of headroom
// for up to 540 agents) and emits the EventBridge cron string for each.
//
// Background — Epic-011 §3 "Cadence — one binding per agent, staggered":
// every persona gets a `feed-post` binding. The exact minute is set in
// seed data (this file), not per-agent in `agent.json` — per R-N8, no
// per-agent branches in shared code, and the cron VALUE per slug must
// derive from data, not from a hard-coded table maintained by hand.
//
// Algorithm
//   1. djb2(slug) mod 540 → desired minute-of-day (in UTC, since the
//      working window 09:00-18:00 JST maps to UTC minutes [0, 540)).
//   2. On collision: walk forward (+1, modulo 540) until a free slot
//      is found. Slugs are processed in alphabetical order so the
//      collision-resolution ordering is itself deterministic.
//   3. Convert each assigned minute to a `cron(M H ? * * *)` EventBridge
//      expression in UTC.
//
// Output
//   A JSON object `{ "<slug>": "cron(M H ? * * *)" }` written to stdout,
//   with keys in alphabetical order and a trailing newline. Re-running
//   the script produces byte-identical output (idempotency contract,
//   verified by `diff` in the PR's discipline section).
//
// Inputs
//   Reads the list of slugs from `workforce/agents/*/` (subdirectory
//   names matching `^[a-z]+$`, excluding `_org`). Adding or removing
//   an agent changes the input set and therefore the output — that
//   drift is accepted for v1 (Epic-011 §Scope out).
//
// No external dependencies. No Date.now(), no Math.random(). Pure
// function of the directory listing.

import { readdirSync, statSync, writeSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const WORKFORCE_ROOT = join(HERE, "..");
const AGENTS_DIR = join(WORKFORCE_ROOT, "agents");

// Working window = 09:00-18:00 JST = 00:00-09:00 UTC = 540 minutes.
// Matches the validator's `[540, 1080)` JST-minute window.
const WINDOW_MINUTES = 540;

const SLUG_RE = /^[a-z]+$/;

function djb2(str) {
  // Classic djb2: h = h * 33 + c, seeded at 5381. Coerced to unsigned
  // 32-bit at each step so the result is stable across Node versions.
  let h = 5381 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h = (((h << 5) + h) + str.charCodeAt(i)) >>> 0;
  }
  return h >>> 0;
}

function listAgentSlugs() {
  return readdirSync(AGENTS_DIR)
    .filter((name) => SLUG_RE.test(name))
    .filter((name) => statSync(join(AGENTS_DIR, name)).isDirectory())
    .sort(); // alphabetical → deterministic collision resolution
}

function assignMinutes(slugs) {
  const taken = new Set();
  const assigned = new Map();
  for (const slug of slugs) {
    let m = djb2(slug) % WINDOW_MINUTES;
    while (taken.has(m)) {
      m = (m + 1) % WINDOW_MINUTES;
    }
    taken.add(m);
    assigned.set(slug, m);
  }
  return assigned;
}

function minuteToCron(minuteOfDay) {
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  // EventBridge cron requires either DOM or DOW to be `?` (they cannot
  // both be `*`). Convention used by the rest of the workforce:
  // `cron(M H ? * * *)` = every day at H:M UTC.
  return `cron(${minute} ${hour} ? * * *)`;
}

function main() {
  const slugs = listAgentSlugs();
  if (slugs.length === 0) {
    console.error("stagger-feed-cron: no agents found under workforce/agents/");
    process.exit(1);
  }
  if (slugs.length > WINDOW_MINUTES) {
    // Won't trip until N=540, but fail loud rather than overflow silently.
    console.error(
      `stagger-feed-cron: ${slugs.length} agents exceed window capacity (${WINDOW_MINUTES})`,
    );
    process.exit(1);
  }
  const assigned = assignMinutes(slugs);
  const out = {};
  for (const slug of slugs) {
    out[slug] = minuteToCron(assigned.get(slug));
  }
  // Pretty-print with 2-space indent + trailing newline for diff
  // readability. `JSON.stringify` preserves insertion order, which is
  // alphabetical here.
  writeSync(1, JSON.stringify(out, null, 2) + "\n");
}

main();
