// Tests for the R-14 gate's population rules.
//
// `node:test` — same runner as source-fetch.test.mjs, reachable from the repo
// root with `npm run test:scripts`, no new dependency.
//
// These exist because the gate's FIRST version was green on all 74 direct
// fetch() callers while `pr-autopilot-sweep.mjs` 401'd on every fire (#534):
// the script is the process entry, types no `fetch(`, and does its network I/O
// through an imported helper whose own bootstrap correctly no-ops when
// imported. The rule's stated intent and its measured population had diverged,
// and nothing was red. So each assertion below names the case it guards.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { analyse, reachesFetch, indexFiles, stripComments, stripNonCode } from "../check-proxy-bootstrap.mjs";

// The gate keys on the specifier containing `proxy-bootstrap.mjs`, so the stub
// has to be named that — a `./boot.mjs` stub reads as "no bootstrap import".
const BOOTSTRAP_LINES =
  'import { ensureProxyAwareEntry } from "./proxy-bootstrap.mjs";\nensureProxyAwareEntry(import.meta.url);\n';
const ENTRY_GUARD = 'if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();\n';

/** Build a throwaway tree of .mjs files and analyse it. `files` maps a
 *  relative path to its source. A `boot.mjs` stub is always written so the
 *  gate's "import path resolves" check has something real to find. */
function analyseTree(files) {
  const root = mkdtempSync(join(tmpdir(), "r14-"));
  const written = [];
  writeFileSync(join(root, "proxy-bootstrap.mjs"), "export function ensureProxyAwareEntry() {}\n");
  for (const [rel, src] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(resolve(abs, ".."), { recursive: true });
    writeFileSync(abs, src);
    written.push(abs);
  }
  try {
    return analyse(written, { root, bootstrap: join(root, "nonexistent-bootstrap.mjs") });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("a direct fetch() caller without the bootstrap is an offender (population A)", () => {
  const { offenders, direct } = analyseTree({
    "caller.mjs": 'const r = await fetch("https://example.test");\n',
  });
  assert.equal(direct, 1);
  assert.equal(offenders.length, 1);
  assert.match(offenders[0][1], /no proxy-bootstrap import statement/);
});

test("a direct fetch() caller with the bootstrap passes", () => {
  const { offenders, direct } = analyseTree({
    "caller.mjs": BOOTSTRAP_LINES + 'const r = await fetch("https://example.test");\n',
  });
  assert.equal(direct, 1);
  assert.deepEqual(offenders, []);
});

test("#534: an entry script fetching only via an imported helper is an offender (population B)", () => {
  const { offenders, transitive } = analyseTree({
    "helper.mjs": BOOTSTRAP_LINES + 'export const gh = () => fetch("https://api.example.test");\n',
    "entry.mjs": 'import { gh } from "./helper.mjs";\nfunction main() { return gh(); }\n' + ENTRY_GUARD,
  });
  assert.equal(transitive, 1, "the entry belongs to the widened population");
  assert.equal(offenders.length, 1);
  assert.match(offenders[0][0], /entry\.mjs/);
  assert.match(offenders[0][1], /entry script; fetches via .*helper\.mjs/);
});

test("the same entry script passes once it bootstraps", () => {
  const { offenders, transitive } = analyseTree({
    "helper.mjs": BOOTSTRAP_LINES + 'export const gh = () => fetch("https://api.example.test");\n',
    "entry.mjs":
      BOOTSTRAP_LINES + 'import { gh } from "./helper.mjs";\nfunction main() { return gh(); }\n' + ENTRY_GUARD,
  });
  assert.equal(transitive, 1);
  assert.deepEqual(offenders, []);
});

test("reach is transitive, not just one hop", () => {
  const { offenders, transitive } = analyseTree({
    "net.mjs": BOOTSTRAP_LINES + 'export const go = () => fetch("https://api.example.test");\n',
    "mid.mjs": 'export { go } from "./net.mjs";\n',
    "entry.mjs": 'import { go } from "./mid.mjs";\nfunction main() { return go(); }\n' + ENTRY_GUARD,
  });
  assert.equal(transitive, 1);
  assert.equal(offenders.length, 1);
  assert.match(offenders[0][0], /entry\.mjs/);
});

test("a NON-entry module that reaches fetch is not an offender — re-execing on import restarts its host", () => {
  const { offenders, transitive } = analyseTree({
    "helper.mjs": BOOTSTRAP_LINES + 'export const gh = () => fetch("https://api.example.test");\n',
    "library.mjs": 'import { gh } from "./helper.mjs";\nexport const wrap = () => gh();\n',
  });
  assert.equal(transitive, 0);
  assert.deepEqual(offenders, []);
});

test("an entry script that reaches no fetch at all is not in the population", () => {
  const { offenders, transitive } = analyseTree({
    "pure.mjs": "export const add = (a, b) => a + b;\n",
    "entry.mjs": 'import { add } from "./pure.mjs";\nfunction main() { return add(1, 2); }\n' + ENTRY_GUARD,
  });
  assert.equal(transitive, 0);
  assert.deepEqual(offenders, []);
});

test("an import cycle terminates instead of hanging the gate", () => {
  const root = mkdtempSync(join(tmpdir(), "r14-cycle-"));
  try {
    writeFileSync(join(root, "a.mjs"), 'import "./b.mjs";\nexport const a = 1;\n');
    writeFileSync(join(root, "b.mjs"), 'import "./a.mjs";\nexport const b = 2;\n');
    const files = [join(root, "a.mjs"), join(root, "b.mjs")];
    const index = indexFiles(files);
    assert.equal(reachesFetch(index, join(root, "a.mjs")), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a commented-out import is not an edge", () => {
  const { offenders, transitive } = analyseTree({
    "helper.mjs": BOOTSTRAP_LINES + 'export const gh = () => fetch("https://api.example.test");\n',
    "entry.mjs": '// import { gh } from "./helper.mjs";\nfunction main() { return 1; }\n' + ENTRY_GUARD,
  });
  assert.equal(transitive, 0);
  assert.deepEqual(offenders, []);
});

test("stripComments keeps specifiers that stripNonCode erases", () => {
  const src = 'import { gh } from "./helper.mjs";\n';
  assert.match(stripComments(src), /\.\/helper\.mjs/);
  assert.doesNotMatch(stripNonCode(src), /\.\/helper\.mjs/);
});
