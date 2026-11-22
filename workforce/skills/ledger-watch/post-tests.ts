// @ts-nocheck — ledger-payload.mjs is a dependency-free ESM module, not TS (same convention as issue-execute-queue-tests.ts).
// Tests for ledger-watch/post.mjs — the feed-receipt → ledger write.
//
// The script is driven as a child process (the interface the agent-runner
// sees: argv + env in, exit code + one JSON stdout line out) against an
// in-process stub HTTP server that plays both the workforce feed and the
// project ledger. Every request the script makes is recorded, so the
// "nothing touched the network" cases are asserted, not assumed.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  LEDGER_CONTRACT_MAJOR, checkBlockedAttempts, ledgerContract, normalizeUrl, usesContractV11, usesContractV13,
  validatePayload, validateSummary,
} from "./ledger-payload.mjs";

const SCRIPT = join(__dirname, "post.mjs");
const META_VERSION = JSON.parse(readFileSync(join(__dirname, "meta.json"), "utf8")).version as string;
const dir = mkdtempSync(join(tmpdir(), "ledger-watch-"));
const TODAY = new Date().toISOString().slice(0, 10);
const KNOWN = ["example_hpwh_rebate", "example_new_program"];

// ── stub server ──────────────────────────────────────────────────────────────
interface Req { method: string; path: string; search: string; headers: IncomingMessage["headers"]; body: string }
interface Stub {
  requests: Req[];
  posts: Map<string, { agent_slug: string; body: string }>;
  feedStatus: number | null;          // force a feed POST status
  tamperReadBack: boolean;            // serve a different body on read-back
  ledgerPlan: Array<number | "drop">; // per-attempt ledger status (last repeats)
  ledgerDispositions: string[] | null;
  knownCodes: string[] | null;        // null → worklist answers 503
  contractVersion: unknown;           // undefined → the worklist carries no contract_version
  seedUrls: boolean;                  // the v1.1 worklist field discovery.seed_urls
  feedFault: "drop" | "hang" | null;  // store the post, then drop the socket / never answer
  items: unknown[];                   // worklist items (v1.3: sources with access / attempt_once)
}
const DEFAULTS = {
  feedStatus: null, tamperReadBack: false, ledgerPlan: [200], ledgerDispositions: null, knownCodes: KNOWN,
  contractVersion: undefined, seedUrls: true, feedFault: null, items: [],
};
const stub: Stub = { requests: [], posts: new Map(), ...DEFAULTS } as Stub;
let server: Server;
let base = "";

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

beforeAll(async () => {
  server = createServer((req, res) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://stub");
      stub.requests.push({ method: req.method ?? "", path: url.pathname, search: url.search, headers: req.headers, body: data });
      // feed
      if (req.method === "POST" && url.pathname === "/prod/feed") {
        if (stub.feedStatus) return send(res, stub.feedStatus, { error: "forced" });
        if (req.headers.authorization !== "Bearer good-token") return send(res, 401, { error: "unauthorized" });
        const j = JSON.parse(data);
        const id = `00TEST${String(stub.posts.size).padStart(20, "0")}`;
        stub.posts.set(id, { agent_slug: j.agent_slug, body: j.body.trim() });
        if (stub.feedFault === "drop") return req.socket.destroy(); // stored, but the client never hears
        if (stub.feedFault === "hang") return;                       // stored, never answered
        return send(res, 201, { post_id: id, agent_slug: j.agent_slug, kind: j.kind });
      }
      const m = /^\/prod\/feed\/([^/]+)$/.exec(url.pathname);
      if (req.method === "GET" && m) {
        const p = stub.posts.get(decodeURIComponent(m[1]!));
        if (!p) return send(res, 404, { error: "not_found" });
        return send(res, 200, { ...p, body: stub.tamperReadBack ? "someone else's prose" : p.body });
      }
      // ledger
      if (req.method === "GET" && url.pathname === "/v1/worklist") {
        if (!stub.knownCodes) return send(res, 503, { error: { code: "down", message: "x" } });
        return send(res, 200, {
          agent: url.searchParams.get("agent"), items: stub.items, count: stub.items.length,
          discovery: { territory: "t", equipment: [], known_codes: stub.knownCodes,
            ...(stub.seedUrls ? { seed_urls: [{ url: "https://example.org/rebates", look_for: "program list" }] } : {}) },
          server_time: new Date().toISOString(),
          ...(stub.contractVersion !== undefined ? { contract_version: stub.contractVersion } : {}),
        });
      }
      if (req.method === "POST" && url.pathname === "/v1/observations") {
        const n = stub.requests.filter((r) => r.path === "/v1/observations").length;
        const plan = stub.ledgerPlan[Math.min(n - 1, stub.ledgerPlan.length - 1)];
        if (plan === "drop") return req.socket.destroy();
        if (plan !== 200) return send(res, plan!, { error: { code: plan === 403 ? "attestation_failed" : "boom", message: "x" } });
        const j = JSON.parse(data);
        const payload = JSON.parse(j.payload);
        const results = payload.observations.map((_: unknown, i: number) => ({
          index: i,
          id: `obs${i}`,
          disposition: stub.ledgerDispositions?.[i] ?? "auto_applied",
          ...(stub.ledgerDispositions?.[i] === "rejected" ? { reason: "unknown_program" } : {}),
        }));
        return send(res, 200, { run_id: "run-1", results });
      }
      send(res, 404, { error: "no_route" });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => { server.closeAllConnections?.(); server.close(() => r()); }));
beforeEach(() => {
  Object.assign(stub, { requests: [], ...DEFAULTS });
  stub.posts.clear();
});

// ── fixtures ─────────────────────────────────────────────────────────────────
function observation(over: Record<string, unknown> = {}) {
  return {
    program_code: "example_hpwh_rebate",
    change_type: "verified_no_change",
    observed_at: TODAY,
    summary: "Program page unchanged: still open, same amount.",
    evidence: [{ url: "https://example.org/rebate", quote: "Rebates are available while funds last.", page_date: null, primary_source: true }],
    confidence: "high",
    ...over,
  };
}
function payload(over: Record<string, unknown> = {}, obs: unknown[] = [observation()]) {
  return {
    run: {
      agent_slug: "soledad", started_at: new Date(Date.now() - 3_600_000).toISOString(), checked_programs: ["example_hpwh_rebate"],
      fetch_failures: [], discovery_queries: ["heat pump water heater rebate"], discovery_mode: "search", ...over,
    },
    observations: obs,
  };
}
const SUMMARY =
  "Ledger check, as of today: 1 program re-read, no change (still open). Source: https://example.org/rebate";

let seq = 0;
function files(p: unknown, summary = SUMMARY) {
  seq += 1;
  const pf = join(dir, `payload-${seq}.json`);
  const sf = join(dir, `summary-${seq}.md`);
  writeFileSync(pf, typeof p === "string" ? p : JSON.stringify(p, null, 2));
  writeFileSync(sf, summary);
  return { pf, sf };
}

interface Run { status: number | null; stdout: string; stderr: string; json: Record<string, any> | null }
function run(
  p: unknown,
  { summary = SUMMARY, ledger = "default", env = {}, skillVersion }:
    { summary?: string; ledger?: string | null; env?: Record<string, string | undefined>; skillVersion?: string } = {},
): Promise<Run> {
  const { pf, sf } = files(p, summary);
  const args = [SCRIPT, "--agent", "soledad", "--payload-file", pf, "--summary-file", sf];
  if (skillVersion !== undefined) args.push("--skill-version", skillVersion);
  if (ledger !== null) args.push("--ledger-url", ledger === "default" ? base : ledger);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      env: {
        ...process.env,
        HTTPS_PROXY: "", https_proxy: "", HTTP_PROXY: "", http_proxy: "",
        LEDGER_API_URL: "",
        FEED_WRITE_TOKEN: "good-token",
        FEED_WRITE_TOKEN_API_URL: `${base}/prod/feed`,
        LEDGER_RETRY_BASE_MS: "1",
        ...env,
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("close", (status) => {
      let json = null;
      try { json = JSON.parse(stdout.trim().split("\n").pop() ?? ""); } catch { /* none */ }
      resolve({ status, stdout, stderr, json });
    });
  });
}
const ledgerCalls = () => stub.requests.filter((r) => r.path === "/v1/observations");
const feedPosts = () => stub.requests.filter((r) => r.method === "POST" && r.path === "/prod/feed");

