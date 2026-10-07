// Discovered by workforce/lambdas/vitest.config.mjs (`../scripts/**/*-tests.ts`).
//
// The quote register is the one place a classical quotation lives; the gate
// (check-book.mjs) matches chapter quotes against it byte-for-byte and the
// appendix is rendered from it. Both halves are pinned here.
import { describe, it, expect } from "vitest";
import { parseQuoteRegister, renderQuotesAppendix } from "./book-quotes.mjs";

const REGISTER = `# quotes

### Q-01-01
- 篇: 01 始計
- 原文: 兵者、國之大事。
- 訓読: 兵は国の大事なり。
- 現代語訳: 戦争は国家の重大事である。
- 含意: 軽々しく始めない。

### Q-03-01
- 篇: 03 謀攻
- 原文: 百戰百勝、非善之善者也。
- 訓読: 百戦百勝は善の善なる者に非ず。
- 出典: 謀攻篇
- 誤解注意: 「百戦百勝」を称賛と読む誤解が多い。
`;

describe("parseQuoteRegister", () => {
  it("reads one entry per ### Q-xx-yy heading with its key/value bullets", () => {
    const entries = parseQuoteRegister(REGISTER);
    expect(entries.map((e) => e.id)).toEqual(["Q-01-01", "Q-03-01"]);
    expect(entries[0].原文).toBe("兵者、國之大事。");
    expect(entries[1].誤解注意).toContain("百戦百勝");
  });

  it("accepts a full-width colon after the key", () => {
    const entries = parseQuoteRegister("### Q-01-01\n- 篇：01 始計\n- 原文：兵者、國之大事。\n- 訓読：兵は国の大事なり。\n");
    expect(entries[0].原文).toBe("兵者、國之大事。");
  });

  it("refuses an entry missing 原文 / 訓読 / 篇 (C-4)", () => {
    expect(() => parseQuoteRegister("### Q-01-01\n- 原文: x\n")).toThrow(/lack 原文\/訓読\/篇/);
  });

  it("refuses a duplicate id", () => {
    expect(() => parseQuoteRegister(REGISTER + "\n" + REGISTER.slice(REGISTER.indexOf("### Q-03-01")))).toThrow(/duplicate id/);
  });
});

describe("renderQuotesAppendix", () => {
  it("renders one quote card per entry, grouped by 篇, deterministically", () => {
    const entries = parseQuoteRegister(REGISTER);
    const md = renderQuotesAppendix(entries, "付録 名言集");
    expect(md.startsWith("# 付録 名言集\n")).toBe(true);
    expect(md).toContain("## 01 始計");
    expect(md).toContain("## 03 謀攻");
    expect(md.match(/```quote/g)?.length).toBe(2);
    // 出典 falls back to the 篇 name when the register has none.
    expect(md).toContain("出典: 始計篇");
    expect(md).toContain("出典: 謀攻篇");
    // 誤解注意 becomes a note under its card.
    expect(md).toContain("```note\n「百戦百勝」");
    expect(renderQuotesAppendix(entries, "付録 名言集")).toBe(md);
  });
});
