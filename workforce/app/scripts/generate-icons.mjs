#!/usr/bin/env node
/**
 * generate-icons.mjs — rasterise the workforce brand mark to PNG.
 *
 * `public/favicon.svg` is the source of truth for the mark; this script is
 * the one place its geometry is duplicated, because the surfaces that will
 * not take an SVG (iOS home-screen `apple-touch-icon`, the PWA manifest's
 * 192/512 icons) need real bitmaps and this repo has no raster toolchain
 * (no sharp / rsvg / ImageMagick). Rather than commit opaque binaries with
 * no way to regenerate them, the geometry lives here as data and the PNG
 * encoder is `zlib.deflateSync` + a CRC table — both Node built-ins.
 *
 * Run after ANY edit to favicon.svg so the bitmaps don't drift:
 *   node workforce/app/scripts/generate-icons.mjs
 *
 * Rendering is 4×4 supersampled coverage per pixel — enough antialiasing
 * for a mark that is circles and straight edges.
 */

import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')

// ── The mark, in the favicon's 32-unit design space ─────────────────────
const INK = [0x0f, 0x1b, 0x46] // wf-primary
const WHITE = [0xff, 0xff, 0xff]

/** Shapes are drawn in order; each returns coverage 0..1 at a point. */
const SHAPES = [
  { kind: 'roundedRect', x: 0, y: 0, w: 32, h: 32, r: 7, color: INK, alpha: 1 },
  { kind: 'segment', x1: 14.6, y1: 12.4, x2: 11.6, y2: 19.6, width: 1.6, color: WHITE, alpha: 0.65 },
  { kind: 'segment', x1: 17.4, y1: 12.4, x2: 20.4, y2: 19.6, width: 1.6, color: WHITE, alpha: 0.65 },
  { kind: 'ring', cx: 10.4, cy: 22.4, r: 2.6, width: 1.6, color: WHITE, alpha: 1 },
  { kind: 'ring', cx: 21.6, cy: 22.4, r: 2.6, width: 1.6, color: WHITE, alpha: 1 },
  { kind: 'disc', cx: 16, cy: 9.6, r: 3.1, color: WHITE, alpha: 1 },
]

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1
  const dy = y2 - y1
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2))
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

/** True when the design-space point (px, py) is inside `s`. */
function hit(s, px, py) {
  switch (s.kind) {
    case 'roundedRect': {
      // Distance to the inner rect inset by the corner radius.
      const ix1 = s.x + s.r
      const iy1 = s.y + s.r
      const ix2 = s.x + s.w - s.r
      const iy2 = s.y + s.h - s.r
      const qx = Math.max(ix1 - px, 0, px - ix2)
      const qy = Math.max(iy1 - py, 0, py - iy2)
      return Math.hypot(qx, qy) <= s.r
    }
    case 'disc':
      return Math.hypot(px - s.cx, py - s.cy) <= s.r
    case 'ring':
      return Math.abs(Math.hypot(px - s.cx, py - s.cy) - s.r) <= s.width / 2
    case 'segment':
      // Round caps, matching the SVG's stroke-linecap="round".
      return distToSegment(px, py, s.x1, s.y1, s.x2, s.y2) <= s.width / 2
    default:
      throw new Error(`unknown shape kind: ${s.kind}`)
  }
}

const SS = 4 // supersample factor per axis

/** RGBA pixel buffer for one square icon of `size` px. */
function render(size) {
  const scale = size / 32
  const px = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (const s of SHAPES) {
        let hits = 0
        for (let sy = 0; sy < SS; sy++) {
          for (let sx = 0; sx < SS; sx++) {
            const dx = (x + (sx + 0.5) / SS) / scale
            const dy = (y + (sy + 0.5) / SS) / scale
            if (hit(s, dx, dy)) hits++
          }
        }
        if (hits === 0) continue
        // Source-over composite in straight (non-premultiplied) space.
        const sa = (hits / (SS * SS)) * s.alpha
        const outA = sa + a * (1 - sa)
        if (outA === 0) continue
        r = (s.color[0] * sa + r * a * (1 - sa)) / outA
        g = (s.color[1] * sa + g * a * (1 - sa)) / outA
        b = (s.color[2] * sa + b * a * (1 - sa)) / outA
        a = outA
      }
      const i = (y * size + x) * 4
      px[i] = Math.round(r)
      px[i + 1] = Math.round(g)
      px[i + 2] = Math.round(b)
      px[i + 3] = Math.round(a * 255)
    }
  }
  return px
}

// ── Minimal PNG encoder (RGBA8, no filtering) ───────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  // 10..12 = compression / filter / interlace, all 0
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0 // filter type: None
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const TARGETS = [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
]

mkdirSync(OUT_DIR, { recursive: true })
for (const [name, size] of TARGETS) {
  const png = encodePng(size, render(size))
  writeFileSync(join(OUT_DIR, name), png)
  console.log(`wrote ${name} (${size}×${size}, ${png.length} bytes)`)
}
