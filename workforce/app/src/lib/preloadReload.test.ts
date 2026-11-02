import { describe, expect, it, vi } from 'vitest';
import { reloadOnceOnPreloadError } from './preloadReload';

function memStore() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

describe('reloadOnceOnPreloadError', () => {
  // Catches: a stale-chunk failure after a deploy leaving the tab on an error card.
  it('reloads on the first preload error', () => {
    const reload = vi.fn();
    expect(reloadOnceOnPreloadError(memStore(), reload)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  // Catches: an infinite reload loop when the chunk is genuinely missing.
  it('does not reload a second time in the same tab session', () => {
    const reload = vi.fn();
    const s = memStore();
    reloadOnceOnPreloadError(s, reload);
    expect(reloadOnceOnPreloadError(s, reload)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  // Catches: reload loop when sessionStorage throws (private mode / blocked).
  it('does not reload when storage throws', () => {
    const reload = vi.fn();
    const bad = { getItem: () => { throw new Error('blocked'); }, setItem: () => {} };
    expect(reloadOnceOnPreloadError(bad, reload)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});
