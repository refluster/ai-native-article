#!/usr/bin/env node
// R-11 — L1 citation gate.
//
// Imported from asp-cloud's R-15 "ADR-presence check": when a PR's diff touches
// an L1-binding document (a framework law in governance.md §3.1, or governance
// /design-policy themselves), the PR body must either CITE the L1 doc it
// honours/amends, or carry an explicit opt-out `RULE-N/A: <reason>`. If neither
// is present the check fails, so an L1 change can never slip in unannounced.
//
// Why this matters here: the L2 truncation bug (d17e1d58ec42) existed because
// the azure-budget bracket rule was undocumented. L1 docs are now the contract;
// editing one silently is how that class of bug returns. This is the cheap,
// mechanical "you touched the law — say which law and why" gate.
//
// Runs only on pull_request events (needs a PR body + base ref). On
// workflow_dispatch / push it is a no-op.
//
// Env:
//   PR_BODY   — github.event.pull_request.body
//   BASE_REF  — github.event.pull_request.base.ref  (e.g. "main")
//
// Exit codes:
//   0  no L1 docs touched, OR L1 docs touched and a citation/RULE-N/A present
//   1  L1 docs touched with neither a citation nor RULE-N/A
//   3  could not determine the diff (git error) — fail loud (C-4)

import { execSync } from 'node:child_process'

// The L1 statute book (governance.md §3.1) + the two governance-axis docs.
// Basenames are used both for diff-matching and for citation-detection.
const L1_DOCS = [
  'newsletter/docs/architecture-source-of-truth.md',
  'newsletter/docs/azure-budget-rules.md',
  'newsletter/docs/L1-L4-PIPELINE.md',
  'newsletter/docs/DESIGN.md',
  'newsletter/docs/GROWTH.md',
  'docs/governance.md',
  'docs/design-policy.md',
  'workforce/docs/governance.md',
]
const L1_BASENAMES = L1_DOCS.map(p => p.split('/').pop())

const body = process.env.PR_BODY || ''
const baseRef = process.env.BASE_REF || 'main'

function changedFiles () {
  try {
    // origin/<base>...HEAD = changes on this branch since it diverged from base.
    const out = execSync(`git diff --name-only origin/${baseRef}...HEAD`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return out.split('\n').map(s => s.trim()).filter(Boolean)
  } catch (e) {
    console.error(`✗ could not compute diff against origin/${baseRef}: ${e.message}`)
    console.error('  Ensure the workflow fetched the base ref before running this gate.')
    process.exit(3)
  }
}

function main () {
  const changed = changedFiles()
  const touchedL1 = changed.filter(f => L1_DOCS.includes(f))

  if (touchedL1.length === 0) {
    console.log('✅ No L1 documents touched — citation gate not applicable.')
    process.exit(0)
  }

  console.log('L1 documents touched by this PR:')
  for (const f of touchedL1) console.log(`  • ${f}`)

  // Accept either an explicit opt-out, or a citation that names an L1 doc.
  const hasOptOut = /RULE-N\/A:\s*\S+/i.test(body)
  const citesL1 = L1_BASENAMES.some(b => body.includes(b))

  if (hasOptOut) {
    console.log('\n✅ PR body carries `RULE-N/A: …` opt-out.')
    process.exit(0)
  }
  if (citesL1) {
    console.log('\n✅ PR body cites an L1 document.')
    process.exit(0)
  }

  console.error('\n❌ L1 document touched, but PR body neither cites an L1 doc nor opts out.')
  console.error('   Add ONE of the following to the PR description:')
  console.error('   • a reference to the L1 doc being changed/honoured, e.g. "amends docs/azure-budget-rules.md", or')
  console.error('   • an explicit opt-out line: `RULE-N/A: <reason this edit is not an L1 rule change>`')
  console.error('\n   This mirrors asp-cloud R-15 (ADR-presence). See docs/governance.md §4.')
  process.exit(1)
}

main()
