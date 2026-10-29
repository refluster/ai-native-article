// Unit tests for the FU-016 guard (check-router-nominates.mjs).
// The network loop requires a token; the three pure functions are tested here.

// @ts-nocheck — the script under test is dependency-free ESM, not TS.
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  touchesPath,
  findRoutingBody,
  isNominated,
  main,
} from "./check-router-nominates.mjs";

// ── helpers ──────────────────────────────────────────────────────────────────

const routingBody = (cycle: number, nominees: string[] = ["ren", "dario", "mateo"]) => {
  const nomineeLines = nominees
    .map((s) => `- **\`wf:${s}\`** — <rationale>`)
    .join("\n");
  return `**Nadia — cycle ${cycle} of ≤ 7.**\n\nSummary.\n\nReviewers nominated (≥ 3):\n\n${nomineeLines}\n\n— Nadia (CCR persona)`;
};

const skipBody = (cycle: number, skipped: string) =>
  `**Nadia — cycle ${cycle} of ≤ 7.**\n\nReviewers nominated (≥ 3):\n\n- **\`wf:dario\`** — engineering\n- **\`wf:mateo\`** — product\n- **\`wf:aoi\`** — design\n\nSkipping \`wf:${skipped}\` — not relevant to this change.\n\n— Nadia`;

// ── touchesPath ──────────────────────────────────────────────────────────────

describe("touchesPath", () => {
  it("returns false for an empty file list", () => {
    expect(touchesPath([], "workforce/lambdas/")).toBe(false);
  });

  it("returns false when no file matches the prefix", () => {
    const files = [
      { filename: "workforce/scripts/foo.mjs" },
      { filename: "newsletter/app/src/App.tsx" },
    ];
    expect(touchesPath(files, "workforce/lambdas/")).toBe(false);
  });

  it("returns true when at least one file matches the prefix", () => {
    const files = [
      { filename: "workforce/lambdas/agents-api/handler.ts" },
      { filename: "workforce/scripts/foo.mjs" },
    ];
    expect(touchesPath(files, "workforce/lambdas/")).toBe(true);
  });

  it("returns false for non-array input", () => {
    expect(touchesPath(null, "workforce/lambdas/")).toBe(false);
    expect(touchesPath(undefined, "workforce/lambdas/")).toBe(false);
  });

  it("matches files at any depth under the prefix", () => {
    const files = [{ filename: "workforce/lambdas/shared/ddb.ts" }];
    expect(touchesPath(files, "workforce/lambdas/")).toBe(true);
  });

  it("is prefix-sensitive: workforce/lambdas-foo/ does not match", () => {
    const files = [{ filename: "workforce/lambdas-foo/bar.ts" }];
    expect(touchesPath(files, "workforce/lambdas/")).toBe(false);
  });

  it("uses a custom path prefix when provided", () => {
    const files = [{ filename: "newsletter/app/src/Foo.tsx" }];
    expect(touchesPath(files, "newsletter/app/")).toBe(true);
    expect(touchesPath(files, "workforce/lambdas/")).toBe(false);
  });
});

// ── findRoutingBody ──────────────────────────────────────────────────────────

describe("findRoutingBody", () => {
  it("returns null when no routing comment exists", () => {
    expect(findRoutingBody(["LGTM", "Looks good", ""])).toBeNull();
  });

  it("returns the cycle-1 routing body when it is the first comment", () => {
    const bodies = [routingBody(1), "reviewer comment"];
    expect(findRoutingBody(bodies)).toBe(bodies[0]);
  });

  it("skips non-cycle-1 routing comments", () => {
    const bodies = ["non-routing comment", routingBody(2), routingBody(3)];
    expect(findRoutingBody(bodies)).toBeNull();
  });

  it("finds cycle-1 even when it comes after non-routing comments", () => {
    const bodies = ["reviewer comment", "other comment", routingBody(1)];
    expect(findRoutingBody(bodies)).toBe(bodies[2]);
  });

  it("returns the first cycle-1 match when multiple cycle-1 routing comments exist", () => {
    const first = routingBody(1, ["ren", "dario", "aoi"]);
    const second = routingBody(1, ["mateo", "dario", "aoi"]);
    expect(findRoutingBody([first, second])).toBe(first);
  });

  it("finds a cycle-2 routing body when targetCycle=2", () => {
    const bodies = [routingBody(1), routingBody(2), routingBody(3)];
    expect(findRoutingBody(bodies, 2)).toBe(bodies[1]);
  });

  it("handles null/undefined bodies gracefully", () => {
    expect(findRoutingBody([null, undefined, routingBody(1)])).toBe(
      routingBody(1),
    );
  });
});

// ── isNominated ──────────────────────────────────────────────────────────────

