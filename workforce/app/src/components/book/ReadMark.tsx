// A chapter's read state as a 10px glyph: an empty ring (unread), a
// half-filled ring (partial) or a filled disc (done). Painted in
// currentColor so it follows whichever surface it sits on — the cover's
// wf-* tokens or the reader's theme variables. The state is spoken, not
// just drawn.

import { readState } from '../../lib/bookPosition';

const LABEL = { unread: '未読', partial: '読書中', done: '読了' } as const;

export default function ReadMark({ ratio, className = '' }: { ratio: number | undefined; className?: string }) {
  const state = readState(ratio);
  const pct = state === 'partial' ? ` ${Math.round((ratio ?? 0) * 100)}%` : '';
  return (
    <span className={`book-mark is-${state} ${className}`} data-state={state}>
      <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden focusable="false">
        <circle cx="5" cy="5" r="4.25" fill={state === 'done' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" />
        {state === 'partial' && <path d="M5 0.75 A4.25 4.25 0 0 1 5 9.25 Z" fill="currentColor" />}
      </svg>
      <span className="sr-only">{`${LABEL[state]}${pct}`}</span>
    </span>
  );
}
