// Tests for build-board-knowledge.mjs — the HTML → text pass and the
// assembled pack against the live repository sources (ADR-0034).
//
// The second block is the drift guard: every source the pack reads is a
// document somebody else maintains (the /docs/ pages, mvv.md, CLAUDE.md,
// governance.md §2/§4 headings). If a heading the builder slices on is
// renamed, `sam build` would throw at deploy time — this test throws in CI
// instead, on the PR that renamed it.

import { describe, expect, it } from "vitest";
import {
  buildKnowledgePack,
  decodeEntities,
  externalProjectTerms,
  htmlTitle,
  htmlToText,
  researchArticles,
  scrub,
  splitSections,
} from "./build-board-knowledge.mjs";

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

describe("scrub (redaction, operator direction 2026-09-12)", () => {
  const terms = ["asp-cloud", "ASP Cloud", "Project IND"];

  it("drops whole lines that mention an external client project or a client topic", () => {
    const out = scrub("keep me\n| asp-cloud | product | detail |\nAlso ASP Cloud shipped.\nIndia energy desk scope.\nスマートメーターの分析\nstill here", terms);
    expect(out).toBe("keep me\nstill here");
  });

  it("rewrites code-hosting detail, money and the founder's identity in place", () => {
    const out = scrub(
      "See https://github.com/refluster/ai-native-article/pull/717 and PR #12 in workforce/lambdas/x.ts; cap USD 600/month; Koh Uehara at kohuehara.xyz",
      terms,
    );
    expect(out).not.toMatch(/https?:|refluster|#12|x\.ts|USD|Uehara|kohuehara/);
    expect(out).toContain("a code change");
    expect(out).toContain("a fixed monthly amount");
    expect(out).toContain("the founder at the site");
  });

  it("reads every non-internal project id/name from workforce/projects/", () => {
    const t = externalProjectTerms();
    expect(t).toContain("asp-cloud");
    expect(t).toContain("luckyhat");
    expect(t).not.toContain("agent-workforce");
    expect(t).not.toContain("conference");
  });
});

describe("buildKnowledgePack (live sources)", () => {
  const pack = buildKnowledgePack({ now: new Date("2026-09-12T00:00:00Z") });
  const sources = new Set(pack.sections.map((s) => s.source));

  it("assembles exactly the thesis + research sources, none of the implementation catalogues", () => {
    for (const s of ["about", "mvv", "founding-story", "manifesto", "whitepaper", "workflow-overview", "research"]) {
      expect(sources.has(s), `source ${s} missing from the pack`).toBe(true);
    }
    for (const s of ["repo", "lambdas", "governance", "adr", "roadmap"]) {
      expect(sources.has(s), `source ${s} should no longer be in the pack`).toBe(false);
    }
  });

  it("pins the orientation, the whole MVV, the manifesto and the founding story; selects the rest", () => {
    const bySource = new Map<string, boolean[]>();
    for (const s of pack.sections) bySource.set(s.source, [...(bySource.get(s.source) ?? []), s.pinned]);
    expect(pack.sections[0]?.title).toBe("What this is (orientation)");
    for (const s of ["about", "mvv", "manifesto", "founding-story"]) expect(bySource.get(s)?.every(Boolean), `${s} pinned`).toBe(true);
    for (const s of ["whitepaper", "workflow-overview", "research"]) expect(bySource.get(s)?.some(Boolean), `${s} not pinned`).toBe(false);
    const pinnedChars = pack.sections.filter((s) => s.pinned).reduce((n, s) => n + s.body.length, 0);
    expect(pinnedChars).toBeGreaterThan(30_000);
    expect(pinnedChars).toBeLessThan(120_000);
  });

  it("titles the docs pages from their <title>, not the split cover heading", () => {
    expect(htmlTitle("<html><head><title>創業ストーリー — Software Talent Network</title></head></html>")).toBe("創業ストーリー");
    expect(pack.sections.some((s) => s.title.startsWith("Software — Software"))).toBe(false);
  });

  it("includes the research corpus, one article per section, excluding client-work articles whole", () => {
    const { articles, excluded } = researchArticles();
    expect(articles.length).toBeGreaterThan(20);
    expect(articles.length + excluded).toBeLessThanOrEqual(200);
    const research = pack.sections.filter((s) => s.source === "research");
    expect(research.length).toBe(articles.length);
    for (const s of research) expect(s.body).not.toMatch(/^---\ntitle:/);
  });

  it("emits parseable section headings and no raw HTML", () => {
    const headings = pack.markdown.split("\n").filter((l) => l.startsWith("## "));
    expect(headings.length).toBe(pack.sections.length);
    for (const h of headings) expect(h).toMatch(/^## \[[a-z0-9-]+(\|pinned)?\] .+$/);
    expect(pack.markdown).not.toMatch(/<(div|p|span|script|style)[ >]/);
  });

  it("contains no external project, code-hosting, money or founder identity residue", () => {
    for (const term of externalProjectTerms()) {
      expect(pack.markdown.toLowerCase(), `external project term "${term}" leaked`).not.toContain(term.toLowerCase());
    }
    const body = pack.sections.map((s) => `${s.title}\n${s.body}`).join("\n");
    expect(body).not.toMatch(/github\.com|refluster\/|kohuehara|Uehara|https?:\/\/|\bUSD\s?\d|\bIndia\b|DISCOM/);
    expect(body).not.toMatch(/\b[A-Za-z0-9_.-]+\.(?:mjs|ts|yml)\b/);
    expect(pack.sections.some((s) => s.title === "Repository map")).toBe(false);
  });

  it("stays inside a sane size envelope", () => {
    expect(pack.sections.length).toBeGreaterThan(50);
    expect(pack.markdown.length).toBeGreaterThan(80_000);
    expect(pack.markdown.length).toBeLessThan(4_000_000);
  });
});
