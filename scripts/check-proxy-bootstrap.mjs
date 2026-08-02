#!/usr/bin/env node
// check-proxy-bootstrap.mjs — R-14 mechanical gate.
//
// Every .mjs that issues a network request with the global fetch() must first
// import scripts/lib/proxy-bootstrap.mjs, so the process is made proxy-aware
// before the request goes out. Without it, Node's undici-backed fetch ignores
// HTTPS_PROXY, bypasses the CCR agent proxy entirely, and the request is
// rejected upstream as "Host not in allowlist: <host>" — a failure that looks
// like an egress-policy denial and cannot be fixed by opening the allowlist.
//
// This gate exists because that failure mode silently stopped the L1→L2/L3
// article pipeline for seven days (28 consecutive no-op dispatches) before
// anyone noticed. See docs/memory-lint-backlog.md (ML-017).
//
// Usage:  node scripts/check-proxy-bootstrap.mjs
// Exit:   0 — every fetch() caller is bootstrapped
//         1 — one or more offenders (listed on stderr)

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BOOTSTRAP = resolve(ROOT, "scripts/lib/proxy-bootstrap.mjs");
const SCAN_DIRS = ["workforce", "scripts", "newsletter"];
const IGNORE_DIRS = new Set(["node_modules", "dist", "build", ".git", "coverage"]);

// A real global fetch() call: `fetch(` not preceded by `.` or a word char, so
// `fetchArticles(`, `this.fetch(` and `await client.fetch(` do not match.
const FETCH_CALL = /(^|[^.\w])fetch\s*\(/m;

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith(".mjs")) out.push(full);
  }
  return out;
}

const offenders = [];
let checked = 0;

for (const dir of SCAN_DIRS) {
  for (const file of walk(join(ROOT, dir))) {
    if (resolve(file) === BOOTSTRAP) continue;
    const src = readFileSync(file, "utf8");
    if (!FETCH_CALL.test(src)) continue;
    checked++;
    if (!src.includes("proxy-bootstrap.mjs")) offenders.push(relative(ROOT, file));
  }
}

if (offenders.length > 0) {
  console.error(
    `❌  R-14: ${offenders.length} script(s) call fetch() without importing the proxy bootstrap:\n`,
  );
  for (const file of offenders) console.error(`      ${file}`);
  console.error(
    `\n    Add this as the first import (adjust the relative path):\n` +
      `      import "../../../scripts/lib/proxy-bootstrap.mjs";\n\n` +
      `    Why: Node's fetch() does not read HTTPS_PROXY. In a CCR session the\n` +
      `    request then bypasses the agent proxy and fails with "Host not in\n` +
      `    allowlist", which no egress setting can fix.\n`,
  );
  process.exit(1);
}

console.log(`✅  R-14: all ${checked} fetch()-calling script(s) import the proxy bootstrap.`);
