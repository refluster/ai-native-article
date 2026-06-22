// @ts-nocheck — the engine under test (pr-merge.mjs) is a dependency-free ESM
// script, not TS; vitest/esbuild imports it fine at runtime, and this suite is
// not shipped code. Discovered by workforce/lambdas/vitest.config.mjs
// (`include: ["../skills/**/*-tests.ts"]`), so `cd workforce/lambdas && npm test`
// (the CI step) runs it. Closes Sana's C1: the merge-gating predicate's
// regression net lives in the repo, not a session transcript (adr-0010).
import { describe, it, expect } from "vitest";
import {
  globToRegExp,
  resolveL0L1Paths,
  reviewerSignedOff,
  reviewerGreenMarker,
  verifyMergeable,
  applyDecisions,
  ESCALATION_LABEL,
} from "./pr-merge.mjs";

/** Route a `${method} ${path}` string to a canned {status,json} response. */
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

const govDoc = (block) => ({
  status: 200,
  json: { encoding: "base64", content: Buffer.from(`# gov\n${block}\n`).toString("base64") },
});
const L0_BLOCK =
  "<!-- autopilot:l0l1-paths -->\n- docs/governance.md\n- docs/adr/**\n<!-- /autopilot:l0l1-paths -->";
const GREEN_CHECK = [{ name: "ci", status: "completed", conclusion: "success" }];
// A non-blocking lens review carries the exact structured green marker.
const DARIO_REVIEW = [{ state: "COMMENTED", body: `looks good\n\n${reviewerGreenMarker("dario")}` }];

/** Standard happy-path route table, parameterised by the variable bits. */
const routes = (files, checks, reviews, comments = []) => [
  [/GET \/repos\/o\/r\/pulls\/1$/, { status: 200, json: { state: "open", mergeable: true, mergeable_state: "clean", head: { sha: "abc" }, base: { ref: "main" } } }],
  [/GET .*contents/, govDoc(L0_BLOCK)],
  [/GET \/repos\/o\/r\/pulls\/1\/files/, { status: 200, json: files }],
  [/GET \/repos\/o\/r\/commits\/abc\/check-runs/, { status: 200, json: { check_runs: checks } }],
  [/GET \/repos\/o\/r\/pulls\/1\/reviews/, { status: 200, json: reviews }],
  [/GET \/repos\/o\/r\/issues\/1\/comments/, { status: 200, json: comments }],
];

describe("globToRegExp", () => {
  it("matches an exact path", () => expect(globToRegExp("docs/governance.md").test("docs/governance.md")).toBe(true));
  it("** spans slashes", () => expect(globToRegExp("docs/adr/**").test("docs/adr/adr-1.md")).toBe(true));
  it("** does not false-match a sibling", () => expect(globToRegExp("docs/adr/**").test("docs/adrx.md")).toBe(false));
  it("* stays within a segment", () => {
    expect(globToRegExp("src/*.ts").test("src/a.ts")).toBe(true);
    expect(globToRegExp("src/*.ts").test("src/sub/a.ts")).toBe(false);
  });
});

describe("reviewerSignedOff (exact structured marker, not byline)", () => {
  it("matches the exact green marker", () => expect(reviewerSignedOff("dario", [`ok\n${reviewerGreenMarker("dario")}`])).toBe(true));
  it("is case-insensitive on the slug token", () => expect(reviewerSignedOff("Ren", ["<!-- AUTOPILOT:REVIEW:REN:GREEN -->"])).toBe(true));
  it("does NOT count a byline/prose mention as a green vote (no false-open)", () => expect(reviewerSignedOff("dario", ["x\n— Dario (CCR) looks good"])).toBe(false));
  it("does NOT count a :red marker", () => expect(reviewerSignedOff("dario", ["<!-- autopilot:review:dario:red -->"])).toBe(false));
  it("is false when the persona never signed", () => expect(reviewerSignedOff("aoi", ["nothing here"])).toBe(false));
});

describe("resolveL0L1Paths (source of truth = target repo governance)", () => {
  it("parses the declared block", async () => {
    const r = await resolveL0L1Paths(mockGh([[/GET .*contents/, govDoc(L0_BLOCK)]]), "o/r", "main");
    expect(r.ok).toBe(true);
    expect(r.patterns).toHaveLength(2);
  });
  it("fails closed when the governance doc is unreadable", async () => {
    const r = await resolveL0L1Paths(mockGh([[/GET .*contents/, { status: 404, json: {} }]]), "o/r", "main");
    expect(r.ok).toBe(false);
  });
  it("fails closed when the markers are absent", async () => {
    const r = await resolveL0L1Paths(mockGh([[/GET .*contents/, govDoc("no markers here")]]), "o/r", "main");
    expect(r.ok).toBe(false);
  });
});

