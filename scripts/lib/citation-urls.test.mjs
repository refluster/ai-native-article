// Tests for the citation-resolution gate (issue #673).
//
// `node:test`, reachable via `npm run test:scripts` (scripts/lib/*.test.mjs).
// `verifyCitationsResolve` takes an injectable `fetchImpl` so these run with
// no network access — the point of the regression is the gate's *logic*
// (which citations count as resolved, what a mixed pass/fail verdict looks
// like), not live reachability of any particular URL.

// citation-urls.mjs now issues a real fetch() of its own (the agent-proxy
// status probe, wf:dario's A1 finding on #726) — R-14 (check-proxy-bootstrap)
// follows transitive imports, so this test file is network-touching too.
import { ensureProxyAwareEntry } from "./proxy-bootstrap.mjs";
ensureProxyAwareEntry(import.meta.url);

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

// wf:dario's A1 finding on #726: a CCR session's egress proxy denies some
// hosts outright, and that failure is indistinguishable at the `fetch()`
// layer from a genuinely dead URL — both throw the same bare error. The gate
// must not report the two identically once it has a way to tell them apart.
test("verifyCitationsResolve labels a plain network error distinctly from an egress-policy block", async () => {
  const fetchImpl = async () => {
    throw new Error("fetch failed");
  };
  const result = await verifyCitationsResolve("https://example.com/plain-network-error", {
    fetchImpl,
    probeProxyBlock: async () => null, // no proxy in this environment / host not in its recent failures
  });
  assert.equal(result.ok, false);
  assert.match(result.checked[0].status, /^error: fetch failed$/);
});

test("verifyCitationsResolve surfaces the agent proxy's own diagnosis when the proxy just rejected this exact host", async () => {
  const fetchImpl = async () => {
    throw new Error("fetch failed");
  };
  const seenHosts = [];
  const probeProxyBlock = async (url) => {
    seenHosts.push(url);
    return "gateway answered 502 to CONNECT (policy denial or upstream failure)";
  };
  const result = await verifyCitationsResolve("https://blocked.example/path", { fetchImpl, probeProxyBlock });
  assert.equal(result.ok, false);
  assert.match(result.checked[0].status, /network-policy-block, not a confirmed dead link/);
  assert.match(result.checked[0].status, /policy denial or upstream failure/);
  assert.deepEqual(seenHosts, ["https://blocked.example/path"]);
});

test("verifyCitationsResolve never lets a failed proxy-status probe itself crash the check", async () => {
  const fetchImpl = async () => {
    throw new Error("fetch failed");
  };
  const probeProxyBlock = async () => {
    throw new Error("status endpoint unreachable");
  };
  // Exercised indirectly: a real bug here would surface as an unhandled
  // rejection / thrown error out of verifyCitationsResolve, not a status
  // string, so asserting the call resolves at all is the regression this
  // guards.
  const result = await verifyCitationsResolve("https://example.com/probe-itself-fails", {
    fetchImpl,
    probeProxyBlock,
  });
  assert.equal(result.ok, false);
  assert.match(result.checked[0].status, /^error: fetch failed$/);
});

// wf:ren's B1 finding on #726, cycle 2: `defaultProxyBlockProbe` reads
// `process.env.HTTPS_PROXY || process.env.https_proxy` — clearing only the
// uppercase var leaves the lowercase one (set in this sandbox, and in any
// real CCR session per proxy-bootstrap.mjs) to satisfy the "proxy configured"
// check, so the claimed no-op path never actually ran; the test passed
// before only because the live call it made happened to return no match, not
// because the early return fired. Both casings are now cleared, and a
// fetch stub proves the early return fires (no network call reaches it) —
// the assertion no longer depends on a reachable proxy endpoint.
test("the real (non-injected) proxy probe is a no-op when HTTPS_PROXY/https_proxy are both unset (local dev / CI)", async () => {
  const originalProxy = process.env.HTTPS_PROXY;
  const originalProxyLower = process.env.https_proxy;
  delete process.env.HTTPS_PROXY;
  delete process.env.https_proxy;
  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new Error("must not fetch — no proxy configured, the probe must return before ever calling fetch");
  };
  try {
    const fetchImpl = async () => {
      throw new Error("fetch failed");
    };
    // No `probeProxyBlock` override — exercises the real default, which must
    // stay inert (return null, not throw or hang) outside a proxied session.
    const result = await verifyCitationsResolve("https://example.com/no-proxy-env", { fetchImpl });
    assert.equal(result.ok, false);
    assert.match(result.checked[0].status, /^error: fetch failed$/);
  } finally {
    if (originalProxy !== undefined) process.env.HTTPS_PROXY = originalProxy;
    else delete process.env.HTTPS_PROXY;
    if (originalProxyLower !== undefined) process.env.https_proxy = originalProxyLower;
    else delete process.env.https_proxy;
    global.fetch = originalFetch;
  }
});

