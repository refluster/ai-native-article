#!/usr/bin/env node
// L3: Reconcile GitHub label set against .github/labels.json.
// See docs/issue-labeling.md for taxonomy and the colour palette.
//
// Usage:
//   GH_TOKEN=ghp_... node scripts/sync-labels.mjs [--dry-run]
//
// Behaviour:
//   - Renames labels per the "aliases" section (e.g. legacy `tracker` →
//     `type:tracker`) so existing issues retain the label across the rename.
//   - Creates labels present in labels.json but missing on GitHub.
//   - Updates colour + description on labels present in both, UNLESS the
//     labels.json entry sets "preserve": true.
//   - Never deletes. Orphans are reported in stdout for the operator to
//     decide on. (Guard against nuking ad-hoc labels.)

import { ensureProxyAwareEntry } from "./lib/proxy-bootstrap.mjs";
ensureProxyAwareEntry(import.meta.url);

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_OWNER = 'refluster';
const REPO_NAME  = 'ai-native-article';
const LABELS_FILE = resolve(__dirname, '..', '.github', 'labels.json');

const dryRun = process.argv.includes('--dry-run');
const token  = process.env.GH_TOKEN;
if (!token) {
  console.error('GH_TOKEN env var is required (repo-scoped PAT with `repo` scope).');
  process.exit(1);
}

const ghHeaders = {
  'Accept': 'application/vnd.github+json',
  'Authorization': `Bearer ${token}`,
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'ai-native-article-label-sync',
};

async function gh(method, path, body) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: { ...ghHeaders, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${path} → ${res.status} ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function listAllLabels() {
  const labels = [];
  let page = 1;
  while (true) {
    const batch = await gh('GET', `/repos/${REPO_OWNER}/${REPO_NAME}/labels?per_page=100&page=${page}`);
    labels.push(...batch);
    if (batch.length < 100) break;
    page += 1;
  }
  return labels;
}

function loadConfig() {
  const raw = JSON.parse(readFileSync(LABELS_FILE, 'utf8'));
  if (!Array.isArray(raw.labels)) throw new Error(`${LABELS_FILE}: missing "labels" array`);
  return { labels: raw.labels, aliases: Array.isArray(raw.aliases) ? raw.aliases : [] };
}

function needsUpdate(remote, desired) {
  if (desired.preserve) return false;
  return remote.color !== desired.color || (remote.description ?? '') !== (desired.description ?? '');
}

async function main() {
  const { labels: desired, aliases } = loadConfig();
  const remote  = await listAllLabels();
  const remoteByName = new Map(remote.map(l => [l.name, l]));
  const desiredNames = new Set(desired.map(l => l.name));

  // Resolve aliases first: rename `from` → `to` if `from` exists and `to` does not.
  const renames = [];
  for (const a of aliases) {
    const fromRemote = remoteByName.get(a.from);
    const toRemote   = remoteByName.get(a.to);
    if (fromRemote && !toRemote) {
      renames.push(a);
    } else if (fromRemote && toRemote) {
      console.log(`! alias collision: both '${a.from}' and '${a.to}' exist — skipping rename. Resolve manually.`);
    }
  }

  const renameTargets = new Set(renames.map(r => r.to));
  const toCreate = desired.filter(l => !remoteByName.has(l.name) && !renameTargets.has(l.name));
  const toUpdate = desired
    .filter(l => remoteByName.has(l.name))
    .filter(l => needsUpdate(remoteByName.get(l.name), l));
  const orphans  = remote.filter(l => !desiredNames.has(l.name) && !renames.some(r => r.from === l.name));

  console.log(`Desired labels:  ${desired.length}`);
  console.log(`Remote labels:   ${remote.length}`);
  console.log(`To rename:       ${renames.length}`);
  console.log(`To create:       ${toCreate.length}`);
  console.log(`To update:       ${toUpdate.length}`);
  console.log(`Orphans:         ${orphans.length} (will NOT be deleted)`);
  if (dryRun) console.log('(--dry-run — no API writes)');

  for (const a of renames) {
    const target = desired.find(l => l.name === a.to);
    const color = target?.color ?? remoteByName.get(a.from).color;
    const description = target?.description ?? '';
    console.log(`> rename ${a.from} → ${a.to} (#${color})`);
    if (!dryRun) {
      await gh('PATCH', `/repos/${REPO_OWNER}/${REPO_NAME}/labels/${encodeURIComponent(a.from)}`, {
        new_name: a.to, color, description,
      });
    }
  }

  for (const l of toCreate) {
    console.log(`+ create ${l.name} (#${l.color})`);
    if (!dryRun) {
      await gh('POST', `/repos/${REPO_OWNER}/${REPO_NAME}/labels`, {
        name: l.name, color: l.color, description: l.description ?? '',
      });
    }
  }

  for (const l of toUpdate) {
    const r = remoteByName.get(l.name);
    console.log(`~ update ${l.name} (color ${r.color}→${l.color})`);
    if (!dryRun) {
      await gh('PATCH', `/repos/${REPO_OWNER}/${REPO_NAME}/labels/${encodeURIComponent(l.name)}`, {
        new_name: l.name, color: l.color, description: l.description ?? '',
      });
    }
  }

  if (orphans.length) {
    console.log('\nOrphan labels on GitHub (not in labels.json):');
    for (const o of orphans) console.log(`  - ${o.name} (#${o.color}) — review and either add to labels.json or delete manually`);
  }

  console.log('\nDone.');
}

main().catch(err => { console.error(err); process.exit(1); });
