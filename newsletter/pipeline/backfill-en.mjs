#!/usr/bin/env node
/**
 * backfill-en.mjs — give every already-published article an English edition.
 *
 * The article-level2/level3 cadences now publish both editions on every fire
 * (ADR-0005), so this script exists for the corpus that predates that: it walks
 * the unified Articles DB, finds rows with no `EN` child page, translates the
 * Japanese body, and writes the child page. It is also the repair tool for a
 * cadence run that exited 4 (row created, English edition failed).
 *
 * Why a script and not a cadence
 * ------------------------------
 * This is a one-shot migration over a fixed set of rows, not recurring work.
 * A cadence would need a schedule, an agent binding, and a persona voice for a
 * job that ends. `--limit` lets the operator run it in batches instead.
 *
 * Notion stays the source of truth (C-2): the translation is written back to
 * Notion, and `fetch-notion.mjs` exports it on the next deploy. Nothing here
 * writes to `newsletter/app/public/posts/` — that directory is derived.
 *
 * Editorial integrity (C-1 / C-4)
 * -------------------------------
 * A translation is an article, so it clears the same W-1 guards the cadences
 * apply: minimum length, no LLM-failure prelude, no cut-off last line. A row
 * that fails is SKIPPED and counted, never written half-good, and the script
 * exits 1 at the end so a batch that silently degraded cannot look like a
 * success. `finish_reason === 'length'` from the model is a hard throw for the
 * same reason (the R-3 rule this repo learned from the d17e1d58ec42 incident).
 *
 * Token budget (newsletter/docs/azure-budget-rules.md)
 * ----------------------------------------------------
 * Uses the **Heavy** bracket, 16000. Generation brackets assume output much
 * shorter than input; a translation must reproduce the *entire* article, so
 * visible output is roughly the length of the input article and competes with
 * hidden reasoning for the same budget. Standard (8000) truncates long
 * analyses. This is the first live call site the bracket table's "Heavy"
 * row has had.
 *
 * Environment:
 *   NOTION_API_KEY             (required)
 *   UNIFIED_DB_ID / NOTION_DB_ID  (optional; falls back to the committed id)
 *   AZURE_OPENAPI_ENDPOINT     (required) e.g. https://<res>.openai.azure.com
 *   AZURE_OPENAPI_KEY          (required)
 *   AZURE_OPENAPI_DEPLOYMENT   (default "gpt-5.4" — MODEL_REGISTRY's azure-gpt5)
 *   AZURE_OPENAPI_API_VERSION  (default "2025-01-01-preview")
 *
 * Usage:
 *   node --env-file=.env newsletter/pipeline/backfill-en.mjs [options]
 *
 *   --limit N        stop after N successful translations (default: no limit)
 *   --page-id <id>   translate exactly this Notion page (repair mode)
 *   --slug <slug>    translate the row whose exported slug matches
 *   --force          re-translate even when an EN child page already exists
 *                    (the old edition is archived, not appended to)
 *   --dry-run        do everything except the Notion write; print a preview
 *   --save-failures <dir>  where rejected translations are kept for inspection
 *                    (default: .backfill-en-failures/ at the repo root)
 *
 *   AZURE_TIMEOUT_MS overrides the 300000ms per-request timeout.
 *
 * Exit codes:
 *   0  every row processed cleanly (including "nothing to do")
 *   1  at least one row failed a W-1 guard or a translation call
 *   2  bad configuration (missing env / unknown target)
 */

// R-14. Keep this even though the fetch() calls now live one module away in
// http-retry.mjs: the bootstrap re-execs the *process*, so it only works from
// the entry point, and this file is it. Removing it because "this file doesn't
// call fetch" is precisely the ML-017 failure — every request would silently
// bypass the agent proxy and come back as "Host not in allowlist".
import { ensureProxyAwareEntry } from '../../scripts/lib/proxy-bootstrap.mjs'
ensureProxyAwareEntry(import.meta.url)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  isEnChildPageTitle,
  parseEnMarkdown,
  writeEnChildPage,
} from '../../scripts/lib/notion-i18n.mjs'
import { describeError, fetchWithRetry } from '../../scripts/lib/http-retry.mjs'
import { isTruncatedMarkdown } from '../../scripts/lib/truncation.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..', '..')

