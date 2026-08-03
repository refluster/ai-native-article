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
// Two populations, because "calls fetch()" was not the whole rule
// ---------------------------------------------------------------
// The first version of this gate scanned exactly one population: files
// containing a direct `fetch(` call. It reported ✅ on all 74 of them while
// `pr-autopilot-sweep.mjs` 401'd on every fire (#534). That script is the
// process entry, issues no `fetch(` of its own, and does all its network I/O
// through `makeGh()` imported from `pr-merge.mjs`. `pr-merge.mjs` *does*
// bootstrap — but with its own `import.meta.url`, which is not the entry, so
// `ensureProxyAwareEntry` correctly no-ops and nobody ever re-execs.
//
// The bootstrap is a property of the *process*, so the obligation belongs to
// whoever starts the process, not to whoever types `fetch(`. Hence:
//
//   Population A — a file with a direct global `fetch(` call.
//   Population B — an ENTRY script (a CLI entry guard, or a `main()` invoked
//                  at module scope) that *transitively* imports a file in
//                  population A.
//
// Both must bootstrap. B is the case #534 named, and the sweep across this
// repo found five members of it, not one.
//
// Scope, deliberately: `.mjs` only, under workforce/ scripts/ newsletter/
// .claude/. `workforce/lambdas/**/*.ts` is excluded on purpose — Lambdas run
// in AWS, not behind the CCR proxy — so do not "fix" that by widening it.
// Reachability follows *relative* specifiers only: a bare specifier is a
// dependency, and no dependency in this repo fetches at import time.
//
// Usage:  node scripts/check-proxy-bootstrap.mjs
// Exit:   0 — every fetch() caller and every fetch-reaching entry is bootstrapped
//         1 — one or more offenders (listed on stderr)

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
// The call itself — importing without calling does nothing.
const BOOTSTRAP_CALL = /ensureProxyAwareEntry\s*\(\s*import\.meta\.url\s*\)/;
// A CLI entry guard, in either idiom this repo actually uses, or a `main()`
// invoked at module scope (column 0 — an indented call is inside something).
const ENTRY_GUARD =
  /import\.meta\.url\s*===\s*pathToFileURL\(|pathToFileURL\([^)]*\)\.href\s*===\s*import\.meta\.url|fileURLToPath\(import\.meta\.url\)\s*===\s*(?:realpathSync\()?(?:resolve\()?process\.argv\[1\]|process\.argv\[1\]\s*===\s*fileURLToPath\(import\.meta\.url\)|^(?:await\s+)?main\s*\(\s*\)/m;
// Every relative specifier this file pulls in: `from "./x.mjs"`, a bare
// side-effect `import "./x.mjs"`, and `import("./x.mjs")`. Matched against
// stripped code, so a path named in prose is not an edge.
const REL_SPECIFIER = /(?:from|import)\s*\(?\s*["'](\.[^"']+)["']/g;

/** Blank out comments and string literals so a mention of a call in prose is
 *  not mistaken for one. Crude, and only ever used for detection.
 *
 *  Order matters. Template literals must go before quoted strings: an
 *  apostrophe inside one ("Node's fetch()") would otherwise be read as a
 *  string delimiter, desynchronising the quote matcher for the rest of the
 *  file and leaking prose back into the scanned text. This gate flagged
 *  itself that way. */
/** Blank out comments only, keeping string literals intact. The import-edge
 *  scan needs the specifiers that `stripNonCode` deliberately erases — running
 *  REL_SPECIFIER over fully-stripped source finds `from ""` and builds an
 *  empty graph, which is how the first cut of this widening reported zero
 *  transitive entries while five existed. */
export function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");
}

export function stripNonCode(src) {
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

export function walk(dir, out = []) {
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

/** Resolve a relative import specifier to a file on disk, the way Node's ESM
 *  loader would for the shapes this repo uses. Returns null when it points
 *  outside the scanned set (a `.json` asset, a missing path) — an unresolvable
 *  edge is not this gate's business; R-14's own import-resolves check owns
 *  that for the bootstrap specifier itself. */
export function resolveRelative(fromFile, spec) {
  const base = resolve(dirname(fromFile), spec);
  for (const cand of [base, `${base}.mjs`, join(base, "index.mjs")]) {
    try {
      if (existsSync(cand) && statSync(cand).isFile()) return resolve(cand);
    } catch {
      /* dangling symlink — treat as unresolvable */
    }
  }
  return null;
}

/** Read every scanned .mjs once into { fetches, bootstraps, isEntry, edges }.
 *  Keyed by absolute path so the graph walk is a map lookup. */
export function indexFiles(files, read = (f) => readFileSync(f, "utf8")) {
  const index = new Map();
  for (const file of files) {
    const abs = resolve(file);
    const src = read(abs);
    const code = stripNonCode(src);
    const edges = [];
    for (const m of stripComments(src).matchAll(REL_SPECIFIER)) {
      const target = resolveRelative(abs, m[1]);
      if (target) edges.push(target);
    }
    index.set(abs, {
      src,
      fetches: FETCH_CALL.test(code),
      bootstraps: BOOTSTRAP_CALL.test(src),
      isEntry: ENTRY_GUARD.test(code),
      edges,
    });
  }
  return index;
}

/** The first fetch-calling module reachable from `start` by relative imports,
 *  or null. Depth-first with a visited set — the graph has cycles (scan ⇄ post
 *  pairs), and a cycle must not hang the gate. */
export function reachesFetch(index, start) {
  const seen = new Set([resolve(start)]);
  const stack = [resolve(start)];
  while (stack.length > 0) {
    const node = index.get(stack.pop());
    if (!node) continue;
    for (const edge of node.edges) {
      if (seen.has(edge)) continue;
      seen.add(edge);
      const target = index.get(edge);
      if (!target) continue;
      if (target.fetches) return edge;
      stack.push(edge);
    }
  }
  return null;
}

/** Assert the bootstrap contract on one file. Returns a reason string, or null
 *  when the file is compliant. */
export function bootstrapDefect(file, src) {
  const importMatch = src.match(BOOTSTRAP_IMPORT);
  if (!importMatch) return "no proxy-bootstrap import statement";
  if (!existsSync(resolve(dirname(file), importMatch[1]))) {
    return `import path does not resolve: ${importMatch[1]}`;
  }
  const firstImport = src.match(ANY_IMPORT);
  if (firstImport && firstImport.index !== importMatch.index) {
    return "proxy-bootstrap is not the first import";
  }
  if (!BOOTSTRAP_CALL.test(src)) {
    return "imports the bootstrap but never calls ensureProxyAwareEntry(import.meta.url)";
  }
  return null;
}

/** The whole gate as a pure function of a file list.
 *  Returns { offenders: [[relPath, why]], direct, transitive }. */
export function analyse(files, { root = ROOT, bootstrap = BOOTSTRAP } = {}) {
  const scanned = files.map((f) => resolve(f)).filter((f) => f !== resolve(bootstrap));
  const index = indexFiles(scanned);
  const offenders = [];
  let direct = 0;
  let transitive = 0;

  for (const file of scanned) {
    const node = index.get(file);
    const rel = relative(root, file);

    // Population A — issues a global fetch() itself.
    if (node.fetches) {
      direct++;
      const why = bootstrapDefect(file, node.src);
      if (why) offenders.push([rel, why]);
      continue;
    }

    // Population B — an entry script whose network I/O is delegated to an
    // imported module (#534). The bootstrap is a process property, so the
    // entry owes it even though it never types `fetch(`.
    if (!node.isEntry) continue;
    const via = reachesFetch(index, file);
    if (!via) continue;
    transitive++;
    const why = bootstrapDefect(file, node.src);
    if (why) offenders.push([rel, `${why} (entry script; fetches via ${relative(root, via)})`]);
  }

  return { offenders, direct, transitive };
}

function main() {
  const files = [];
  for (const dir of SCAN_DIRS) files.push(...walk(join(ROOT, dir)));
  const { offenders, direct, transitive } = analyse(files);

  if (offenders.length > 0) {
    console.error(
      `❌  R-14: ${offenders.length} script(s) reach fetch() without a valid proxy bootstrap:\n`,
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
        `    module that is also imported by tests.\n\n` +
        `    An entry script that calls no fetch() of its own still needs it: the\n` +
        `    bootstrap only re-execs for the process ENTRY, so a helper's own\n` +
        `    call no-ops when imported and nothing makes the process\n` +
        `    proxy-aware (#534).\n`,
    );
    process.exit(1);
  }

  console.log(
    `✅  R-14: all ${direct} fetch()-calling and ${transitive} fetch-reaching entry script(s) ` +
      `bootstrap the proxy correctly.`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
