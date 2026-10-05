// Per-device reading state for the web books: where the reader stopped,
// how far into each chapter they have read, and their reader settings.
//
// localStorage only — no server state (C-3: one operator, no reader
// accounts). Every access is wrapped: private browsing, a full quota or a
// disabled storage throws, and the reader must still work, just without
// memory. Reads validate the stored shape and fall back rather than trust
// whatever an older build (or a curious reader) left there.
//
// Keys (book-content-contract v1):
//   kohuehara.book.<slug>        last position   { chapterId, anchor, ratio, at }
//   kohuehara.book.<slug>.read   read ratio      { [chapterId]: maxRatio }
//   kohuehara.book.settings      reader settings { size, theme, family }

export interface BookPosition {
  chapterId: string;
  /** Id of the nearest heading above the viewport top (`h-<n>`), or null. */
  anchor: string | null;
  /** Scroll ratio within the chapter, 0..1. */
  ratio: number;
  /** When it was written (epoch ms). */
  at: number;
}

export type BookSize = 's' | 'm' | 'l';
export type BookTheme = 'paper' | 'sepia' | 'night';
export type BookFamily = 'serif' | 'sans';

export interface BookSettings {
  size: BookSize;
  theme: BookTheme;
  family: BookFamily;
}

export const DEFAULT_BOOK_SETTINGS: Readonly<BookSettings> = { size: 'm', theme: 'paper', family: 'serif' };

/** A ratio at or above this counts as finished (rounding at the very end
 *  of a page never quite reaches 1). */
export const DONE_RATIO = 0.98;

const SETTINGS_KEY = 'kohuehara.book.settings';
const positionKey = (slug: string) => `kohuehara.book.${slug}`;
const progressKey = (slug: string) => `kohuehara.book.${slug}.read`;

function storage(): Storage | null {
  try {
    const s = globalThis.localStorage;
    return s ?? null;
  } catch {
    return null;
  }
}

function readJson(key: string): unknown {
  try {
    const raw = storage()?.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    storage()?.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode / quota: the reader works without memory */
  }
}

function clampRatio(r: unknown): number {
  const n = typeof r === 'number' && Number.isFinite(r) ? r : 0;
  return Math.min(1, Math.max(0, n));
}

export function readPosition(slug: string): BookPosition | null {
  const v = readJson(positionKey(slug)) as Partial<BookPosition> | null;
  if (!v || typeof v !== 'object' || typeof v.chapterId !== 'string' || !v.chapterId) return null;
  return {
    chapterId: v.chapterId,
    anchor: typeof v.anchor === 'string' && v.anchor ? v.anchor : null,
    ratio: clampRatio(v.ratio),
    at: typeof v.at === 'number' && Number.isFinite(v.at) ? v.at : 0,
  };
}

export function writePosition(slug: string, pos: BookPosition): void {
  writeJson(positionKey(slug), { ...pos, ratio: clampRatio(pos.ratio) });
}

/** Per-chapter read ratio (the furthest the reader has got), 0..1. */
export function readProgress(slug: string): Record<string, number> {
  const v = readJson(progressKey(slug));
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: Record<string, number> = {};
  for (const [id, r] of Object.entries(v as Record<string, unknown>)) {
    if (typeof r === 'number' && Number.isFinite(r)) out[id] = clampRatio(r);
  }
  return out;
}

/** Record progress in a chapter, keeping the maximum: scrolling back up to
 *  re-read a passage must not un-finish a chapter. Returns the stored map. */
export function markProgress(slug: string, chapterId: string, ratio: number): Record<string, number> {
  const progress = readProgress(slug);
  const next = clampRatio(ratio);
  if ((progress[chapterId] ?? 0) >= next) return progress;
  progress[chapterId] = next;
  writeJson(progressKey(slug), progress);
  return progress;
}

/** 0 → unread, (0, DONE_RATIO) → partial, ≥ DONE_RATIO → done. */
export function readState(ratio: number | undefined): 'unread' | 'partial' | 'done' {
  if (!ratio || ratio <= 0) return 'unread';
  return ratio >= DONE_RATIO ? 'done' : 'partial';
}

const SIZES: readonly BookSize[] = ['s', 'm', 'l'];
const THEMES: readonly BookTheme[] = ['paper', 'sepia', 'night'];
const FAMILIES: readonly BookFamily[] = ['serif', 'sans'];

/** Stored settings, field by field: one bad field falls back alone. */
export function readSettings(): BookSettings {
  const v = (readJson(SETTINGS_KEY) ?? {}) as Partial<Record<keyof BookSettings, unknown>>;
  return {
    size: SIZES.includes(v.size as BookSize) ? (v.size as BookSize) : DEFAULT_BOOK_SETTINGS.size,
    theme: THEMES.includes(v.theme as BookTheme) ? (v.theme as BookTheme) : DEFAULT_BOOK_SETTINGS.theme,
    family: FAMILIES.includes(v.family as BookFamily) ? (v.family as BookFamily) : DEFAULT_BOOK_SETTINGS.family,
  };
}

export function writeSettings(settings: BookSettings): void {
  writeJson(SETTINGS_KEY, settings);
}
