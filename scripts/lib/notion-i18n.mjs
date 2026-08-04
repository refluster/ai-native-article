// notion-i18n.mjs — the single canonical contract for an article's **English
// edition** inside Notion.
//
// Where the English edition lives (ADR-0005)
// ------------------------------------------
// One article stays ONE row in the unified Articles DB. Its English edition is
// a **child page titled `EN`** hanging off that row's page. Nothing about the
// row changes: slug, Tags, Date, Author, SourceURLs, Type and the L2/L3
// coverage keys stay single-sourced, so `pick-l1-source.mjs` / `pick-l2-sources.mjs`
// see exactly the corpus they saw before, and the reader keeps one URL per
// article in both languages.
//
// The alternative — a second DB row with a `Lang` property — was rejected
// because it doubles every row the pickers walk, splits the tag counts, and
// makes "which of these two rows is the article" a question every consumer has
// to answer. See docs/adr/adr-0005-bilingual-article-editions.md.
//
// The EN child page's own body is a small, fixed document shape so it
// round-trips through Notion blocks without a schema:
//
//     # <English title>          ← heading_1, exactly one, first
//     > <English abstract>       ← quote, optional, immediately after the title
//     <English body …>           ← everything else
//
// `buildEnPageBlocks` writes that shape; `parseEnMarkdown` reads it back out of
// the markdown `fetch-notion` renders from those blocks. The two are inverses,
// and `notion-i18n.test.mjs` holds them to it.
//
// This module is deliberately **pure** — it never calls fetch(). Callers inject
// their own `notionFetch`, which keeps the R-14 proxy-bootstrap discipline (and
// the retry/throttle policy) in the entry scripts where it belongs, and lets the
// block/markdown logic be unit-tested with no network.

/** Title of the child page that carries the English edition. */
export const EN_CHILD_PAGE_TITLE = 'EN'

/** Notion's hard cap on `children` per create/append request. */
export const NOTION_CHILDREN_LIMIT = 100

/** Notion's hard cap on a single rich_text content string. */
const RICH_TEXT_LIMIT = 2000

/**
 * Does this child-page title mark the English edition?
 *
 * Tolerant on read (`EN`, `en`, `English`, `English (EN)`) and exact on write —
 * an operator who renames the page in the Notion UI should not silently drop
 * the translation out of the export.
 */
export function isEnChildPageTitle(title) {
  return /^\s*(en|english)(\s*\(\s*en\s*\))?\s*$/i.test(String(title ?? ''))
}

/** Split an oversized block array into Notion-sized create/append chunks. */
export function chunkBlocks(blocks, size = NOTION_CHILDREN_LIMIT) {
  const out = []
  for (let i = 0; i < blocks.length; i += size) out.push(blocks.slice(i, i + size))
  return out
}

function textBlock(type, content) {
  return {
    object: 'block',
    type,
    [type]: { rich_text: [{ type: 'text', text: { content: content.slice(0, RICH_TEXT_LIMIT) } }] },
  }
}

/**
 * Minimal Markdown → Notion blocks. Handles H1–H3, bullet lists, blockquotes,
 * and blank-line-separated paragraphs.
 *
 * Lifted verbatim from the two `publish-notion.mjs` copies it replaces, with
 * two deliberate changes:
 *
 *   1. **No `.slice(0, 100)`.** The old cap silently dropped everything past
 *      the 100th block — a C-1 editorial-integrity hole that only hid because
 *      a ~3000字 article usually lands under the cap. Callers now chunk and
 *      append the overflow (`chunkBlocks`), so a long article publishes whole
 *      or fails loud.
 *   2. **`>` becomes a quote block** rather than a paragraph that starts with a
 *      literal ">". This is what lets the EN abstract round-trip.
 */