// ── tests ────────────────────────────────────────────────────────────────────
describe("ledger-watch/post.mjs", () => {
  it("happy path: receipt posted, read back, ledger accepts", async () => {
    const r = await run(payload());
    expect(r.status).toBe(0);
    expect(r.json).toMatchObject({ ok: true, stage: "done", run_id: "run-1", counts: { auto_applied: 1, rejected: 0 } });
    expect(r.json?.results[0]).toMatchObject({ program_code: "example_hpwh_rebate", disposition: "auto_applied" });
    expect(feedPosts()).toHaveLength(1);
    expect(ledgerCalls()).toHaveLength(1);
    const sent = JSON.parse(ledgerCalls()[0]!.body);
    expect(sent.attestation).toEqual({ agent_slug: "soledad", post_id: r.json?.post_id });
    expect(ledgerCalls()[0]!.headers.authorization).toBeUndefined(); // no workforce secret leaves for the ledger
    expect(r.stderr).not.toContain("good-token");
    expect(r.stdout).not.toContain("good-token");
  });

  it("the receipt hash is sha256 of the exact payload string sent to the ledger", async () => {
    const r = await run(payload());
    const sent = JSON.parse(ledgerCalls()[0]!.body);
    expect(typeof sent.payload).toBe("string");
    const hex = createHash("sha256").update(Buffer.from(sent.payload, "utf8")).digest("hex");
    expect(r.json?.receipt_sha256).toBe(hex);
    const feedBody = JSON.parse(feedPosts()[0]!.body).body as string;
    expect(feedBody.endsWith(`\n\nledger-receipt: sha256:${hex}`)).toBe(true);
    expect(JSON.parse(feedPosts()[0]!.body).kind).toBe("observation");
    // skill_version is filled into the run from meta.json before hashing
    expect(JSON.parse(sent.payload).run.skill_version).toBe(META_VERSION);
    expect(JSON.parse(feedPosts()[0]!.body).skill_version).toBe(META_VERSION);
  });

  it("local validation failures exit 2 and touch no network", async () => {
    const cases: unknown[] = [
      payload({ agent_slug: "valeria" }),                                            // slug mismatch
      payload({}, [observation({ change_type: "status_changed" })]),                 // proposed missing
      payload({}, [observation({ evidence: [{ url: "http://example.org", quote: "x", primary_source: true }] })]),
      payload({}, Array.from({ length: 21 }, () => observation())),                  // > 20
      payload({}, [observation({ observed_at: "2999-01-01" })]),                     // future
      payload({ fetch_failures: [{ url: "https://example.org/rebate", reason: "HTTP 403" }] }), // no_change on an unread page
    ];
    for (const p of cases) {
      const r = await run(p);
      expect(r.status, r.stderr).toBe(2);
      expect(r.json?.stage).toBe("validate");
    }
    const bad = await run(payload(), { summary: "Here is the ledger update: https://example.org/rebate all good" });
    expect(bad.status).toBe(2);
    expect(stub.requests).toHaveLength(0);
  });

  it("missing --ledger-url fails loud before any network call", async () => {
    const r = await run(payload(), { ledger: null });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("--ledger-url is required");
    expect(stub.requests).toHaveLength(0);
  });

  it("feed 401 exits 2 and never calls the ledger", async () => {
    const r = await run(payload(), { env: { FEED_WRITE_TOKEN: "wrong" } });
    expect(r.status).toBe(2);
    expect(r.json?.stage).toBe("feed");
    expect(ledgerCalls()).toHaveLength(0);
  });

  it("read-back mismatch exits 2 and never attests the post", async () => {
    stub.tamperReadBack = true;
    const r = await run(payload());
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("read-back MISMATCH");
    expect(r.json?.orphan_receipt?.post_id).toBeTruthy();
    expect(ledgerCalls()).toHaveLength(0);
  });

  it("ledger 403 (attestation failed) exits 2 and names the orphan receipt", async () => {
    stub.ledgerPlan = [403];
    const r = await run(payload());
    expect(r.status).toBe(2);
    expect(r.json?.orphan_receipt).toMatchObject({ post_id: r.json?.post_id, reason: "HTTP 403" });
    expect(ledgerCalls()).toHaveLength(1); // 4xx is not retried
  });

  it("ledger 5xx / dropped connection is retried, then succeeds", async () => {
    stub.ledgerPlan = [503, "drop", 200];
    const r = await run(payload());
    expect(r.status).toBe(0);
    expect(r.json?.ledger_attempts).toBe(3);
    expect(ledgerCalls()).toHaveLength(3);
    // every attempt carries the identical bytes the receipt hashed
    expect(new Set(ledgerCalls().map((c) => c.body)).size).toBe(1);
  });

  it("ledger 5xx on every attempt exits 3 with the orphan receipt", async () => {
    stub.ledgerPlan = [502];
    const r = await run(payload());
    expect(r.status).toBe(3);
    expect(r.json?.orphan_receipt?.post_id).toBe(r.json?.post_id);
    expect(ledgerCalls()).toHaveLength(3);
  });

  it("partial `rejected` results exit 2 but report every disposition", async () => {
    stub.ledgerDispositions = ["pending_review", "rejected"];
    const second = observation({
      program_code: "example_new_program",
      change_type: "status_changed",
      proposed: { status: "suspended" },
    });
    const r = await run(payload({}, [observation({ change_type: "status_changed", proposed: { status: "closed" } }), second]));
    expect(r.status).toBe(2);
    expect(r.json?.counts).toMatchObject({ pending_review: 1, rejected: 1 });
    expect(r.json?.results[1]).toMatchObject({ disposition: "rejected", reason: "unknown_program" });
  });
});

