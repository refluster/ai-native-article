// Fixture tests for the R-14 gate's population-detection logic (#575).
//
// The gate (scripts/check-proxy-bootstrap.mjs) has been wrong about its own
// population twice in 90 days:
//   - ML-017: a script that reached fetch() only through an imported network
//     helper (scripts/lib/http-retry.mjs) was outside the scan set entirely.
//   - ML-025 (#534): pr-autopilot-sweep.mjs reaches fetch() only through an
//     imported helper (makeGh() from pr-merge.mjs) and was outside the scan
//     set entirely — a direct-fetch()-only population misses any entry point
//     whose only network I/O is transitive.
//
// These fixtures pin the population logic itself — direct fetch() caller,
// transitive-via-import caller, a script with no network I/O, and the
// well-formedness checks on the bootstrap import once a file IS in the
// population — against known-good and known-bad shapes, so a future
// regression in either direction (over- or under-counting the population)
// fails CI instead of production.

// @ts-nocheck — the script under test is dependency-free ESM, not TS.
import { describe, it, expect } from "vitest";
import { findProxyBootstrapOffenders } from "../../scripts/check-proxy-bootstrap.mjs";

const BOOTSTRAP_REL = "scripts/lib/proxy-bootstrap.mjs";
const NETWORK_LIB_REL = "scripts/lib/http-retry.mjs";

// Real proxy-bootstrap.mjs is never itself a network-touching entry — a
// minimal stand-in is enough for the resolver to find a real map entry.
const BOOTSTRAP_SRC = `export function ensureProxyAwareEntry(url) {}\n`;
// The real http-retry.mjs never calls fetch( itself — fetch is injected as a
// default parameter value (\`fetchImpl = fetch\`), which is exactly why the
// NETWORK_MODULE_IMPORT seed exists: FETCH_CALL requires a call (\`fetch(\`),
// and a bare identifier reference never matches it.
const HTTP_RETRY_SRC = `
export async function withRetry(url, { fetchImpl = fetch } = {}) {
  return fetchImpl(url);
}
`;

const GOOD_IMPORT = `import { ensureProxyAwareEntry } from "./lib/proxy-bootstrap.mjs";\nensureProxyAwareEntry(import.meta.url);\n`;

function baseFiles(extra = {}) {
  return new Map([
    [BOOTSTRAP_REL, BOOTSTRAP_SRC],
    [NETWORK_LIB_REL, HTTP_RETRY_SRC],
    ...Object.entries(extra),
  ]);
}

