// @ts-nocheck — the module under test (flaky-rerun.mjs) is a dependency-free
// ESM script, not TS; vitest/esbuild imports it fine at runtime, and this
// suite is not shipped code. Discovered by workforce/lambdas/vitest.config.mjs
// (`include: ["../skills/**/*-tests.ts"]`), so `cd workforce/lambdas && npm test`
// runs it.
//
// Locks Epic-019 Story 2c (Farah's rerun discipline): the allowlist is
// evidenced + expiring (no evergreen exemptions), editorial/deploy-class
// checks are categorically ineligible, max ONE rerun per PR (the hidden
// marker is the once-ever latch, posted BEFORE the rerun fires), a mixed
// failing set escalates, and ambiguous states throw or escalate — never a
// silent pass (C-4).
import { describe, it, expect } from "vitest";
import {
  MAX_RERUNS_PER_PR,
  RERAN_LABEL,
  RERUN_MARKER_PREFIX,
  EDITORIAL_INELIGIBLE_RE,
  validateFlakyChecks,
  activeAllowlist,
  hasRerunMarker,
  rerunMarker,
  findRerunMarkers,
  decideRerun,
  rerunAuditBody,
  attemptFlakyRerun,
} from "./flaky-rerun.mjs";

const TODAY = "2026-07-08";
const ENTRY = (check_name, over = {}) => ({
  check_name,
  evidence: "https://github.com/refluster/ai-native-article/issues/999",
  expires: "2026-12-31",
  ...over,
});

describe("validateFlakyChecks — evidenced + expiring allowlist (Farah's discipline)", () => {
  it("accepts an empty allowlist (ships empty; entries land with evidence as flakes occur)", () => {
    expect(validateFlakyChecks([], { today: TODAY })).toEqual({ errors: [], warnings: [] });
  });
  it("accepts a well-formed entry (URL evidence) and one with an issue-ref evidence", () => {
    const r = validateFlakyChecks(
      [ENTRY("integration-e2e"), ENTRY("lambda-smoke", { evidence: "#450" }), ENTRY("infra-drift", { evidence: "refluster/ai-native-article#450" })],
      { today: TODAY },
    );
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });
  it("rejects an entry without evidence — no evidence, no entry", () => {
    const { errors } = validateFlakyChecks([{ check_name: "integration-e2e", expires: "2026-12-31" }], { today: TODAY });
    expect(errors.join("\n")).toMatch(/evidence/);
  });
  it("rejects non-URL / non-issue-ref evidence", () => {
    const { errors } = validateFlakyChecks([ENTRY("integration-e2e", { evidence: "trust me" })], { today: TODAY });
    expect(errors.join("\n")).toMatch(/evidence/);
  });
  it("rejects an entry without expires — no evergreen exemptions", () => {
    const { errors } = validateFlakyChecks([{ check_name: "integration-e2e", evidence: "#450" }], { today: TODAY });
    expect(errors.join("\n")).toMatch(/expires/);
  });
  it("rejects a malformed expires date", () => {
    const { errors } = validateFlakyChecks([ENTRY("integration-e2e", { expires: "soonish" })], { today: TODAY });
    expect(errors.join("\n")).toMatch(/YYYY-MM-DD/);
  });
  it("WARNS (not errors) on an expired entry — inert at runtime, prune it", () => {
    const { errors, warnings } = validateFlakyChecks([ENTRY("integration-e2e", { expires: "2026-07-01" })], { today: TODAY });
    expect(errors).toEqual([]);
    expect(warnings.join("\n")).toMatch(/expired 2026-07-01/);
  });
  it("HARD-errors on editorial/deploy-class check names (R-10/W-1: categorically ineligible)", () => {
    for (const name of ["deploy-article-site", "article-health", "corpus-truncation-gate", "Editorial Guard", "Deploy to gh-pages"]) {
      const { errors } = validateFlakyChecks([ENTRY(name)], { today: TODAY });
      expect(errors.join("\n")).toMatch(/rerun-ineligible/);
    }
  });
  it("rejects duplicates, unknown keys, non-object entries, and a non-array file", () => {
    expect(validateFlakyChecks([ENTRY("e2e"), ENTRY("E2E")], { today: TODAY }).errors.join("\n")).toMatch(/duplicate/);
    expect(validateFlakyChecks([ENTRY("e2e", { note: "x" })], { today: TODAY }).errors.join("\n")).toMatch(/unknown key/);
    expect(validateFlakyChecks(["e2e"], { today: TODAY }).errors.join("\n")).toMatch(/must be an object/);
    expect(validateFlakyChecks({ checks: [] }, { today: TODAY }).errors.join("\n")).toMatch(/must be a JSON array/);
  });
});

