/**
 * messages.ts — the reader-facing UI string catalog.
 *
 * Scope, on purpose: the **reader** surfaces (index, article, cards, source
 * sections, chrome). The operator surfaces — `/operator`, `/sources`,
 * `/capture`, `/design-*` — stay Japanese-only. They are tools for one
 * operator (C-3), not a reading destination (ADR-0002), and translating them
 * would double the maintenance for an audience of one.
 *
 * Adding a key: add it to `ja` and TypeScript will refuse to compile until
 * `en` has it too. That is the whole enforcement mechanism — there is no
 * runtime "missing translation" fallback, because a silently-untranslated
 * string is exactly the sort of thing that reaches production unnoticed.
 */

import type { Language } from './language'

const ja = {
  // — chrome —
  'nav.index': 'INDEX',
  'nav.operator': 'OPERATOR',
  'lang.switchTo': 'Switch to English',
  'lang.label': '表示言語',

  // — index —
  'home.latest': '最新',
  'home.articleCount': '件の記事',
  'home.search': '検索',
  'home.searchPlaceholder': 'タイトル・タグ',
  'home.searchAria': '記事を絞り込み',
  'home.clearTag': 'を解除',
  'home.empty': '該当する記事はありません',
  'home.mustReads': '必読',
  'home.tags': 'タグ',
  'home.showAllTags': 'すべて見る',
  'home.hideTags': '閉じる',
  'home.pagination': 'ページ送り',
  'home.prev': '前へ',
  'home.next': '次へ',

  // — article —
  'article.loading': '読み込み中…',
  'article.notFound': '記事が見つかりません',
  'article.backToIndex': '一覧に戻る',
  'article.index': '一覧',
  'article.backToAll': 'すべての記事に戻る',
  'article.spotifyAria': 'Spotifyでポッドキャストを聴く',
  'article.noTranslationTitle': '英語版はまだありません',
  'article.noTranslationBody': 'この記事は日本語版のみ公開されています。日本語で表示しています。',

  // — source sections —
  'sources.used': '元になった出典',
  'sources.externalOnly': '外部のみ',
  'sources.readExplanation': '解説を読む',
  'sources.original': '元記事',
  'sources.originalSource': '元の外部記事',
  'sources.featuredIn': 'この出典を取り上げた分析',

  // — article types —
  'type.explanation': '解説',
  'type.analysis': '分析',
} as const

export type MessageKey = keyof typeof ja

const en: Record<MessageKey, string> = {
  'nav.index': 'INDEX',
  'nav.operator': 'OPERATOR',
  'lang.switchTo': '日本語に切り替え',
  'lang.label': 'Language',

  'home.latest': 'Latest',
  'home.articleCount': 'articles',
  'home.search': 'Search',
  'home.searchPlaceholder': 'Title or tag',
  'home.searchAria': 'Filter articles',
  'home.clearTag': 'clear',
  'home.empty': 'No articles match this filter',
  'home.mustReads': 'Must reads',
  'home.tags': 'Tags',
  'home.showAllTags': 'Show all',
  'home.hideTags': 'Collapse',
  'home.pagination': 'Pagination',
  'home.prev': 'Prev',
  'home.next': 'Next',

  'article.loading': 'Loading…',
  'article.notFound': 'Article not found',
  'article.backToIndex': 'Back to index',
  'article.index': 'Index',
  'article.backToAll': 'Back to all insights',
  'article.spotifyAria': 'Listen to the podcast on Spotify',
  'article.noTranslationTitle': 'No English edition yet',
  'article.noTranslationBody':
    'This article has only been published in Japanese. Showing the Japanese edition.',

  'sources.used': 'Sources used',
  'sources.externalOnly': 'External only',
  'sources.readExplanation': 'Read the explanation',
  'sources.original': 'Original',
  'sources.originalSource': 'Original source',
  'sources.featuredIn': 'Featured in analyses',

  'type.explanation': 'Explanation',
  'type.analysis': 'Analysis',
}

export const MESSAGES: Record<Language, Record<MessageKey, string>> = { ja, en }

/** Look up one message. `language` is always resolved — there is no fallback. */
export function translate(language: Language, key: MessageKey): string {
  return MESSAGES[language][key]
}
