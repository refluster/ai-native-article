#!/usr/bin/env node
// gas-call: POST a JSON action to the project's deployed GAS web app and
// pretty-print the response. Encapsulates the workaround for the GAS POST
// redirect that breaks plain curl (script.google.com → script.googleusercontent.com
// returns 405 on POST). Node fetch with redirect:'follow' preserves method+body.
//
// Usage:
//   node .claude/skills/gas-call/scripts/gas-call.mjs                   # GET /exec (lists supported actions)
//   node .claude/skills/gas-call/scripts/gas-call.mjs <ACTION>          # POST {action}
//   node .claude/skills/gas-call/scripts/gas-call.mjs <ACTION> '<json>' # POST {action, ...json}

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..')
const GAS_CONFIG_PATH = resolve(REPO_ROOT, 'src', 'lib', 'gas-config.ts')
// 6 minutes — GAS's own maxExecutionTime upper bound, so we never give up
// before the server does.
const TIMEOUT_MS = 6 * 60 * 1000

function loadDeploymentId () {
  // Single-line `const id = '...'` in src/lib/gas-config.ts. Re-deriving keeps
  // the React app and this skill aligned automatically.
  const txt = readFileSync(GAS_CONFIG_PATH, 'utf8')
  const m = txt.match(/const\s+id\s*=\s*['"]([^'"]+)['"]/)
  if (!m) throw new Error(`Could not parse deployment id from ${GAS_CONFIG_PATH}`)
  return m[1]
}

function parseArgs (argv) {
  const [, , action, payloadJson] = argv
  if (!action) return { action: null, payload: {} }
  let payload = {}
  if (payloadJson) {
    try { payload = JSON.parse(payloadJson) }
    catch (e) {
      console.error(`Invalid JSON payload: ${e.message}`)
      process.exit(2)
    }
  }
  return { action, payload }
}

async function main () {
  const id = loadDeploymentId()
  const url = `https://script.google.com/macros/s/${id}/exec`
  const { action, payload } = parseArgs(process.argv)

  const init = {
    method: action ? 'POST' : 'GET',
    redirect: 'follow',
  }
  if (action) {
    init.headers = { 'Content-Type': 'application/json' }
    init.body = JSON.stringify({ action, ...payload })
  }

  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  init.signal = ctl.signal

  const t0 = Date.now()
  let res
  try {
    res = await fetch(url, init)
  } catch (e) {
    console.error(`fetch failed: ${e.name} ${e.message}`)
    process.exit(1)
  } finally {
    clearTimeout(timer)
  }

  const text = await res.text()
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)

  // Non-200 or HTML response = failure (often the 405 redirect-trap or a
  // GAS exception page). Print enough to triage.
  if (res.status !== 200) {
    console.error(`HTTP ${res.status} after ${elapsed}s`)
    console.error(text.slice(0, 1000))
    process.exit(1)
  }
  if (!text.trim().startsWith('{') && !text.trim().startsWith('[')) {
    console.error(`Non-JSON response after ${elapsed}s (likely auth / deploy issue):`)
    console.error(text.slice(0, 1000))
    process.exit(1)
  }

  let parsed
  try { parsed = JSON.parse(text) }
  catch {
    console.log(text)
    return
  }
  console.log(JSON.stringify(parsed, null, 2))
  console.error(`(${elapsed}s)`)
  // Surface application-level failures with a non-zero exit so callers can
  // chain commands safely.
  if (parsed && parsed.success === false) process.exit(1)
}

main().catch(e => { console.error(e.stack || e.message); process.exit(1) })
