import { describe, expect, it } from 'vitest';
import { autoGrowHeight, MAX_ROWS_DESKTOP, MAX_ROWS_MOBILE } from './AutoGrowTextarea';

// text-sm (20px line) + py-2 (16px) + 1px border top/bottom.
const base = { lineHeight: 20, paddingY: 16, borderY: 2 };
const rows = (n: number) => base.lineHeight * n + base.paddingY; // scrollHeight for n lines

describe('autoGrowHeight', () => {
  it('opens at one row for an empty draft', () => {
    expect(autoGrowHeight({ ...base, scrollHeight: rows(1) }, MAX_ROWS_DESKTOP)).toEqual({ height: 38, overflow: false });
  });

  it('never shrinks below one row', () => {
    expect(autoGrowHeight({ ...base, scrollHeight: 0 }, MAX_ROWS_DESKTOP).height).toBe(38);
  });

  it('grows one row per line until the cap', () => {
    expect(autoGrowHeight({ ...base, scrollHeight: rows(4) }, MAX_ROWS_DESKTOP)).toEqual({ height: 98, overflow: false });
    expect(autoGrowHeight({ ...base, scrollHeight: rows(10) }, MAX_ROWS_DESKTOP)).toEqual({ height: 218, overflow: false });
  });

  it('caps at 10 rows on desktop and scrolls beyond', () => {
    expect(autoGrowHeight({ ...base, scrollHeight: rows(14) }, MAX_ROWS_DESKTOP)).toEqual({ height: 218, overflow: true });
  });

  it('caps at 5 rows on mobile and scrolls beyond', () => {
    expect(autoGrowHeight({ ...base, scrollHeight: rows(5) }, MAX_ROWS_MOBILE)).toEqual({ height: 118, overflow: false });
    expect(autoGrowHeight({ ...base, scrollHeight: rows(6) }, MAX_ROWS_MOBILE)).toEqual({ height: 118, overflow: true });
  });
});
