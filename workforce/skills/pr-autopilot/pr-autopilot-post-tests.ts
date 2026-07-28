// @ts-nocheck — the script under test (pr-autopilot-post.mjs) is a dependency-free
// ESM script, not TS; vitest/esbuild imports it fine at runtime, and this suite is
// not shipped code. Discovered by workforce/lambdas/vitest.config.mjs
// (`include: ["../skills/**/*-tests.ts"]`), so `cd workforce/lambdas && npm test`
// runs it.
//
// Locks the operator directive (2026-06-21): a pr-autopilot hand-off to a human
// ALWAYS carries the autopilot:needs-human label. resolveLabels is the mechanical
// half — it must add ESCALATION_LABEL whenever the verdict escalates (the
// --needs-human flag OR the hidden body marker), and never on a plain routing
// comment.
import { describe, it, expect } from "vitest";
import { resolveLabels, resolveReasons, findRawMentions, NEEDS_HUMAN_MARKER, REVIEWED_MARKER, isVerdictBody, resolvePanelProvenance } from "./pr-autopilot-post.mjs";
import { ESCALATION_LABEL, REVIEWED_LABEL } from "./pr-merge.mjs";

describe("resolveLabels — escalation always carries the label", () => {
  it("a plain routing comment (no flag, no marker) gets no escalation label", () => {
    expect(resolveLabels([], { needsHuman: false, body: "**Nadia — cycle 1.**" })).toEqual([]);
  });

  it("--needs-human forces ESCALATION_LABEL even with no --label values", () => {
    expect(resolveLabels([], { needsHuman: true, body: "verdict" })).toEqual([ESCALATION_LABEL]);
  });

  it("the hidden body marker forces ESCALATION_LABEL even if --needs-human was forgotten", () => {
    const body = `L0/L1 change — operator's final call.\n\n${NEEDS_HUMAN_MARKER}\n`;
    expect(resolveLabels([], { needsHuman: false, body })).toEqual([ESCALATION_LABEL]);
  });

  it("merges explicit --label values and de-dupes the canonical label", () => {
    const out = resolveLabels(["governance", ESCALATION_LABEL], {
      needsHuman: true,
      body: NEEDS_HUMAN_MARKER,
    });
    expect(out).toContain("governance");
    expect(out.filter((l) => l === ESCALATION_LABEL)).toHaveLength(1);
  });

  it("extra --label values without escalation do NOT add the canonical label", () => {
    expect(resolveLabels(["needs-rebase"], { needsHuman: false, body: "" })).toEqual(["needs-rebase"]);
  });

  it("the marker constant is the canonical hidden token", () => {
    expect(NEEDS_HUMAN_MARKER).toBe("<!-- autopilot:needs-human -->");
  });
});

// Locks the operator directive (2026-06-23): a 🟢 unanimous-green PR handed off
// to a human only because of a human gate (L0/L1 / no delegation) ALSO carries
// autopilot:reviewed, so the operator can find the merge-ready subset. reviewed
// is an independent signal — it never implies escalation and vice versa.
describe("resolveLabels — a green, merge-ready hand-off is flagged reviewed", () => {
  it("--reviewed adds REVIEWED_LABEL alongside ESCALATION_LABEL on a green-L0/L1 hand-off", () => {
    const out = resolveLabels([], { needsHuman: true, reviewed: true, body: "verdict" });
    expect(out).toContain(ESCALATION_LABEL);
    expect(out).toContain(REVIEWED_LABEL);
  });

  it("the hidden reviewed marker adds REVIEWED_LABEL even if --reviewed was forgotten", () => {
    const body = `🟢 consensus, but touches L0/L1.\n\n${NEEDS_HUMAN_MARKER}\n${REVIEWED_MARKER}\n`;
    const out = resolveLabels([], { needsHuman: false, reviewed: false, body });
    expect(out).toContain(ESCALATION_LABEL);
    expect(out).toContain(REVIEWED_LABEL);
  });

  it("a 🔴 / non-consensus escalation gets needs-human but NOT reviewed", () => {
    expect(resolveLabels([], { needsHuman: true, reviewed: false, body: "🔴 blocking" })).toEqual([ESCALATION_LABEL]);
  });

  it("reviewed is independent of escalation — reviewed alone never adds needs-human", () => {
    expect(resolveLabels([], { needsHuman: false, reviewed: true, body: "" })).toEqual([REVIEWED_LABEL]);
  });

  it("a plain routing comment gets neither label", () => {
    expect(resolveLabels([], { needsHuman: false, reviewed: false, body: "**Nadia — cycle 1.**" })).toEqual([]);
  });

  it("the reviewed marker constant is the canonical hidden token", () => {
    expect(REVIEWED_MARKER).toBe("<!-- autopilot:reviewed -->");
  });
});