describe("ledger-watch/post.mjs — known codes", () => {
  it("an observation on a code the ledger does not hold fails before the receipt", async () => {
    const r = await run(payload({}, [observation({ program_code: "not_in_ledger" })]));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("not_in_ledger");
    expect(feedPosts()).toHaveLength(0);
    expect(stub.requests.map((q) => q.path)).toEqual(["/v1/worklist"]);
  });

  it("an unknown fetch_failures[].program_code fails before the receipt", async () => {
    const r = await run(payload({ fetch_failures: [{ url: "https://example.org/other", reason: "HTTP 403", program_code: "not_in_ledger" }] }));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("fetch_failures[0].program_code");
    expect(feedPosts()).toHaveLength(0);
  });

  it("an unreachable worklist exits 3 before the receipt", async () => {
    stub.knownCodes = null;
    const r = await run(payload());
    expect(r.status).toBe(3);
    expect(feedPosts()).toHaveLength(0);
    expect(r.json?.orphan_receipt).toBeUndefined();
  });

  it("a new_program code need not be known", async () => {
    const np = observation({
      program_code: "example_brand_new",
      change_type: "new_program",
      proposed: { name: "Example new rebate", status: "open", equipment: ["hpwh"] },
    });
    const r = await run(payload({}, [np]));
    expect(r.status, r.stderr).toBe(0);
  });
});

