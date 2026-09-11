import { test } from 'node:test'
import assert from 'node:assert/strict'
import { countMissingAuthor } from './author-coverage.mjs'

test('counts nothing missing when every row has a non-empty author', () => {
  const result = countMissingAuthor([
    { slug: 'a', author: 'elena' },
    { slug: 'b', author: 'ren' },
  ])
  assert.deepEqual(result, { total: 2, missing: 0, missingSlugs: [] })
})

test('counts a row with no author key at all', () => {
  const result = countMissingAuthor([{ slug: 'legacy-1' }])
  assert.deepEqual(result, { total: 1, missing: 1, missingSlugs: ['legacy-1'] })
})

test('counts a row whose author is null', () => {
  const result = countMissingAuthor([{ slug: 'legacy-2', author: null }])
  assert.deepEqual(result, { total: 1, missing: 1, missingSlugs: ['legacy-2'] })
})

test('counts a row whose author is an empty or whitespace-only string', () => {
  const result = countMissingAuthor([
    { slug: 'legacy-3', author: '' },
    { slug: 'legacy-4', author: '   ' },
  ])
  assert.deepEqual(result, { total: 2, missing: 2, missingSlugs: ['legacy-3', 'legacy-4'] })
})

test('a slug-less row still counts, under a placeholder label', () => {
  const result = countMissingAuthor([{ author: '' }])
  assert.deepEqual(result, { total: 1, missing: 1, missingSlugs: ['(no slug)'] })
})

test('mixed corpus reports only the missing subset', () => {
  const result = countMissingAuthor([
    { slug: 'a', author: 'elena' },
    { slug: 'b' },
    { slug: 'c', author: 'ren' },
    { slug: 'd', author: null },
  ])
  assert.deepEqual(result, { total: 4, missing: 2, missingSlugs: ['b', 'd'] })
})

test('non-array input is treated as an empty corpus rather than throwing', () => {
  assert.deepEqual(countMissingAuthor(undefined), { total: 0, missing: 0, missingSlugs: [] })
  assert.deepEqual(countMissingAuthor(null), { total: 0, missing: 0, missingSlugs: [] })
})