// Load .env in local dev, matching fetch-notion.mjs.
const envPath = join(ROOT, '.env')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim()
  }
}

const NOTION_API = 'https://api.notion.com/v1'
const NOTION_VERSION = '2022-06-28'
const NOTION_THROTTLE_MS = 350 // ~3 req/sec, Notion's documented ceiling
const MAX_RETRIES = 4

// W-1 floor. Deliberately the LOWER of the two cadence floors (L2's 200): this
// script processes both explanations and analyses, and a floor tuned for the
// longer form would reject legitimate short explanations.
const MIN_BODY_CHARS = 200
const ARTEFACT_PRELUDE =
  /^\s*(as an ai|here is|here's|i apologize|i'm sorry|certainly!|sure,|of course)/i

// Heavy bracket — see the header note and newsletter/docs/azure-budget-rules.md.
const MAX_COMPLETION_TOKENS = 16000

// A long article is a long request. Retries here matter more than on the Notion
// side, not less (ML-021).
const AZURE_MAX_RETRIES = 3
const AZURE_TIMEOUT_MS = Number(process.env.AZURE_TIMEOUT_MS) || 300_000

// Where a rejected translation is written so the operator can read what the
// model actually produced. A W-1 rejection that discards its own evidence makes
// a reproducible failure undiagnosable — which is how the first backfill run
// produced 9 identical, uninvestigable "looks cut off" errors (ML-021).
const DEFAULT_FAILURE_DIR = '.backfill-en-failures'

