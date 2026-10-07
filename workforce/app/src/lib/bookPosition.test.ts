// lib/bookPosition — the reader's per-device memory. A fake localStorage
// for the round-trips; a throwing / absent one for private browsing, where
// the reader must keep working on defaults.

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  DEFAULT_BOOK_SETTINGS,
  markProgress,
  readPosition,
  readProgress,
  readSettings,
  readState,
  writePosition,
  writeSettings,
} from './bookPosition';

function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: k => (m.has(k) ? m.get(k)! : null),
    key: i => [...m.keys()][i] ?? null,
    removeItem: k => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

function throwingStorage(): Storage {
  const boom = () => {
    throw new Error('SecurityError: storage disabled');
  };
  return { length: 0, clear: boom, getItem: boom, key: boom, removeItem: boom, setItem: boom };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('position', () => {
  it('round-trips under kohuehara.book.<slug>', () => {
    const s = fakeStorage();
    vi.stubGlobal('localStorage', s);
    writePosition('sunzi', { chapterId: '01-ji', anchor: 'h-3', ratio: 0.42, at: 1000 });
    expect(readPosition('sunzi')).toEqual({ chapterId: '01-ji', anchor: 'h-3', ratio: 0.42, at: 1000 });
    expect(JSON.parse(s.getItem('kohuehara.book.sunzi')!)).toMatchObject({ chapterId: '01-ji' });
    expect(readPosition('other')).toBeNull();
  });

  it('clamps the ratio and ignores a malformed record', () => {
    const s = fakeStorage();
    vi.stubGlobal('localStorage', s);
    writePosition('sunzi', { chapterId: 'x', anchor: null, ratio: 7, at: 1 });
    expect(readPosition('sunzi')?.ratio).toBe(1);
    s.setItem('kohuehara.book.sunzi', '{"ratio":0.5}');
    expect(readPosition('sunzi')).toBeNull();
    s.setItem('kohuehara.book.sunzi', 'not json');
    expect(readPosition('sunzi')).toBeNull();
  });
});

describe('progress', () => {
  it('keeps the maximum ratio per chapter', () => {
    const s = fakeStorage();
    vi.stubGlobal('localStorage', s);
    markProgress('sunzi', 'a', 0.6);
    markProgress('sunzi', 'a', 0.2); // scrolling back up does not un-read
    markProgress('sunzi', 'b', 1);
    expect(readProgress('sunzi')).toEqual({ a: 0.6, b: 1 });
    expect(markProgress('sunzi', 'a', 0.9)).toEqual({ a: 0.9, b: 1 });
    expect(JSON.parse(s.getItem('kohuehara.book.sunzi.read')!)).toEqual({ a: 0.9, b: 1 });
  });

  it('classifies a ratio as unread / partial / done', () => {
    expect(readState(undefined)).toBe('unread');
    expect(readState(0)).toBe('unread');
    expect(readState(0.3)).toBe('partial');
    expect(readState(0.99)).toBe('done');
    expect(readState(1)).toBe('done');
  });
});

describe('settings', () => {
  it('defaults to M / paper / serif and round-trips', () => {
    vi.stubGlobal('localStorage', fakeStorage());
    expect(readSettings()).toEqual({ size: 'm', theme: 'paper', family: 'serif' });
    writeSettings({ size: 'l', theme: 'night', family: 'sans' });
    expect(readSettings()).toEqual({ size: 'l', theme: 'night', family: 'sans' });
  });

  it('falls back field by field on a bad stored value', () => {
    const s = fakeStorage();
    vi.stubGlobal('localStorage', s);
    s.setItem('kohuehara.book.settings', JSON.stringify({ size: 'xl', theme: 'sepia', family: 42 }));
    expect(readSettings()).toEqual({ size: 'm', theme: 'sepia', family: 'serif' });
  });
});

describe('when storage is unavailable (private mode)', () => {
  it.each([
    ['throws on every call', throwingStorage()],
    ['is absent', undefined],
  ])('reads defaults and writes are no-ops when storage %s', (_label, storage) => {
    vi.stubGlobal('localStorage', storage);
    expect(() => writePosition('sunzi', { chapterId: 'a', anchor: null, ratio: 0.5, at: 1 })).not.toThrow();
    expect(() => writeSettings({ size: 's', theme: 'night', family: 'sans' })).not.toThrow();
    expect(readPosition('sunzi')).toBeNull();
    expect(readProgress('sunzi')).toEqual({});
    expect(markProgress('sunzi', 'a', 0.5)).toEqual({ a: 0.5 });
    expect(readSettings()).toEqual(DEFAULT_BOOK_SETTINGS);
  });
});
