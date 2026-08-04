/**
 * article.ts — reading an article's metadata in the reader's language.
 *
 * The fallback is always to Japanese, never to nothing. An article whose
 * English edition has not been written yet still appears in the English index,
 * still carries its title, and still opens — with a notice explaining that the
 * body is the Japanese one. Hiding it would silently shrink the corpus for
 * English readers, which is a worse failure than a visible fallback (C-4).
 */

import type { ArticleMeta } from '../types/article'
import type { Language } from './language'

export function localizedTitle(article: ArticleMeta, language: Language): string {
  if (language === 'en' && article.titleEn) return article.titleEn
  return article.title
}

export function localizedAbstract(article: ArticleMeta, language: Language): string {
  if (language === 'en' && article.abstractEn) return article.abstractEn
  return article.abstract
}