describe("ledger-watch/post.mjs — skill version (A3)", () => {
  it("reads the version from meta.json when --skill-version is omitted", async () => {
    const r = await run(payload());
    expect(r.status, r.stderr).toBe(0);
    expect(r.json?.skill_version).toBe(META_VERSION);
  });

  it("accepts a --skill-version equal to meta.json", async () => {
    const r = await run(payload(), { skillVersion: META_VERSION });
    expect(r.status, r.stderr).toBe(0);
  });

  it("a --skill-version that differs from meta.json exits 1 before any network call", async () => {
    const r = await run(payload(), { skillVersion: "0.0.1" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`differs from meta.json "${META_VERSION}"`);
    expect(stub.requests).toHaveLength(0);
  });

  it("a payload whose run.skill_version differs from meta.json is a validation error", async () => {
    const r = await run(payload({ skill_version: "0.0.1" }));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("run.skill_version");
    expect(stub.requests).toHaveLength(0);
  });
});

describe("ledger-watch/post.mjs — contract handshake (A2)", () => {
  it("no contract_version: proceeds with one stderr warning", async () => {
    const r = await run(payload());
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr.split("\n").filter((l) => l.includes("contract_version"))).toHaveLength(1);
  });

  it("a matching major proceeds without the warning", async () => {
    stub.contractVersion = `${LEDGER_CONTRACT_MAJOR}.1`;
    const r = await run(payload());
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).not.toContain("warning");
    expect(r.json?.ledger_contract).toBe(`${LEDGER_CONTRACT_MAJOR}.1`);
  });

  it("a different major exits 3 before the receipt", async () => {
    stub.contractVersion = `${LEDGER_CONTRACT_MAJOR + 1}.0`;
    const r = await run(payload());
    expect(r.status).toBe(3);
    expect(r.json?.stage).toBe("contract");
    expect(r.stderr).toContain(`contract v${LEDGER_CONTRACT_MAJOR + 1}.0`);
    expect(feedPosts()).toHaveLength(0);
    expect(ledgerCalls()).toHaveLength(0);
  });

  it("an unreadable contract_version exits 3 before the receipt", async () => {
    stub.contractVersion = "v-next";
    const r = await run(payload());
    expect(r.status).toBe(3);
    expect(feedPosts()).toHaveLength(0);
  });

  it("a v1.1 payload to a ledger that does not advertise v1.1 exits 3 before the receipt", async () => {
    stub.seedUrls = false; // a v1.0 worklist, no contract_version
    const unconfirmed = observation({ change_type: "unconfirmed", summary: "The page does not state the current amount." });
    const r = await run(payload({}, [unconfirmed]));
    expect(r.status).toBe(3);
    expect(r.stderr).toContain("deploy the ledger first");
    expect(feedPosts()).toHaveLength(0);
    // … while a 0.1.x-shaped payload still goes through to the same ledger
    const ok = await run(payload());
    expect(ok.status, ok.stderr).toBe(0);
  });

  it("unconfirmed + fetch_failures[].program_code go through to a v1.1 ledger", async () => {
    const unconfirmed = observation({ change_type: "unconfirmed", summary: "The page does not state the current amount." });
    const r = await run(payload({ fetch_failures: [{ url: "https://example.org/other", reason: "HTTP 403", program_code: "example_new_program" }] }, [unconfirmed]));
    expect(r.status, r.stderr).toBe(0);
    const sent = JSON.parse(JSON.parse(ledgerCalls()[0]!.body).payload);
    expect(sent.observations[0].change_type).toBe("unconfirmed");
    expect(sent.run.fetch_failures[0].program_code).toBe("example_new_program");
    expect(sent.run.discovery_mode).toBe("search");
  });
});

describe("ledger-watch/post.mjs — feed-stage failures (possible orphan receipt)", () => {
  const hex = (r: Run) => r.json?.receipt_sha256 as string;

  it("a dropped connection after the feed stored the post reports a possible orphan and exits 3", async () => {
    stub.feedFault = "drop";
    const r = await run(payload());
    expect(r.status).toBe(3);
    expect(r.json).toMatchObject({ ok: false, stage: "feed", possible_orphan_receipt: true });
    expect(hex(r)).toMatch(/^[0-9a-f]{64}$/);
    expect(r.stderr).toContain(`ledger-receipt: sha256:${hex(r)}`);
    // the post really exists and carries that hash; the ledger was never called
    expect([...stub.posts.values()][0]!.body.endsWith(`ledger-receipt: sha256:${hex(r)}`)).toBe(true);
    expect(ledgerCalls()).toHaveLength(0);
    expect(feedPosts()).toHaveLength(1); // no second receipt
  });

  it("a feed timeout reports a possible orphan and exits 3", async () => {
    stub.feedFault = "hang";
    const r = await run(payload(), { env: { FEED_TIMEOUT_MS: "300" } });
    expect(r.status).toBe(3);
    expect(r.json?.possible_orphan_receipt).toBe(true);
    expect(ledgerCalls()).toHaveLength(0);
  });

  it("a feed 5xx reports a possible orphan; a feed 401 does not", async () => {
    stub.feedStatus = 502;
    const r = await run(payload());
    expect(r.status).toBe(3);
    expect(r.json?.possible_orphan_receipt).toBe(true);
    stub.feedStatus = null;
    const unauth = await run(payload(), { env: { FEED_WRITE_TOKEN: "wrong" } });
    expect(unauth.status).toBe(2);
    expect(unauth.json?.possible_orphan_receipt).toBeUndefined();
  });
});