// Locks Epic-019 Story 1: a hand-off to a human ALWAYS carries WHY. resolveReasons
// is the mechanical half — an escalating post with no reason, an unknown code,
// or a bare `other` never reaches GitHub (C-4, exit 1 in main()).
describe("resolveReasons — escalation always carries a reason (Epic-019)", () => {
  it("an escalating post with no reason at all throws", () => {
    expect(() => resolveReasons({ body: `verdict\n${NEEDS_HUMAN_MARKER}`, escalating: true })).toThrow(
      /must carry an escalation reason/,
    );
  });

  it("--reason supplies the code: label + marker to append", () => {
    const r = resolveReasons({ body: "verdict", escalating: true, reason: "cannot-seat-panel" });
    expect(r.labels).toEqual(["autopilot:reason:cannot-seat-panel"]);
    expect(r.appendMarker).toBe("<!-- autopilot:reason:cannot-seat-panel -->");
  });

  it("a marker already embedded in the body satisfies the requirement (nothing appended)", () => {
    const body = `verdict\n${NEEDS_HUMAN_MARKER}\n<!-- autopilot:reason:no-reviewer-consensus -->`;
    const r = resolveReasons({ body, escalating: true });
    expect(r.labels).toEqual(["autopilot:reason:no-reviewer-consensus"]);
    expect(r.appendMarker).toBeNull();
  });

  it("--reason matching an embedded marker is not appended twice", () => {
    const body = "verdict\n<!-- autopilot:reason:l0l1-path -->";
    const r = resolveReasons({ body, escalating: true, reason: "l0l1-path" });
    expect(r.labels).toEqual(["autopilot:reason:l0l1-path"]);
    expect(r.appendMarker).toBeNull();
  });

  it("an unknown code throws (C-4), flag or marker alike", () => {
    expect(() => resolveReasons({ body: "v", escalating: true, reason: "sloppy-review" })).toThrow(/unknown/);
    expect(() => resolveReasons({ body: "<!-- autopilot:reason:sloppy-review -->", escalating: true })).toThrow(/unknown/);
  });

  it("`other` requires free text", () => {
    expect(() => resolveReasons({ body: "v", escalating: true, reason: "other" })).toThrow(/free text/);
    const r = resolveReasons({ body: "v", escalating: true, reason: "other", reasonText: "repo archived" });
    expect(r.labels).toEqual(["autopilot:reason:other"]);
    expect(r.appendMarker).toBe("<!-- autopilot:reason:other repo archived -->");
  });

  it("a non-escalating routing comment needs no reason", () => {
    expect(resolveReasons({ body: "**Nadia — cycle 1.**", escalating: false })).toEqual({
      codes: [],
      labels: [],
      appendMarker: null,
    });
  });
});

// Locks the operator directive (2026-07-04, ML-012): persona slugs are not
// GitHub accounts — a raw `@<slug>` in a posted body notifies the real,
// unrelated GitHub user who owns that name (`@yuki` pinged github.com/yuki).
// findRawMentions is the mechanical half: the script refuses (exit 1) any
// body where it finds a mention. Agents are referenced as `wf:<slug>` in
// backticks, which must never trip the guard.
describe("findRawMentions — no raw GitHub @-mentions leave the workforce", () => {
  it("flags the incident shape: a routing comment @-mentioning a persona", () => {
    expect(findRawMentions("- **@yuki** — owns the console surface")).toEqual(["@yuki"]);
  });

  it("flags a skip-line mention and de-dupes repeats", () => {
    const body = "Skipping @maya — no surface. Also skipping @maya.\n@dario is seated.";
    expect(findRawMentions(body).sort()).toEqual(["@dario", "@maya"]);
  });

  it("the canonical wf:<slug> reference in backticks is clean", () => {
    const body = "Reviewers nominated (≥ 3):\n\n- **`wf:yuki`** — console surface\n\nSkipping `wf:maya` — no surface.";
    expect(findRawMentions(body)).toEqual([]);
  });

  it("ignores @-tokens inside inline code spans and fenced blocks", () => {
    const body = "Uses `@anthropic-ai/sdk`.\n\n```ts\n@Injectable()\nclass A {}\n// cc @yuki\n```\n";
    expect(findRawMentions(body)).toEqual([]);
  });

  it("ignores double-backtick spans", () => {
    expect(findRawMentions("quote ``@yuki`` verbatim")).toEqual([]);
  });

  it("flags a mention GitHub would linkify even when bolded or hyphenated", () => {
    expect(findRawMentions("ping **@anthropic-ai** please")).toEqual(["@anthropic-ai"]);
  });

  it("does not flag emails (GitHub does not linkify them either)", () => {
    expect(findRawMentions("contact refluster@gmail.com about it")).toEqual([]);
  });

  it("flags a mention at the very start of the body", () => {
    expect(findRawMentions("@yuki take a look")).toEqual(["@yuki"]);
  });

  it("empty / markerless bodies are clean", () => {
    expect(findRawMentions("")).toEqual([]);
    expect(findRawMentions(`verdict\n\n${NEEDS_HUMAN_MARKER}\n`)).toEqual([]);
  });
});


