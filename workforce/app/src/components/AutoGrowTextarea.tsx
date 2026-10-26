// AutoGrowTextarea — the Messaging composer field, LinkedIn-style: it opens
// one line tall and grows with its content (hard newlines and soft wraps
// alike) until a row cap, after which it stops growing and scrolls. The cap
// is 10 rows on md+ (laptop) and 5 rows below md (mobile), so the keyboard
// and the thread above stay usable on a phone.

import { forwardRef, useCallback, useEffect, useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react';

export const MAX_ROWS_DESKTOP = 10;
export const MAX_ROWS_MOBILE = 5;
// Tailwind `md` — the same breakpoint Messaging uses to split list / thread.
const DESKTOP_QUERY = '(min-width: 768px)';

export interface TextareaMetrics {
  /** el.scrollHeight measured with height reset to auto (content + padding). */
  scrollHeight: number;
  lineHeight: number;
  paddingY: number;
  borderY: number;
}

/**
 * Border-box height for the textarea and whether it must scroll. The field
 * is never shorter than one row and never taller than `maxRows` rows.
 */
export function autoGrowHeight(m: TextareaMetrics, maxRows: number): { height: number; overflow: boolean } {
  const minHeight = m.lineHeight + m.paddingY + m.borderY;
  const maxHeight = m.lineHeight * maxRows + m.paddingY + m.borderY;
  const content = m.scrollHeight + m.borderY;
  return {
    height: Math.min(Math.max(content, minHeight), maxHeight),
    overflow: content > maxHeight + 1, // 1px slack for sub-pixel rounding
  };
}

function isDesktop(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(DESKTOP_QUERY).matches;
}

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'rows'>;

const AutoGrowTextarea = forwardRef<HTMLTextAreaElement, Props>(function AutoGrowTextarea(
  { value, className = '', ...rest },
  forwardedRef,
) {
  const innerRef = useRef<HTMLTextAreaElement | null>(null);

  const setRefs = useCallback(
    (el: HTMLTextAreaElement | null) => {
      innerRef.current = el;
      if (typeof forwardedRef === 'function') forwardedRef(el);
      else if (forwardedRef) forwardedRef.current = el;
    },
    [forwardedRef],
  );

  const resize = useCallback(() => {
    const el = innerRef.current;
    if (!el) return;
    const cs = window.getComputedStyle(el);
    const fontSize = parseFloat(cs.fontSize) || 14;
    const lineHeight = parseFloat(cs.lineHeight) || fontSize * 1.4286;
    el.style.height = 'auto';
    const { height, overflow } = autoGrowHeight(
      {
        scrollHeight: el.scrollHeight,
        lineHeight,
        paddingY: (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0),
        borderY: (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0),
      },
      isDesktop() ? MAX_ROWS_DESKTOP : MAX_ROWS_MOBILE,
    );
    el.style.height = `${height}px`;
    el.style.overflowY = overflow ? 'auto' : 'hidden';
  }, []);

  // Re-measure on every content change, before paint, so the field never
  // flashes at the wrong height.
  useLayoutEffect(resize, [value, resize]);

  // Width changes re-wrap the text; crossing md changes the row cap.
  useEffect(() => {
    const el = innerRef.current;
    window.addEventListener('resize', resize);
    // Only width matters here — resize() itself changes the height.
    let lastWidth = el?.clientWidth ?? 0;
    const ro =
      typeof ResizeObserver === 'function' && el
        ? new ResizeObserver(() => {
            if (el.clientWidth === lastWidth) return;
            lastWidth = el.clientWidth;
            resize();
          })
        : null;
    if (ro && el) ro.observe(el);
    return () => {
      window.removeEventListener('resize', resize);
      ro?.disconnect();
    };
  }, [resize]);

  return (
    <textarea
      {...rest}
      ref={setRefs}
      value={value}
      rows={1}
      className={`resize-none overflow-y-hidden ${className}`}
    />
  );
});

export default AutoGrowTextarea;
