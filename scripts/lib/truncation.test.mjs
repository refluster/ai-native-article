// Tests for the canonical W-1 / R-10 truncation heuristic.
//
// This heuristic decides whether an article deploys. It had no test coverage
// until ML-020, which is how a glyph set written for Japanese prose reached
// English content and rejected complete translations. These cases pin both
// directions: what must be flagged, and what must NOT be.

import assert from 'node:assert/strict'
import test from 'node:test'

import { isTruncatedMarkdown, lastNonEmptyLine, stripFrontmatter } from './truncation.mjs'

test('flags a body whose last line is a dangling heading', () => {
  assert.equal(isTruncatedMarkdown('## Intro\n\nText.\n\n## 次のセクション'), true)
})

test('flags prose that stops without sentence-ending punctuation', () => {
  assert.equal(isTruncatedMarkdown('The filing shows that revenue'), true)
  assert.equal(isTruncatedMarkdown('売上高は前年比で'), true)
})

test('accepts Japanese sentence terminators', () => {
  for (const ending of ['である。', 'なのか？', 'そうだ！', 'と述べた」', '（注記）', '…']) {
    assert.equal(isTruncatedMarkdown(`本文\n\n${ending}`), false, ending)
  }
})

test('accepts ASCII sentence terminators', () => {
  for (const ending of ['It ends.', 'Does it?', 'It does!', 'See (ibid.)', 'the `flag`']) {
    assert.equal(isTruncatedMarkdown(`Body\n\n${ending}`), false, ending)
  }
})

test('structural last lines are never truncation', () => {
  for (const line of ['- a bullet', '1. a numbered item', '> a quote', '---', '```']) {
    assert.equal(isTruncatedMarkdown(`Body\n\n${line}`), false, line)
  }
})

test('ML-006: a sentence wrapped in emphasis is a complete ending', () => {
  assert.equal(isTruncatedMarkdown('本文\n\n*Elena が確認しました。*'), false)
  assert.equal(isTruncatedMarkdown('Body\n\n**The point stands.**'), false)
})

test('ML-020: an English paragraph ending on a quotation is complete', () => {
  // English puts the full stop inside the quote, so this is how any translation
  // of a Japanese paragraph ending 「…」。 comes out.
  assert.equal(
    isTruncatedMarkdown('Body\n\nAnd then the final proposition: "Encoding the nuances may be the largest economic task of the coming decade."'),
    false,
  )
  for (const ending of ['he said."', 'he said.”', "he said.'", 'he said.’', 'Really?"', 'Stop!”']) {
    assert.equal(isTruncatedMarkdown(`Body\n\n${ending}`), false, ending)
  }
})

test('ML-020 fix stays strict: a line ending on an OPENING quote is still truncation', () => {
  assert.equal(isTruncatedMarkdown('Body\n\nAnd then he said, "'), true)
  assert.equal(isTruncatedMarkdown('Body\n\nThe report calls this a “'), true)
})

test('a line of nothing but closers is truncation, not a complete sentence', () => {
  assert.equal(isTruncatedMarkdown('Body\n\n**'), true)
  assert.equal(isTruncatedMarkdown('Body\n\n"'), true)
})

test('empty and whitespace-only bodies are not flagged', () => {
  assert.equal(isTruncatedMarkdown(''), false)
  assert.equal(isTruncatedMarkdown('   \n\n  '), false)
})

test('trailing blank lines do not hide the real last line', () => {
  assert.equal(isTruncatedMarkdown('Body ends properly.\n\n\n   \n'), false)
  assert.equal(isTruncatedMarkdown('Body ends abruptly\n\n\n   \n'), true)
})

test('stripFrontmatter removes a leading YAML block and nothing else', () => {
  assert.equal(stripFrontmatter('---\ntitle: "x"\n---\nBody.\n'), 'Body.\n')
  assert.equal(stripFrontmatter('Body with --- inside.\n'), 'Body with --- inside.\n')
})

test('lastNonEmptyLine previews at 60 chars', () => {
  assert.equal(lastNonEmptyLine('a\n\nshort line'), 'short line')
  const long = 'x'.repeat(100)
  assert.equal(lastNonEmptyLine(long).length, 60)
  assert.ok(lastNonEmptyLine(long).endsWith('...'))
  assert.equal(lastNonEmptyLine('\n\n  \n'), '')
})