// wf:ren's B2 finding on #726, cycle 2: every prior test exercised
// `verifyCitationsResolve`'s wiring around an *injected* `probeProxyBlock` —
// the real matching logic inside `defaultProxyBlockProbe` itself (host/port
// equality, the `withinMs` recency arithmetic, the `connect_rejected` kind
// filter, parsing `recentRelayFailures[]`) never ran against a realistic
// payload. These two tests mock the status-endpoint `fetch` directly and
// exercise the real (non-injected) default probe.
test("the real proxy-status probe matches a recent connect_rejected entry for the exact host, and ignores non-matching entries in the same response", async () => {
  const originalProxy = process.env.HTTPS_PROXY;
  const originalProxyLower = process.env.https_proxy;
  process.env.HTTPS_PROXY = "http://127.0.0.1:9999";
  delete process.env.https_proxy;
  const originalFetch = global.fetch;
  const now = new Date().toISOString();
  const stale = new Date(Date.now() - 60_000).toISOString(); // outside the default 30s window
  global.fetch = async (url) => {
    assert.equal(url, "http://127.0.0.1:9999/__agentproxy/status");
    return {
      ok: true,
      json: async () => ({
        recentRelayFailures: [
          // Wrong host — must not match.
          { host: "other.example:443", kind: "connect_rejected", ts: now, detail: "wrong host" },
          // Right host, wrong kind — must not match.
          { host: "blocked.example:443", kind: "timeout", ts: now, detail: "wrong kind" },
          // Right host and kind, but stale — must not match.
          { host: "blocked.example:443", kind: "connect_rejected", ts: stale, detail: "stale" },
          // The real match: right host, right kind, recent.
          {
            host: "blocked.example:443",
            kind: "connect_rejected",
            ts: now,
            detail: "gateway answered 502 to CONNECT (policy denial or upstream failure)",
          },
        ],
      }),
    };
  };
  try {
    const fetchImpl = async () => {
      throw new Error("fetch failed");
    };
    const result = await verifyCitationsResolve("https://blocked.example/path", { fetchImpl });
    assert.equal(result.ok, false);
    assert.match(result.checked[0].status, /network-policy-block, not a confirmed dead link/);
    assert.match(result.checked[0].status, /policy denial or upstream failure/);
  } finally {
    if (originalProxy !== undefined) process.env.HTTPS_PROXY = originalProxy;
    else delete process.env.HTTPS_PROXY;
    if (originalProxyLower !== undefined) process.env.https_proxy = originalProxyLower;
    else delete process.env.https_proxy;
    global.fetch = originalFetch;
  }
});

test("the real proxy-status probe returns no diagnosis when nothing in recentRelayFailures matches", async () => {
  const originalProxy = process.env.HTTPS_PROXY;
  const originalProxyLower = process.env.https_proxy;
  process.env.HTTPS_PROXY = "http://127.0.0.1:9999";
  delete process.env.https_proxy;
  const originalFetch = global.fetch;
  const now = new Date().toISOString();
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      recentRelayFailures: [
        { host: "other.example:443", kind: "connect_rejected", ts: now, detail: "wrong host" },
      ],
    }),
  });
  try {
    const fetchImpl = async () => {
      throw new Error("fetch failed");
    };
    const result = await verifyCitationsResolve("https://not-blocked.example/path", { fetchImpl });
    assert.equal(result.ok, false);
    // No matching entry -> falls back to the bare fetch error, not the
    // proxy-block diagnosis.
    assert.match(result.checked[0].status, /^error: fetch failed$/);
  } finally {
    if (originalProxy !== undefined) process.env.HTTPS_PROXY = originalProxy;
    else delete process.env.HTTPS_PROXY;
    if (originalProxyLower !== undefined) process.env.https_proxy = originalProxyLower;
    else delete process.env.https_proxy;
    global.fetch = originalFetch;
  }
});