describe("ledger-payload.mjs", () => {
  const CTX = { agent: "soledad", skillVersion: "0.1.0", now: new Date() };
  const errs = (o: unknown) => validatePayload(payload({}, [o]), CTX).errors.join("\n");

  it("proposed must be absent on verified_no_change and note", () => {
    expect(errs(observation({ proposed: { status: "open" } }))).toMatch(/proposed: must be absent/);
    expect(errs(observation({ change_type: "note", proposed: {} }))).toMatch(/proposed: must be absent/);
    expect(errs(observation({ change_type: "note", proposed: null }))).toBe(""); // the ledger reads null as absent
  });

  it("new_program needs a status and a name", () => {
    const np = (proposed: unknown) => observation({ program_code: "example_brand_new", change_type: "new_program", proposed });
    expect(errs(np({ name: "X rebate" }))).toMatch(/proposed\.status: is required/);
    expect(errs(np({ status: "open" }))).toMatch(/name, name_ja or reference/);
    expect(errs(np({ status: "open", reference: "Utility X rebate page" }))).toBe("");
  });

  it("proposed keys, nested keys, enums and dates are checked like the ledger", () => {
    const sc = (proposed: unknown) => observation({ change_type: "requirements_changed", proposed });
    expect(errs(sc({ eligibility: true }))).toMatch(/not a known program field/);
    expect(errs(sc({ process: { install_by: "2026-12-31", apply_within_days: 90 } }))).toMatch(/process\.apply_within_days/);
    expect(errs(sc({ jurisdiction: { utilities: [{ type: "propane", id: "x" }] } }))).toMatch(/utilities\[0\]\.type/);
    expect(errs(sc({ budget: { remaining_usd: -1 } }))).toMatch(/budget\.remaining_usd/);
    expect(errs(sc({ form: { pdf: "https://x.example" } }))).toMatch(/form\.pdf/);
    expect(errs(sc({ equipment: ["tankless"] }))).toMatch(/equipment\[0\]/);
    expect(errs(sc({ customer_segments: ["renter"] }))).toMatch(/customer_segments\[0\]/);
    expect(errs(sc({ owner_desk: "naomi" }))).toMatch(/owner_desk/);
    expect(errs(observation({ change_type: "status_changed", proposed: { status: "candidate" } }))).toMatch(/proposed\.status/);
    expect(errs(observation({ change_type: "deadline_changed", proposed: { deadline: "2026-02-30" } }))).toMatch(/deadline/);
    expect(errs(sc({ last_verified_at: "2026-11-19" }))).toMatch(/last_verified_at/);
    expect(errs(sc({ process: { install_by: "2026-12-31", payee_options: ["contractor"] }, equipment: ["hpwh"] }))).toBe("");
  });

  it("forbidden fields include attention, created_*, verify_interval_effective and the v1.1 operational marks", () => {
    for (const k of ["attention", "created_at", "created_by", "verify_interval_effective", "version", "code",
      "needs_human", "fetch_fail_streak", "fetch_fail_run",
      "secondary_verified_at", "secondary_checked_by", "human_verified_at", "applied_patches", "watch_mode", "human_check_due_at"]) {
      expect(errs(observation({ change_type: "status_changed", proposed: { status: "open", [k]: 1 } }))).toMatch(new RegExp(`proposed\\.${k}: is not writable`));
    }
  });

  it("evidence and next_actions reject unknown keys; null detail/due are fine", () => {
    expect(errs(observation({ evidence: [{ url: "https://x.example", quote: "q", primary_source: true, title: "t" }] }))).toMatch(/evidence\[0\]\.title/);
    expect(errs(observation({ next_actions: [{ type: "recheck", owner: "me" }] }))).toMatch(/next_actions\[0\]\.owner/);
    expect(errs(observation({ next_actions: [{ type: "recheck", detail: null, due: null }] }))).toBe("");
  });

  it("date-times are checked field by field, as Python's fromisoformat does", () => {
    const at = (s: string) => validatePayload(payload({ started_at: s }, []), CTX).errors.join("\n");
    expect(at("2026-11-19T10:00:00Z")).toBe("");
    expect(at("2026-11-19T10:00:00+09:00")).toBe("");
    for (const bad of ["2026-02-30T00:00:00Z", "2026-11-19T24:00:00Z", "2026-11-19T23:60:00Z", "2026-11-19T23:59:60Z", "2026-11-19T10:00:00+24:00", "2026-11-19T10:00:00"]) {
      expect(at(bad), bad).toMatch(/run\.started_at/);
    }
  });

  it("observed_at tolerates the ledger's +14h window but not more", () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const late = new Date(Date.UTC(2026, 10, 19, 23, 0));
    const at = (d: string) => validatePayload(payload({ started_at: "2026-11-19T20:00:00Z" }, [observation({ observed_at: d })]), { ...CTX, now: late }).errors.join("\n");
    expect(at("2026-11-20")).toBe("");
    expect(at("2026-11-21")).toMatch(/observed_at/);
    expect(tomorrow > TODAY).toBe(true);
  });

  it("accepts an empty run (programs checked, nothing to report)", () => {
    const { errors } = validatePayload(payload({}, []), CTX);
    expect(errors).toEqual([]);
  });

  it("rejects proposed fields the ledger never accepts from an observation", () => {
    const { errors } = validatePayload(
      payload({}, [observation({ change_type: "new_program", program_code: "x_new", proposed: { status: "candidate", version: 2 } })]),
      CTX,
    );
    expect(errors.join("\n")).toMatch(/proposed\.status/);
  });

  it("summary guards: JSON body, receipt line and missing link are refused", () => {
    expect(validateSummary('{"run": 1} https://example.org and more words here to pass length')).not.toEqual([]);
    expect(validateSummary(`${SUMMARY}\nledger-receipt: sha256:abc`)).not.toEqual([]);
    expect(validateSummary("No change across all programs checked today, nothing else to add.")).not.toEqual([]);
    expect(validateSummary(SUMMARY)).toEqual([]);
  });

  it("unconfirmed: evidence required, proposed refused, may not cite a failed page", () => {
    const u = (over: Record<string, unknown> = {}) => observation({ change_type: "unconfirmed", summary: "Page loads but gives no amount.", ...over });
    expect(errs(u())).toBe("");
    expect(errs(u({ proposed: { status: "open" } }))).toMatch(/proposed: must be absent for unconfirmed/);
    expect(errs(u({ evidence: [] }))).toMatch(/evidence: at least one/);
    const failed = validatePayload(
      payload({ fetch_failures: [{ url: "https://example.org/rebate", reason: "HTTP 403" }] }, [u()]), CTX,
    ).errors.join("\n");
    expect(failed).toMatch(/unconfirmed cites https:\/\/example\.org\/rebate/);
  });

  it("fetch_failures[].program_code is optional, nullable, a code, and known when codes are given", () => {
    const f = (ff: unknown, knownCodes?: Set<string>) =>
      validatePayload(payload({ fetch_failures: [ff] }, []), { ...CTX, knownCodes }).errors.join("\n");
    expect(f({ url: "https://x.example/a", reason: "HTTP 403" })).toBe("");
    expect(f({ url: "https://x.example/a", reason: "HTTP 403", program_code: null })).toBe("");
    expect(f({ url: "https://x.example/a", reason: "HTTP 403", program_code: "Bad-Code" })).toMatch(/fetch_failures\[0\]\.program_code/);
    expect(f({ url: "https://x.example/a", reason: "HTTP 403", program_code: "example_hpwh_rebate" }, new Set(KNOWN))).toBe("");
    expect(f({ url: "https://x.example/a", reason: "HTTP 403", program_code: "nope_code" }, new Set(KNOWN))).toMatch(/not in the ledger/);
    expect(f({ url: "https://x.example/a", reason: "HTTP 403", status: 403 })).toMatch(/fetch_failures\[0\]\.status/);
  });

  it("discovery_mode: required, enumerated, and consistent with the record", () => {
    const r = (over: Record<string, unknown>) => validatePayload(payload(over, []), CTX).errors.join("\n");
    expect(r({ discovery_mode: undefined })).toMatch(/run\.discovery_mode: required/);
    expect(r({ discovery_mode: "guessed" })).toMatch(/run\.discovery_mode: must be one of/);
    expect(r({ discovery_mode: "skipped", discovery_queries: [] })).toMatch(/run\.note/);
    expect(r({ discovery_mode: "skipped", discovery_queries: [], note: "no search tool; seed_urls empty" })).toBe("");
    expect(r({ discovery_mode: "seed_pages", discovery_queries: [] })).toMatch(/seed:<url>/);
    expect(r({ discovery_mode: "seed_pages", discovery_queries: ["seed:http://x.example/list"] })).toMatch(/seed:https/);
    expect(r({ discovery_mode: "seed_pages", discovery_queries: ["seed:https://x.example/list"] })).toBe("");
    expect(r({ discovery_mode: "search", discovery_queries: [] })).toMatch(/search queries/);
    expect(r({ discovery_mode: "search", discovery_queries: ["seed:https://x.example/list"] })).toMatch(/search queries/);
  });

  it("usesContractV11 flags only what a v1.0 ledger rejects", () => {
    expect(usesContractV11(payload())).toBe(false); // discovery_mode alone is ignored by a v1.0 ledger
    expect(usesContractV11(payload({}, [observation({ change_type: "unconfirmed" })]))).toBe(true);
    expect(usesContractV11(payload({ fetch_failures: [{ url: "https://x.example", reason: "r", program_code: null }] }))).toBe(true);
  });

  it("ledgerContract: absent warns, same major passes, other major or junk fails", () => {
    expect(ledgerContract({ discovery: {} })).toMatchObject({ version: null, v11: false, warning: expect.any(String) });
    expect(ledgerContract({ discovery: { seed_urls: [] } })).toMatchObject({ v11: true });
    expect(ledgerContract({ contract_version: "1.1" })).toMatchObject({ major: 1, v11: true });
    expect(ledgerContract({ contract_version: "1.0" })).toMatchObject({ major: 1, v11: false });
    expect(ledgerContract({ contract_version: 1 }).error).toBeUndefined();
    expect(ledgerContract({ contract_version: "2.0" }).error).toMatch(/contract v2\.0/);
    expect(ledgerContract({ contract_version: "1.x" }).error).toMatch(/unreadable/);
    expect(ledgerContract({ contract_version: 1.5 }).error).toMatch(/unreadable/);
  });
});

