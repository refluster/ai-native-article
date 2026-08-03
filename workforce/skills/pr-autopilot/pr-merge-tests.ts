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
  countRouterCycles,
  W4_CYCLE_CAP,
  MIN_REVIEWERS,
  verifyMergeable,
  applyDecisions,
  prTouchesL0L1,
  ESCALATION_LABEL,
  AUTHOR_LABEL,
  AUTHOR_MARKER,
  REMEDIATION_CAP,
  countRemediationAttempts,
  remediationMarker,
  emitRefusalReason,
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
// A merge needs a panel of ≥ MIN_REVIEWERS (operator directive 2026-06-29).
// PANEL + PANEL_REVIEWS is the canonical green-consensus fixture; each persona
// posts its own exact green marker.
const PANEL = ["dario", "ren", "mateo"];
const PANEL_REVIEWS = PANEL.map((slug) => ({ state: "COMMENTED", body: `looks good\n\n${reviewerGreenMarker(slug)}` }));

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
  it("passes on a non-L0/L1, green, 3-reviewer consensus PR", async () => {
    const v = await verifyMergeable(mockGh(routes([{ filename: "src/app.ts" }], GREEN_CHECK, PANEL_REVIEWS)), "o/r", 1, { reviewers: PANEL });
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
    // 3 nominated (clears the panel floor), but ren never posted a green marker.
    const v = await verifyMergeable(mockGh(routes([{ filename: "src/app.ts" }], GREEN_CHECK, [...DARIO_REVIEW, { state: "COMMENTED", body: reviewerGreenMarker("mateo") }])), "o/r", 1, { reviewers: PANEL });
    expect(v.ok).toBe(false);
    expect(v.why).toMatch(/ren/);
  });
  it("refuses a single green reviewer — below the 3-reviewer panel floor", async () => {
    const v = await verifyMergeable(mockGh(routes([{ filename: "src/app.ts" }], GREEN_CHECK, DARIO_REVIEW)), "o/r", 1, { reviewers: ["dario"] });
    expect(v.ok).toBe(false);
    expect(v.why).toMatch(/at least 3/);
  });
  it("refuses two green reviewers — still below the floor", async () => {
    const two = ["dario", "ren"];
    const reviews = two.map((s) => ({ state: "COMMENTED", body: reviewerGreenMarker(s) }));
    const v = await verifyMergeable(mockGh(routes([{ filename: "src/app.ts" }], GREEN_CHECK, reviews)), "o/r", 1, { reviewers: two });
    expect(v.ok).toBe(false);
    expect(v.why).toMatch(/at least 3/);
  });
  it("de-dupes reviewers — the same persona listed 3× is one reviewer, refused", async () => {
    const v = await verifyMergeable(mockGh(routes([{ filename: "src/app.ts" }], GREEN_CHECK, DARIO_REVIEW)), "o/r", 1, { reviewers: ["dario", "Dario", "DARIO"] });
    expect(v.ok).toBe(false);
    expect(v.why).toMatch(/at least 3/);
  });
  it("passes on exactly 3 distinct green reviewers", async () => {
    const v = await verifyMergeable(mockGh(routes([{ filename: "src/app.ts" }], GREEN_CHECK, PANEL_REVIEWS)), "o/r", 1, { reviewers: PANEL });
    expect(v.ok).toBe(true);
  });
  // adr-0011: the workforce's own repo is a normal delegated target — no own-repo
  // veto. The single boundary is the L0/L1 path set, so a reviewed non-L0/L1 PR
  // passes (next test) while a governance PR still escalates (the one after).
  const ownRepoRoutes = (files) => [
    [/GET \/repos\/refluster\/ai-native-article\/pulls\/1$/, { status: 200, json: { state: "open", mergeable: true, mergeable_state: "clean", head: { sha: "abc" }, base: { ref: "main" } } }],
    [/GET .*contents/, govDoc(L0_BLOCK)],
    [/GET \/repos\/refluster\/ai-native-article\/pulls\/1\/files/, { status: 200, json: files }],
    [/GET \/repos\/refluster\/ai-native-article\/commits\/abc\/check-runs/, { status: 200, json: { check_runs: GREEN_CHECK } }],
    [/GET \/repos\/refluster\/ai-native-article\/pulls\/1\/reviews/, { status: 200, json: PANEL_REVIEWS }],
    [/GET \/repos\/refluster\/ai-native-article\/issues\/1\/comments/, { status: 200, json: [] }],
  ];
  it("passes an own-repo, non-L0/L1, green, consensus PR (adr-0011: no own-repo veto)", async () => {
    const v = await verifyMergeable(mockGh(ownRepoRoutes([{ filename: "workforce/app/src/pages/Messaging.tsx" }])), "refluster/ai-native-article", 1, { reviewers: PANEL });
    expect(v.ok).toBe(true);
  });
  it("still refuses an own-repo PR that touches L0/L1 — the boundary holds", async () => {
    const v = await verifyMergeable(mockGh(ownRepoRoutes([{ filename: "docs/governance.md" }])), "refluster/ai-native-article", 1, { reviewers: PANEL });
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

describe("countRouterCycles (FU-004)", () => {
  it("returns 0 for empty input", () => expect(countRouterCycles([])).toBe(0));
  it("returns 0 when no routing comment is present", () =>
    expect(countRouterCycles(["no routing here", "just a review comment"])).toBe(0));
  it("detects cycle 1 from a canonical routing comment", () =>
    expect(countRouterCycles(["**Nadia — cycle 1 of ≤ 7.**\n\nPR summary…"])).toBe(1));
  it("detects the highest cycle across multiple routing comments", () =>
    expect(countRouterCycles([
      "**Nadia — cycle 1 of ≤ 7.**",
      "other comment",
      "**Nadia — cycle 3 of ≤ 7.**",
    ])).toBe(3));
  it("matches when persona name contains a space", () =>
    expect(countRouterCycles(["**Some Name — cycle 2 of ≤ 7.**"])).toBe(2));
  it("W4_CYCLE_CAP is 7", () => expect(W4_CYCLE_CAP).toBe(7));
});

describe("MIN_REVIEWERS (3-reviewer panel floor — operator directive 2026-06-29)", () => {
  it("MIN_REVIEWERS is 3", () => expect(MIN_REVIEWERS).toBe(3));
});

describe("verifyMergeable — W-4 cycle cap (FU-004)", () => {
  it("allows merge when cycle equals W4_CYCLE_CAP (exactly 7)", async () => {
    const gh = mockGh(routes(
      [{ filename: "src/app.ts" }],
      GREEN_CHECK,
      PANEL_REVIEWS,
      [{ body: "**Nadia — cycle 7 of ≤ 7.**\n\nsummary" }],
    ));
    const v = await verifyMergeable(gh, "o/r", 1, { reviewers: PANEL });
    expect(v.ok).toBe(true);
  });
  it("refuses merge when cycle exceeds W4_CYCLE_CAP (cycle = 8)", async () => {
    const gh = mockGh(routes(
      [{ filename: "src/app.ts" }],
      GREEN_CHECK,
      PANEL_REVIEWS,
      [{ body: "**Nadia — cycle 8 of ≤ 7.**\n\nsummary" }],
    ));
    const v = await verifyMergeable(gh, "o/r", 1, { reviewers: PANEL });
    expect(v.ok).toBe(false);
    expect(v.why).toMatch(/W-4/);
    expect(v.why).toMatch(/cycle 8/);
  });
});

describe("applyDecisions (merge path — approve is advisory, not a gate)", () => {
  const MERGE_DECISION = {
    pr: 1, action: "merge", comment: "consensus-green, merging", reviewers: PANEL,
    squash_subject: "feat: thing (#1)", squash_body: "Unanimous sign-off (dario, ren, mateo).",
  };
  // verifyMergeable's GET routes (green, non-L0/L1, 3-reviewer consensus) + write legs.
  const mergeRoutes = (approveResp) => [
    ...routes([{ filename: "workforce/lambdas/shared/x.ts" }], GREEN_CHECK, PANEL_REVIEWS),
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

  // Epic-019 Story 1: an escalation may declare its reason code — validated
  // loud, carried as label + hidden marker on the filed issue.
  it("a reason_code rides along as label + marker", async () => {
    const gh = mockGh([
      [/POST \/repos\/o\/r\/labels/, { status: 422, json: {} }],
      [/POST \/repos\/o\/r\/issues$/, { status: 201, json: { html_url: "u" } }],
    ]);
    const res = await applyDecisions(gh, "o/r", [
      { pr: 9, action: "escalate", issue_title: "Hold #9", issue_body: "touches L0/L1", reason_code: "l0l1-path" },
    ]);
    expect(res.escalated).toBe(1);
    const issueCall = gh.calls.find((c) => c.method === "POST" && /\/issues$/.test(c.path));
    expect(issueCall.body.labels).toContain("autopilot:reason:l0l1-path");
    expect(issueCall.body.body).toContain("<!-- autopilot:reason:l0l1-path -->");
  });

  it("an unknown reason_code throws (C-4) — never a quiet new bucket", async () => {
    await expect(
      applyDecisions(mockGh([]), "o/r", [
        { pr: 9, action: "escalate", issue_title: "t", issue_body: "b", reason_code: "reviewer-was-slow" },
      ]),
    ).rejects.toThrow(/unknown escalation-reason code/);
  });
});

describe("applyDecisions — refusal telemetry (Epic-019 Story 1)", () => {
  const MERGE_DECISION = {
    pr: 1, action: "merge", comment: "consensus-green, merging", reviewers: PANEL,
    squash_subject: "feat: thing (#1)", squash_body: "Unanimous sign-off (dario, ren, mateo).",
  };
  it("a refused merge stamps autopilot:reason:<code> + posts the marker comment — and still never merges", async () => {
    // L0/L1-touching PR → verifyMergeable refuses with the `touches L0/L1 path` clause.
    const gh = mockGh([
      ...routes([{ filename: "docs/governance.md" }], GREEN_CHECK, PANEL_REVIEWS),
      [/POST \/repos\/o\/r\/labels/, { status: 422, json: {} }],
      [/POST \/repos\/o\/r\/issues\/1\/labels/, { status: 200, json: [] }],
      [/POST \/repos\/o\/r\/issues\/1\/comments/, { status: 201, json: {} }],
    ]);
    const res = await applyDecisions(gh, "o/r", [MERGE_DECISION]);
    expect(res.merged).toBe(0);
    expect(res.refused).toBe(1);
    const labelCall = gh.calls.find((c) => c.method === "POST" && /issues\/1\/labels$/.test(c.path));
    expect(labelCall.body.labels).toEqual(["autopilot:reason:l0l1-path"]);
    const commentCall = gh.calls.find((c) => c.method === "POST" && /issues\/1\/comments$/.test(c.path));
    expect(commentCall.body.body).toContain("<!-- autopilot:reason:l0l1-path -->");
    // Telemetry never widens the predicate: the merge PUT was still not reached.
    expect(gh.calls.some((c) => c.method === "PUT" && /\/merge$/.test(c.path))).toBe(false);
  });
  it("a consensus refusal maps to no-reviewer-consensus", async () => {
    const gh = mockGh([
      ...routes([{ filename: "src/app.ts" }], GREEN_CHECK, DARIO_REVIEW),
      [/POST \/repos\/o\/r\/labels/, { status: 422, json: {} }],
      [/POST \/repos\/o\/r\/issues\/1\/labels/, { status: 200, json: [] }],
      [/POST \/repos\/o\/r\/issues\/1\/comments/, { status: 201, json: {} }],
    ]);
    const res = await applyDecisions(gh, "o/r", [{ ...MERGE_DECISION, reviewers: ["dario"] }]);
    expect(res.refused).toBe(1);
    const labelCall = gh.calls.find((c) => c.method === "POST" && /issues\/1\/labels$/.test(c.path));
    expect(labelCall.body.labels).toEqual(["autopilot:reason:no-reviewer-consensus"]);
  });
});

describe("prTouchesL0L1 (verdict-time L0/L1 computation — Epic-019 Story 1)", () => {
  it("reports touches:true when a changed file matches the declared set", async () => {
    const gh = mockGh([
      [/GET .*contents/, govDoc(L0_BLOCK)],
      [/GET \/repos\/o\/r\/pulls\/1\/files/, { status: 200, json: [{ filename: "docs/adr/adr-2.md" }] }],
    ]);
    const t = await prTouchesL0L1(gh, "o/r", 1, "main");
    expect(t.known).toBe(true);
    expect(t.touches).toBe(true);
    expect(t.why).toMatch(/docs\/adr\/adr-2\.md/);
  });
  it("reports touches:false on a clean surface", async () => {
    const gh = mockGh([
      [/GET .*contents/, govDoc(L0_BLOCK)],
      [/GET \/repos\/o\/r\/pulls\/1\/files/, { status: 200, json: [{ filename: "src/app.ts" }] }],
    ]);
    const t = await prTouchesL0L1(gh, "o/r", 1, "main");
    expect(t).toMatchObject({ known: true, touches: false });
  });
  it("fails closed (known:false, touches:null) when the governance doc is unreadable — never guesses", async () => {
    const t = await prTouchesL0L1(mockGh([[/GET .*contents/, { status: 404, json: {} }]]), "o/r", 1);
    expect(t.known).toBe(false);
    expect(t.touches).toBeNull();
  });
  it("fails closed when the files listing fails", async () => {
    const gh = mockGh([[/GET .*contents/, govDoc(L0_BLOCK)]]); // files GET → 404 default
    const t = await prTouchesL0L1(gh, "o/r", 1, "main");
    expect(t.known).toBe(false);
  });
});

describe("verifyMergeable — drafts are merge-eligible (adr-0014)", () => {
  // A draft GET (state "draft", draft:true, node_id) prepended so mockGh's
  // first-match wins over routes()'s default clean pulls/1 GET.
  const draftPullGet = {
    status: 200,
    json: { state: "open", draft: true, node_id: "PR_kwDraft", mergeable: true, mergeable_state: "draft", head: { sha: "abc" }, base: { ref: "main" } },
  };
  it("accepts a green, non-L0/L1 draft and surfaces draft + nodeId", async () => {
    const gh = mockGh([
      [/GET \/repos\/o\/r\/pulls\/1$/, draftPullGet],
      ...routes([{ filename: "src/app.ts" }], GREEN_CHECK, PANEL_REVIEWS),
    ]);
    const v = await verifyMergeable(gh, "o/r", 1, { reviewers: PANEL });
    expect(v.ok).toBe(true);
    expect(v.draft).toBe(true);
    expect(v.nodeId).toBe("PR_kwDraft");
  });
  it("still refuses a genuinely non-mergeable state even on a draft (dirty)", async () => {
    const gh = mockGh([
      [/GET \/repos\/o\/r\/pulls\/1$/, { status: 200, json: { state: "open", draft: true, mergeable: false, mergeable_state: "dirty", head: { sha: "abc" }, base: { ref: "main" } } }],
      ...routes([{ filename: "src/app.ts" }], GREEN_CHECK, PANEL_REVIEWS),
    ]);
    const v = await verifyMergeable(gh, "o/r", 1, { reviewers: PANEL });
    expect(v.ok).toBe(false);
  });
});

describe("applyDecisions (draft auto-ready then merge — adr-0014)", () => {
  const DRAFT_MERGE = {
    pr: 1, action: "merge", comment: "consensus-green, merging", reviewers: PANEL,
    squash_subject: "feat: thing (#1)", squash_body: "Unanimous sign-off (dario, ren, mateo).",
  };
  const draftMergeRoutes = (readyResp) => [
    [/GET \/repos\/o\/r\/pulls\/1$/, { status: 200, json: { state: "open", draft: true, node_id: "PR_kwDraft", mergeable: true, mergeable_state: "draft", head: { sha: "abc" }, base: { ref: "main" } } }],
    ...routes([{ filename: "workforce/lambdas/shared/x.ts" }], GREEN_CHECK, PANEL_REVIEWS),
    [/POST \/graphql/, readyResp],
    [/POST \/repos\/o\/r\/issues\/1\/comments/, { status: 201, json: {} }],
    [/POST \/repos\/o\/r\/pulls\/1\/reviews/, { status: 200, json: {} }],
    [/PUT \/repos\/o\/r\/pulls\/1\/merge/, { status: 200, json: { merged: true } }],
  ];
  const READY_OK = { status: 200, json: { data: { markPullRequestReadyForReview: { pullRequest: { isDraft: false } } } } };

  it("marks the draft Ready for Review (GraphQL) before merging, then merges", async () => {
    const gh = mockGh(draftMergeRoutes(READY_OK));
    const res = await applyDecisions(gh, "o/r", [DRAFT_MERGE]);
    expect(res.merged).toBe(1);
    expect(res.refused).toBe(0);
    // The un-draft GraphQL leg ran, and the merge PUT — the real gate — was reached.
    expect(gh.calls.some((c) => c.method === "POST" && c.path === "/graphql")).toBe(true);
    expect(gh.calls.some((c) => c.method === "PUT" && /\/merge$/.test(c.path))).toBe(true);
  });

  it("fails closed when the un-draft does not land (GraphQL errors) — no merge", async () => {
    const READY_FAIL = { status: 200, json: { errors: [{ message: "could not mark ready" }] } };
    const gh = mockGh(draftMergeRoutes(READY_FAIL));
    const res = await applyDecisions(gh, "o/r", [DRAFT_MERGE]);
    expect(res.merged).toBe(0);
    expect(res.refused).toBe(1);
    expect(gh.calls.some((c) => c.method === "PUT" && /\/merge$/.test(c.path))).toBe(false);
  });
});

// ── adr-0022: the author lane's bound, and the engine's routing into it ────
describe("countRemediationAttempts / remediationMarker — the lane's bound", () => {
  it("a never-attempted PR reads 0", () => {
    expect(countRemediationAttempts(["**Nadia — cycle 1.**", "a review"])).toBe(0);
  });

  it("reads the highest attempt across every body, order-independently", () => {
    expect(countRemediationAttempts([remediationMarker(2), "noise", remediationMarker(1)])).toBe(2);
  });

  it("markers outside 1..CAP are refused — the lane can never loop unbounded", () => {
    expect(() => remediationMarker(0)).toThrow(/outside 1\.\./);
    expect(() => remediationMarker(REMEDIATION_CAP + 1)).toThrow(/remediation-cap-exceeded/);
  });
});

describe("emitRefusalReason — an agent-fixable refusal routes to the author lane", () => {
  it("a dirty PR is labelled needs-author (not needs-human) and carries the lane marker", async () => {
    const gh = mockGh([
      [/^POST \/repos\/o\/r\/labels$/, { status: 201, json: {} }],
      [/^POST \/repos\/o\/r\/issues\/7\/labels$/, { status: 200, json: {} }],
      [/^POST \/repos\/o\/r\/issues\/7\/comments$/, { status: 201, json: {} }],
    ]);
    const calls = gh.calls;
    const code = await emitRefusalReason(gh, "o/r", 7, "not mergeable (mergeable=false, state=dirty)");
    expect(code).toBe("merge-conflict");
    const labelCall = calls.find((c) => c.path === "/repos/o/r/issues/7/labels");
    expect(labelCall.body.labels).toContain(AUTHOR_LABEL);
    expect(labelCall.body.labels).not.toContain(ESCALATION_LABEL);
    const comment = calls.find((c) => c.path === "/repos/o/r/issues/7/comments");
    expect(comment.body.body).toContain(AUTHOR_MARKER);
  });

  it("a human-lane refusal is unchanged — no author label, no lane marker", async () => {
    const gh = mockGh([
      [/^POST \/repos\/o\/r\/labels$/, { status: 201, json: {} }],
      [/^POST \/repos\/o\/r\/issues\/8\/labels$/, { status: 200, json: {} }],
      [/^POST \/repos\/o\/r\/issues\/8\/comments$/, { status: 201, json: {} }],
    ]);
    const calls = gh.calls;
    const code = await emitRefusalReason(gh, "o/r", 8, "touches L0/L1 path docs/governance.md — escalate to human");
    expect(code).toBe("l0l1-path");
    expect(calls.find((c) => c.path === "/repos/o/r/issues/8/labels").body.labels).not.toContain(AUTHOR_LABEL);
    expect(calls.find((c) => c.path === "/repos/o/r/issues/8/comments").body.body).not.toContain(AUTHOR_MARKER);
  });
});
