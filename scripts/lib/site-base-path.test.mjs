import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseSiteBasePath, readSiteBasePath, readSiteBaseName } from './site-base-path.mjs'

test('parses a subpath declaration', () => {
  assert.equal(
    parseSiteBasePath("export const SITE_BASE_PATH = '/ai-native-article/'\n"),
    '/ai-native-article/'
  )
})

test('parses a root declaration', () => {
  assert.equal(parseSiteBasePath('export const SITE_BASE_PATH = "/"\n'), '/')
})

test('ignores the value in a comment above the declaration', () => {
  const src = [
    "// When it happens, flip this one constant to '/'.",
    "export const SITE_BASE_PATH = '/ai-native-article/'",
  ].join('\n')
  assert.equal(parseSiteBasePath(src), '/ai-native-article/')
})

test('throws when the declaration is missing', () => {
  assert.throws(() => parseSiteBasePath('export const OTHER = 1\n'), /not found/)
})

test('throws on a value missing its slashes', () => {
  assert.throws(
    () => parseSiteBasePath("export const SITE_BASE_PATH = 'ai-native-article'\n"),
    /must start and end/
  )
})

test('reads the repo config and derives the basename', () => {
  const base = readSiteBasePath()
  assert.match(base, /^\/.*\/$/)
  assert.equal(readSiteBaseName(), base.replace(/\/$/, ''))
})
