#!/usr/bin/env node
/**
 * generate-sitemap.mjs
 *
 * Reads public/posts/manifest.json and writes:
 *   - public/sitemap.xml  (one entry per article + home + design pages)
 *   - public/robots.txt   (allow all, point to sitemap)
 *
 * Runs during CI deploy, before `vite build`, so dist/ ships with both.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ORIGIN = 'https://kohuehara.xyz'
const BASE = '/ai-native-article'
const MANIFEST = join(ROOT, 'public', 'posts', 'manifest.json')
const SITEMAP = join(ROOT, 'public', 'sitemap.xml')
const ROBOTS = join(ROOT, 'public', 'robots.txt')

const today = new Date().toISOString().slice(0, 10)

const staticRoutes = [
  { path: '/', changefreq: 'daily', priority: 1.0 },
  { path: '/design-system', changefreq: 'monthly', priority: 0.3 },
  { path: '/design-guide', changefreq: 'monthly', priority: 0.3 },
]

let articles = []
if (existsSync(MANIFEST)) {
  articles = JSON.parse(readFileSync(MANIFEST, 'utf8'))
} else {
  console.warn(`⚠  ${MANIFEST} not found — sitemap will omit articles.`)
}

const urls = [
  ...staticRoutes.map(r => ({
    loc: `${ORIGIN}${BASE}${r.path === '/' ? '/' : r.path}`,
    lastmod: today,
    changefreq: r.changefreq,
    priority: r.priority,
  })),
  ...articles.map(a => ({
    loc: `${ORIGIN}${BASE}/article/${a.slug}`,
    lastmod: a.date || today,
    changefreq: 'yearly',
    priority: 0.8,
  })),
]

const xml = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...urls.map(
    u =>
      `  <url><loc>${u.loc}</loc><lastmod>${u.lastmod}</lastmod><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`,
  ),
  '</urlset>',
  '',
].join('\n')

writeFileSync(SITEMAP, xml)

const robots = [
  'User-agent: *',
  'Allow: /',
  '',
  `Sitemap: ${ORIGIN}${BASE}/sitemap.xml`,
  '',
].join('\n')

writeFileSync(ROBOTS, robots)

console.log(`✅ sitemap.xml (${urls.length} urls) + robots.txt written.`)
