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
// Testability (#575 / ML-017 / ML-025)
// -------------------------------------
// The population-detection logic (which files "touch the network", which of
// those are missing a valid bootstrap) is exported as a pure function,
// `findProxyBootstrapOffenders`, over an in-memory `Map<relPath, source>` —
// no filesystem access. This is what let this gate's population miss twice
// (ML-017, then ML-025/#534 — an entry script reaching fetch() only through
// an imported helper) reach production before anyone noticed: there was
// nothing pinning the population logic against known-good/known-bad shapes.
// `check-proxy-bootstrap-tests.ts` exercises this function directly; the CLI
// below is a thin wrapper that walks the real tree and calls it.
//
// Usage:  node scripts/check-proxy-bootstrap.mjs
// Exit:   0 — every network-touching script is bootstrapped
//         1 — one or more offenders (listed on stderr)

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative, resolve, dirname, posix } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BOOTSTRAP_REL = "scripts/lib/proxy-bootstrap.mjs";
const NETWORK_LIB_REL = "scripts/lib/http-retry.mjs";
const SCAN_DIRS = ["workforce", "scripts", "newsletter", ".claude"];
const IGNORE_DIRS = new Set(["node_modules", "dist", "build", ".git", "coverage"]);

// A real global fetch() call. `fetchArticles(`, `this.fetch(` and
// `client.fetch(` must not match; `globalThis.fetch(` must.
const FETCH_CALL = /(?:(?:^|[^.\w])fetch\s*\(|\bglobalThis\.fetch\s*\()/;
// A literal `fetch(` is no longer the only way to issue a request. Importing
// scripts/lib/http-retry.mjs performs network I/O just as surely, and its own
// call is `fetchImpl(...)` — which this file's FETCH_CALL deliberately does not
// match, so the module and every future importer would drop out of the scan
// set entirely. That is how backfill-en.mjs left it (74 → 73 callers) the
// moment its fetch moved one module away, leaving a code comment as the only
// thing holding its bootstrap in place. A comment is a memory; §6.1 says
// memories become checks. Adding an indirection here is a tightening, not a
// loosening — nothing that was scanned before stops being scanned.
const NETWORK_MODULE_IMPORT =
  /^[ \t]*import\s[\s\S]*?from\s+["'][^"']*scripts\/lib\/http-retry\.mjs["']/m;
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

/** Resolve a relative specifier against a virtual (posix, "/"-joined)
 *  relative path, purely by string manipulation — no filesystem access, so
 *  this is exercised the same way in a fixture test as it runs in
 *  production. Mirrors how a real ESM resolver treats a `./` or `../`
 *  specifier relative to the importing file's own directory. */
function resolveRelative(fromRel, spec) {
  const fromDir = posix.dirname(fromRel.split("\\").join("/"));
  return posix.normalize(posix.join(fromDir, spec));
}

/**
 * Pure population-and-offender detector (unit-tested — #575 / ML-017 /
 * ML-025). No filesystem access: `files` is the complete candidate set as an
 * in-memory `Map<relPath, source>`, where `relPath` is a "/"-joined path
 * relative to the same root every specifier in `spec` is resolved against
 * (in production, the repo root).
 *
 * Returns `{ offenders: [[relPath, reason], ...], checked, direct }` — never
 * throws and never touches process.exit/console; the CLI wrapper below owns
 * output and exit codes.
 */
export function findProxyBootstrapOffenders(
  files,
  { bootstrapRel = BOOTSTRAP_REL, networkLibRel = NETWORK_LIB_REL } = {},
) {
  // Pass 1 — does each candidate fetch directly, and what does it import
  // relatively? (Two independent ways into the population, kept deliberately
  // redundant — see the module-level comment on NETWORK_MODULE_IMPORT.)
  const deps = new Map();
  const fetchesDirectly = new Set();

  for (const [relPath, src] of files) {
    if (relPath === bootstrapRel) continue;
    if (
      FETCH_CALL.test(stripNonCode(src)) ||
      NETWORK_MODULE_IMPORT.test(src)
    ) {
      fetchesDirectly.add(relPath);
    }
    const edges = [];
    for (const m of src.matchAll(RELATIVE_DEP)) {
      const target = resolveRelative(relPath, m[1]);
      if (target.endsWith(".mjs") && files.has(target)) edges.push(target);
    }
    deps.set(relPath, edges);
  }

  // Pass 2 — transitive closure: a file touches the network if it fetches, or
  // imports something that does. Fixed-point over a graph this small (~140
  // nodes in production) is cheaper than the bookkeeping to avoid it, and
  // cycles terminate because the set only ever grows.
  const touchesNetwork = new Set(fetchesDirectly);
  for (let changed = true; changed; ) {
    changed = false;
    for (const [relPath, edges] of deps) {
      if (touchesNetwork.has(relPath)) continue;
      if (edges.some((d) => touchesNetwork.has(d))) {
        touchesNetwork.add(relPath);
        changed = true;
      }
    }
  }

  const offenders = [];
  const direct = fetchesDirectly.size;
  let checked = 0;

  for (const relPath of touchesNetwork) {
    // scripts/lib/http-retry.mjs is itself a library, never a process entry,
    // so the bootstrap cannot apply to it — excluded exactly as the
    // bootstrap file itself is. It stays a NODE in the graph above on
    // purpose: every script that reaches fetch() *through* it must still be
    // pulled into touchesNetwork, which is the whole point of the transitive
    // pass.
    if (relPath === networkLibRel) continue;
    const src = files.get(relPath);
    checked++;

    const importMatch = src.match(BOOTSTRAP_IMPORT);
    if (!importMatch) {
      offenders.push([relPath, "no proxy-bootstrap import statement"]);
      continue;
    }
    if (!files.has(resolveRelative(relPath, importMatch[1]))) {
      offenders.push([relPath, `import path does not resolve: ${importMatch[1]}`]);
      continue;
    }
    const firstImport = src.match(ANY_IMPORT);
    if (firstImport && firstImport.index !== importMatch.index) {
      offenders.push([relPath, "proxy-bootstrap is not the first import"]);
      continue;
    }
    if (!BOOTSTRAP_CALL.test(src)) {
      offenders.push([
        relPath,
        "imports the bootstrap but never calls ensureProxyAwareEntry(import.meta.url)",
      ]);
    }
  }

  return { offenders, checked, direct };
}

// CLI entry point — reads the real tree into the same `Map<relPath, source>`
// shape findProxyBootstrapOffenders expects, then owns output/exit codes.
// Guarded so importing this module (the test file does) never runs it.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const files = new Map();
  for (const dir of SCAN_DIRS) {
    for (const file of walk(join(ROOT, dir))) {
      const relPath = relative(ROOT, file).split("\\").join("/");
      files.set(relPath, readFileSync(file, "utf8"));
    }
  }

  // Sanity check: the two well-known library files must exist where the
  // constants say they do, or the exclusions above silently stop applying.
  for (const rel of [BOOTSTRAP_REL, NETWORK_LIB_REL]) {
    if (!existsSync(resolve(ROOT, rel))) {
      console.error(`check-proxy-bootstrap: expected library file missing: ${rel}`);
      process.exit(1);
    }
  }

  const { offenders, checked, direct } = findProxyBootstrapOffenders(files);

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
}
