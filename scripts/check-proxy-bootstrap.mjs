#!/usr/bin/env node
// check-proxy-bootstrap.mjs — R-14 mechanical gate.
//
// Every .mjs that issues a network request with the global fetch() must
// bootstrap the process for the agent proxy before the request goes out:
//
//     import { ensureProxyAwareEntry } from "<path>/scripts/lib/proxy-bootstrap.mjs";
//     ensureProxyAwareEntry(import.meta.url);
//
// Without it, Node's undici-backed fetch ignores HTTPS_PROXY, bypasses the CCR
// agent proxy entirely, and the request is rejected upstream as "Host not in
// allowlist: <host>" — a failure that looks like an egress-policy denial and
// cannot be fixed by opening the allowlist. That failure mode silently stopped
// the L1→L2/L3 article pipeline for seven days across 28 no-op dispatches.
// See docs/memory-lint-backlog.md (ML-017).
//
// What this gate asserts, and why each part
// -----------------------------------------
// The first version of this check was `src.includes("proxy-bootstrap.mjs")`.
// A review built three probe files against it: a file with a real fetch() and
// only a *comment* naming the path passed; a file using `globalThis.fetch(`
// was never considered a fetch caller at all; and a file with no fetch was
// flagged because a comment contained "fetch(". So this version checks the
// properties that actually matter:
//
//   1. the import is a real import *statement*, not a mention in a comment;
//   2. its specifier resolves to a file that exists (a wrong relative depth
//      used to pass here and die at runtime with ERR_MODULE_NOT_FOUND —
//      inside a CCR session, i.e. exactly the silent-cadence-failure
//      environment this rule is about);
//   3. it is the FIRST import in the file, because ESM evaluates imports in
//      source order and a sibling that fetches at import time would otherwise
//      win;
//   4. the imported function is actually called;
//   5. the fetch-call scan ignores comments and string literals.
//
// Direct AND indirect callers (the denominator bug)
// -------------------------------------------------
// Checking only files that contain a literal `fetch(` picks the wrong
// denominator. A CLI entry script that reaches the network solely through an
// imported helper — `makeGh()` from pr-merge.mjs, `queryAll()` from
// scripts/lib/notion.mjs — contains no fetch call of its own, so it was never
// counted, and it gets no bootstrap: the helper's own
// `ensureProxyAwareEntry(import.meta.url)` is inert when the helper is
// imported rather than run (by design — re-exec on import would restart its
// host). Both halves are individually correct and the composition is not.
//
// This was not hypothetical. `pr-autopilot-sweep.mjs` took HTTP 401 on every
// proxied fire while this gate reported "all 74 fetch()-calling scripts
// bootstrap correctly" — and that sweep is what mechanically enforces
// pr-autopilot's two-outcome contract, so PRs could sit in neither terminal
// state with nothing red anywhere. `newsletter/pipeline/fetch-notion.mjs`,
// the deploy-time export of the C-2 source of truth, was in the same class.
// Found 2026-08-04 on a live agent-runner fire; ML-017's second occurrence.
//
// So the gate now follows relative imports transitively: a file "touches the
// network" if it calls fetch() itself OR imports (however deeply) a file that
// does. Requiring the bootstrap on the whole set is safe — on a module that
// is imported rather than executed the call is a no-op, which is exactly the
// property that made the leaf-level guard correct in the first place.
//
// Scope, deliberately: `.mjs` only, under workforce/ scripts/ newsletter/
// .claude/. `workforce/lambdas/**/*.ts` is excluded on purpose — Lambdas run
// in AWS, not behind the CCR proxy — so do not "fix" that by widening it.
//
// Usage:  node scripts/check-proxy-bootstrap.mjs
// Exit:   0 — every network-touching script is bootstrapped
//         1 — one or more offenders (listed on stderr)

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BOOTSTRAP = resolve(ROOT, "scripts/lib/proxy-bootstrap.mjs");
const SCAN_DIRS = ["workforce", "scripts", "newsletter", ".claude"];
const IGNORE_DIRS = new Set(["node_modules", "dist", "build", ".git", "coverage"]);

