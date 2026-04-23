#!/usr/bin/env node
/**
 * fetch-notion.mjs
 * Pulls all entries from the "L3: Insights" Notion database,
 * converts them to Markdown files in public/posts/, and writes
 * a manifest.json for the React app to consume.
 *
 * Usage: node --env-file=.env scripts/fetch-notion.mjs
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Load .env if present (local dev). In CI, env vars are injected by the runner.
const __envPath = join(__dirname, '..', '.env')
if (existsSync(__envPath)) {
  for (const line of readFileSync(__envPath, 'utf8').split('\n')) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim()
  }
}
const ROOT = join(__dirname, '..')

const NOTION_API_KEY = process.env.NOTION_API_KEY
const DB_ID = '331d0f0be61e812e92bfc1ba92bcd1d9'
const NOTION_VERSION = '2022-06-28'
const POSTS_DIR = join(ROOT, 'public', 'posts')

if (!NOTION_API_KEY) {
  console.error('❌  NOTION_API_KEY is not set. Add it to your .env file.')
  process.exit(1)
}

const headers = {
  Authorization: `Bearer ${NOTION_API_KEY}`,
  'Notion-Version': NOTION_VERSION,
  'Content-Type': 'application/json',
}

async function get(path) {
  const res = await fetch(`https://api.notion.com/v1${path}`, { headers })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`GET ${path} → ${res.status}: ${body}`)
  }
  return res.json()
}

async function post(path, body) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`POST ${path} → ${res.status}: ${text}`)
  }
  return res.json()
}

/** Convert a Notion rich_text array to a Markdown string */
function richTextToMd(richText) {
  return (richText ?? [])
    .map(t => {
      let text = t.plain_text
      if (!text) return ''
      // Order matters: code wraps first, then bold/italic
      if (t.annotations?.code)          text = `\`${text}\``
      if (t.annotations?.bold)          text = `**${text}**`
      if (t.annotations?.italic)        text = `*${text}*`
      if (t.annotations?.strikethrough) text = `~~${text}~~`
      if (t.href)                        text = `[${text}](${t.href})`
      return text
    })
    .join('')
}

/** Recursively fetch all children blocks (handles pagination) */
async function fetchAllBlocks(blockId) {
  const blocks = []
  let cursor

  do {
    const params = cursor ? `?start_cursor=${cursor}` : ''
    const data = await get(`/blocks/${blockId}/children${params}`)
    blocks.push(...data.results)
    cursor = data.has_more ? data.next_cursor : undefined
  } while (cursor)

  return blocks
}

/** Convert an array of Notion blocks to Markdown */
async function blocksToMd(pageId, depth = 0) {
  const blocks = await fetchAllBlocks(pageId)
  const indent = '  '.repeat(depth)
  const lines = []

  for (const block of blocks) {
    const type = block.type
    const b = block[type]

    switch (type) {
      case 'paragraph': {
        const text = richTextToMd(b.rich_text)
        lines.push(text ? `${text}\n` : '')
        break
      }
      case 'heading_1':
        lines.push(`# ${richTextToMd(b.rich_text)}\n`)
        break
      case 'heading_2':
        lines.push(`## ${richTextToMd(b.rich_text)}\n`)
        break
      case 'heading_3':
        lines.push(`### ${richTextToMd(b.rich_text)}\n`)
        break
      case 'bulleted_list_item': {
        lines.push(`${indent}- ${richTextToMd(b.rich_text)}`)
        if (block.has_children) {
          const nested = await blocksToMd(block.id, depth + 1)
          lines.push(nested)
        }
        break
      }
      case 'numbered_list_item': {
        lines.push(`${indent}1. ${richTextToMd(b.rich_text)}`)
        if (block.has_children) {
          const nested = await blocksToMd(block.id, depth + 1)
          lines.push(nested)
        }
        break
      }
      case 'quote':
        lines.push(`> ${richTextToMd(b.rich_text)}\n`)
        break
      case 'callout':
        lines.push(`> ${richTextToMd(b.rich_text)}\n`)
        break
      case 'code': {
        const lang = b.language && b.language !== 'plain text' ? b.language : ''
        lines.push(`\`\`\`${lang}\n${richTextToMd(b.rich_text)}\n\`\`\`\n`)
        break
      }
      case 'divider':
        lines.push('---\n')
        break
      case 'to_do': {
        const checked = b.checked ? 'x' : ' '
        lines.push(`${indent}- [${checked}] ${richTextToMd(b.rich_text)}`)
        break
      }
      case 'toggle': {
        lines.push(`**${richTextToMd(b.rich_text)}**\n`)
        if (block.has_children) {
          const nested = await blocksToMd(block.id, depth)
          lines.push(nested)
        }
        break
      }
      case 'image': {
        const src = b.type === 'external' ? b.external?.url : b.file?.url
        const caption = richTextToMd(b.caption)
        if (src) lines.push(`![${caption || ''}](${src})\n`)
        break
      }
      case 'table': {
        if (block.has_children) {
          const rows = await fetchAllBlocks(block.id)
          rows.forEach((row, i) => {
            const cells = row.table_row?.cells ?? []
            const line = '| ' + cells.map(c => richTextToMd(c)).join(' | ') + ' |'
            lines.push(line)
            if (i === 0) {
              lines.push('| ' + cells.map(() => '---').join(' | ') + ' |')
            }
          })
          lines.push('')
        }
        break
      }
      // Silently skip unsupported blocks
      default:
        break
    }
  }

  return lines.join('\n')
}