// ── Panel provenance (#513 / wf:rafael R1) ──────────────────────────────────
// The verdict comment weighs convergence differently depending on whether the
// lenses could see each other, and the operator merges on that sentence. These
// pin that the claim must be PRESENT and machine-readable — not that it is
// true, which this mechanism cannot establish and must not appear to.

const verdict = (extra = "") =>
  `**Nadia — verdict, cycle 1 of ≤ 3. 🟡 — author revision expected.**\n\nSynthesis…${extra}`;

describe("isVerdictBody — only verdict posts carry the requirement", () => {
  it("matches the Step-5 verdict header", () => {
    expect(isVerdictBody(verdict())).toBe(true);
  });
  // Catches: the requirement leaking onto routing comments and lens reviews,
  // which would break every non-verdict post the cadence makes.
  it("does not match a routing comment or a lens review", () => {
    expect(isVerdictBody("**Nadia — cycle 1 of ≤ 3.**\n\nReviewers nominated…")).toBe(false);
    expect(isVerdictBody("🔴 **from the architecture lens** — …")).toBe(false);
    expect(isVerdictBody("")).toBe(false);
  });
});

describe("resolvePanelProvenance", () => {
  // THE FINDING. Pre-fix, a verdict could assert convergence with no statement
  // of how the lenses were produced, and nothing objected. Now the claim is
  // always present — and an undeclared verdict gets the WEAKER one.
  it("stamps inline on an undeclared verdict rather than asserting independence", () => {
    expect(resolvePanelProvenance({ body: verdict() })).toEqual({
      mode: "inline",
      appendMarker: "<!-- autopilot:panel:inline -->",
      defaulted: true,
    });
  });

  // Catches: turning the default into a throw. That would break every verdict
  // post between merging this and the OP-015 PATCH, because the script is live
  // from the clone while the body telling the router to pass --panel is not
  // (ADR-0008 / wf:sana S1). An outage is not a stronger guarantee.
  it("never throws for a missing declaration — the activation window depends on it", () => {
    expect(() => resolvePanelProvenance({ body: verdict() })).not.toThrow();
  });

  it("appends the marker from --panel", () => {
    expect(resolvePanelProvenance({ body: verdict(), panel: "isolated" })).toEqual({
      mode: "isolated",
      appendMarker: "<!-- autopilot:panel:isolated -->",
    });
    expect(resolvePanelProvenance({ body: verdict(), panel: "inline" }).appendMarker).toBe(
      "<!-- autopilot:panel:inline -->",
    );
  });

  it("accepts a marker already embedded in the body, without duplicating it", () => {
    const body = verdict("\n\n<!-- autopilot:panel:inline -->");
    expect(resolvePanelProvenance({ body })).toEqual({ mode: "inline", appendMarker: null });
    expect(resolvePanelProvenance({ body, panel: "inline" }).appendMarker).toBeNull();
  });

  // Catches: a flag and a marker disagreeing, which would publish two
  // contradictory provenance claims in one verdict.
  it("refuses a flag that contradicts an embedded marker", () => {
    const body = verdict("\n\n<!-- autopilot:panel:inline -->");
    expect(() => resolvePanelProvenance({ body, panel: "isolated" })).toThrow(/contradicts/);
  });

  it("refuses an unknown mode rather than stamping it", () => {
    expect(() => resolvePanelProvenance({ body: verdict(), panel: "independent" })).toThrow(/--panel must be one of/);
  });

  // Non-verdict posts are unaffected — the requirement is scoped to the one
  // comment whose reader is being asked to weigh convergence.
  it("leaves routing comments and reviews alone", () => {
    expect(resolvePanelProvenance({ body: "**Nadia — cycle 1 of ≤ 3.**" })).toEqual({
      mode: null,
      appendMarker: null,
    });
  });

  // Catches: the mechanism drifting into a truth claim. This test exists to be
  // read, not just to pass — `isolated` is accepted on a body that says the
  // lenses ran inline, because the check is presence, not honesty.
  it("cannot detect a false declaration, by construction", () => {
    const lying = verdict("\n\nThe lenses ran inline, in my own context.");
    expect(resolvePanelProvenance({ body: lying, panel: "isolated" }).mode).toBe("isolated");
  });
});
