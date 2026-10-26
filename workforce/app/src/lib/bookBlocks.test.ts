// lib/bookBlocks — the fenced-block parsers. Malformed input must come
// back as an error (rendered as a visible card), never as a partial block.

import { describe, it, expect } from 'vitest';
import { parseConnectBlock, parseNoteBlock, parseQuoteBlock } from './bookBlocks';

const QUOTE = [
  '原文: 百戰百勝、非善之善者也。',
  '訓読: 百戦百勝は善の善なる者に非ず。',
  '出典: 謀攻篇',
  '訳: 百回戦って百回勝つのは、最善ではない。',
].join('\n');

describe('parseQuoteBlock', () => {
  it('reads the four keys', () => {
    expect(parseQuoteBlock(QUOTE)).toEqual({
      ok: true,
      value: {
        original: '百戰百勝、非善之善者也。',
        kundoku: '百戦百勝は善の善なる者に非ず。',
        source: '謀攻篇',
        translation: '百回戦って百回勝つのは、最善ではない。',
      },
    });
  });

  it('treats 訳 as optional and tolerates blank lines and a full-width colon', () => {
    const r = parseQuoteBlock('\n原文：兵者\n\n訓読: 兵は\n出典: 始計篇\n');
    expect(r).toEqual({ ok: true, value: { original: '兵者', kundoku: '兵は', source: '始計篇' } });
  });

  it('keeps a colon inside a value', () => {
    const r = parseQuoteBlock('原文: 甲\n訓読: 乙\n出典: 始計篇\n訳: 結論: 数えよ');
    expect(r.ok && r.value.translation).toBe('結論: 数えよ');
  });

  it.each([
    ['a missing 出典', '原文: 甲\n訓読: 乙', /missing 出典/],
    ['missing 原文 and 訓読', '出典: 始計篇', /missing 原文, 訓読/],
    ['an unknown key', `${QUOTE}\n注: x`, /unknown key "注"/],
    ['a duplicate key', `${QUOTE}\n出典: 作戦篇`, /duplicate key "出典"/],
    ['a line without a key', '原文: 甲\nつづき\n訓読: 乙\n出典: 丙', /line 2/],
    ['an empty value', '原文:\n訓読: 乙\n出典: 丙', /"原文" is empty/],
    ['an empty block', '', /missing/],
  ])('rejects %s', (_label, text, why) => {
    const r = parseQuoteBlock(text);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(why);
  });
});

describe('parseConnectBlock', () => {
  it('reads the title line and keeps the body as Markdown', () => {
    expect(parseConnectBlock('title: 航空機設計の「安全余裕」\n本文の**強調**\n\n- 一\n- 二\n')).toEqual({
      ok: true,
      value: { title: '航空機設計の「安全余裕」', body: '本文の**強調**\n\n- 一\n- 二' },
    });
  });

  it('skips leading blank lines', () => {
    expect(parseConnectBlock('\n\ntitle: 題\n本文')).toMatchObject({ ok: true, value: { title: '題' } });
  });

  it.each([
    ['no title line', '本文だけ', /title:/],
    ['an empty title', 'title:   \n本文', /title:/],
    ['no body', 'title: 題\n\n', /no body/],
    ['an empty block', '  \n', /empty/],
  ])('rejects %s', (_label, text, why) => {
    const r = parseConnectBlock(text);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(why);
  });
});

describe('parseNoteBlock', () => {
  it('trims the body and rejects an empty one', () => {
    expect(parseNoteBlock('\n注の本文\n')).toEqual({ ok: true, value: '注の本文' });
    expect(parseNoteBlock('   ')).toMatchObject({ ok: false });
  });
});
