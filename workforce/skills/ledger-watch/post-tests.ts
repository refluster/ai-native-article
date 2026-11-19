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
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { validatePayload, validateSummary } from "./ledger-payload.mjs";

const SCRIPT = join(__dirname, "post.mjs");
const dir = mkdtempSync(join(tmpdir(), "ledger-watch-"));
const TODAY = new Date().toISOString().slice(0, 10);

// ── stub server ──────────────────────────────────────────────────────────────
interface Req { method: string; path: string; headers: IncomingMessage["headers"]; body: string }
interface Stub {
  requests: Req[];
  posts: Map<string, { agent_slug: string; body: string }>;
  feedStatus: number | null;          // force a feed POST status
  tamperReadBack: boolean;            // serve a different body on read-back
  ledgerPlan: Array<number | "drop">; // per-attempt ledger status (last repeats)
  ledgerDispositions: string[] | null;
}
const stub: Stub = {
  requests: [], posts: new Map(), feedStatus: null, tamperReadBack: false, ledgerPlan: [200], ledgerDispositions: null,
};
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
      stub.requests.push({ method: req.method ?? "", path: url.pathname, headers: req.headers, body: data });
      // feed
      if (req.method === "POST" && url.pathname === "/prod/feed") {
        if (stub.feedStatus) return send(res, stub.feedStatus, { error: "forced" });
        if (req.headers.authorization !== "Bearer good-token") return send(res, 401, { error: "unauthorized" });
        const j = JSON.parse(data);
        const id = `00TEST${String(stub.posts.size).padStart(20, "0")}`;
        stub.posts.set(id, { agent_slug: j.agent_slug, body: j.body.trim() });
        return send(res, 201, { post_id: id, agent_slug: j.agent_slug, kind: j.kind });
      }
      const m = /^\/prod\/feed\/([^/]+)$/.exec(url.pathname);
      if (req.method === "GET" && m) {
        const p = stub.posts.get(decodeURIComponent(m[1]!));
        if (!p) return send(res, 404, { error: "not_found" });
        return send(res, 200, { ...p, body: stub.tamperReadBack ? "someone else's prose" : p.body });
      }
      // ledger
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
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  Object.assign(stub, { requests: [], feedStatus: null, tamperReadBack: false, ledgerPlan: [200], ledgerDispositions: null });
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
    run: { agent_slug: "soledad", started_at: `${TODAY}T15:30:00Z`, checked_programs: ["example_hpwh_rebate"], fetch_failures: [], discovery_queries: [], ...over },
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
  { summary = SUMMARY, ledger = "default", env = {} }: { summary?: string; ledger?: string | null; env?: Record<string, string | undefined> } = {},
): Promise<Run> {
  const { pf, sf } = files(p, summary);
  const args = [SCRIPT, "--agent", "soledad", "--skill-version", "0.1.0", "--payload-file", pf, "--summary-file", sf];
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
    // skill_version is filled into the run from --skill-version before hashing
    expect(JSON.parse(sent.payload).run.skill_version).toBe("0.1.0");
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

describe("ledger-payload.mjs", () => {
  it("accepts an empty run (programs checked, nothing to report)", () => {
    const { errors } = validatePayload(payload({}, []), { agent: "soledad", skillVersion: "0.1.0", today: TODAY });
    expect(errors).toEqual([]);
  });

  it("rejects proposed fields the ledger never accepts from an observation", () => {
    const { errors } = validatePayload(
      payload({}, [observation({ change_type: "new_program", program_code: "x_new", proposed: { status: "candidate", version: 2 } })]),
      { agent: "soledad", today: TODAY },
    );
    expect(errors.join("\n")).toMatch(/proposed\.version/);
    expect(errors.join("\n")).toMatch(/proposed\.status/);
  });

  it("summary guards: JSON body, receipt line and missing link are refused", () => {
    expect(validateSummary('{"run": 1} https://example.org and more words here to pass length')).not.toEqual([]);
    expect(validateSummary(`${SUMMARY}\nledger-receipt: sha256:abc`)).not.toEqual([]);
    expect(validateSummary("No change across all programs checked today, nothing else to add.")).not.toEqual([]);
    expect(validateSummary(SUMMARY)).toEqual([]);
  });
});