describe("isNominated", () => {
  it("returns true when the routing comment nominates wf:ren", () => {
    expect(isNominated(routingBody(1, ["ren", "dario", "mateo"]))).toBe(true);
  });

  it("returns false when wf:ren is not in the comment at all", () => {
    expect(isNominated(routingBody(1, ["dario", "mateo", "aoi"]))).toBe(false);
  });

  it("returns false when wf:ren appears only on a Skipping line", () => {
    expect(isNominated(skipBody(1, "ren"))).toBe(false);
  });

  it("returns true when wf:ren is nominated even when also skipping others", () => {
    const body =
      routingBody(1, ["ren", "dario", "mateo"]) +
      "\nSkipping `wf:aoi` — not relevant.";
    expect(isNominated(body)).toBe(true);
  });

  it("is case-insensitive for the Skipping prefix", () => {
    const body = `**Nadia — cycle 1 of ≤ 7.**\n\nSKIPPING \`wf:ren\` — not needed.\n\n- **\`wf:dario\`**\n`;
    expect(isNominated(body)).toBe(false);
  });

  it("matches wf:ren even when inline with other text", () => {
    const body = "- **`wf:ren`** — Lambda engineering lens";
    expect(isNominated(body)).toBe(true);
  });

  it("uses a custom slug when provided", () => {
    const body = "- **`wf:dario`** — architecture lens";
    expect(isNominated(body, "dario")).toBe(true);
    expect(isNominated(body, "ren")).toBe(false);
  });

  it("returns false for an empty body", () => {
    expect(isNominated("")).toBe(false);
    expect(isNominated(null)).toBe(false);
    expect(isNominated(undefined)).toBe(false);
  });

  it("does not match a slug that is a substring of another slug", () => {
    // e.g. wf:ren should not match wf:ren-advisor or wf:prena
    const body = "- **`wf:ren-advisor`** — extended lens";
    // wf:ren-advisor contains wf:ren as a prefix, so the tag `wf:ren`
    // does NOT appear standalone — this tests the tag literal match
    expect(isNominated(body)).toBe(false);
  });
});

describe("isNominated: bare mentions", () => {
  it("counts a bare mention in prose as a nomination (documented, pinned)", () => {
    // The guard is a cheap text lint: any non-"Skipping" line containing
    // `wf:ren` nominates. "considered wf:ren but out of scope" therefore
    // PASSES the lint. Routers must use the "Skipping `wf:ren` — ..." form to
    // decline; this test pins that contract.
    expect(isNominated("considered `wf:ren` but out of scope")).toBe(true);
    expect(isNominated("Skipping `wf:ren` — out of scope")).toBe(false);
  });
});

// ── main() with stubbed fetch ────────────────────────────────────────────────

type Route = { status?: number; json?: unknown; link?: string };

function stubFetch(routes: Record<string, Route>) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    const u = String(url);
    calls.push(u);
    const key = Object.keys(routes).find((k) => u.includes(k));
    const r = key ? routes[key] : { status: 404, json: {} };
    return {
      status: r.status ?? 200,
      text: async () => JSON.stringify(r.json ?? []),
      headers: { get: (h: string) => (h.toLowerCase() === "link" ? (r.link ?? null) : null) },
    };
  });
  return calls;
}

async function runMain(): Promise<number> {
  const savedArgv = process.argv;
  const savedTok = process.env.GITHUB_TOKEN;
  process.argv = ["node", "check-router-nominates.mjs", "--repo", "o/r"];
  process.env.GITHUB_TOKEN = "test-token";
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    return await main();
  } finally {
    err.mockRestore();
    process.argv = savedArgv;
    if (savedTok === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = savedTok;
  }
}

const PR = [{ number: 7, title: "t", html_url: "u" }];
const LAMBDA_FILE = [{ filename: "workforce/lambdas/x/handler.ts" }];
const comment = (body: string) => [{ body, created_at: "2026-01-01T00:00:00Z" }];

describe("main (stubbed fetch)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("exits 2 when a routed lambdas PR does not nominate wf:ren", async () => {
    stubFetch({
      "/pulls?state=open": { json: PR },
      "/pulls/7/files": { json: LAMBDA_FILE },
      "/issues/7/comments": { json: comment(routingBody(1, ["dario", "mateo", "aoi"])) },
      "/pulls/7/reviews": { json: [] },
    });
    expect(await runMain()).toBe(2);
  });

  it("exits 0 when the lambdas PR is not yet routed", async () => {
    stubFetch({
      "/pulls?state=open": { json: PR },
      "/pulls/7/files": { json: LAMBDA_FILE },
      "/issues/7/comments": { json: [] },
      "/pulls/7/reviews": { json: [] },
    });
    expect(await runMain()).toBe(0);
  });

  it("exits 0 when wf:ren is nominated", async () => {
    stubFetch({
      "/pulls?state=open": { json: PR },
      "/pulls/7/files": { json: LAMBDA_FILE },
      "/issues/7/comments": { json: comment(routingBody(1)) },
      "/pulls/7/reviews": { json: [] },
    });
    expect(await runMain()).toBe(0);
  });

  for (const which of ["/pulls/7/files", "/issues/7/comments", "/pulls/7/reviews"]) {
    for (const status of [403, 500]) {
      it(`exits 3 on HTTP ${status} from ${which}`, async () => {
        stubFetch({
          "/pulls?state=open": { json: PR },
          "/pulls/7/files": { json: LAMBDA_FILE },
          "/issues/7/comments": { json: comment(routingBody(1, ["dario", "mateo", "aoi"])) },
          "/pulls/7/reviews": { json: [] },
          [which]: { status, json: { message: "nope" } },
        });
        expect(await runMain()).toBe(3);
      });
    }
  }

  it("follows Link rel=next: a lambdas file on page 2 is flagged", async () => {
    stubFetch({
      "/pulls?state=open": { json: PR },
      "page=2": { json: LAMBDA_FILE },
      "/pulls/7/files": {
        json: [{ filename: "README.md" }],
        link: '<https://api.github.com/repos/o/r/pulls/7/files?per_page=100&page=2>; rel="next"',
      },
      "/issues/7/comments": { json: comment(routingBody(1, ["dario", "mateo", "aoi"])) },
      "/pulls/7/reviews": { json: [] },
    });
    expect(await runMain()).toBe(2);
  });
});
