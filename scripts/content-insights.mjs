#!/usr/bin/env node
// Weekly content-insights loop — the Software 2.0 feedback loop for the article
// side (design-policy.md D-2). Closes the gap noted there: GA4 is wired on the
// client, but the data never came back to drive the editorial roadmap.
// Decision record: docs/adr/adr-0001-self-driving-governance-mechanisms.md.
//
// Flow:
//   GA4 Data API (last 7d page views + engagement)
//     → join with the published manifest on gh-pages (slug → title/type)
//       → derive insights (low-engagement published articles, top performers)
//         → upsert ONE GitHub issue labelled `insights` (idempotent: find the
//            open insights issue and update it, else create)
//
// Credential boundary (a §8.1 B operator action, recorded as RAL-002):
//   GA4_PROPERTY_ID  — numeric GA4 property id
//   GA4_SA_KEY       — service-account JSON (with Analytics Data API access)
// When these are absent the loop is INERT BY DESIGN: it prints what is missing
// and exits 0. It is advisory, so a missing credential is fail-soft, not
// fail-loud (contrast C-4, which governs the publishing path). When the
// credential IS present but the API errors, that is a real failure and exits 1.
//
// Env (provided by the workflow):
//   GITHUB_TOKEN, GITHUB_REPOSITORY  — to upsert the issue
//   GA4_PROPERTY_ID, GA4_SA_KEY      — optional; see above
//   DRY_RUN=1                        — compute + print, never write the issue

import "./lib/proxy-bootstrap.mjs";

import { createSign } from 'node:crypto'

const REPO = process.env.GITHUB_REPOSITORY || 'refluster/ai-native-article'
const PAGES_BRANCH = 'gh-pages'
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/${PAGES_BRANCH}/posts`
const ISSUE_LABEL = 'insights'
const LOW_ENGAGEMENT_VIEWS = 5 // published article with < this many 7d views = adoption gap
const DRY_RUN = process.env.DRY_RUN === '1'

// ---- GA4 access (service-account JWT → access token → runReport) ----------

async function mintAccessToken (saKey) {
  const sa = typeof saKey === 'string' ? JSON.parse(saKey) : saKey
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/analytics.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }
  const b64 = obj => Buffer.from(JSON.stringify(obj)).toString('base64url')
  const unsigned = `${b64(header)}.${b64(claim)}`
  const signature = createSign('RSA-SHA256').update(unsigned).sign(sa.private_key, 'base64url')
  const jwt = `${unsigned}.${signature}`

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })
  if (!res.ok) throw new Error(`token exchange failed: ${res.status} ${await res.text()}`)
  return (await res.json()).access_token
}

async function runReport (token, propertyId) {
  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
        dimensions: [{ name: 'pagePath' }],
        metrics: [{ name: 'screenPageViews' }, { name: 'averageSessionDuration' }],
        limit: 500,
      }),
    },
  )
  if (!res.ok) throw new Error(`runReport failed: ${res.status} ${await res.text()}`)
  const json = await res.json()
  const rows = json.rows || []
  // pagePath like /article/<slug> or /l2/<slug>; key by trailing slug segment.
  const bySlug = new Map()
  for (const r of rows) {
    const path = r.dimensionValues[0].value
    const views = Number(r.metricValues[0].value || 0)
    const dur = Number(r.metricValues[1].value || 0)
    const slug = path.replace(/\/+$/, '').split('/').pop()
    if (!slug) continue
    const prev = bySlug.get(slug) || { views: 0, dur: 0 }
    bySlug.set(slug, { views: prev.views + views, dur: Math.max(prev.dur, dur) })
  }
  return bySlug
}

// ---- gh-pages manifest -----------------------------------------------------

async function fetchManifest () {
  const r = await fetch(`${RAW_BASE}/manifest.json`, { redirect: 'follow' })
  if (!r.ok) throw new Error(`manifest fetch failed: HTTP ${r.status}`)
  return r.json()
}

// ---- insight derivation ----------------------------------------------------

function deriveInsights (manifest, bySlug) {
  const joined = manifest.map(m => {
    const a = bySlug.get(m.slug) || { views: 0, dur: 0 }
    return { slug: m.slug, title: m.title || m.slug, type: m.type || 'unknown', views: a.views, dur: a.dur }
  })
  const top = [...joined].sort((a, b) => b.views - a.views).slice(0, 5)
  const adoptionGap = joined
    .filter(a => a.views < LOW_ENGAGEMENT_VIEWS)
    .sort((a, b) => a.views - b.views)
  return { total: joined.length, top, adoptionGap }
}

function renderIssueBody (insights, generatedAt) {
  const lines = []
  lines.push(`_Auto-generated by \`scripts/content-insights.mjs\` — ${generatedAt}._`)
  lines.push('')
  lines.push('This is the article-side Software 2.0 loop (see docs/governance-mechanisms.md).')
  lines.push('GA4 7-day engagement joined to the published manifest. Triage, then act or close.')
  lines.push('')
  lines.push(`**Corpus:** ${insights.total} published articles.`)
  lines.push('')
  lines.push('### Top performers (7d page views)')
  lines.push('| slug | type | views | avg session (s) |')
  lines.push('|---|---|---|---|')
  for (const a of insights.top) lines.push(`| ${a.slug} | ${a.type} | ${a.views} | ${a.dur.toFixed(0)} |`)
  lines.push('')
  lines.push(`### Adoption gaps (< ${LOW_ENGAGEMENT_VIEWS} views in 7d) — ${insights.adoptionGap.length}`)
  if (insights.adoptionGap.length === 0) {
    lines.push('_None — every published article cleared the threshold._')
  } else {
    lines.push('Candidates for an editorial pass, a better title, or cross-linking:')
    lines.push('| slug | type | views |')
    lines.push('|---|---|---|')
    for (const a of insights.adoptionGap.slice(0, 20)) lines.push(`| ${a.slug} | ${a.type} | ${a.views} |`)
    if (insights.adoptionGap.length > 20) lines.push(`| …and ${insights.adoptionGap.length - 20} more | | |`)
  }
  lines.push('')
  lines.push('---')
  lines.push('Actionable insight: pick one adoption-gap article, decide title/cross-link/leave-be, and note the decision.')
  return lines.join('\n')
}

