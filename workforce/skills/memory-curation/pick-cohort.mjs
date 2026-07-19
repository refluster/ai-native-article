#!/usr/bin/env node
// Deterministic cohort picker for the memory-curation Cadence (Epic-018
// Story 3). Lists active agents oldest-memory-first and prints the cohort
// this fire should curate, sized so a daily binding re-curates every
// active agent at least weekly as the roster grows:
//
//   cohort_size = max(--cohort-size ?? 5, ceil(active_agents / 7))
//
// Never-curated agents (no memory.body) sort first, keyed by their
// memory.last_updated when present (the empty legacy deck carries one) or
// epoch otherwise. The read is the public roster API — the same
// GET /agents/{slug} detail the runner composes from, so what this script
// sees is exactly what fires see.
//
// Usage:
//   node workforce/skills/memory-curation/pick-cohort.mjs \
//     [--cohort-size 5] [--exclude slug1,slug2]
//   # override host for a non-prod stage: MEMORY_API_BASE=https://.../{stage}
//
// Output (stdout, single JSON object):
//   { cohort: [{slug, last_updated, memory_chars}], active_agents, cohort_size }
//
// Exit codes: 0 ok · 1 bad args · 3 network/API error (fail loud, W-4).

const DEFAULT_API_BASE = "https://sjhikazsf9.execute-api.us-west-2.amazonaws.com/prod";
const API_BASE = (process.env.MEMORY_API_BASE ?? DEFAULT_API_BASE).replace(/\/+$/, "");

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

const cohortSizeArg = arg("cohort-size");
const baseCohort = cohortSizeArg ? Number(cohortSizeArg) : 5;
if (!Number.isInteger(baseCohort) || baseCohort < 1) {
  console.error(`invalid --cohort-size "${cohortSizeArg}"`);
  process.exit(1);
}
const exclude = new Set(
  (arg("exclude") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
);

async function getJson(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`GET ${path} -> HTTP ${res.status}`);
  return res.json();
}

try {
  const list = await getJson("/agents?page_size=100");
  const slugs = (list.items ?? [])
    .map((a) => a.slug)
    .filter((s) => typeof s === "string" && !exclude.has(s));

  const rows = [];
  for (const slug of slugs) {
    // The list view strips profile blocks; the detail carries memory.
    const detail = await getJson(`/agents/${encodeURIComponent(slug)}`);
    if (detail.archived === true) continue;
    const memory = detail.memory ?? {};
    rows.push({
      slug,
      last_updated: typeof memory.last_updated === "string" && memory.last_updated ? memory.last_updated : "1970-01-01",
      memory_chars: typeof memory.body === "string" ? memory.body.length : 0,
    });
  }

  // Oldest curation first; never-curated (epoch/no body) lead. Slug is the
  // deterministic tiebreak so two fires never disagree on order.
  rows.sort((a, b) =>
    a.last_updated === b.last_updated
      ? a.slug.localeCompare(b.slug)
      : a.last_updated.localeCompare(b.last_updated),
  );

  const cohortSize = Math.max(baseCohort, Math.ceil(rows.length / 7));
  console.log(
    JSON.stringify(
      { cohort: rows.slice(0, cohortSize), active_agents: rows.length, cohort_size: cohortSize },
      null,
      2,
    ),
  );
} catch (err) {
  console.error(`pick-cohort failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(3);
}
