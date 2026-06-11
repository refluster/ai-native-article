// Shared truncation heuristic — the canonical JS copy.
//
// This predicate is mirrored in three places that must agree:
//   1. newsletter/gas/src/Code.gs#isTruncatedMarkdown  (GAS / runtime, R-5)
//   2. this module                                      (CI + skills, R-10)
//   3. .claude/skills/article-health/scripts/article-health.mjs (imports this)
//
// Node consumers that import this module directly (no copy to keep in sync):
// article-health (above) and the workforce publish guards
// workforce/skills/article-level{2,3}/publish-notion.mjs (W-1, the
// generation-time check while the GAS cron is paused).
//
// (1) lives in Apps Script and cannot import this file, so it stays a hand-kept
// copy; (2) is the single source for every Node consumer. When the heuristic
// changes, update Code.gs and this file together and cite the incident in
// docs/memory-lint-backlog.md.
//
// A body is "truncated" when its last non-empty line looks like a cut-off
// generation: a dangling heading, or a prose line that does not end on a
// sentence-terminating glyph (Japanese 。！？」） or ASCII .!?)]> / closing code).
// List items, blockquotes, rules and fences are structural, not prose, so they
// are never treated as truncation. Trailing emphasis closers (* / _) are
// unwrapped before the glyph test: an italic byline like `*…ください。*` is a
// complete ending, not a truncation (incident e7fc028993e1, 2026-06-10 —
// ML-006).

export function isTruncatedMarkdown (mdBody) {
  if (!mdBody) return false
  const lines = mdBody.split('\n').map(l => l.replace(/\s+$/, ''))
  let i = lines.length - 1
  while (i >= 0 && lines[i].trim() === '') i--
  if (i < 0) return false
  const trimmed = lines[i].trim()
  if (/^#{1,6}\s+/.test(trimmed)) return true
  if (/^([-*]\s|\d+\.\s|>\s|---|```)/.test(trimmed)) return false
  const unwrapped = trimmed.replace(/[*_]+$/, '')
  if (unwrapped === '') return true
  return !/[。！？」）…\.!\?\)\]`>]$/.test(unwrapped)
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