function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined
}
function flag(name) {
  return process.argv.includes(`--${name}`)
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const NOTION_API_KEY = process.env.NOTION_API_KEY
const UNIFIED_DB_ID =
  process.env.UNIFIED_DB_ID || process.env.NOTION_DB_ID || '34fd0f0b-e61e-817a-9f6b-dc65b0d5b4cc'
const AZURE_ENDPOINT = (process.env.AZURE_OPENAPI_ENDPOINT || '').replace(/\/$/, '')
const AZURE_KEY = process.env.AZURE_OPENAPI_KEY
const AZURE_DEPLOYMENT = process.env.AZURE_OPENAPI_DEPLOYMENT || 'gpt-5.4'
const AZURE_API_VERSION = process.env.AZURE_OPENAPI_API_VERSION || '2025-01-01-preview'

const dryRun = flag('dry-run')
const force = flag('force')
const onlyPageId = arg('page-id')
const onlySlug = arg('slug')
const limit = arg('limit') ? Number(arg('limit')) : Infinity
const failureDir = arg('save-failures') || join(ROOT, DEFAULT_FAILURE_DIR)

if (!NOTION_API_KEY) {
  console.error('❌  NOTION_API_KEY is not set.')
  process.exit(2)
}
if (!AZURE_ENDPOINT || !AZURE_KEY) {
  console.error('❌  AZURE_OPENAPI_ENDPOINT and AZURE_OPENAPI_KEY are required.')
  console.error('    --dry-run needs them too: it translates and prints, it only skips the Notion write.')
  process.exit(2)
}
if (!Number.isFinite(limit) && arg('limit')) {
  console.error(`❌  --limit must be a number (got "${arg('limit')}")`)
  process.exit(2)
}

// ── Notion ────────────────────────────────────────────────────────────────

/** One Notion request, throttled, with 429/5xx retry. */
async function notionFetch(method, path, payload) {
  await sleep(NOTION_THROTTLE_MS)
  const res = await fetchWithRetry({
    url: `${NOTION_API}${path}`,
    label: `Notion ${method} ${path}`,
    maxRetries: MAX_RETRIES,
    baseMs: 1000,
    init: {
      method,
      headers: {
        authorization: `Bearer ${NOTION_API_KEY}`,
        'notion-version': NOTION_VERSION,
        'content-type': 'application/json',
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    },
    logger: msg => console.log(`⏳  ${msg}`),
  })
  return res.json()
}

async function fetchAllBlocks(blockId) {
  const blocks = []
  let cursor
  do {
    const params = cursor ? `?start_cursor=${cursor}` : ''
    const data = await notionFetch('GET', `/blocks/${blockId}/children${params}`)
    blocks.push(...data.results)
    cursor = data.has_more ? data.next_cursor : undefined
  } while (cursor)
  return blocks
}

/**
 * Notion rich_text → Markdown, preserving bold/italic/code/links.
 *
 * Same mapping as the fetcher's `richTextToMd`. Plain text would be simpler,
 * but it silently strips every inline link out of the article before the model
 * ever sees it — and the English edition would then be the only one missing its
 * citations.
 */
function plain(richText) {
  return (richText ?? [])
    .map(t => {
      let text = t.plain_text
      if (!text) return ''
      if (t.annotations?.code) text = `\`${text}\``
      if (t.annotations?.bold) text = `**${text}**`
      if (t.annotations?.italic) text = `*${text}*`
      if (t.annotations?.strikethrough) text = `~~${text}~~`
      if (t.href) text = `[${text}](${t.href})`
      return text
    })
    .join('')
}

/**
 * Blocks → Markdown, restricted to the shapes the article corpus uses. This is
 * a local, prompt-facing renderer rather than a reuse of the fetcher's
 * `blocksToMd` because that one is not exported and pulls the whole fetcher
 * module (and its options plumbing) in with it.
 */
function blocksToMarkdown(blocks) {
  const lines = []
  for (const block of blocks) {
    const b = block[block.type]
    switch (block.type) {
      case 'heading_1': lines.push(`# ${plain(b.rich_text)}\n`); break
      case 'heading_2': lines.push(`## ${plain(b.rich_text)}\n`); break
      case 'heading_3': lines.push(`### ${plain(b.rich_text)}\n`); break
      case 'bulleted_list_item': lines.push(`- ${plain(b.rich_text)}`); break
      case 'numbered_list_item': lines.push(`1. ${plain(b.rich_text)}`); break
      case 'quote':
      case 'callout': lines.push(`> ${plain(b.rich_text)}\n`); break
      case 'code': lines.push(`\`\`\`\n${plain(b.rich_text)}\n\`\`\`\n`); break
      case 'divider': lines.push('---\n'); break
      case 'paragraph': {
        const text = plain(b.rich_text)
        lines.push(text ? `${text}\n` : '')
        break
      }
      default: break // child_page (the EN edition), images, tables — not prose
    }
  }
  return lines.join('\n').trim()
}

function propText(prop) {
  if (!prop) return ''
  switch (prop.type) {
    case 'title': return (prop.title ?? []).map(t => t.plain_text).join('')
    case 'rich_text': return (prop.rich_text ?? []).map(t => t.plain_text).join('')
    default: return ''
  }
}

/** Same slug rule as the fetcher, so `--slug` matches what is on the site. */
function slugOf(page) {
  return propText(page.properties?.LegacySlug) || page.id.replace(/-/g, '').slice(-12)
}

async function queryAllRows() {
  const rows = []
  let cursor
  do {
    const body = { page_size: 100 }
    if (cursor) body.start_cursor = cursor
    const data = await notionFetch('POST', `/databases/${UNIFIED_DB_ID}/query`, body)
    rows.push(...data.results)
    cursor = data.has_more ? data.next_cursor : undefined
  } while (cursor)
  return rows
}

// ── Translation ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = [
  'You produce the English edition of a Japanese article for a technology',
  'publication about AI, software development, and the future of work.',
  '',
  'This is an edition, not a gloss. Write as an English-language publication',
  'would: natural English prose and sentence order, not transliterated Japanese.',
  '',
  'Absolute rules:',
  '- Reproduce the article in full. Same structure, same section order, same',
  '  headings, same bullet lists. Do not summarise, condense, or omit anything.',
  '- Every number, proper noun, date, company, and quotation must survive exactly.',
  '  Do not round figures or normalise units. Where a quotation was originally in',
  '  English, restore the original English wording if you can infer it verbatim;',
  '  otherwise translate it faithfully and keep the quotation marks.',
  '- Do not add commentary, translator notes, or a preamble. Do not add a byline',
  '  or disclosure footer.',
  '- Japanese terms with no clean English equivalent: keep the term and add a',
  '  short parenthetical gloss on first use.',
  '',
  'Output format — exactly this, and nothing else:',
  '  Line 1: `# ` followed by the English title.',
  '  Line 2 (after a blank line): `> ` followed by the English lead, 2-3',
  '  sentences, one line.',
  '  Then a blank line, then the full English body in Markdown.',
].join('\n')

/**
 * One Azure chat completion, with retry/backoff and an explicit timeout.
 *
 * The Notion side of this script had retries from the start; the Azure side had
 * none, so a single transport blip killed the article outright. A long article
 * is a long request, which is precisely when a socket is most likely to be
 * reset — so the calls that needed retry most had it least (ML-021).
 */
async function azureChat(payload) {
  const res = await fetchWithRetry({
    url:
      `${AZURE_ENDPOINT}/openai/deployments/${AZURE_DEPLOYMENT}/chat/completions` +
      `?api-version=${AZURE_API_VERSION}`,
    label: 'Azure',
    maxRetries: AZURE_MAX_RETRIES,
    // Without a timeout a hung socket blocks the whole batch indefinitely.
    timeoutMs: AZURE_TIMEOUT_MS,
    init: {
      method: 'POST',
      headers: { 'api-key': AZURE_KEY, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    },
    logger: msg => console.log(`\n     ⏳ ${msg}`),
  })
  return res.json()
}

/**
 * Translate one article. Throws on any failure — the caller counts it and
 * moves to the next row, so one bad article never stalls the batch.
 */
async function translate({ title, abstract, body }) {
  const userPrompt = [
    `# ${title}`,
    abstract ? `\n> ${abstract}` : '',
    '',
    body,
  ].join('\n')

  const data = await azureChat({
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    // Heavy bracket. `temperature` is deliberately omitted — gpt-5.4 rejects
    // any non-default value with HTTP 400 (azure-budget-rules.md).
    max_completion_tokens: MAX_COMPLETION_TOKENS,
  })

  const choice = data.choices?.[0]
  // Fail loud on a budget overrun rather than publishing the cut-off half.
  if (choice?.finish_reason === 'length') {
    const err = new Error(
      `hit max_completion_tokens (${MAX_COMPLETION_TOKENS}) — the translation is cut off. ` +
        'Raise the bracket or split the article; do not publish this.',
    )
    err.fatal = true
    throw err
  }
  const content = choice?.message?.content ?? ''
  if (!content.trim()) throw new Error('model returned an empty completion')
  return { ...parseEnMarkdown(content), finishReason: choice?.finish_reason ?? '', raw: content }
}

/**
 * The same W-1 guards the cadences apply, on the translated body.
 *
 * Messages carry the FULL offending line, not the 60-char `lastNonEmptyLine`
 * preview. That preview is right for a findings table listing many articles; it
 * is wrong here, where the whole question is what the last line actually ends
 * with — a preview that elides the final characters hides the one fact needed to
 * tell a real cut-off from a false positive (ML-021).
 */
function assertPublishable(en, label) {
  if (!en.title) throw new Error(`${label}: translation has no \`# Title\` heading (W-1)`)
  const body = en.body.trim()
  if (body.length < MIN_BODY_CHARS) {
    throw new Error(`${label}: translated body is ${body.length} chars (< ${MIN_BODY_CHARS}) (W-1)`)
  }
  if (ARTEFACT_PRELUDE.test(body.slice(0, 50))) {
    throw new Error(`${label}: translated body opens with an LLM-failure prelude (W-1)`)
  }
  if (isTruncatedMarkdown(body)) {
    const lines = body.split('\n').filter(l => l.trim())
    throw new Error(
      `${label}: translated body looks cut off (W-1)\n` +
        `       finish_reason: ${en.finishReason || 'unknown'}\n` +
        `       last line in full: ${lines[lines.length - 1]}`,
    )
  }
}

/** Persist a rejected translation so the operator can read it. Best-effort. */
function saveFailure(slug, en) {
  if (!en?.raw) return ''
  try {
    mkdirSync(failureDir, { recursive: true })
    const path = join(failureDir, `${slug}.en.md`)
    writeFileSync(path, en.raw)
    return path
  } catch {
    return ''
  }
}

// ── Main ──────────────────────────────────────────────────────────────────

console.log(`🌐  EN backfill — db ${UNIFIED_DB_ID}${dryRun ? ' (dry run)' : ''}`)

let rows
if (onlyPageId) {
  rows = [await notionFetch('GET', `/pages/${onlyPageId}`)]
} else {
  rows = await queryAllRows()
  if (onlySlug) rows = rows.filter(r => slugOf(r) === onlySlug)
  if (rows.length === 0) {
    console.error(`❌  no row matched ${onlySlug ? `--slug ${onlySlug}` : 'the query'}`)
    process.exit(2)
  }
}
console.log(`    ${rows.length} row(s) to consider`)

let translated = 0
let skipped = 0
const failures = []

for (const page of rows) {
  if (translated >= limit) {
    console.log(`\n⏹  --limit ${limit} reached; ${rows.length - translated - skipped} row(s) left for the next run.`)
    break
  }

  const title = propText(page.properties?.Title) || propText(page.properties?.Name)
  const label = `${slugOf(page)} "${title}"`
  let lastTranslation = null

  try {
    const topBlocks = await fetchAllBlocks(page.id)
    const existingEn = topBlocks.find(
      b => b.type === 'child_page' && isEnChildPageTitle(b.child_page?.title),
    )
    if (existingEn && !force) {
      skipped += 1
      continue
    }

    const body = blocksToMarkdown(topBlocks)
    if (!body || body.length < MIN_BODY_CHARS) {
      // An empty Japanese row is a pre-existing corpus problem, not a
      // translation problem — the writer already skips it. Say so and move on.
      console.log(`  ⚠  ${label} — Japanese body is empty/too short (${body.length} chars); nothing to translate`)
      skipped += 1
      continue
    }

    const abstract = propText(page.properties?.Abstract) || propText(page.properties?.['Contents Summary'])
    process.stdout.write(`  ↻  ${label} … `)
    const en = await translate({ title, abstract, body })
    lastTranslation = en
    assertPublishable(en, label)

    if (dryRun) {
      console.log(`ok (dry run)\n       → "${en.title}"\n       → ${en.body.length} chars`)
      translated += 1
      continue
    }

    const written = await writeEnChildPage({
      parentPageId: page.id,
      existingEnPageId: existingEn?.id,
      en,
      notionFetch,
    })
    console.log(`ok → "${en.title}" (${written.blocks} blocks)`)
    translated += 1
  } catch (err) {
    console.log('FAILED')
    const message = describeError(err)
    const saved = saveFailure(slugOf(page), lastTranslation)
    console.error(`  ✗  ${label}: ${message}`)
    if (saved) console.error(`       rejected translation saved to ${saved}`)
    failures.push({ label, message, saved })
  }
}

console.log(
  `\n${failures.length === 0 ? '✅' : '⚠'}  ${translated} translated, ${skipped} already had one (or had nothing to translate), ${failures.length} failed.`,
)

if (failures.length > 0) {
  console.error('\nFailed rows — re-run to retry just these:')
  for (const f of failures) {
    console.error(`  ✗ ${f.label}: ${f.message}`)
    if (f.saved) console.error(`     evidence: ${f.saved}`)
  }
  // C-4: a batch that degraded must not exit 0.
  process.exit(1)
}