// ---- GitHub issue upsert ---------------------------------------------------

const gh = (method, path, token, body) =>
  fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'ai-native-article-content-insights',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })

async function upsertIssue (token, title, body) {
  const [owner, repo] = REPO.split('/')
  const labels = [ISSUE_LABEL, 'project:article', 'area:content', 'type:ops']
  const list = await gh('GET', `/repos/${owner}/${repo}/issues?state=open&labels=${ISSUE_LABEL}&per_page=1`, token)
  if (!list.ok) throw new Error(`list issues failed: ${list.status} ${await list.text()}`)
  const existing = (await list.json())[0]

  if (existing) {
    const upd = await gh('PATCH', `/repos/${owner}/${repo}/issues/${existing.number}`, token, { title, body })
    if (!upd.ok) throw new Error(`update issue failed: ${upd.status} ${await upd.text()}`)
    console.log(`Updated existing insights issue #${existing.number}`)
    return existing.number
  }
  const cre = await gh('POST', `/repos/${owner}/${repo}/issues`, token, { title, body, labels })
  if (!cre.ok) throw new Error(`create issue failed: ${cre.status} ${await cre.text()}`)
  const num = (await cre.json()).number
  console.log(`Created insights issue #${num}`)
  return num
}

// ---- main ------------------------------------------------------------------

async function main () {
  const propertyId = process.env.GA4_PROPERTY_ID
  const saKey = process.env.GA4_SA_KEY
  if (!propertyId || !saKey) {
    console.log('GA4 credentials not configured (GA4_PROPERTY_ID / GA4_SA_KEY absent).')
    console.log('The content-insights loop is wired but inert — see docs/risk-acceptance-ledger.md RAL-002.')
    console.log('This is fail-soft by design (the loop is advisory). Exiting 0.')
    process.exit(0)
  }

  const generatedAt = new Date().toISOString()
  const token = await mintAccessToken(saKey)
  const bySlug = await runReport(token, propertyId)
  const manifest = await fetchManifest()
  const insights = deriveInsights(manifest, bySlug)
  const body = renderIssueBody(insights, generatedAt)
  const title = `Weekly content insights — ${generatedAt.slice(0, 10)}`

  console.log(`Corpus ${insights.total}, top ${insights.top.length}, adoption gaps ${insights.adoptionGap.length}`)

  if (DRY_RUN) {
    console.log('\n--- DRY_RUN: issue body ---\n')
    console.log(body)
    process.exit(0)
  }

  const ghToken = process.env.GITHUB_TOKEN
  if (!ghToken) throw new Error('GITHUB_TOKEN absent — cannot upsert the insights issue.')
  await upsertIssue(ghToken, title, body)
  process.exit(0)
}

main().catch(e => {
  // Credentials were present, so a failure here is real — fail loud.
  console.error(`content-insights error: ${e.stack || e.message}`)
  process.exit(1)
})