// A real global fetch() call. `fetchArticles(`, `this.fetch(` and
// `client.fetch(` must not match; `globalThis.fetch(` must.
const FETCH_CALL = /(?:(?:^|[^.\w])fetch\s*\(|\bglobalThis\.fetch\s*\()/;
// The bootstrap import, as a statement, capturing its specifier.
const BOOTSTRAP_IMPORT =
  /^[ \t]*import\s+\{[^}]*\}\s+from\s+["']([^"']*proxy-bootstrap\.mjs)["']/m;
// Any import statement, to establish position.
const ANY_IMPORT = /^[ \t]*import\s/m;
// A relative import/export specifier, read off the RAW source. It must not be
// read off stripNonCode() output — that blanks string literals, so every
// specifier would come back as "" and the graph would be empty (which is
// precisely the bug that let the indirect callers through unnoticed).
const RELATIVE_DEP = /^\s*(?:import|export)[^;\n]*?from\s+["'](\.[^"']+)["']/gm;
// The call itself — importing without calling does nothing.
const BOOTSTRAP_CALL = /ensureProxyAwareEntry\s*\(\s*import\.meta\.url\s*\)/;

/** Blank out comments and string literals so a mention of a call in prose is
 *  not mistaken for one. Crude, and only ever used for detection.
 *
 *  Order matters. Template literals must go before quoted strings: an
 *  apostrophe inside one ("Node's fetch()") would otherwise be read as a
 *  string delimiter, desynchronising the quote matcher for the rest of the
 *  file and leaking prose back into the scanned text. This gate flagged
 *  itself that way. */
function stripNonCode(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ \t]*\/\/.*$/gm, " ")
    // Regex literals before templates: a pattern may legitimately contain an
    // odd number of backticks (this file's own does), which would otherwise
    // desynchronise template-literal pairing for everything after it.
    .replace(
      /(^|[=(,:!&|?{};\n]\s*)\/(?![/*])(?:\\.|\[(?:\\.|[^\]\\])*\]|[^\\/\n])+\/[gimsuyd]*/g,
      "$1/RE/",
    )
    .replace(/`(?:\\.|[^\\`])*`/g, "``")
    .replace(/(["'])(?:\\.|(?!\1)[^\\\n])*\1/g, '""');
}

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out; // unreadable dir — not this gate's problem
  }
  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    // withFileTypes avoids a bare statSync, which throws ENOENT on a dangling
    // symlink and would abort the whole gate.
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith(".mjs")) out.push(full);
  }
  return out;
}

/** Resolve a relative specifier to the .mjs file it names. Extensionless and
 *  directory specifiers are not used in this repo; anything that does not land
 *  on a real .mjs is simply not an edge. */
function resolveDep(fromFile, spec) {
  const target = resolve(dirname(fromFile), spec);
  return target.endsWith(".mjs") && existsSync(target) ? target : null;
}

// Pass 1 — read every candidate once: does it fetch directly, and what does it
// import relatively?
const sources = new Map();
const deps = new Map();
const fetchesDirectly = new Set();

for (const dir of SCAN_DIRS) {
  for (const file of walk(join(ROOT, dir))) {
    if (resolve(file) === BOOTSTRAP) continue;
    const src = readFileSync(file, "utf8");
    sources.set(file, src);
    if (FETCH_CALL.test(stripNonCode(src))) fetchesDirectly.add(file);
    deps.set(
      file,
      [...src.matchAll(RELATIVE_DEP)]
        .map((m) => resolveDep(file, m[1]))
        .filter(Boolean),
    );
  }
}

// Pass 2 — transitive closure: a file touches the network if it fetches, or
// imports something that does. Fixed-point over a graph this small (~140
// nodes) is cheaper than the bookkeeping to avoid it, and cycles terminate
// because the set only ever grows.
const touchesNetwork = new Set(fetchesDirectly);
for (let changed = true; changed; ) {
  changed = false;
  for (const [file, edges] of deps) {
    if (touchesNetwork.has(file)) continue;
    if (edges.some((d) => touchesNetwork.has(d))) {
      touchesNetwork.add(file);
      changed = true;
    }
  }
}

const offenders = [];
const direct = fetchesDirectly.size;
let checked = 0;

for (const file of touchesNetwork) {
  const src = sources.get(file);
  checked++;

  const rel = relative(ROOT, file);
  const importMatch = src.match(BOOTSTRAP_IMPORT);
  if (!importMatch) {
    offenders.push([rel, "no proxy-bootstrap import statement"]);
    continue;
  }
  if (!existsSync(resolve(dirname(file), importMatch[1]))) {
    offenders.push([rel, `import path does not resolve: ${importMatch[1]}`]);
    continue;
  }
  const firstImport = src.match(ANY_IMPORT);
  if (firstImport && firstImport.index !== importMatch.index) {
    offenders.push([rel, "proxy-bootstrap is not the first import"]);
    continue;
  }
  if (!BOOTSTRAP_CALL.test(src)) {
    offenders.push([
      rel,
      "imports the bootstrap but never calls ensureProxyAwareEntry(import.meta.url)",
    ]);
  }
}

if (offenders.length > 0) {
  console.error(
    `❌  R-14: ${offenders.length} script(s) reach the network without a valid proxy bootstrap:\n`,
  );
  for (const [file, why] of offenders) console.error(`      ${file} — ${why}`);
  console.error(
    `\n    Add this as the first import, and call it before any other statement:\n` +
      `      import { ensureProxyAwareEntry } from "../../../scripts/lib/proxy-bootstrap.mjs";\n` +
      `      ensureProxyAwareEntry(import.meta.url);\n\n` +
      `    Why: Node's fetch() does not read HTTPS_PROXY. In a CCR session the\n` +
      `    request then bypasses the agent proxy and fails with "Host not in\n` +
      `    allowlist", which no egress setting can fix. The call is a no-op\n` +
      `    unless the file is the process entry point, so it is safe in a\n` +
      `    module that is also imported by tests.\n`,
  );
  process.exit(1);
}

console.log(
  `✅  R-14: all ${checked} network-touching script(s) bootstrap the proxy correctly ` +
    `(${direct} direct fetch() caller(s), ${checked - direct} via an imported helper).`,
);
