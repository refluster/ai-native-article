import assert from 'node:assert/strict'
import test from 'node:test'

import { MIN_BODY_CHARS, checkEnPublishable } from './en-publishable.mjs'

const longBody = 'The filing shows revenue of $4.1B. '.repeat(20)

test('a complete translation passes', () => {
  assert.deepEqual(checkEnPublishable({ title: 'A Title', body: longBody, finishReason: 'stop' }), { ok: true })
})

test('a missing title is rejected', () => {
  const r = checkEnPublishable({ title: '   ', body: longBody })
  assert.equal(r.reason, 'no-title')
  assert.match(r.message, /no `# Title` heading/)
})

test('a body under the floor is rejected, and the message says by how much', () => {
  const r = checkEnPublishable({ title: 'T', body: 'Too short.' })
  assert.equal(r.reason, 'too-short')
  assert.match(r.message, new RegExp(`10 chars \\(< ${MIN_BODY_CHARS}\\)`))
})

test('an LLM-failure prelude is rejected', () => {
  const r = checkEnPublishable({ title: 'T', body: `Here is the English translation. ${longBody}` })
  assert.equal(r.reason, 'prelude')
})

test('ML-021: a truncation rejection names finish_reason and the FULL last line', () => {
  // The 60-char preview that shipped originally elided exactly the characters
  // the operator needs. Pin that it no longer does.
  const tail = 'and the analysis concludes that the constraint was never the tooling but the'
  const r = checkEnPublishable({
    title: 'T',
    body: `${longBody}\n\n${tail}`,
    finishReason: 'stop',
  })
  assert.equal(r.reason, 'truncated')
  assert.match(r.message, /finish_reason: stop/)
  assert.ok(r.message.includes(tail), 'the full last line must appear, not a 60-char preview')
  assert.ok(r.message.includes('ends with:'), 'the tail must be quoted separately')
})

test('finish_reason is reported as unknown rather than blank when absent', () => {
  const r = checkEnPublishable({ title: 'T', body: `${longBody}\n\nends abruptly with` })
  assert.match(r.message, /finish_reason: unknown/)
})

test('the quoted tail makes an invisible trailing character visible', () => {
  // A zero-width space is the case that matters: `trim()` and the heuristic's
  // own `\s+$` both leave it (neither treats U+200B as whitespace), so it
  // survives to be the character the verdict turns on — and prints as nothing.
  const r = checkEnPublishable({ title: 'T', body: `${longBody}\n\nends invisibly​` })
  assert.equal(r.reason, 'truncated')
  assert.match(r.message, /ends with: ".*\\u200b"/)
  // …and the trailing-whitespace case is quoted consistently with what the
  // heuristic actually tested, i.e. stripped by both.
  const w = checkEnPublishable({ title: 'T', body: `${longBody}\n\nends with a trailing tab\t` })
  assert.match(w.message, /ends with: ".*trailing tab"/)
})

test('ML-020: an English paragraph ending on a quotation is publishable', () => {
  const r = checkEnPublishable({
    title: 'T',
    body: `${longBody}\n\nAnd then the final proposition: "Encoding the nuances may be the largest economic task of the coming decade."`,
    finishReason: 'stop',
  })
  assert.deepEqual(r, { ok: true })
})

test('ML-020 (ja): a paragraph closing on 『…』 or 【…】 is publishable', () => {
  for (const tail of ['彼は『これは構造的だ』', '詳細は【注】']) {
    const r = checkEnPublishable({ title: 'T', body: `${longBody}\n\n${tail}` })
    assert.deepEqual(r, { ok: true }, tail)
  }
})

test('checks run in a stable order: no-title beats every other complaint', () => {
  assert.equal(checkEnPublishable({ title: '', body: 'x' }).reason, 'no-title')
})

test('missing fields do not throw', () => {
  assert.equal(checkEnPublishable({}).reason, 'no-title')
  assert.equal(checkEnPublishable(undefined).reason, 'no-title')
})