describe("findProxyBootstrapOffenders — population (which files must bootstrap)", () => {
  it("counts a direct fetch() caller and clears it when correctly bootstrapped", () => {
    const files = baseFiles({
      "scripts/good-direct.mjs": `${GOOD_IMPORT}\nconst r = await fetch("https://example.com");\n`,
    });
    const { offenders, checked, direct } = findProxyBootstrapOffenders(files);
    expect(offenders).toEqual([]);
    expect(direct).toBe(1);
    expect(checked).toBe(1);
  });

  it("ML-025 / #534: flags an entry script whose ONLY network I/O is transitive, via an imported helper", () => {
    // Mirrors pr-autopilot-sweep.mjs -> makeGh() from pr-merge.mjs: the entry
    // has no literal fetch() of its own, so a direct-caller-only scan misses it.
    const files = baseFiles({
      "scripts/helper.mjs": `${GOOD_IMPORT}\nexport function makeGh() { return fetch("https://api.github.com"); }\n`,
      "scripts/sweep-entry.mjs": `import { makeGh } from "./helper.mjs";\nmakeGh();\n`,
    });
    const { offenders, checked, direct } = findProxyBootstrapOffenders(files);
    expect(direct).toBe(1); // only helper.mjs calls fetch() itself
    expect(checked).toBe(2); // both helper.mjs and sweep-entry.mjs are in the population
    expect(offenders).toEqual([
      ["scripts/sweep-entry.mjs", "no proxy-bootstrap import statement"],
    ]);
  });

  it("ML-017: counts a script that imports scripts/lib/http-retry.mjs even with no literal fetch(", () => {
    // http-retry.mjs's own call is the injected fetchImpl, which FETCH_CALL
    // does not match by design (see the module-level comment) — the
    // NETWORK_MODULE_IMPORT seed is what pulls an importer of it into the
    // population. NETWORK_MODULE_IMPORT matches on the specifier TEXT
    // containing "scripts/lib/http-retry.mjs" — a real caller outside
    // scripts/ (e.g. newsletter/pipeline/backfill-en.mjs) writes exactly this
    // shape: "../../scripts/lib/http-retry.mjs".
    const files = baseFiles({
      "newsletter/pipeline/uses-http-retry.mjs":
        `import { withRetry } from "../../scripts/lib/http-retry.mjs";\nwithRetry("https://example.com");\n`,
    });
    const { offenders, checked } = findProxyBootstrapOffenders(files);
    expect(checked).toBe(1);
    expect(offenders).toEqual([
      ["newsletter/pipeline/uses-http-retry.mjs", "no proxy-bootstrap import statement"],
    ]);
  });

  it("a script with no network I/O at all is excluded from the population entirely", () => {
    const files = baseFiles({
      "scripts/no-network.mjs": `export function add(a, b) { return a + b; }\n`,
    });
    const { offenders, checked, direct } = findProxyBootstrapOffenders(files);
    expect(checked).toBe(0);
    expect(direct).toBe(0);
    expect(offenders).toEqual([]);
  });

  it("does not flag fetch( mentioned only in a comment or a string literal", () => {
    const files = baseFiles({
      "scripts/mentions-only.mjs": `// call fetch(url) here eventually\nconst msg = "please fetch(this) later";\n`,
    });
    const { checked } = findProxyBootstrapOffenders(files);
    expect(checked).toBe(0);
  });

  it("counts globalThis.fetch( as a direct call, matching a bare fetch(", () => {
    const files = baseFiles({
      "scripts/global-fetch.mjs": `${GOOD_IMPORT}\nglobalThis.fetch("https://example.com");\n`,
    });
    const { offenders, direct } = findProxyBootstrapOffenders(files);
    expect(direct).toBe(1);
    expect(offenders).toEqual([]);
  });

  it("does not flag a method call named fetch on an unrelated object", () => {
    const files = baseFiles({
      "scripts/client-fetch.mjs": `const client = { fetch: async () => {} };\nclient.fetch("https://example.com");\n`,
    });
    const { checked, offenders } = findProxyBootstrapOffenders(files);
    expect(checked).toBe(0);
    expect(offenders).toEqual([]);
  });

  it("transitive closure reaches a fetcher imported two hops away", () => {
    const files = baseFiles({
      "scripts/leaf.mjs": `${GOOD_IMPORT}\nexport function callIt() { return fetch("https://example.com"); }\n`,
      "scripts/mid.mjs": `${GOOD_IMPORT}\nimport { callIt } from "./leaf.mjs";\nexport function relay() { return callIt(); }\n`,
      "scripts/root-entry.mjs": `${GOOD_IMPORT}\nimport { relay } from "./mid.mjs";\nrelay();\n`,
    });
    const { offenders, checked } = findProxyBootstrapOffenders(files);
    expect(checked).toBe(3);
    expect(offenders).toEqual([]);
  });

  it("resolves a relative import at production-realistic depth (workforce/skills/{name}/*.mjs)", () => {
    const files = baseFiles({
      "workforce/skills/some-cadence/entry.mjs":
        `import { ensureProxyAwareEntry } from "../../../scripts/lib/proxy-bootstrap.mjs";\nensureProxyAwareEntry(import.meta.url);\nfetch("https://example.com");\n`,
    });
    const { offenders, direct } = findProxyBootstrapOffenders(files);
    expect(direct).toBe(1);
    expect(offenders).toEqual([]);
  });

  it("excludes scripts/lib/http-retry.mjs itself from offender reporting even though it touches the network", () => {
    // http-retry.mjs is a library, never a process entry — it stays a node in
    // the dependency graph (so importers are still reached) but is not itself
    // checked for a bootstrap.
    const { offenders, checked } = findProxyBootstrapOffenders(baseFiles());
    expect(checked).toBe(0);
    expect(offenders).toEqual([]);
  });
});

describe("findProxyBootstrapOffenders — bootstrap well-formedness (once a file IS in the population)", () => {
  it("flags a missing proxy-bootstrap import entirely", () => {
    const files = baseFiles({
      "scripts/no-import.mjs": `fetch("https://example.com");\n`,
    });
    const { offenders } = findProxyBootstrapOffenders(files);
    expect(offenders).toEqual([
      ["scripts/no-import.mjs", "no proxy-bootstrap import statement"],
    ]);
  });

  it("flags an import specifier at the wrong relative depth (resolves to nothing)", () => {
    const files = baseFiles({
      "scripts/wrong-depth.mjs":
        `import { ensureProxyAwareEntry } from "../../lib/proxy-bootstrap.mjs";\nensureProxyAwareEntry(import.meta.url);\nfetch("https://example.com");\n`,
    });
    const { offenders } = findProxyBootstrapOffenders(files);
    expect(offenders).toEqual([
      ["scripts/wrong-depth.mjs", "import path does not resolve: ../../lib/proxy-bootstrap.mjs"],
    ]);
  });

  it("flags a bootstrap import that is not the FIRST import (ESM evaluates in source order)", () => {
    const files = baseFiles({
      "scripts/not-first.mjs":
        `import { readFileSync } from "node:fs";\n${GOOD_IMPORT}\nfetch("https://example.com");\n`,
    });
    const { offenders } = findProxyBootstrapOffenders(files);
    expect(offenders).toEqual([
      ["scripts/not-first.mjs", "proxy-bootstrap is not the first import"],
    ]);
  });

  it("flags an imported-but-never-called bootstrap", () => {
    const files = baseFiles({
      "scripts/never-called.mjs":
        `import { ensureProxyAwareEntry } from "./lib/proxy-bootstrap.mjs";\nfetch("https://example.com");\n`,
    });
    const { offenders } = findProxyBootstrapOffenders(files);
    expect(offenders).toEqual([
      [
        "scripts/never-called.mjs",
        "imports the bootstrap but never calls ensureProxyAwareEntry(import.meta.url)",
      ],
    ]);
  });

  it("clears a well-formed bootstrap: first import, resolves, and called", () => {
    const files = baseFiles({
      "scripts/well-formed.mjs": `${GOOD_IMPORT}\nfetch("https://example.com");\n`,
    });
    const { offenders } = findProxyBootstrapOffenders(files);
    expect(offenders).toEqual([]);
  });
});
