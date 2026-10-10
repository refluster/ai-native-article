// Discovered by workforce/lambdas/vitest.config.mjs (`../scripts/**/*-tests.ts`).
//
// check-book.mjs is the web books' W-1: a blank chapter, a quotation the
// research pack never verified, a missing figure or a stub must turn the
// build red. Each rule is exercised on a throwaway book directory.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkBook, visibleChars, fencedBlocks, parseKeyValues, MIN_CHARS } from "./check-book.mjs";

const REGISTER = `### Q-01-01
- 篇: 01 始計
- 原文: 兵者、國之大事。
- 訓読: 兵は国の大事なり。
- 現代語訳: 戦争は国家の重大事である。
`;

const QUOTE_OK = "```quote\n原文: 兵者、國之大事。\n訓読: 兵は国の大事なり。\n出典: 始計篇\n訳: 戦争は国家の重大事である。\n```\n";
const SVG_OK = '<svg viewBox="0 0 100 40" xmlns="http://www.w3.org/2000/svg" role="img"><title>t</title><rect width="10" height="10" fill="var(--book-panel)" stroke="var(--book-line)"/></svg>';

function filler(n: number): string {
  return "あ".repeat(n) + "。\n";
}

function manifest(extra: Record<string, unknown> = {}, chapters?: unknown[]) {
  return JSON.stringify({
    slug: "demo",
    title: "demo",
    lang: "ja",
    kicker: "k",
    description: "d",
    version: "1.0.0",
    updated: "2026-10-05",
    authors: ["ingrid"],
    parts: [{ id: "p1", title: "part", chapters: chapters ?? [{ id: "c1", file: "chapters/01.md", title: "c1" }] }],
    ...extra,
  });
}

let root: string;
let dir: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "check-book-"));
  dir = join(root, "demo");
  mkdirSync(join(dir, "chapters"), { recursive: true });
  mkdirSync(join(dir, "figures"), { recursive: true });
  writeFileSync(join(dir, "quotes.md"), REGISTER);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function write(path: string, text: string) {
  writeFileSync(join(dir, path), text);
}

describe("check-book helpers", () => {
  it("counts the characters a reader sees, not the markup", () => {
    expect(visibleChars("# 題\n\n本文です。\n\n```quote\n原文: 兵者。\n訓読: 兵は。\n出典: 始計篇\n```\n")).toBe("題本文です。兵者。兵は。始計篇".length);
  });
  it("finds fenced blocks with their language and line", () => {
    const blocks = fencedBlocks("# t\n\n```note\nx\n```\n\n```connect\ntitle: y\nbody\n```\n");
    expect(blocks.map((b) => [b.lang, b.line])).toEqual([["note", 3], ["connect", 7]]);
  });
  it("parses key: value lines", () => {
    expect(parseKeyValues("原文: a\n訓読: b\n")).toEqual({ 原文: "a", 訓読: "b" });
  });
});

describe("checkBook", () => {
  it("passes a well-formed book", () => {
    write("book.json", manifest());
    write("figures/f.svg", SVG_OK);
    write("chapters/01.md", "# c1\n\n" + filler(MIN_CHARS) + QUOTE_OK + "```connect\ntitle: 接続\n本文\n```\n\n```note\n注\n```\n\n![図1 題](figures/f.svg)\n");
    expect(checkBook(dir, "demo")).toEqual([]);
  });

  it("refuses a manifest whose chapter file is missing or slug mismatches", () => {
    write("book.json", manifest({ slug: "other" }, [{ id: "c1", file: "chapters/nope.md", title: "c1" }]));
    const d = checkBook(dir, "demo");
    expect(d.join("\n")).toMatch(/slug "other"/);
    expect(d.join("\n")).toMatch(/chapter file missing: chapters\/nope.md/);
  });

  it("refuses a quotation the register does not carry, verbatim", () => {
    write("book.json", manifest());
    write("chapters/01.md", "# c1\n\n" + filler(MIN_CHARS) + "```quote\n原文: 兵者國之大事\n訓読: 兵は国の大事なり。\n出典: 始計篇\n```\n");
    expect(checkBook(dir, "demo").join("\n")).toMatch(/原文 not in quotes.md/);
  });

  it("refuses a quote block missing a required key", () => {
    write("book.json", manifest());
    write("chapters/01.md", "# c1\n\n" + filler(MIN_CHARS) + "```quote\n原文: 兵者、國之大事。\n訓読: 兵は国の大事なり。\n```\n");
    expect(checkBook(dir, "demo").join("\n")).toMatch(/quote block lacks 出典/);
  });

  it("refuses a stub chapter, raw HTML, a missing H1 and an unknown fence", () => {
    write("book.json", manifest());
    write("chapters/01.md", "intro without title\n<div>x</div>\n```foo\nx\n```\n");
    const d = checkBook(dir, "demo").join("\n");
    expect(d).toMatch(/exactly one "# title"/);
    expect(d).toMatch(/raw HTML/);
    expect(d).toMatch(/unknown fenced block "foo"/);
    expect(d).toMatch(/visible characters/);
  });

  it("lets a `short` chapter be short", () => {
    write("book.json", manifest({}, [{ id: "c1", file: "chapters/01.md", title: "c1", short: true }]));
    write("chapters/01.md", "# c1\n\n短い章。\n");
    expect(checkBook(dir, "demo")).toEqual([]);
  });

  it("refuses a missing figure and a hex-painted figure", () => {
    write("book.json", manifest());
    write("figures/hex.svg", '<svg viewBox="0 0 1 1"><rect fill="#ff0000"/></svg>');
    write("chapters/01.md", "# c1\n\n" + filler(MIN_CHARS) + "![a](figures/missing.svg)\n\n![b](figures/hex.svg)\n");
    const d = checkBook(dir, "demo").join("\n");
    expect(d).toMatch(/figure missing: figures\/missing.svg/);
    expect(d).toMatch(/raw hex colour/);
  });

  it("refuses a generated quote appendix that drifted from quotes.md", () => {
    write("book.json", manifest({}, [
      { id: "c1", file: "chapters/01.md", title: "c1" },
      { id: "q", file: "chapters/99.md", title: "付録", generated: "quotes", short: true },
    ]));
    write("chapters/01.md", "# c1\n\n" + filler(MIN_CHARS));
    write("chapters/99.md", "# 付録\n\nstale\n");
    expect(checkBook(dir, "demo").join("\n")).toMatch(/out of sync with quotes.md/);
  });
});
