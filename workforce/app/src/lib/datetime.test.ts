import { describe, expect, it } from 'vitest';
import { fmtUtc } from './datetime';

describe('fmtUtc', () => {
  it('formats a valid ISO timestamp to minute precision by default', () => {
    expect(fmtUtc('2026-11-10T09:05:33.123Z')).toBe('2026-11-10T09:05');
  });

  it('honours the slice length', () => {
    expect(fmtUtc('2026-11-10T09:05:33.123Z', 10)).toBe('2026-11-10');
  });

  it('normalises an offset timestamp to UTC', () => {
    expect(fmtUtc('2026-11-10T18:05:00+09:00')).toBe('2026-11-10T09:05');
  });

  it('accepts epoch milliseconds', () => {
    expect(fmtUtc(Date.UTC(2026, 10, 10, 9, 5))).toBe('2026-11-10T09:05');
  });

  // Regression: last_run_at "x" crashed /agents with RangeError (2026-11-10).
  it.each(['x', 'not a date', '', null, undefined, Number.NaN])(
    'returns the fallback instead of throwing for %p',
    (v) => {
      expect(() => fmtUtc(v as string)).not.toThrow();
      expect(fmtUtc(v as string)).toBe('—');
      expect(fmtUtc(v as string, 16, 'n/a')).toBe('n/a');
    },
  );
});
