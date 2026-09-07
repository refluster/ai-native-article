// pages-propagation-fixture.mjs — a GitHub Pages stand-in that propagates.
//
// R-17's post-deploy behaviour cannot be argued about from the code alone: the
// bug it exists for (#620) was a *timing* bug, and its first fix was wrong in a
// direction that reads as success. So the claims about it are made against this
// fixture rather than against prose, and it lives in the repo so anyone can
// re-run them (#620 review, Owen O5) instead of taking a transcript's word.
//
// It models the two properties that matter:
//
//   1. **A project path under someone else's apex.** Requests outside `mount`
//      404, the way this repo's Pages deploy sits under the user site's domain.
//   2. **Propagation is a window, not an instant.** `oldDir` is served until
//      `flipAfterMs`, then `newDir`. Serving the *old* build with HTTP 200 is
//      the whole difficulty: it is usually healthy, so every content assertion
//      passes against the wrong bytes.
//
// HONEST LIMIT, and do not oversell what a green run here proves: the flip is
// atomic, while real Pages propagation is per-edge, so a real client can see
// the new shell with old assets or the reverse. This fixture demonstrates the
// uniform window; it does not reproduce interleaved states. That gap is why
// R-17 settles on build *identity* — an interleaved read is a shell whose
// fingerprint does not match, i.e. `stale`, i.e. keep waiting — rather than on
// "did anything fail", which is exactly what the interleaving would fool.
//
// Usage:
//   node scripts/lib/pages-propagation-fixture.mjs <oldDir> <newDir> <mount> <port> <flipAfterMs>
// Prints its URL on stdout once listening, and `PROPAGATED` when it flips.

import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join, extname, normalize } from 'node:path'

const CONTENT_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.md': 'text/markdown',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
  '.ico': 'image/x-icon',
}

/**
 * @param {object} opts
 * @param {string} opts.oldDir        served until the flip — the previous deploy
 * @param {string} opts.newDir        served after the flip — the build just published
 * @param {string} [opts.mount]       path prefix this "repo" is published under
 * @param {number} [opts.flipAfterMs] 0 = already propagated
 * @returns {{server: import('node:http').Server, flip: () => void}}
 */
export function createPropagationFixture ({ oldDir, newDir, mount = '/', flipAfterMs = 0 }) {
  let current = flipAfterMs > 0 ? oldDir : newDir
  const flip = () => { current = newDir }
  if (flipAfterMs > 0) setTimeout(flip, flipAfterMs).unref?.()

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fixture')
    if (!url.pathname.startsWith(mount)) {
      // Not this repo's path — somebody else's site answers here.
      res.writeHead(404, { 'content-type': 'text/html' })
      return res.end('<!doctype html><title>another site</title>')
    }
    let rel = normalize(url.pathname.slice(mount.length))
    if (rel === '' || rel === '.' || rel.endsWith('/')) rel = join(rel, 'index.html')

    let file = join(current, rel)
    try { if ((await stat(file)).isDirectory()) file = join(file, 'index.html') } catch { /* not a dir */ }

    try {
      const body = await readFile(file)
      res.writeHead(200, { 'content-type': CONTENT_TYPES[extname(file)] || 'application/octet-stream' })
      res.end(body)
    } catch {
      // GitHub Pages answers an unknown path under the project with 404.html —
      // the SPA fallback the deep-link assertion depends on.
      try {
        const body = await readFile(join(current, '404.html'))
        res.writeHead(404, { 'content-type': 'text/html' })
        res.end(body)
      } catch {
        res.writeHead(404)
        res.end()
      }
    }
  })

  return { server, flip }
}

// CLI entry point — only when run directly, so importing this in a test does
// not start a server.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const [oldDir, newDir, mount = '/', port = '8099', flipAfterMs = '0'] = process.argv.slice(2)
  if (!oldDir || !newDir) {
    console.error(
      'usage: pages-propagation-fixture.mjs <oldDir> <newDir> [mount] [port] [flipAfterMs]'
    )
    process.exit(2)
  }
  const { server } = createPropagationFixture({
    oldDir, newDir, mount, flipAfterMs: Number(flipAfterMs),
  })
  server.listen(Number(port), () => {
    console.log(`pages-propagation-fixture on http://localhost:${port}${mount}`)
    if (Number(flipAfterMs) > 0) {
      console.log(`  serving the OLD build for ${flipAfterMs}ms, then the NEW one`)
      setTimeout(() => console.log('PROPAGATED'), Number(flipAfterMs))
    }
  })
}
