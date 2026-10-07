// Parsers for the web books' fenced blocks (book-content-contract v1):
//
//   ```quote     原文: / 訓読: / 出典: / 訳:   one `key: value` per line
//   ```connect   `title: …` first, then a Markdown body
//   ```note      a Markdown body
//
// They return a result rather than throw: a malformed block renders as a
// visible error card in place (C-4 — never silently dropped) while the rest
// of the chapter keeps rendering, so one typo does not blank a chapter.

export interface QuoteBlock {
  /** 原文 — the classical Chinese text. */
  original: string;
  /** 訓読 — the Japanese reading (書き下し). */
  kundoku: string;
  /** 出典 — the source chapter. */
  source: string;
  /** 訳 — modern translation (optional). */
  translation?: string;
}

export interface ConnectBlock {
  title: string;
  /** Markdown: paragraphs, emphasis, lists. */
  body: string;
}

export type BlockResult<T> = { ok: true; value: T } | { ok: false; error: string };

const QUOTE_KEYS = { 原文: 'original', 訓読: 'kundoku', 出典: 'source', 訳: 'translation' } as const;
type QuoteKey = keyof typeof QUOTE_KEYS;

// Full-width colon accepted too: a Japanese IME types `：` as readily as `:`.
const KEY_LINE = /^\s*([^:：\s]+)\s*[:：]\s*(.*)$/;

export function parseQuoteBlock(text: string): BlockResult<QuoteBlock> {
  const found: Partial<Record<QuoteKey, string>> = {};
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const m = KEY_LINE.exec(line);
    if (!m) return { ok: false, error: `line ${i + 1} is not "key: value": ${line.trim()}` };
    const key = m[1] as QuoteKey;
    if (!(key in QUOTE_KEYS)) return { ok: false, error: `unknown key "${m[1]}" (expected 原文, 訓読, 出典, 訳)` };
    if (found[key] !== undefined) return { ok: false, error: `duplicate key "${key}"` };
    const value = m[2].trim();
    if (!value) return { ok: false, error: `"${key}" is empty` };
    found[key] = value;
  }
  const missing = (['原文', '訓読', '出典'] as const).filter(k => !found[k]);
  if (missing.length) return { ok: false, error: `missing ${missing.join(', ')}` };
  return {
    ok: true,
    value: {
      original: found.原文!,
      kundoku: found.訓読!,
      source: found.出典!,
      ...(found.訳 ? { translation: found.訳 } : {}),
    },
  };
}

export function parseConnectBlock(text: string): BlockResult<ConnectBlock> {
  const lines = text.split(/\r?\n/);
  const first = lines.findIndex(l => l.trim().length > 0);
  if (first < 0) return { ok: false, error: 'empty block' };
  const m = /^\s*title\s*[:：]\s*(.*)$/.exec(lines[first]);
  if (!m || !m[1].trim()) return { ok: false, error: 'first line must be "title: …"' };
  const body = lines.slice(first + 1).join('\n').trim();
  if (!body) return { ok: false, error: `"${m[1].trim()}" has no body` };
  return { ok: true, value: { title: m[1].trim(), body } };
}

export function parseNoteBlock(text: string): BlockResult<string> {
  const body = text.trim();
  return body ? { ok: true, value: body } : { ok: false, error: 'empty block' };
}
