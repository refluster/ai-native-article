// Canonical flat tag vocabulary — the single source of truth for the article
// taxonomy. Replaces the retired A–E lettered hierarchy (governed by
// docs/adr/adr-0003-flat-tag-taxonomy.md).
//
// Why one module: the A–E names were duplicated across five files
// (workforce/skills/article-level{2,3}/publish-notion.mjs,
// article-level3/pick-l2-sources.mjs, newsletter/pipeline/normalize-categories.mjs,
// newsletter/pipeline/fetchers/notion.mjs). This is the DRY replacement —
// importable by the newsletter pipeline AND the workforce write-scripts (the
// latter already import sibling helpers from scripts/lib/, e.g. truncation.mjs).
//
// Model: tags are FLAT (no hierarchy), English-labelled (reader-facing on the
// web, matching the site's uppercase Swiss microlabel style), and
// many-to-many — one article carries ~3–5 tags, one tag spans many articles.
// Reader-facing labels are the tag strings verbatim (no prefix, no code letter).

/**
 * The controlled vocabulary. Order is the canonical display order for any
 * fixed list (e.g. a capture-form dropdown); the reader sidebar still ranks by
 * article count. Editing this list is a Zone A editorial decision — amend
 * adr-0003 in the same PR. (JP gloss in comments for editorial reference only.)
 */
export const TAGS = [
  'AI Productivity',     // AI生産性 — hyper-automation / 業務効率
  'Agentic AI',          // エージェントAI — autonomous agents
  'Verification & Trust',// 検証と信頼 — verification / quality / trust
  'Engineering Process', // 開発プロセス — SDLC / methodology
  'Developer Tools',     // 開発者ツール — coding assistants / toolchain
  'Role Blurring',       // 役割の融合
  'Emerging Roles',      // 新しい職種 — FDE & new roles
  'Skills & Learning',   // スキルと学習 — reskilling / education
  'Org Transformation',  // 組織変革 — org design & culture
  'Labor Market',        // 雇用と労働市場 — layoffs / hiring
  'Big Tech',            // 大手テック動向 — Big Tech strategy / AI pivot
  'AI Infrastructure',   // AIインフラ — semiconductors / data centres / compute
  'Manufacturing AI',    // 製造業のAI — industrial application
  'AI Strategy',         // AI戦略 — corporate strategy / governance
]

export const TAG_SET = new Set(TAGS)

/** Max tags per article (the many-to-many target is ~3–5). */
export const MAX_TAGS_PER_ARTICLE = 5

/** True iff `t` is exactly a vocabulary tag (after trim). */
export function isValidTag(t) {
  return TAG_SET.has(String(t ?? '').trim())
}

/**
 * Clean a candidate tag list: trim, drop blanks/invalids, de-dupe (first wins),
 * cap at MAX_TAGS_PER_ARTICLE. Returns only vocabulary tags — never invents.
 */
export function validateTags(list) {
  const out = []
  for (const raw of Array.isArray(list) ? list : []) {
    const t = String(raw ?? '').trim()
    if (!t || !TAG_SET.has(t) || out.includes(t)) continue
    out.push(t)
    if (out.length >= MAX_TAGS_PER_ARTICLE) break
  }
  return out
}

// ── Keyword classifier (backfill / fallback only) ──────────────────────────
// Deterministic best-effort mapping from free text → vocabulary tags, for
// re-tagging the existing corpus. NOT the steady-state path: new articles get
// their tags chosen by the generating agent against TAGS. Patterns are
// case-insensitive and matched against title+abstract(+body). A document may
// match several tags (that's the point — many-to-many).
const TAG_PATTERNS = [
  ['AI Productivity', /hyper.?productivity|productivity|生産性|業務効率|効率化|automation|自動化|ハイパーオートメーション/i],
  ['Agentic AI', /\bagentic\b|\bagent\b|エージェント|autonomous|自律/i],
  ['Verification & Trust', /verif|検証|\btrust\b|信頼|品質|quality|\beval\b|評価|hallucinat|幻覚|reliab/i],
  ['Engineering Process', /\bsdlc\b|開発プロセス|開発手法|methodology|ci\/cd|アジャイル|デプロイ|software development/i],
  ['Developer Tools', /copilot|coding assistant|\bide\b|ツールチェーン|コーディング|framework|フレームワーク|ライブラリ|developer tool/i],
  ['Role Blurring', /role blurring|役割の融合|境界の融解|職域|blur|役割が|職務の/i],
  ['Emerging Roles', /\bfde\b|forward.?deployed|new role|新しい職種|新職種|キャリアパス/i],
  ['Skills & Learning', /\bskill\b|スキル|学習|教育|education|learning|reskill|リスキリング|研修|育成/i],
  ['Org Transformation', /組織変革|組織設計|組織文化|organizational|org transformation|culture|文化変革/i],
  ['Labor Market', /layoff|レイオフ|雇用|労働市場|labor market|labour market|採用|hiring|解雇|future of work|働き方/i],
  ['Big Tech', /big tech|ビッグテック|大手テック|google|microsoft|\bmeta\b|amazon|\bapple\b|openai|anthropic|nvidia|tesla|\bxai\b|ai pivot/i],
  ['AI Infrastructure', /infrastructure|インフラ|半導体|semiconductor|data ?cent(er|re)|データセンター|\bgpu\b|compute|計算基盤|\bchip\b/i],
  ['Manufacturing AI', /manufactur|製造|industrial|産業|工場|\brobot|ロボット/i],
  ['AI Strategy', /\bstrategy\b|戦略|経営|governance|ガバナンス|投資|investment|roadmap|事業戦略/i],
]

/**
 * Best-effort vocabulary tags for a piece of text, ranked by match strength.
 * Returns up to MAX_TAGS_PER_ARTICLE tags; may return [] (caller decides the
 * fallback — e.g. leave untagged rather than guess).
 */
export function classifyTags(text) {
  const s = String(text ?? '')
  if (!s.trim()) return []
  const scored = []
  for (const [tag, re] of TAG_PATTERNS) {
    const matches = s.match(new RegExp(re, re.flags.includes('g') ? re.flags : re.flags + 'g'))
    if (matches && matches.length) scored.push([tag, matches.length])
  }
  return scored
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_TAGS_PER_ARTICLE)
    .map(([tag]) => tag)
}