/** Extract plain text from a Notion property */
function propText(prop) {
  if (!prop) return ''
  switch (prop.type) {
    case 'title':     return (prop.title ?? []).map(t => t.plain_text).join('')
    case 'rich_text': return (prop.rich_text ?? []).map(t => t.plain_text).join('')
    case 'date':      return prop.date?.start ?? ''
    default:          return ''
  }
}

/** Generate a stable slug from a Notion page ID — use last 12 chars of stripped UUID */
function slugFromId(id) {
  const stripped = id.replace(/-/g, '')
  return stripped.slice(-12)
}

/** Escape double-quotes in frontmatter strings */
function esc(str) {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

async function main() {
  if (!existsSync(POSTS_DIR)) {
    mkdirSync(POSTS_DIR, { recursive: true })
  }

  console.log('🔍  Querying Notion database …')

  const manifest = []
  let cursor

  do {
    const body = {
      page_size: 100,
      sorts: [{ property: 'Date', direction: 'descending' }],
    }
    if (cursor) body.start_cursor = cursor

    const data = await post(`/databases/${DB_ID}/query`, body)

    for (const page of data.results) {
      const props = page.properties
      const title    = propText(props.Title)
      const abstract = propText(props.Abstract)
      const category = propText(props.Category)
      // Fall back to Notion's created_time when the Date property is empty
      // (GAS-created L3 entries don't populate Date). Without this, those
      // entries sort as `""` and sink below the manually-dated backlog.
      const date     = propText(props.Date) || page.created_time || ''
      const slug     = slugFromId(page.id)

      console.log(`  ↳  ${title || page.id}`)

      const bodyMd = await blocksToMd(page.id)

      const frontmatter = [
        '---',
        `title: "${esc(title)}"`,
        `category: "${esc(category)}"`,
        `date: "${esc(date)}"`,
        `abstract: "${esc(abstract)}"`,
        `notionId: "${page.id}"`,
        '---',
        '',
      ].join('\n')

      writeFileSync(join(POSTS_DIR, `${slug}.md`), frontmatter + '\n' + bodyMd)

      manifest.push({ slug, title, category, date, abstract })
    }

    cursor = data.has_more ? data.next_cursor : undefined
  } while (cursor)

  manifest.sort((a, b) => b.date.localeCompare(a.date))

  writeFileSync(
    join(POSTS_DIR, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
  )

  console.log(`\n✅  Done. ${manifest.length} articles written to public/posts/`)
}

main().catch(err => {
  console.error('❌ ', err.message)
  process.exit(1)
})