describe("activeAllowlist — unexpired entries only; malformed lists throw (C-4)", () => {
  it("drops expired entries and keys by lowercased name", () => {
    const m = activeAllowlist([ENTRY("E2E-Suite"), ENTRY("old-check", { expires: "2026-01-01" })], TODAY);
    expect(m.has("e2e-suite")).toBe(true);
    expect(m.has("old-check")).toBe(false);
  });
  it("throws on a malformed allowlist — a broken file never authorises a rerun", () => {
    expect(() => activeAllowlist([{ check_name: "e2e" }], TODAY)).toThrow(/invalid/);
    expect(() => activeAllowlist([ENTRY("deploy-site")], TODAY)).toThrow(/rerun-ineligible/);
  });
});

describe("rerun marker — the once-ever latch + machine-readable check names", () => {
  it("round-trips check names through the marker", () => {
    const marker = rerunMarker(["integration-e2e", "lambda smoke"]);
    expect(marker.startsWith(RERUN_MARKER_PREFIX)).toBe(true);
    expect(findRerunMarkers(marker)).toEqual([{ checks: ["integration-e2e", "lambda smoke"] }]);
  });
  it("neutralises --> and | inside check names", () => {
    const marker = rerunMarker(["weird --> name", "a|b"]);
    expect(marker.match(/-->/g)).toHaveLength(1); // only the closing token
    expect(findRerunMarkers(marker)[0].checks).toEqual(["weird → name", "a/b"]);
  });
  it("hasRerunMarker detects the latch anywhere in the bodies", () => {
    expect(hasRerunMarker(["routing…", `audit\n${rerunMarker(["e2e"])}`])).toBe(true);
    expect(hasRerunMarker(["routing…", "<!-- autopilot:needs-human -->"])).toBe(false);
    expect(hasRerunMarker([])).toBe(false);
  });
});

describe("decideRerun — the pure decision core", () => {
  const entries = [ENTRY("integration-e2e"), ENTRY("lambda-smoke")];

  it("all failing checks allowlisted + no prior rerun → rerun (with evidence carried)", () => {
    const d = decideRerun({ failingChecks: ["integration-e2e", "lambda-smoke"], entries, bodies: [], today: TODAY });
    expect(d.reran).toBe(true);
    expect(d.checks).toEqual(["integration-e2e", "lambda-smoke"]);
    expect(d.evidence[0]).toMatchObject({ check: "integration-e2e", expires: "2026-12-31" });
  });
  it("second time (marker present) → escalate checks-failing, never retried", () => {
    const bodies = [rerunAuditBody(decideRerun({ failingChecks: ["integration-e2e"], entries, bodies: [], today: TODAY }))];
    const d = decideRerun({ failingChecks: ["integration-e2e"], entries, bodies, today: TODAY });
    expect(d).toMatchObject({ reran: false, escalateWith: "checks-failing" });
    expect(d.why).toMatch(new RegExp(`max ${MAX_RERUNS_PER_PR}`));
  });
  it("a mixed failing set (one check not allowlisted) → escalate", () => {
    const d = decideRerun({ failingChecks: ["integration-e2e", "unit-tests"], entries, bodies: [], today: TODAY });
    expect(d).toMatchObject({ reran: false, escalateWith: "checks-failing" });
    expect(d.why).toMatch(/unit-tests/);
  });
  it("an expired allowlist entry no longer authorises its check", () => {
    const d = decideRerun({ failingChecks: ["e2e"], entries: [ENTRY("e2e", { expires: "2026-07-07" })], bodies: [], today: TODAY });
    expect(d).toMatchObject({ reran: false, escalateWith: "checks-failing" });
  });
  it("an editorial/deploy-class failing check escalates even before the allowlist is consulted", () => {
    const d = decideRerun({ failingChecks: ["deploy-article-site"], entries: [], bodies: [], today: TODAY });
    expect(d).toMatchObject({ reran: false, escalateWith: "checks-failing" });
    expect(d.why).toMatch(/categorically rerun-ineligible/);
    expect(EDITORIAL_INELIGIBLE_RE.test("deploy-article-site")).toBe(true);
  });
  it("throws on an empty or unnamed failing set — ambiguity never silently passes (C-4)", () => {
    expect(() => decideRerun({ failingChecks: [], entries, bodies: [], today: TODAY })).toThrow(/ambiguous/);
    expect(() => decideRerun({ failingChecks: [""], entries, bodies: [], today: TODAY })).toThrow(/ambiguous/);
    expect(() => decideRerun({ failingChecks: "e2e", entries, bodies: [], today: TODAY })).toThrow(/array/);
  });
  it("its escalate code is inside the taxonomy (cannot drift)", () => {
    const d = decideRerun({ failingChecks: ["nope"], entries, bodies: [], today: TODAY });
    expect(d.escalateWith).toBe("checks-failing");
  });
});

