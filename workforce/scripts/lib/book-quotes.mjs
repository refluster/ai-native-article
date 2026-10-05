// book-quotes.mjs — parse a book's quote register (quotes.md) and render the
// 名言集 appendix from it. Shared by check-book.mjs (the gate) and
// build-book-quotes-appendix.mjs (the generator) so the two cannot drift.
//
// Register format (one entry per `### Q-xx-yy` heading):
//
//   ### Q-03-02
//   - 篇: 03 謀攻
//   - 原文: 百戰百勝、非善之善者也。…
//   - 訓読: 百戦百勝は善の善なる者に非ず。…
//   - よみ: 殆（あや）うからず
//   - 現代語訳: …
//   - 含意: …
//   - 誤解注意: …
//
// Keys other than the ones above are kept verbatim; `原文` is the only one the
// gate matches on, so it must be written exactly as the writers will quote it.

const ENTRY_RE = /^###\s+(Q-\d{2}-\d{2})\s*$/;

export function parseQuoteRegister(markdown) {
  const entries = [];
  let cur = null;
  for (const raw of markdown.split("\n")) {
    const h = raw.match(ENTRY_RE);
    if (h) {
      cur = { id: h[1] };
      entries.push(cur);
      continue;
    }
    if (!cur) continue;
    const m = raw.match(/^-\s*([^:：]+)[:：]\s*(.*)$/);
    if (m) cur[m[1].trim()] = m[2].trim();
  }
  const bad = entries.filter((e) => !e.原文 || !e.訓読 || !e.篇);
  if (bad.length) {
    throw new Error(`quotes.md: ${bad.length} entr(y/ies) lack 原文/訓読/篇: ${bad.map((b) => b.id).join(", ")}`);
  }
  const seen = new Set();
  for (const e of entries) {
    if (seen.has(e.id)) throw new Error(`quotes.md: duplicate id ${e.id}`);
    seen.add(e.id);
  }
  return entries;
}

/** `03 謀攻篇` → `謀攻篇`, `03 謀攻` → `謀攻篇`: the 出典 chip a quote card
 *  carries when the register entry has no explicit 出典. */
export function chapterName(label) {
  const bare = label.replace(/^\d+\s*/, "");
  return bare.endsWith("篇") ? bare : `${bare}篇`;
}

/** The appendix chapter: every register entry as a quote card, grouped by 篇,
 *  deterministic so check-book can compare byte-for-byte. */
export function renderQuotesAppendix(entries, title = "付録 名言集 — 十三篇の原文と訓読") {
  const byChapter = new Map();
  for (const e of entries) {
    const key = e.篇;
    if (!byChapter.has(key)) byChapter.set(key, []);
    byChapter.get(key).push(e);
  }
  const lines = [`# ${title}`, ""];
  lines.push(
    "本文で引いた原文を、篇の順にまとめました。原文は通行本（武経七書系）の本文、訓読は慣用の読みに従った本書の書き下しです。各カードの「出典」から篇を確かめ、本文の該当章に戻って読み返せます。",
    "",
  );
  for (const [chapter, list] of byChapter) {
    lines.push(`## ${chapter}`, "");
    for (const e of list) {
      lines.push("```quote");
      lines.push(`原文: ${e.原文}`);
      lines.push(`訓読: ${e.訓読}`);
      lines.push(`出典: ${e.出典 ?? chapterName(chapter)}`);
      if (e.現代語訳) lines.push(`訳: ${e.現代語訳}`);
      lines.push("```", "");
      if (e.誤解注意) {
        lines.push("```note", e.誤解注意, "```", "");
      }
    }
  }
  return lines.join("\n");
}
