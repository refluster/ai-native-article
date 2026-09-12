// Tests for build-board-knowledge.mjs — the HTML → text pass and the
// assembled pack against the live repository sources (ADR-0034).
//
// The second block is the drift guard: every source the pack reads is a
// document somebody else maintains (the /docs/ pages, mvv.md, CLAUDE.md,
// governance.md §2/§4 headings). If a heading the builder slices on is
// renamed, `sam build` would throw at deploy time — this test throws in CI
// instead, on the PR that renamed it.

import { describe, expect, it } from "vitest";
import { buildKnowledgePack, decodeEntities, htmlToText, splitSections } from "./build-board-knowledge.mjs";

describe("htmlToText", () => {
  it("keeps headings, lists and cells; drops head/script/style/svg", () => {
    const html = `<!doctype html><html><head><title>T</title><style>p{}</style></head>
<body><script>alert(1)</script><svg><path d="M0"/></svg>
<h1>Title &amp; co</h1><p>Para one.<br>Line two</p>
<h2>Second</h2><ul><li>alpha</li><li>beta &#x2014; gamma</li></ul>
<table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table></body></html>`;
    const text = htmlToText(html);
    expect(text).toContain("# Title & co");
    expect(text).toContain("Para one.\nLine two");
    expect(text).toContain("## Second");
    expect(text).toContain("- alpha\n- beta — gamma");
    expect(text).toContain("a | b");
    expect(text).toContain("1 | 2");
    expect(text).not.toContain("alert");
    expect(text).not.toContain("p{}");
    expect(text).not.toContain("<");
  });

  it("decodes named, decimal and hex entities", () => {
    expect(decodeEntities("&lt;a&gt; &#65;&#x42; &nbsp;x &unknown;")).toBe("<a> AB  x &unknown;");
  });
});

describe("splitSections", () => {
  it("splits on # and ## only, keeping deeper headings in the body", () => {
    const blocks = splitSections("intro\n# One\nbody\n### deep\n## Two\nmore", "Lead");
    expect(blocks.map((b) => b.title)).toEqual(["Lead", "One", "Two"]);
    expect(blocks[1]?.body).toBe("body\n### deep");
  });
});

describe("buildKnowledgePack (live sources)", () => {
  const pack = buildKnowledgePack({ now: new Date("2026-09-12T00:00:00Z") });
  const sources = new Set(pack.sections.map((s) => s.source));

  it("assembles every declared source", () => {
    for (const s of [
      "about",
      "mvv",
      "founding-story",
      "manifesto",
      "whitepaper",
      "workflow-overview",
      "repo",
      "lambdas",
      "governance",
      "adr",
      "roadmap",
    ]) {
      expect(sources.has(s), `source ${s} missing from the pack`).toBe(true);
    }
  });

  it("pins the orientation and the MVV mission/vision", () => {
    const pinned = pack.sections.filter((s) => s.pinned).map((s) => `${s.source}:${s.title}`);
    expect(pinned[0]).toBe("about:What this is (orientation)");
    expect(pinned.some((p) => /^mvv:Mission/.test(p))).toBe(true);
    expect(pinned.some((p) => /^mvv:Vision/.test(p))).toBe(true);
  });

  it("emits parseable section headings and no raw HTML", () => {
    const headings = pack.markdown.split("\n").filter((l) => l.startsWith("## "));
    expect(headings.length).toBe(pack.sections.length);
    for (const h of headings) expect(h).toMatch(/^## \[[a-z0-9-]+(\|pinned)?\] .+$/);
    expect(pack.markdown).not.toMatch(/<(div|p|span|script|style)[ >]/);
  });

  it("stays inside a sane size envelope", () => {
    expect(pack.sections.length).toBeGreaterThan(30);
    expect(pack.markdown.length).toBeGreaterThan(50_000);
    expect(pack.markdown.length).toBeLessThan(600_000);
  });
});