/** Route a `${method} ${path}` string to a canned {status,json} response
 *  (pr-merge-tests.ts style), recording calls for order assertions. */
function mockGh(routes) {
  const calls = [];
  const gh = async (method, path, body) => {
    calls.push({ method, path, body });
    for (const [re, resp] of routes) {
      if (re.test(`${method} ${path}`)) return typeof resp === "function" ? resp() : resp;
    }
    return { status: 404, json: {} };
  };
  gh.calls = calls;
  return gh;
}

const CHECK = (name, over = {}) => ({
  id: 11,
  name,
  status: "completed",
  conclusion: "failure",
  app: { slug: "github-actions" },
  ...over,
});

const ioRoutes = ({ checks, comments = [], workflowRuns, commentStatus = 201 }) => [
  [/GET \/repos\/o\/r\/pulls\/7$/, { status: 200, json: { head: { sha: "abc" } } }],
  [/GET \/repos\/o\/r\/commits\/abc\/check-runs/, { status: 200, json: { check_runs: checks } }],
  [/GET \/repos\/o\/r\/issues\/7\/comments/, { status: 200, json: comments }],
  [/GET \/repos\/o\/r\/pulls\/7\/reviews/, { status: 200, json: [] }],
  [/POST \/repos\/o\/r\/issues\/7\/comments/, { status: commentStatus, json: { id: 1 } }],
  [/POST \/repos\/o\/r\/labels/, { status: 201, json: {} }],
  [/POST \/repos\/o\/r\/issues\/7\/labels/, { status: 200, json: {} }],
  [/GET \/repos\/o\/r\/actions\/runs\?head_sha=abc/, { status: 200, json: { workflow_runs: workflowRuns } }],
  [/POST \/repos\/o\/r\/actions\/runs\/5\/rerun-failed-jobs/, { status: 201, json: {} }],
  [/POST \/repos\/o\/r\/check-runs\/11\/rerequest/, { status: 201, json: {} }],
];

const FAILED_RUN = { id: 5, status: "completed", conclusion: "failure" };
const entries = [ENTRY("integration-e2e")];

