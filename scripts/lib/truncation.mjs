// Shared truncation heuristic — the single canonical copy.
//
// Every consumer imports this module directly; there are no hand-kept copies
// to keep in sync (the GAS Code.gs#isTruncatedMarkdown copy was removed when
// the GAS L1→L4 pipeline was retired). All nine consumers — a change here
// reaches every one of them, which is the blast radius to size before editing:
//   - scripts/check-corpus-truncation.mjs                      (R-10, deploy gate)
//   - .claude/skills/article-health/scripts/article-health.mjs (live-site sweep)
//   - workforce/skills/article-level2/publish-notion.mjs       (W-1, generation)
//   - workforce/skills/article-level3/publish-notion.mjs       (W-1, generation)
//   - workforce/skills/podcast-script/publish-notion.mjs       (W-1)
//   - workforce/skills/hypothesis/publish-notion.mjs           (W-1)
//   - workforce/skills/weekly-project-report/publish-report.mjs (W-1)
//   - workforce/skills/monthly-report/post.mjs                 (W-1)
//   - newsletter/pipeline/backfill-en.mjs                      (W-1, ja→en backfill)
//
// When the heuristic changes, cite the incident in docs/memory-lint-backlog.md.
//
// A body is "truncated" when its last non-empty line looks like a cut-off
// generation: a dangling heading, or a prose line that does not end on a
// sentence-terminating glyph (Japanese 。！？」） or ASCII .!?)]> / closing code).
// List items, blockquotes, rules and fences are structural, not prose, so they
// are never treated as truncation.
//
// Trailing *closers* are unwrapped before the glyph test, so the test sees the
// punctuation that actually ends the sentence:
//
//   - emphasis (* / _) — an italic byline like `*…ください。*` is a complete
//     ending, not a truncation (incident e7fc028993e1, 2026-06-10 — ML-006).
//   - closing quotation marks (" ' ” ’ » ) — English puts the full stop INSIDE
//     the quote, so a paragraph that ends on a quotation ends with `."`, and a
//     glyph set carrying `」` but not `"` flags every one of them. That is
//     ML-020: it made the ja→en backfill reject complete translations of any
//     article whose closing paragraph ends on a 「…」 quote.
//
// Unwrapping (rather than adding `"` to the terminator set) is what keeps this
// strict: a line ending on an *opening* quote — `and then he said "` — unwraps
// to a letter and is still correctly flagged.
//
// That leaves English STRICTER than Japanese, deliberately. `」` and `）` sit in
// the terminator set below, so `…と述べた」` is accepted with no `。` under it,
// while `…he said"` is still flagged. The asymmetry is not an oversight: the
// Japanese bracket family closes a sentence on its own, and English is the
// language whose guard just produced nine false positives, so it keeps the
// stricter treatment.
//
// The Japanese bracket family is `」』】》〉`, and only `」` was ever listed —
// so `…彼は『これは構造的だ』` and `…詳細は【注】`, both idiomatic complete
// Japanese, were flagged exactly as the English quotations were. That is the
// other half of ML-020's own rule ("cover the punctuation conventions of every
// language the corpus publishes in"), and it belongs in the TERMINATOR set with
// `」`, not in the closers: unwrapping `』` off `…構造的だ』` leaves `だ`, a
// letter, so a closer-set fix would not have fixed it.

const TRAILING_CLOSERS = /[*_"'”’»]+$/

export function isTruncatedMarkdown (mdBody) {
  if (!mdBody) return false
  const lines = mdBody.split('\n').map(l => l.replace(/\s+$/, ''))
  let i = lines.length - 1
  while (i >= 0 && lines[i].trim() === '') i--
  if (i < 0) return false
  const trimmed = lines[i].trim()
  if (/^#{1,6}\s+/.test(trimmed)) return true
  if (/^([-*]\s|\d+\.\s|>\s|---|```)/.test(trimmed)) return false
  const unwrapped = trimmed.replace(TRAILING_CLOSERS, '')
  if (unwrapped === '') return true
  return !/[。！？」』】》〉）…\.!\?\)\]`>]$/.test(unwrapped)
}

// Strip a leading YAML frontmatter block, if present.
export function stripFrontmatter (md) {
  const m = md.match(/^---\n[\s\S]*?\n---\n?/)
  return m ? md.slice(m[0].length) : md
}

// First ≤60-char preview of the last non-empty line — for human-readable
// findings tables.
export function lastNonEmptyLine (md) {
  const lines = md.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = lines[i].trim()
    if (t) return t.length > 60 ? t.slice(0, 57) + '...' : t
  }
  return ''
}
