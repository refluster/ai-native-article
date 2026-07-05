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
import { resolveLabels, findRawMentions, NEEDS_HUMAN_MARKER, REVIEWED_MARKER } from "./pr-autopilot-post.mjs";
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