describe("attemptFlakyRerun — thin IO around the decision core", () => {
  it("happy path: all-allowlisted Actions failure → audit comment, reran label, rerun-failed-jobs", async () => {
    const gh = mockGh(ioRoutes({ checks: [CHECK("integration-e2e")], workflowRuns: [FAILED_RUN, { id: 6, status: "completed", conclusion: "success" }] }));
    const r = await attemptFlakyRerun(gh, "o/r", 7, { entries, today: TODAY });
    expect(r).toMatchObject({ reran: true, checks: ["integration-e2e"], triggered: 1 });
    const posts = gh.calls.filter((c) => c.method === "POST").map((c) => c.path);
    expect(posts).toContain("/repos/o/r/actions/runs/5/rerun-failed-jobs");
    expect(posts).toContain("/repos/o/r/issues/7/labels");
    // The once-ever latch (audit marker comment) lands BEFORE the rerun fires.
    expect(posts.indexOf("/repos/o/r/issues/7/comments")).toBeLessThan(posts.indexOf("/repos/o/r/actions/runs/5/rerun-failed-jobs"));
    const audit = gh.calls.find((c) => c.method === "POST" && c.path === "/repos/o/r/issues/7/comments").body.body;
    expect(audit).toContain(RERUN_MARKER_PREFIX);
    expect(audit).toContain("integration-e2e");
    expect(audit).toContain(entries[0].evidence);
    expect(gh.calls.find((c) => c.path === "/repos/o/r/issues/7/labels").body.labels).toEqual([RERAN_LABEL]);
  });
  it("a non-Actions failing check is rerequested by check-run id", async () => {
    const gh = mockGh(ioRoutes({ checks: [CHECK("integration-e2e", { app: { slug: "some-ci-app" } })], workflowRuns: [] }));
    const r = await attemptFlakyRerun(gh, "o/r", 7, { entries, today: TODAY });
    expect(r).toMatchObject({ reran: true, triggered: 1 });
    expect(gh.calls.some((c) => c.method === "POST" && c.path === "/repos/o/r/check-runs/11/rerequest")).toBe(true);
  });
  it("the marker in an existing comment blocks a second rerun (escalate, nothing posted)", async () => {
    const gh = mockGh(ioRoutes({ checks: [CHECK("integration-e2e")], comments: [{ body: rerunMarker(["integration-e2e"]) }], workflowRuns: [FAILED_RUN] }));
    const r = await attemptFlakyRerun(gh, "o/r", 7, { entries, today: TODAY });
    expect(r).toMatchObject({ reran: false, escalateWith: "checks-failing" });
    expect(gh.calls.some((c) => c.method === "POST")).toBe(false);
  });
  it("an empty allowlist short-circuits to escalate with zero API calls", async () => {
    const gh = mockGh([]);
    const r = await attemptFlakyRerun(gh, "o/r", 7, { entries: [], today: TODAY });
    expect(r).toMatchObject({ reran: false, escalateWith: "checks-failing" });
    expect(gh.calls).toHaveLength(0);
  });
  it("a still-pending check is ambiguous → escalate, no rerun (C-4)", async () => {
    const gh = mockGh(ioRoutes({ checks: [CHECK("integration-e2e"), CHECK("slow-suite", { status: "in_progress", conclusion: null })], workflowRuns: [FAILED_RUN] }));
    const r = await attemptFlakyRerun(gh, "o/r", 7, { entries, today: TODAY });
    expect(r).toMatchObject({ reran: false, escalateWith: "checks-failing" });
    expect(r.why).toMatch(/not completed/);
  });
  it("no failing checks at rerun time → escalate (re-verdict), never a guess", async () => {
    const gh = mockGh(ioRoutes({ checks: [CHECK("integration-e2e", { conclusion: "success" })], workflowRuns: [] }));
    const r = await attemptFlakyRerun(gh, "o/r", 7, { entries, today: TODAY });
    expect(r).toMatchObject({ reran: false, escalateWith: "checks-failing" });
  });
  it("a failed audit comment aborts BEFORE any rerun fires (the latch must exist first)", async () => {
    const gh = mockGh(ioRoutes({ checks: [CHECK("integration-e2e")], workflowRuns: [FAILED_RUN], commentStatus: 500 }));
    await expect(attemptFlakyRerun(gh, "o/r", 7, { entries, today: TODAY })).rejects.toThrow(/max-1 latch/);
    expect(gh.calls.some((c) => c.path.includes("rerun-failed-jobs"))).toBe(false);
  });
  it("a rejected rerun POST throws — a half-triggered rerun escalates, never silently passes (C-4)", async () => {
    const routes = ioRoutes({ checks: [CHECK("integration-e2e")], workflowRuns: [FAILED_RUN] }).filter(
      ([re]) => !re.test("POST /repos/o/r/actions/runs/5/rerun-failed-jobs"),
    );
    routes.push([/POST \/repos\/o\/r\/actions\/runs\/5\/rerun-failed-jobs/, { status: 403, json: {} }]);
    const gh = mockGh(routes);
    await expect(attemptFlakyRerun(gh, "o/r", 7, { entries, today: TODAY })).rejects.toThrow(/HTTP 403/);
  });
  it("deciding to rerun but finding nothing to trigger throws (ambiguous)", async () => {
    const gh = mockGh(ioRoutes({ checks: [CHECK("integration-e2e")], workflowRuns: [{ id: 6, status: "completed", conclusion: "success" }] }));
    await expect(attemptFlakyRerun(gh, "o/r", 7, { entries, today: TODAY })).rejects.toThrow(/nothing to trigger/);
  });
});
