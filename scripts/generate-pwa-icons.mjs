#!/usr/bin/env node
// Generates PWA icons (Swiss-style L1 monogram) with zero dependencies.
// Outputs to public/icons/.
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { Buffer } from 'node:buffer'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = resolve(__dirname, '..', 'public', 'icons')

// --- PNG encoding (RGBA, zlib) ---
const crcTable = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  crcTable[n] = c
}
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crcBuf])
}
function encodePNG(w, h, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  const stride = w * 4
  const raw = Buffer.alloc(h * (1 + stride))
  for (let y = 0; y < h; y++) {
    raw[y * (1 + stride)] = 0
    rgba.copy(raw, y * (1 + stride) + 1, y * stride, (y + 1) * stride)
  }
  const idat = deflateSync(raw, { level: 9 })
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

// --- Draw ---
// Swiss-style monogram: red background, white "L1" built from rectangles.
// `scale` expands rectangle coordinates to pixel-space.
function drawIcon(size, { padding = 0 } = {}) {
  const RED = [0xc1, 0x00, 0x0a, 0xff]
  const WHITE = [0xff, 0xff, 0xff, 0xff]
  const buf = Buffer.alloc(size * size * 4)
  for (let i = 0; i < size * size; i++) {
    buf[i * 4] = RED[0]; buf[i * 4 + 1] = RED[1]; buf[i * 4 + 2] = RED[2]; buf[i * 4 + 3] = RED[3]
  }
  // Rectangles in normalized [0,1] within a (1-2p) inner square.
  // Monogram fits inside inner box to leave margin for maskable icons.
  const inner = 1 - 2 * padding
  const rects = [
    // L vertical
    [0.16, 0.22, 0.30, 0.78],
    // L horizontal
    [0.16, 0.68, 0.46, 0.78],
    // 1 serif flag
    [0.54, 0.22, 0.64, 0.30],
    // 1 vertical stem
    [0.64, 0.22, 0.74, 0.78],
    // 1 base
    [0.54, 0.72, 0.84, 0.78],
  ]
  for (const [x0, y0, x1, y1] of rects) {
    const px0 = Math.round((padding + x0 * inner) * size)
    const py0 = Math.round((padding + y0 * inner) * size)
    const px1 = Math.round((padding + x1 * inner) * size)
    const py1 = Math.round((padding + y1 * inner) * size)
    for (let y = py0; y < py1; y++) {
      for (let x = px0; x < px1; x++) {
        const i = (y * size + x) * 4
        buf[i] = WHITE[0]; buf[i + 1] = WHITE[1]; buf[i + 2] = WHITE[2]; buf[i + 3] = WHITE[3]
      }
    }
  }
  return encodePNG(size, size, buf)
}

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(resolve(OUT_DIR, 'icon-192.png'), drawIcon(192))
writeFileSync(resolve(OUT_DIR, 'icon-512.png'), drawIcon(512))
// Maskable: glyph sits in the safe zone (10% padding on each side).
writeFileSync(resolve(OUT_DIR, 'icon-maskable-512.png'), drawIcon(512, { padding: 0.1 }))
writeFileSync(resolve(OUT_DIR, 'apple-touch-icon.png'), drawIcon(180))
console.log('wrote icons to', OUT_DIR)
