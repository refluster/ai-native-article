#!/usr/bin/env node
// check-skill-lifecycle.mjs — #666 reconciliation: is a skill's declared
// `status: "active"` still true?
//
// The problem (#666, mateo/sana/priya 2026-09 letters): the lifecycle field
// (`workforce/scripts/schemas/skill-meta.schema.json:status`, enum
// active/stale/deprecated/archived) exists and is enforced at write time
// (ADR-0017), but nothing checks it stays TRUE after the fact. A skill can
// sit at "active" for months after its last real invocation, or after every
// binding that used to fire it was removed, with no mechanical signal ever
// telling a human to look. The sibling `check-skill-*.mjs` scripts
// (spec-drift, version-sync, body-version) all police VERSION drift; none
// police LIFECYCLE drift. This is that check — item 1 of #666's "What would
// close this" ONLY (see the PR body for why items 2/4/5 are explicitly out
// of scope for this slice).
//
// Two independent live signals, sourced the way this script's siblings
// source theirs (git for the skill population, the live wf-agents-api for
// anything that changes without a git commit — bindings and EXEC history
// both live in DynamoDB, not git; see root CLAUDE.md "How content flows" /
// "bindings ... live in DynamoDB via agents-api, not in git"):
//
//   1. Zero EXEC rows in the trailing STALE_DAYS window
//      (`GET /skills/{name}/executions?from=<STALE_DAYS ago>&limit=1`,
//      GSI2-backed, server-side range push-down — see
//      `workforce/lambdas/shared/project.ts:listExecutions`). Nobody has
//      actually run this skill recently, regardless of why.
//   2. No live binding references it
//      (`GET /agents` returns every non-archived agent's full `bindings[]`
//      — the route's own comment confirms it's fully drained server-side,
//      `scanAllPrefix` + `next_cursor` always undefined, so no client-side
//      paging is needed at C-3 scale). Nothing is even WIRED to fire it.
//
// Why STALE_DAYS = 30 (env override: SKILL_LIFECYCLE_STALE_DAYS)
// -----------------------------------------------------------------
// The issue's own text suggests "e.g. 30d" and nothing in the repo's other
// cadences needs a longer look-back to prove liveness: the slowest regular
// cadence discovered in this repo (monthly-report, vp-monthly-report) fires
// on a ~monthly rhythm, so 30 days covers at least one full cycle of every
// bound cadence before flagging it dormant. Shorter would false-positive on
// monthly cadences between their own fires; longer buys nothing (nothing in
// `workforce/skills/*` runs on a slower cadence than monthly today) while
// delaying the signal a human actually wants.
//
// Why BOTH signals, not either alone (the issue says "and/or")
// -----------------------------------------------------------------
// Chosen conservatively as AND, not OR, specifically to avoid false-
// positiving the small set of utility/helper skills that are invoked AS AN
// INTERNAL STEP of another skill's own judgment rather than bound directly
// by the orchestrator (`record-engagement`'s own SKILL.md documents exactly
// this: "it is never bound to an agent for the orchestrator to fire" — and
// a handful of others, e.g. `code-task-brief`, look structurally the same:
// no `requires[]`, no `deliverable`, called from inside a persona's own
// planning step). Those skills legitimately show "no live binding" forever
// by design, so gating on that signal alone would flag them every single
// run — a mechanical check that cries wolf gets ignored (the same lesson
// R-15/corpus-freshness already encodes: a signal that fires on things
// nobody can or should act on trains people to stop reading it). Requiring
// BOTH signals means a skill only surfaces here when it is NEITHER being
// invoked ad hoc NOR wired to fire on a schedule — the case an operator can
// actually act on (confirm it's dormant and retire it, or discover a
// binding silently went missing).
//
// Grace period
// -----------------------------------------------------------------
// A skill younger than STALE_DAYS hasn't had a fair chance to accumulate
// EXEC rows yet — skip it rather than flag a brand-new skill as "suspect"
// on day 3.
//
// Exit codes: 0 clean (or nothing to check), 1 suspect skill(s) found,
// 2 script-internal error (unreachable API, bad JSON, missing skills dir —
// W-4 fail loud; a check that silently no-ops on an API outage is worse
// than one that turns red).
//
// NOT wired into ci.yml's PR gate, deliberately — same reasoning
// ci.yml gives for R-15/corpus-freshness.yml: "Staleness is a property of
// time, not of a diff: gating PRs on it blocks changes that neither caused
// nor can fix the condition." A skill going quiet is a property of the
// calendar, not of any one PR's diff. Wired instead into the `workforce:*`
// npm-run family (`workforce:skill-lifecycle`) for manual/scheduled use —
// scheduling it (a periodic workflow, mirroring corpus-freshness.yml) is a
// natural follow-up but is its own decision, out of scope for this slice.

import { ensureProxyAwareEntry } from "../../scripts/lib/proxy-bootstrap.mjs";
ensureProxyAwareEntry(import.meta.url);

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const WORKFORCE_ROOT = join(HERE, "..");
const SKILLS_DIR = join(WORKFORCE_ROOT, "skills");

// Same base-URL resolution as build-agent-manifest.mjs / record-engagement.mjs:
// an explicit override, else the stable custom domain (reachable without AWS
// credentials — workforce/infra/sam-api-domain).
const API_BASE = (
  process.env.WF_AGENTS_API_BASE ??
  process.env.VITE_WORKFORCE_AGENTS_API_BASE ??
  "https://workforce-api.kohuehara.xyz"
).replace(/\/+$/, "");

const STALE_DAYS = Math.max(1, parseInt(process.env.SKILL_LIFECYCLE_STALE_DAYS ?? "30", 10) || 30);