// ── 0.3.0: contract v1.3 (secondary_watch, secondary_no_change, attempt_once) ──
const BLOCKED = "https://www.example-city.gov/rebates/hpwh";
const LISTING = "https://www.example-rebate-finder.org/city/hpwh";
function watchItem(over: Record<string, unknown> = {}) {
  return {
    code: "example_hpwh_rebate", reference: "Example city HPWH rebate", status: "open", mode: "secondary_watch",
    sources: [
      { url: BLOCKED, watch: ["status"], look_for_ja: "x", primary_source: true, access: "blocked", attempt_once: true },
      { url: LISTING, watch: ["amount"], look_for_ja: "x", primary_source: false, access: "ok" },
    ],
    ...over,
  };
}
const secondaryObs = (over: Record<string, unknown> = {}) => observation({
  change_type: "secondary_no_change", confidence: "medium",
  summary: "Primary page blocked; the listing still shows the $400 rebate as available.",
  evidence: [{ url: LISTING, quote: "Heat Pump Water Heater – $400 – Available", page_date: null, primary_source: false }],
  ...over,
});
const blockedFailure = (over: Record<string, unknown> = {}) => ({ url: BLOCKED, reason: "HTTP 403", program_code: "example_hpwh_rebate", ...over });

describe("ledger-payload.mjs — v1.3 validation", () => {
  const CTX = { agent: "soledad", skillVersion: "0.1.0", now: new Date() };
  const errs = (o: unknown, run: Record<string, unknown> = {}) => validatePayload(payload(run, [o]), CTX).errors.join("\n");

  it("secondary_no_change: all-secondary evidence, no proposed, not citing a failed page", () => {
    expect(errs(secondaryObs())).toBe("");
    expect(errs(secondaryObs({ proposed: { status: "open" } }))).toMatch(/proposed: must be absent for secondary_no_change/);
    const mixed = secondaryObs({ evidence: [
      { url: LISTING, quote: "q", primary_source: false },
      { url: "https://example.org/rebate", quote: "q", primary_source: true },
    ] });
    expect(errs(mixed)).toMatch(/secondary_no_change takes only primary_source: false/);
    expect(errs(secondaryObs({ evidence: [] }))).toMatch(/evidence: at least one/);
    expect(errs(secondaryObs(), { fetch_failures: [{ url: LISTING, reason: "HTTP 403" }] })).toMatch(/could not be read/);
    // the blocked primary in fetch_failures beside a secondary_no_change is the expected shape
    expect(errs(secondaryObs(), { fetch_failures: [blockedFailure()] })).toBe("");
  });

  it("verified_no_change without any primary evidence is refused and points to secondary_no_change", () => {
    const v = observation({ evidence: [{ url: LISTING, quote: "q", primary_source: false }] });
    expect(errs(v)).toMatch(/verified_no_change needs at least one primary_source: true.*secondary_no_change/);
    const both = observation({ evidence: [
      { url: LISTING, quote: "q", primary_source: false },
      { url: "https://example.org/rebate", quote: "q", primary_source: true },
    ] });
    expect(errs(both)).toBe("");
  });

  it("a *_changed resting on a secondary listing alone is refused", () => {
    for (const [ct, proposed] of [["amount_changed", { amount: { display: "$300" } }], ["status_changed", { status: "closed" }]] as const) {
      const o = observation({ change_type: ct, proposed, evidence: [{ url: LISTING, quote: "q", primary_source: false }] });
      expect(errs(o)).toMatch(new RegExp(`${ct} needs at least one primary_source: true`));
    }
  });

  it("unconfirmed with all-secondary evidence (the tripwire) is accepted", () => {
    const u = observation({
      change_type: "unconfirmed", summary: "The listing now shows $300, the row says $400.",
      evidence: [{ url: LISTING, quote: "Heat Pump Water Heater – $300", primary_source: false }],
    });
    expect(errs(u, { fetch_failures: [blockedFailure()] })).toBe("");
  });

  it("usesContractV13 flags secondary_no_change only", () => {
    expect(usesContractV13(payload())).toBe(false);
    expect(usesContractV13(payload({}, [observation({ change_type: "unconfirmed" })]))).toBe(false);
    expect(usesContractV13(payload({}, [secondaryObs()]))).toBe(true);
  });

  it("ledgerContract: v13 needs contract_version ≥ 1.3", () => {
    expect(ledgerContract({ discovery: { seed_urls: [] } })).toMatchObject({ v11: true, v13: false });
    expect(ledgerContract({ contract_version: "1.2" })).toMatchObject({ v11: true, v13: false });
    expect(ledgerContract({ contract_version: "1.3" })).toMatchObject({ v11: true, v13: true });
    expect(ledgerContract({ contract_version: "1.10" })).toMatchObject({ v13: true });
    expect(ledgerContract({ contract_version: "2.3" })).toMatchObject({ v13: false, error: expect.any(String) });
  });

  it("normalizeUrl matches the ledger's normalize_url", () => {
    expect(normalizeUrl(" HTTPS://WWW.Example.GOV/Rebates/HPWH/#top ")).toBe("https://www.example.gov/Rebates/HPWH");
    expect(normalizeUrl("https://x.example/")).toBe("https://x.example");
    expect(normalizeUrl("   ")).toBeNull();
    expect(normalizeUrl(1)).toBeNull();
  });

  it("checkBlockedAttempts: each attempt_once source needs a failure for that code or a citing observation", () => {
    const wl = { items: [watchItem()] };
    expect(checkBlockedAttempts(payload({}, []), wl).join("\n")).toMatch(/the attempt on the blocked source was not recorded/);
    expect(checkBlockedAttempts(payload({ fetch_failures: [blockedFailure()] }, []), wl)).toEqual([]);
    expect(checkBlockedAttempts(payload({ fetch_failures: [blockedFailure({ url: "https://WWW.Example-City.gov/REBATES/hpwh" })] }, []), wl)).not.toEqual([]); // path case matters
    expect(checkBlockedAttempts(payload({ fetch_failures: [blockedFailure({ url: "HTTPS://WWW.Example-City.GOV/rebates/hpwh/#x" })] }, []), wl)).toEqual([]);
    expect(checkBlockedAttempts(payload({ fetch_failures: [blockedFailure({ program_code: "example_new_program" })] }, []), wl)).toHaveLength(1);
    expect(checkBlockedAttempts(payload({ fetch_failures: [blockedFailure({ program_code: undefined })] }, []), wl)).toHaveLength(1);
    // the page loaded after all: an observation citing it is the record
    const read = observation({ evidence: [{ url: BLOCKED, quote: "Rebates are available.", primary_source: true }] });
    expect(checkBlockedAttempts(payload({}, [read]), wl)).toEqual([]);
    // an item without attempt_once, or no items, asks for nothing
    expect(checkBlockedAttempts(payload({}, []), { items: [watchItem({ sources: [{ url: BLOCKED, access: "blocked" }] })] })).toEqual([]);
    expect(checkBlockedAttempts(payload({}, []), {})).toEqual([]);
    // two blocked sources → two errors when neither is recorded
    const two = { items: [watchItem({ sources: [
      { url: BLOCKED, primary_source: true, access: "blocked", attempt_once: true },
      { url: `${BLOCKED}.pdf`, primary_source: true, access: "blocked", attempt_once: true },
    ] })] };
    expect(checkBlockedAttempts(payload({ fetch_failures: [blockedFailure()] }, []), two)).toHaveLength(1);
  });

  it("checkBlockedAttempts: a URL the ledger lists as secondary may not be claimed as primary evidence", () => {
    const wl = { items: [watchItem()] };
    const claimed = observation({ evidence: [{ url: `${LISTING}/`, quote: "q", primary_source: true }] });
    expect(checkBlockedAttempts(payload({ fetch_failures: [blockedFailure()] }, [claimed]), wl).join("\n"))
      .toMatch(/evidence\[0\]\.primary_source: .* is a secondary source of example_hpwh_rebate/);
    expect(checkBlockedAttempts(payload({ fetch_failures: [blockedFailure()] }, [secondaryObs()]), wl)).toEqual([]);
  });

  it("checkBlockedAttempts: secondary_no_change needs a blocked worklist item and may not cite its primary page", () => {
    const wl = { items: [watchItem()] };
    const onPrimary = secondaryObs({ evidence: [{ url: BLOCKED, quote: "q", primary_source: false }] });
    expect(checkBlockedAttempts(payload({}, [onPrimary]), wl).join("\n")).toMatch(/is a primary source of example_hpwh_rebate/);
    // not on the worklist, or on it without a blocked source → refused
    expect(checkBlockedAttempts(payload({}, [secondaryObs()]), { items: [] }).join("\n")).toMatch(/only for a worklist item with a blocked primary source/);
    const plain = { items: [watchItem({ mode: undefined, sources: [{ url: BLOCKED, primary_source: true, access: "ok", attempt_once: false }, { url: LISTING, primary_source: false, access: "ok" }] })] };
    expect(checkBlockedAttempts(payload({}, [secondaryObs()]), plain).join("\n")).toMatch(/has none on this worklist/);
    // a listing URL the ledger does not hold is the desk's word (false), as in the ledger
    const other = secondaryObs({ evidence: [{ url: "https://another-finder.example/apu", quote: "q", primary_source: false }] });
    expect(checkBlockedAttempts(payload({ fetch_failures: [blockedFailure()] }, [other]), wl)).toEqual([]);
  });

  it("a proposed source may not carry the ledger's per-source access record", () => {
    const o = observation({ change_type: "source_changed", proposed: { sources: [{ url: "https://x.example", primary_source: true, access: "ok" }] } });
    expect(errs(o)).toMatch(/sources\[0\]\.access: is not a writable field/);
  });
});