describe("verifyMergeable (fail-closed predicate)", () => {
  it("passes on a non-L0/L1, green, consensus PR", async () => {
    const v = await verifyMergeable(mockGh(routes([{ filename: "src/app.ts" }], GREEN_CHECK, DARIO_REVIEW)), "o/r", 1, { reviewers: ["dario"] });
    expect(v.ok).toBe(true);
  });
  it("refuses a PR touching an L0/L1 path", async () => {
    const v = await verifyMergeable(mockGh(routes([{ filename: "docs/governance.md" }], GREEN_CHECK, DARIO_REVIEW)), "o/r", 1, { reviewers: ["dario"] });
    expect(v.ok).toBe(false);
    expect(v.why).toMatch(/L0\/L1/);
  });
  it("refuses when a reviewer requested changes", async () => {
    const v = await verifyMergeable(mockGh(routes([{ filename: "src/app.ts" }], GREEN_CHECK, [{ state: "CHANGES_REQUESTED", body: "x" }])), "o/r", 1, { reviewers: ["dario"] });
    expect(v.ok).toBe(false);
    expect(v.why).toMatch(/CHANGES_REQUESTED/);
  });
  it("refuses when a required check is not green", async () => {
    const v = await verifyMergeable(mockGh(routes([{ filename: "src/app.ts" }], [{ name: "ci", status: "completed", conclusion: "failure" }], DARIO_REVIEW)), "o/r", 1, { reviewers: ["dario"] });
    expect(v.ok).toBe(false);
  });
  it("refuses a no-review merge (empty reviewers[])", async () => {
    const v = await verifyMergeable(mockGh(routes([{ filename: "src/app.ts" }], GREEN_CHECK, [])), "o/r", 1, { reviewers: [] });
    expect(v.ok).toBe(false);
    expect(v.why).toMatch(/reviewers/);
  });
  it("refuses when a nominated reviewer's lens review is missing", async () => {
    const v = await verifyMergeable(mockGh(routes([{ filename: "src/app.ts" }], GREEN_CHECK, DARIO_REVIEW)), "o/r", 1, { reviewers: ["dario", "ren"] });
    expect(v.ok).toBe(false);
    expect(v.why).toMatch(/ren/);
  });
  // adr-0011: the workforce's own repo is a normal delegated target — no own-repo
  // veto. The single boundary is the L0/L1 path set, so a reviewed non-L0/L1 PR
  // passes (next test) while a governance PR still escalates (the one after).
  const ownRepoRoutes = (files) => [
    [/GET \/repos\/refluster\/ai-native-article\/pulls\/1$/, { status: 200, json: { state: "open", mergeable: true, mergeable_state: "clean", head: { sha: "abc" }, base: { ref: "main" } } }],
    [/GET .*contents/, govDoc(L0_BLOCK)],
    [/GET \/repos\/refluster\/ai-native-article\/pulls\/1\/files/, { status: 200, json: files }],
    [/GET \/repos\/refluster\/ai-native-article\/commits\/abc\/check-runs/, { status: 200, json: { check_runs: GREEN_CHECK } }],
    [/GET \/repos\/refluster\/ai-native-article\/pulls\/1\/reviews/, { status: 200, json: DARIO_REVIEW }],
    [/GET \/repos\/refluster\/ai-native-article\/issues\/1\/comments/, { status: 200, json: [] }],
  ];
  it("passes an own-repo, non-L0/L1, green, consensus PR (adr-0011: no own-repo veto)", async () => {
    const v = await verifyMergeable(mockGh(ownRepoRoutes([{ filename: "workforce/app/src/pages/Messaging.tsx" }])), "refluster/ai-native-article", 1, { reviewers: ["dario"] });
    expect(v.ok).toBe(true);
  });
  it("still refuses an own-repo PR that touches L0/L1 — the boundary holds", async () => {
    const v = await verifyMergeable(mockGh(ownRepoRoutes([{ filename: "docs/governance.md" }])), "refluster/ai-native-article", 1, { reviewers: ["dario"] });
    expect(v.ok).toBe(false);
    expect(v.why).toMatch(/L0\/L1/);
  });
  it("refuses when the maintainer set the autopilot:off label", async () => {
    const v = await verifyMergeable(
      mockGh([[/GET \/repos\/o\/r\/pulls\/1$/, { status: 200, json: { state: "open", mergeable: true, mergeable_state: "clean", labels: [{ name: "autopilot:off" }], head: { sha: "abc" }, base: { ref: "main" } } }]]),
      "o/r", 1, { reviewers: ["dario"] },
    );
    expect(v.ok).toBe(false);
    expect(v.why).toMatch(/autopilot:off/);
  });
  it("refuses when the PR is not mergeable/clean", async () => {
    const v = await verifyMergeable(
      mockGh([[/GET \/repos\/o\/r\/pulls\/1$/, { status: 200, json: { state: "open", mergeable: false, mergeable_state: "dirty", head: { sha: "abc" }, base: { ref: "main" } } }]]),
      "o/r", 1, { reviewers: ["dario"] },
    );
    expect(v.ok).toBe(false);
  });
});