export function markdownToBlocks(md) {
  const out = []
  let para = []
  const flushPara = () => {
    if (para.length === 0) return
    out.push(textBlock('paragraph', para.join(' ')))
    para = []
  }
  for (const raw of String(md ?? '').split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '') { flushPara(); continue }
    let m
    if ((m = line.match(/^###\s+(.+)/))) { flushPara(); out.push(textBlock('heading_3', m[1])) }
    else if ((m = line.match(/^##\s+(.+)/))) { flushPara(); out.push(textBlock('heading_2', m[1])) }
    else if ((m = line.match(/^#\s+(.+)/))) { flushPara(); out.push(textBlock('heading_2', m[1])) }
    else if ((m = line.match(/^>\s?(.*)/))) { flushPara(); out.push(textBlock('quote', m[1])) }
    else if ((m = line.match(/^[-*]\s+(.+)/))) { flushPara(); out.push(textBlock('bulleted_list_item', m[1])) }
    else { para.push(line) }
  }
  flushPara()
  return out
}

/**
 * Blocks for the body of an EN child page: title heading, optional abstract
 * quote, then the body.
 *
 * @param {{title: string, abstract?: string, body: string}} en
 */
export function buildEnPageBlocks(en) {
  const blocks = [textBlock('heading_1', String(en.title ?? '').trim())]
  const abstract = String(en.abstract ?? '').trim().replace(/\s+/g, ' ')
  if (abstract) blocks.push(textBlock('quote', abstract))
  blocks.push(...markdownToBlocks(en.body))
  return blocks
}

/**
 * Inverse of `buildEnPageBlocks`, over the markdown `fetch-notion` renders from
 * the EN child page.
 *
 * Both leading fields are optional on read so a hand-written EN page still
 * exports: with no `# ` heading the whole document is the body and the caller
 * falls back to the row's Japanese title; with no `> ` quote the abstract is
 * empty and the reader falls back to the Japanese abstract.
 *
 * @returns {{title: string, abstract: string, body: string}}
 */
export function parseEnMarkdown(md) {
  const lines = String(md ?? '').split(/\r?\n/)
  let i = 0
  const skipBlank = () => { while (i < lines.length && lines[i].trim() === '') i++ }

  skipBlank()
  let title = ''
  const h1 = lines[i]?.match(/^#\s+(.+?)\s*$/)
  if (h1) { title = h1[1].trim(); i++ }

  skipBlank()
  const quote = []
  while (i < lines.length) {
    const m = lines[i].match(/^>\s?(.*)$/)
    if (!m) break
    quote.push(m[1].trim())
    i++
  }

  const body = lines.slice(i).join('\n').trim()
  return { title, abstract: quote.join(' ').trim(), body }
}

/** Serialize an EN edition back to the child page's canonical markdown. */
export function serializeEnMarkdown(en) {
  const parts = []
  const title = String(en.title ?? '').trim()
  const abstract = String(en.abstract ?? '').trim().replace(/\s+/g, ' ')
  if (title) parts.push(`# ${title}`)
  if (abstract) parts.push(`> ${abstract}`)
  parts.push(String(en.body ?? '').trim())
  return parts.join('\n\n') + '\n'
}

/**
 * Create (or replace) the `EN` child page under an article's Notion page.
 *
 * Networking is injected so this module stays pure and the caller keeps its own
 * retry/throttle policy and R-14 proxy bootstrap.
 *
 * @param {Object} options
 * @param {string} options.parentPageId       the article row's page id
 * @param {{title: string, abstract?: string, body: string}} options.en
 * @param {(method: string, path: string, body?: unknown) => Promise<any>} options.notionFetch
 * @param {string} [options.existingEnPageId] archive this page first (re-translation)
 * @returns {Promise<{id: string, url: string, blocks: number}>}
 */
export async function writeEnChildPage(options) {
  const { parentPageId, en, notionFetch, existingEnPageId } = options
  if (!parentPageId) throw new Error('writeEnChildPage: parentPageId is required')
  if (typeof notionFetch !== 'function') throw new Error('writeEnChildPage: notionFetch is required')

  const blocks = buildEnPageBlocks(en)
  const [first, ...rest] = chunkBlocks(blocks)

  // Re-translation: archive the old edition rather than appending to it, so a
  // second run can never produce a page with two articles stacked in it.
  if (existingEnPageId) {
    await notionFetch('PATCH', `/blocks/${existingEnPageId}`, { archived: true })
  }

  const created = await notionFetch('POST', '/pages', {
    parent: { page_id: parentPageId },
    properties: { title: [{ type: 'text', text: { content: EN_CHILD_PAGE_TITLE } }] },
    children: first ?? [],
  })

  for (const chunk of rest) {
    await notionFetch('PATCH', `/blocks/${created.id}/children`, { children: chunk })
  }

  return { id: created.id, url: created.url ?? '', blocks: blocks.length }
}
