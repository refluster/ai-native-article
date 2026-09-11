// author-coverage.mjs — the pure counting logic behind
// check-corpus-author-coverage.mjs (#672 item 3).
//
// Kept separate from the CLI wrapper so the counting rule itself is
// unit-testable without touching the filesystem, the same split
// scripts/lib/truncation.mjs uses for check-corpus-truncation.mjs (R-10).
//
// A manifest row counts as "no author" when `author` is missing, null, or an
// empty/whitespace-only string — never when it merely differs from an
// expected value. This module does not know or care WHICH persona wrote an
// article; it only counts whether the byline field is populated at all.

/**
 * @param {Array<{ slug?: string; author?: string | null }>} rows
 * @returns {{ total: number; missing: number; missingSlugs: string[] }}
 */
export function countMissingAuthor(rows) {
  const list = Array.isArray(rows) ? rows : []
  const missingSlugs = []
  for (const row of list) {
    const author = typeof row?.author === 'string' ? row.author.trim() : ''
    if (!author) missingSlugs.push(row?.slug ?? '(no slug)')
  }
  return { total: list.length, missing: missingSlugs.length, missingSlugs }
}
