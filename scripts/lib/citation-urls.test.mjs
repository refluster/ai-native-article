// Tests for the citation-resolution gate (issue #673).
//
// `node:test`, reachable via `npm run test:scripts` (scripts/lib/*.test.mjs).
// `verifyCitationsResolve` takes an injectable `fetchImpl` so these run with
// no network access — the point of the regression is the gate's *logic*
// (which citations count as resolved, what a mixed pass/fail verdict looks
// like), not live reachability of any particular URL.

import { test } from "node:test";
import assert from "node:assert/strict";

import { extractCitationUrls, verifyCitationsResolve } from "./citation-urls.mjs";

test("extractCitationUrls finds a bare URL", () => {
  assert.deepEqual(extractCitationUrls("Some Source — https://example.com/a/b"), [
    "https://example.com/a/b",
  ]);
});

test("extractCitationUrls strips trailing sentence punctuation, not URL structure", () => {
  assert.deepEqual(extractCitationUrls("See https://example.com/path (accessed today)."), [
    "https://example.com/path",
  ]);
  // A trailing paren that is part of the URL's own path must survive — only
  // punctuation the surrounding prose added should be stripped.
  assert.deepEqual(extractCitationUrls("https://example.com/wiki/Foo_(bar)"), [
    "https://example.com/wiki/Foo_(bar)",
  ]);
});

test("extractCitationUrls de-duplicates and finds multiple sources", () => {
  const text = "One: https://a.example/1\nTwo: https://b.example/2\nAgain: https://a.example/1";
  assert.deepEqual(extractCitationUrls(text), ["https://a.example/1", "https://b.example/2"]);
});

test("extractCitationUrls returns [] for a citations file with no URL", () => {
  assert.deepEqual(extractCitationUrls("Reuters, 2026-09-01, page A1."), []);
});

test("verifyCitationsResolve fails when the text carries no URL at all", async () => {
  // This is the exact defect issue #673 named: a single non-empty character
  // ("x") passed the old non-empty-string check while citing nothing.
  const result = await verifyCitationsResolve("x", { fetchImpl: async () => {
    throw new Error("must not fetch — there is no URL to check");
  } });
  assert.equal(result.ok, false);
  assert.match(result.reason, /no citation URL found/);
  assert.deepEqual(result.checked, []);
});

test("verifyCitationsResolve passes when every cited URL resolves (HEAD 200)", async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, method: init.method });
    return { ok: true, status: 200 };
  };
  const result = await verifyCitationsResolve("Source A: https://a.example/x\nSource B: https://b.example/y", { fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(result.checked.length, 2);
  assert.ok(result.checked.every((c) => c.ok));
  assert.ok(seen.every((s) => s.method === "HEAD"));
});

test("verifyCitationsResolve falls back to GET when a server rejects HEAD (405)", async () => {
  const methodsSeen = [];
  const fetchImpl = async (url, init) => {
    methodsSeen.push(init.method);
    if (init.method === "HEAD") return { ok: false, status: 405 };
    return { ok: true, status: 200 };
  };
  const result = await verifyCitationsResolve("https://example.com/head-not-allowed", { fetchImpl });
  assert.equal(result.ok, true);
  assert.deepEqual(methodsSeen, ["HEAD", "GET"]);
});

test("verifyCitationsResolve fails and names the dead URL when one of several 404s", async () => {
  const fetchImpl = async (url) => {
    if (url === "https://example.com/dead") return { ok: false, status: 404 };
    return { ok: true, status: 200 };
  };
  const result = await verifyCitationsResolve(
    "Good: https://example.com/alive\nBad: https://example.com/dead",
    { fetchImpl },
  );
  assert.equal(result.ok, false);
  assert.match(result.reason, /1\/2 citation URL\(s\) do not resolve/);
  assert.match(result.reason, /https:\/\/example\.com\/dead \(404\)/);
});

test("verifyCitationsResolve treats a network error / timeout as non-resolving, not a crash", async () => {
  const fetchImpl = async () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    throw err;
  };
  const result = await verifyCitationsResolve("https://example.com/times-out", { fetchImpl, timeoutMs: 5 });
  assert.equal(result.ok, false);
  assert.equal(result.checked[0].status, "timeout");
});