describe("applyDecisions (merge path — approve is advisory, not a gate)", () => {
  const MERGE_DECISION = {
    pr: 1, action: "merge", comment: "consensus-green, merging", reviewers: ["dario"],
    squash_subject: "feat: thing (#1)", squash_body: "Unanimous sign-off (dario).",
  };
  // verifyMergeable's GET routes (green, non-L0/L1, consensus) + the write legs.
  const mergeRoutes = (approveResp) => [
    ...routes([{ filename: "workforce/lambdas/shared/x.ts" }], GREEN_CHECK, DARIO_REVIEW),
    [/POST \/repos\/o\/r\/issues\/1\/comments/, { status: 201, json: {} }],
    [/POST \/repos\/o\/r\/pulls\/1\/reviews/, approveResp],
    [/PUT \/repos\/o\/r\/pulls\/1\/merge/, { status: 200, json: { merged: true } }],
  ];
  const OWN_PR_422 = { status: 422, json: { message: "Unprocessable Entity", errors: ["Review Can not approve your own pull request"] } };

  it("merges a green own-identity PR even though self-approve 422s (the #361 stall fix)", async () => {
    const gh = mockGh(mergeRoutes(OWN_PR_422));
    const res = await applyDecisions(gh, "o/r", [MERGE_DECISION]);
    expect(res.merged).toBe(1);
    expect(res.refused).toBe(0);
    // The merge PUT — the real gate — must have been reached despite the 422.
    expect(gh.calls.some((c) => c.method === "PUT" && /\/merge$/.test(c.path))).toBe(true);
  });

  it("still merges on a normal approve (200) — non-self-authored path unbroken", async () => {
    const res = await applyDecisions(mockGh(mergeRoutes({ status: 200, json: {} })), "o/r", [MERGE_DECISION]);
    expect(res.merged).toBe(1);
    expect(res.refused).toBe(0);
  });

  it("does NOT merge when the predicate fails (verifyMergeable refuses) even if approve would 422", async () => {
    // L0/L1-touching PR → verifyMergeable refuses before any write leg runs.
    const gh = mockGh([
      ...routes([{ filename: "docs/governance.md" }], GREEN_CHECK, DARIO_REVIEW),
      [/PUT \/repos\/o\/r\/pulls\/1\/merge/, { status: 200, json: { merged: true } }],
    ]);
    const res = await applyDecisions(gh, "o/r", [MERGE_DECISION]);
    expect(res.merged).toBe(0);
    expect(res.refused).toBe(1);
    expect(gh.calls.some((c) => c.method === "PUT" && /\/merge$/.test(c.path))).toBe(false);
  });
});

describe("applyDecisions (escalation labelling)", () => {
  it("always stamps ESCALATION_LABEL on the filed issue", async () => {
    const gh = mockGh([
      [/POST \/repos\/o\/r\/labels/, { status: 422, json: {} }], // label already exists
      [/POST \/repos\/o\/r\/issues$/, { status: 201, json: { html_url: "u" } }],
    ]);
    const res = await applyDecisions(gh, "o/r", [{ pr: 9, action: "escalate", issue_title: "Hold #9", issue_body: "touches L0/L1" }]);
    expect(res.escalated).toBe(1);
    const issueCall = gh.calls.find((c) => c.method === "POST" && /\/issues$/.test(c.path));
    expect(issueCall.body.labels).toContain(ESCALATION_LABEL);
  });
});
