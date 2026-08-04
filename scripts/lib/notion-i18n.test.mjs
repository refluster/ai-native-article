import assert from 'node:assert/strict'
import test from 'node:test'

import {
  EN_CHILD_PAGE_TITLE,
  buildEnPageBlocks,
  chunkBlocks,
  isEnChildPageTitle,
  markdownToBlocks,
  parseEnMarkdown,
  serializeEnMarkdown,
  writeEnChildPage,
} from './notion-i18n.mjs'

test('isEnChildPageTitle accepts the sentinel and its common hand-typed variants', () => {
  for (const t of ['EN', 'en', ' En ', 'English', 'english', 'English (EN)']) {
    assert.equal(isEnChildPageTitle(t), true, `expected "${t}" to be recognised`)
  }
  for (const t of ['', 'JA', 'Notes', 'English draft', undefined, null]) {
    assert.equal(isEnChildPageTitle(t), false, `expected "${t}" to be rejected`)
  }
})

test('markdownToBlocks maps headings, bullets, quotes and paragraphs', () => {
  const blocks = markdownToBlocks(
    ['## Section', '- first', '- second', '', 'A paragraph', 'wrapped over two lines', '', '> quoted'].join('\n'),
  )
  assert.deepEqual(
    blocks.map(b => b.type),
    ['heading_2', 'bulleted_list_item', 'bulleted_list_item', 'paragraph', 'quote'],
  )
  assert.equal(blocks[3].paragraph.rich_text[0].text.content, 'A paragraph wrapped over two lines')
  assert.equal(blocks[4].quote.rich_text[0].text.content, 'quoted')
})

test('markdownToBlocks does not silently drop content past Notion’s 100-block limit', () => {
  const md = Array.from({ length: 250 }, (_, i) => `- item ${i}`).join('\n')
  const blocks = markdownToBlocks(md)
  assert.equal(blocks.length, 250)
  const chunks = chunkBlocks(blocks)
  assert.deepEqual(chunks.map(c => c.length), [100, 100, 50])
})

test('markdownToBlocks caps a single rich_text at Notion’s 2000-char limit', () => {
  const [block] = markdownToBlocks('x'.repeat(5000))
  assert.equal(block.paragraph.rich_text[0].text.content.length, 2000)
})

test('parseEnMarkdown is the inverse of serializeEnMarkdown', () => {
  const en = {
    title: 'What the Q2 filings actually say',
    abstract: 'Two of the three headline numbers are restatements, not growth.',
    body: '## Evidence\n\n- Revenue: $4.1B\n\nThe filing footnote is the whole story.',
  }
  assert.deepEqual(parseEnMarkdown(serializeEnMarkdown(en)), en)
})

test('parseEnMarkdown reads back what buildEnPageBlocks wrote, via a fetch-notion-style render', () => {
  const en = {
    title: 'A title',
    abstract: 'A one sentence lead.',
    body: '## Section\n\nClosing paragraph.\n\n- point\n- another point',
  }
  // Mirrors newsletter/pipeline/fetchers/notion.mjs blocksToMd for the block
  // types buildEnPageBlocks emits. (blocksToMd emits list items without a
  // trailing blank line, so a bullet followed directly by a paragraph comes
  // back as a lazy continuation of the list item — a pre-existing quirk of the
  // renderer that applies to the Japanese body too. Bullets last here.)
  const rendered = buildEnPageBlocks(en)
    .map(b => {
      const text = b[b.type].rich_text[0].text.content
      if (b.type === 'heading_1') return `# ${text}\n`
      if (b.type === 'heading_2') return `## ${text}\n`
      if (b.type === 'quote') return `> ${text}\n`
      if (b.type === 'bulleted_list_item') return `- ${text}`
      return `${text}\n`
    })
    .join('\n')

  assert.deepEqual(parseEnMarkdown(rendered), en)
})

test('parseEnMarkdown tolerates a hand-written page with no title and no abstract', () => {
  const parsed = parseEnMarkdown('Just some prose.\n\n## And a heading\n')
  assert.deepEqual(parsed, { title: '', abstract: '', body: 'Just some prose.\n\n## And a heading' })
})

test('parseEnMarkdown does not eat a body blockquote that follows real content', () => {
  const parsed = parseEnMarkdown('# T\n\n> lead\n\nBody starts.\n\n> a pull quote in the body\n')
  assert.equal(parsed.abstract, 'lead')
  assert.equal(parsed.body, 'Body starts.\n\n> a pull quote in the body')
})

test('buildEnPageBlocks omits the abstract quote when there is no abstract', () => {
  assert.deepEqual(
    buildEnPageBlocks({ title: 'T', body: 'Body.' }).map(b => b.type),
    ['heading_1', 'paragraph'],
  )
})

test('writeEnChildPage creates the EN page and appends every overflow chunk', async () => {
  const calls = []
  const notionFetch = async (method, path, body) => {
    calls.push({ method, path, children: body?.children?.length, archived: body?.archived })
    return { id: 'new-page', url: 'https://notion.so/new-page' }
  }

  const result = await writeEnChildPage({
    parentPageId: 'row-1',
    en: { title: 'T', abstract: 'A.', body: Array.from({ length: 220 }, (_, i) => `- ${i}`).join('\n') },
    notionFetch,
  })

  assert.equal(result.id, 'new-page')
  assert.equal(result.blocks, 222) // heading_1 + quote + 220 bullets
  assert.deepEqual(
    calls.map(c => [c.method, c.path, c.children]),
    [
      ['POST', '/pages', 100],
      ['PATCH', '/blocks/new-page/children', 100],
      ['PATCH', '/blocks/new-page/children', 22],
    ],
  )
})

test('writeEnChildPage archives a previous edition before writing the replacement', async () => {
  const calls = []
  const notionFetch = async (method, path, body) => {
    calls.push({ method, path, archived: body?.archived })
    return { id: 'p2', url: '' }
  }

  await writeEnChildPage({
    parentPageId: 'row-1',
    existingEnPageId: 'old-en',
    en: { title: 'T', body: 'Body.' },
    notionFetch,
  })

  assert.deepEqual(calls[0], { method: 'PATCH', path: '/blocks/old-en', archived: true })
  assert.equal(calls[1].method, 'POST')
})

test('writeEnChildPage titles the child page with the sentinel', async () => {
  let payload
  await writeEnChildPage({
    parentPageId: 'row-1',
    en: { title: 'T', body: 'Body.' },
    notionFetch: async (_m, _p, body) => { payload = body; return { id: 'p', url: '' } },
  })
  assert.equal(payload.properties.title[0].text.content, EN_CHILD_PAGE_TITLE)
  assert.deepEqual(payload.parent, { page_id: 'row-1' })
})

test('writeEnChildPage refuses to run without its required inputs', async () => {
  await assert.rejects(
    () => writeEnChildPage({ en: { title: 'T', body: 'B' }, notionFetch: async () => ({}) }),
    /parentPageId is required/,
  )
  await assert.rejects(
    () => writeEnChildPage({ parentPageId: 'row-1', en: { title: 'T', body: 'B' } }),
    /notionFetch is required/,
  )
})
