// R-14: this file calls the global fetch() (against its own localhost fixture).
// The bootstrap is a no-op unless the file is the process entry point, so it
// costs nothing here and keeps the gate's invariant unconditional.
import { ensureProxyAwareEntry } from './proxy-bootstrap.mjs'
ensureProxyAwareEntry(import.meta.url)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPropagationFixture } from './pages-propagation-fixture.mjs'

const MOUNT = '/ai-native-article/'

/** A minimal built site: an index.html with one content-hashed asset. */
function makeBuild (hash) {
  const dir = mkdtempSync(join(tmpdir(), `build-${hash}-`))
  mkdirSync(join(dir, 'assets'), { recursive: true })
  writeFileSync(
    join(dir, 'index.html'),
    `<!doctype html><link href="${MOUNT}assets/index-${hash}.css">` +
    `<script src="${MOUNT}assets/index-${hash}.js"></script>`
  )
  writeFileSync(join(dir, 'assets', `index-${hash}.js`), '//')
  writeFileSync(join(dir, 'assets', `index-${hash}.css`), '/**/')
  writeFileSync(join(dir, '404.html'), `<!doctype html><script>var base = '${MOUNT}';</script>`)
  return dir
}

async function withFixture (opts, fn) {
  const { server, flip } = createPropagationFixture({ mount: MOUNT, ...opts })
  await new Promise(resolve => server.listen(0, resolve))
  const origin = `http://localhost:${server.address().port}`
  try {
    return await fn({ origin, flip })
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
}

const OLD = makeBuild('OLD00000')
const NEW = makeBuild('NEW11111')

test('serves the old build before the flip, the new build after', async () => {
  await withFixture({ oldDir: OLD, newDir: NEW, flipAfterMs: 3_600_000 }, async ({ origin, flip }) => {
    const before = await (await fetch(`${origin}${MOUNT}`)).text()
    assert.match(before, /index-OLD00000\.js/)
    assert.doesNotMatch(before, /index-NEW11111/)

    flip()

    const after = await (await fetch(`${origin}${MOUNT}`)).text()
    assert.match(after, /index-NEW11111\.js/)
  })
})

test('the stale build answers 200 and is internally consistent — the whole difficulty', async () => {
  await withFixture({ oldDir: OLD, newDir: NEW, flipAfterMs: 3_600_000 }, async ({ origin }) => {
    const shell = await fetch(`${origin}${MOUNT}`)
    assert.equal(shell.status, 200)
    // Every asset the stale shell references resolves. Nothing "fails" — which
    // is why a check that waits on failure alone passes against the wrong build.
    for (const asset of ['assets/index-OLD00000.js', 'assets/index-OLD00000.css']) {
      assert.equal((await fetch(`${origin}${MOUNT}${asset}`)).status, 200)
    }
  })
})

test('flipAfterMs = 0 means already propagated', async () => {
  await withFixture({ oldDir: OLD, newDir: NEW, flipAfterMs: 0 }, async ({ origin }) => {
    assert.match(await (await fetch(`${origin}${MOUNT}`)).text(), /index-NEW11111\.js/)
  })
})

test('paths outside the mount are somebody else\'s site', async () => {
  await withFixture({ oldDir: OLD, newDir: NEW }, async ({ origin }) => {
    const res = await fetch(`${origin}/assets/index-NEW11111.js`)
    assert.equal(res.status, 404)
  })
})

test('an unknown path under the mount gets the SPA 404 fallback', async () => {
  await withFixture({ oldDir: OLD, newDir: NEW }, async ({ origin }) => {
    const res = await fetch(`${origin}${MOUNT}article/whatever`)
    assert.equal(res.status, 404)
    assert.match(await res.text(), /var base = '\/ai-native-article\/'/)
  })
})

test('flips on its own timer', async () => {
  await withFixture({ oldDir: OLD, newDir: NEW, flipAfterMs: 40 }, async ({ origin }) => {
    assert.match(await (await fetch(`${origin}${MOUNT}`)).text(), /OLD00000/)
    await new Promise(r => setTimeout(r, 90))
    assert.match(await (await fetch(`${origin}${MOUNT}`)).text(), /NEW11111/)
  })
})