export function listSkillMeta() {
  if (!existsSync(SKILLS_DIR)) {
    throw new Error(`skills directory not found: ${SKILLS_DIR}`);
  }
  const out = [];
  for (const name of readdirSync(SKILLS_DIR).sort()) {
    const metaPath = join(SKILLS_DIR, name, "meta.json");
    if (!existsSync(metaPath)) continue;
    let meta;
    try {
      meta = JSON.parse(readFileSync(metaPath, "utf8"));
    } catch (err) {
      throw new Error(`could not parse ${metaPath}: ${err instanceof Error ? err.message : String(err)}`);
    }
    out.push({ name, meta });
  }
  return out;
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  return res.json();
}

// GET /agents fully drains the AGENT#/META set server-side at C-3 scale
// (listAgents's own comment: scanAllPrefix, next_cursor is always
// undefined). Still check for a cursor and fail loud rather than silently
// under-counting bindings if that assumption ever stops holding.
export async function fetchAllAgents(apiBase = API_BASE) {
  const data = await fetchJson(`${apiBase}/agents`);
  if (data.next_cursor) {
    throw new Error(
      "GET /agents returned a next_cursor — it no longer fully drains server-side; " +
        "this script needs client-side paging added (see listAgents's own comment for why it currently doesn't).",
    );
  }
  return Array.isArray(data.items) ? data.items : [];
}

// Pure — trivially testable, and the one place the "what counts as bound"
// rule lives.
export function boundSkillNames(agents) {
  const bound = new Set();
  for (const agent of agents) {
    for (const binding of agent.bindings ?? []) {
      if (binding && typeof binding.skill === "string") bound.add(binding.skill);
    }
  }
  return bound;
}

export async function hasRecentExecutions(skillName, sinceIso, apiBase = API_BASE) {
  const url = `${apiBase}/skills/${encodeURIComponent(skillName)}/executions?limit=1&from=${encodeURIComponent(sinceIso)}`;
  const data = await fetchJson(url);
  return Array.isArray(data.items) && data.items.length > 0;
}

// Pure — the AND-of-two-signals + grace-period rule, factored out so it's
// testable without mocking fetch at all. Mirrors the loop body of main().
export function classifySkill({ name, meta }, { bound, recentlyRan, sinceIso }) {
  if (meta.status !== "active") return "not-active";
  if (meta.created_at && meta.created_at > sinceIso.slice(0, 10)) return "too-new";
  const isBound = bound.has(name);
  if (!recentlyRan && !isBound) return "suspect";
  return "ok";
}

async function main() {
  let skills;
  try {
    skills = listSkillMeta();
  } catch (err) {
    console.error(`check-skill-lifecycle: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }

  const sinceMs = Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000;
  const sinceIso = new Date(sinceMs).toISOString();

  const eligible = skills.filter(({ meta }) => meta.status === "active");
  const graced = eligible.filter(({ meta }) => !meta.created_at || meta.created_at <= sinceIso.slice(0, 10));
  const tooNew = eligible.length - graced.length;

  if (graced.length === 0) {
    console.log(
      `check-skill-lifecycle: no active skill(s) old enough to evaluate (${eligible.length} active, ` +
        `${tooNew} within the ${STALE_DAYS}d grace period); nothing to check.`,
    );
    return 0;
  }

  let agents;
  try {
    agents = await fetchAllAgents();
  } catch (err) {
    console.error(
      `check-skill-lifecycle: could not read live bindings from ${API_BASE}/agents: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
    console.error(
      "check-skill-lifecycle: this is a live-API reconciliation, not a git-only lint — an unreachable " +
        "API fails loud (W-4) rather than silently reporting a clean run it never actually checked.",
    );
    return 2;
  }
  const bound = boundSkillNames(agents);

  const suspects = [];
  for (const entry of graced) {
    const { name, meta } = entry;
    let recentlyRan;
    try {
      recentlyRan = await hasRecentExecutions(name, sinceIso);
    } catch (err) {
      console.error(
        `check-skill-lifecycle: could not read executions for "${name}": ${err instanceof Error ? err.message : String(err)}`,
      );
      return 2;
    }
    if (classifySkill(entry, { bound, recentlyRan, sinceIso }) === "suspect") {
      suspects.push({ name, owners: (meta.owners ?? []).join(", ") || "(none listed)" });
    }
  }

  if (suspects.length === 0) {
    console.log(
      `check-skill-lifecycle: OK — ${graced.length} active skill(s) checked (${tooNew} exempt, ` +
        `within the ${STALE_DAYS}d grace period) against ${agents.length} agent(s)' live bindings and the ` +
        `last ${STALE_DAYS}d of EXEC rows; none are suspect.`,
    );
    return 0;
  }

  console.error(
    `check-skill-lifecycle: ${suspects.length} of ${graced.length} evaluated active skill(s) are ` +
      `SUSPECT — status:"active" but zero EXEC rows in the last ${STALE_DAYS}d AND no live binding ` +
      `references them:`,
  );
  for (const s of suspects) {
    console.error(`  - ${s.name} (owners: ${s.owners}) — workforce/skills/${s.name}/meta.json`);
  }
  console.error(
    "\nThis does NOT mean these skills are wrong to keep active — some are legitimately invoked as an " +
      "internal step of another skill's own judgment rather than bound directly (record-engagement's own " +
      "SKILL.md documents exactly this pattern) and will never show a binding of their own. A human call " +
      "is needed per skill: confirm it's still reachable some other way and leave it, or retire it " +
      "(PATCH /skills/{name} status → stale/deprecated/archived, ADR-0017).",
  );
  return 1;
}

// Run as CLI only when invoked directly; importing (tests) has no side effect.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  process.exit(await main());
}
