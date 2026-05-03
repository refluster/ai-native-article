#!/usr/bin/env node
// gas-deploy-verify: deploy gas/src/Code.gs via clasp, then assert the new
// version is actually serving by polling GET /exec for the expected
// supportedActions. Closes the "did v49 actually go live?" gap.

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..')
const GAS_CONFIG_PATH = resolve(REPO_ROOT, 'src', 'lib', 'gas-config.ts')
const POLL_BUDGET_MS = 90 * 1000
const POLL_INTERVAL_MS = 3 * 1000

function parseArgs (argv) {
  const args = { expect: [], probeOnly: false }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--probe-only') args.probeOnly = true
    else if (a === '--expect') {
      args.expect = (argv[++i] || '').split(',').map(s => s.trim()).filter(Boolean)
    } else if (a.startsWith('--expect=')) {
      args.expect = a.slice('--expect='.length).split(',').map(s => s.trim()).filter(Boolean)
    } else if (a === '-h' || a === '--help') {
      console.log('Usage: gas-deploy-verify [--probe-only] [--expect ACTION1,ACTION2,...]')
      process.exit(0)
    }
  }
  return args
}

function loadGasUrl () {
  const txt = readFileSync(GAS_CONFIG_PATH, 'utf8')
  const m = txt.match(/const\s+id\s*=\s*['"]([^'"]+)['"]/)
  if (!m) throw new Error(`Could not parse deployment id from ${GAS_CONFIG_PATH}`)
  return `https://script.google.com/macros/s/${m[1]}/exec`
}

function runDeploy () {
  // npm run deploy-gas chains check-gas → clasp push --force → clasp deploy -i <id>.
  // Re-using it (rather than calling clasp directly) keeps a single source of
  // truth for what "deploy" means.
  const r = spawnSync('npm', ['run', 'deploy-gas'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  })
  if (r.status !== 0) {
    console.error(`npm run deploy-gas failed (exit ${r.status})`)
    process.exit(2)
  }
}

async function probeOnce (url) {
  try {
    const r = await fetch(url, { redirect: 'follow' })
    const txt = await r.text()
    if (r.status !== 200) return { ok: false, reason: `HTTP ${r.status}`, body: txt.slice(0, 200) }
    if (!txt.trim().startsWith('{')) return { ok: false, reason: 'non-JSON', body: txt.slice(0, 200) }
    return { ok: true, body: JSON.parse(txt) }
  } catch (e) {
    return { ok: false, reason: e.name, body: e.message }
  }
}

async function pollForActions (url, expect) {
  const deadline = Date.now() + POLL_BUDGET_MS
  let lastReason = ''
  while (Date.now() < deadline) {
    const r = await probeOnce(url)
    if (r.ok) {
      const supported = (r.body && r.body.supportedActions) || []
      const missing = expect.filter(a => !supported.includes(a))
      if (missing.length === 0) return { ok: true, supported }
      lastReason = `missing actions: ${missing.join(', ')}`
    } else {
      lastReason = `${r.reason}: ${r.body}`
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
  }
  return { ok: false, reason: lastReason }
}

async function main () {
  const args = parseArgs(process.argv)
  if (!args.probeOnly) runDeploy()

  const url = loadGasUrl()
  console.log()
  console.log(`Probing ${url} (expect=${args.expect.length ? args.expect.join(',') : '<JSON>'}, budget=${POLL_BUDGET_MS / 1000}s)`)

  // Without --expect, we just need a single successful JSON probe.
  if (args.expect.length === 0) {
    const r = await probeOnce(url)
    if (!r.ok) {
      console.error(`✗ /exec is not serving JSON: ${r.reason}`)
      console.error(r.body)
      process.exit(3)
    }
    console.log(`✓ /exec is serving (supportedActions: ${(r.body.supportedActions || []).length})`)
    process.exit(0)
  }

  const r = await pollForActions(url, args.expect)
  if (r.ok) {
    console.log(`✓ all expected actions present (${args.expect.join(', ')})`)
    process.exit(0)
  }
  console.error(`✗ probe budget elapsed: ${r.reason}`)
  process.exit(1)
}

main().catch(e => { console.error(e.stack || e.message); process.exit(11) })