describe("ledger-watch/post.mjs — v1.3 (secondary_watch)", () => {
  it("reads the worklist once, at the ledger's default page size (not limit=1)", async () => {
    const r = await run(payload());
    expect(r.status, r.stderr).toBe(0);
    const wl = stub.requests.filter((q) => q.path === "/v1/worklist");
    expect(wl).toHaveLength(1);
    expect(wl[0]!.search).toBe("?agent=soledad");
  });

  it("secondary_no_change to a ledger below v1.3 exits 3 before the receipt", async () => {
    for (const cv of [undefined, "1.2"]) {
      Object.assign(stub, { requests: [], contractVersion: cv });
      const r = await run(payload({ fetch_failures: [blockedFailure()] }, [secondaryObs()]));
      expect(r.status, String(cv)).toBe(3);
      expect(r.json?.stage).toBe("contract");
      expect(r.stderr).toContain("v1.3 (secondary_no_change)");
      expect(feedPosts()).toHaveLength(0);
      expect(ledgerCalls()).toHaveLength(0);
    }
  });

  it("a secondary_watch fire (failure recorded + secondary_no_change) goes through to a v1.3 ledger", async () => {
    stub.contractVersion = "1.3";
    stub.items = [watchItem()];
    const r = await run(payload({ fetch_failures: [blockedFailure()] }, [secondaryObs()]));
    expect(r.status, r.stderr).toBe(0);
    const sent = JSON.parse(JSON.parse(ledgerCalls()[0]!.body).payload);
    expect(sent.observations[0].change_type).toBe("secondary_no_change");
    expect(sent.run.fetch_failures[0]).toEqual(blockedFailure());
  });

  it("an attempt_once source left unrecorded exits 2 before the receipt", async () => {
    stub.contractVersion = "1.3";
    stub.items = [watchItem()];
    const r = await run(payload({}, [secondaryObs()]));
    expect(r.status).toBe(2);
    expect(r.json?.stage).toBe("validate");
    expect(r.stderr).toContain("the attempt on the blocked source was not recorded");
    expect(r.stderr).toContain(BLOCKED);
    expect(feedPosts()).toHaveLength(0);
    expect(stub.requests.map((q) => q.path)).toEqual(["/v1/worklist"]);
  });

  it("secondary_no_change on a program not on the worklist exits 2 before the receipt", async () => {
    stub.contractVersion = "1.3";
    const r = await run(payload({}, [secondaryObs()]));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("only for a worklist item with a blocked primary source");
    expect(feedPosts()).toHaveLength(0);
  });

  it("a failure-only fire on a blocked row (no observation) still records and posts", async () => {
    stub.contractVersion = "1.3";
    stub.items = [watchItem()];
    const r = await run(payload({ fetch_failures: [blockedFailure()] }, []));
    expect(r.status, r.stderr).toBe(0);
  });

  it("verified_no_change on secondary evidence alone exits 2 and touches no network", async () => {
    const v = observation({ evidence: [{ url: LISTING, quote: "q", primary_source: false }] });
    const r = await run(payload({}, [v]));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("secondary_no_change");
    expect(stub.requests).toHaveLength(0);
  });
});
