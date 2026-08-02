#!/usr/bin/env node
// check-skill-version-sync.mjs — ADR-0018's missing third leg: POST-deploy
// proof that the live SKILL# row actually caught up with git.
//
// ADR-0018 has two working legs and one hole:
//
//   1. §Decision-1 — `wf-seed-skills` re-syncs a skill's authored judgment
//      fields iff git `meta.json:version` is STRICTLY NEWER than the live
//      row's version (workforce/lambdas/seed-skills/handler.ts).
//   2. §Decision-3 — `check-skill-body-version.mjs` makes the version bump
//      mandatory at PR time, so an edit can never ship un-versioned.
//   3. (missing) — nothing asserts, AFTER the deploy, that the propagation
//      actually happened. The PR-time gate proves the bump exists in git; the
//      seed *usually* applies it. If the post-deploy seed is skipped,
//      throttled, or errors on one skill, the runtime keeps composing the OLD
//      body and no signal fires — a slow-motion C-4 ("fail loud, not silent")
//      gap of exactly the shape that left podcast-script on its v0.1.0 body
//      while git carried v0.3.0.
//
// This script is that third leg. It compares, for every
// `workforce/skills/*/meta.json`, the git `version` against the live
// `GET /skills` row and fails when the live version is BEHIND git.
//
// Direction matters. A live version NEWER than git is legal, not drift: it is
// ADR-0018's deliberate escape hatch (a `PATCH /skills` that bumps above git
// stays authoritative, and a stale/rolled-back bundle must never regress the
// row). Only "live is older" means the propagation owed to us did not land.
//
// Detect, do not repair. Auto-PATCHing on detect is explicitly out of scope —
// ADR-0018 §Decision-1 already owns propagation; this script owns the signal.
//
// Where this runs: after the data-plane deploy, where a real skew is
// observable — NOT at PR time (at PR time the live row is *expected* to lag
// until the deploy runs, so a PR-time version would be red by construction).
//
// Usage:
//   node workforce/scripts/check-skill-version-sync.mjs [--strict]
//
//   WF_AGENTS_API_BASE   override the agents-api base (default: prod)
//   --strict             also fail on advisories (live ahead of git)
//
// Exit codes: 0 clean (or advisories only) · 1 skew found (live behind git,
//             or a git skill with no live row) · 2 lint-internal (unparseable
//             meta.json) · 3 API unreachable.

import "../../scripts/lib/proxy-bootstrap.mjs";

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const SKILLS_DIR = join(HERE, "..", "skills");

const API_BASE = (
  process.env.WF_AGENTS_API_BASE ??
  "https://sjhikazsf9.execute-api.us-west-2.amazonaws.com/prod"
).replace(/\/+$/, "");
const STRICT = process.argv.includes("--strict");

// >0 if a newer than b (mirror of handler.ts compareSemver and the same
// helper in check-skill-body-version.mjs — kept local so this script has no
// cross-script import).
function compareSemver(a, b) {
  const parse = (s) => {
    const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(s).trim());
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
  };
  const [aM, aN, aP] = parse(a);
  const [bM, bN, bP] = parse(b);
  return aM - bM || aN - bN || aP - bP;
}

function listSkillDirs() {
  if (!existsSync(SKILLS_DIR)) return [];
  return readdirSync(SKILLS_DIR)
    .filter((n) => /^[a-z][a-z0-9-]*$/.test(n))
    .filter((n) => statSync(join(SKILLS_DIR, n)).isDirectory())
    .filter((n) => existsSync(join(SKILLS_DIR, n, "meta.json")))
    .sort();
}

let live;
try {
  const res = await fetch(`${API_BASE}/skills`);
  if (!res.ok) throw new Error(`GET /skills -> HTTP ${res.status}`);
  live = await res.json();
} catch (e) {
  console.error(`check-skill-version-sync: skills API unreachable: ${e.message}`);
  process.exit(3);
}

const liveVersion = new Map(
  (live.items || []).map((s) => [s.name, s.version]),
);

const names = listSkillDirs();
console.log(
  `check-skill-version-sync: ${names.length} git skill(s) vs ${liveVersion.size} live row(s) @ ${API_BASE}\n`,
);

const skews = [];
const advisories = [];

for (const name of names) {
  let gitVer;
  try {
    gitVer = JSON.parse(
      readFileSync(join(SKILLS_DIR, name, "meta.json"), "utf8"),
    ).version;
  } catch (err) {
    console.error(
      `check-skill-version-sync: could not parse workforce/skills/${name}/meta.json: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    process.exit(2);
  }

  if (!liveVersion.has(name)) {
    // No live row at all: the seed never created it. After a data-plane
    // deploy that is the same "propagation did not land" class as a stale
    // version — the runtime has no body to compose.
    skews.push({ name, gitVer, liveVer: "(absent)", why: "no live SKILL# row — wf-seed-skills never created it" });
    continue;
  }

  const liveVer = liveVersion.get(name);
  const cmp = compareSemver(liveVer, gitVer);

  if (cmp < 0) {
    skews.push({
      name,
      gitVer,
      liveVer,
      why: "live row is BEHIND git — the version-gated seed did not propagate this deploy",
    });
  } else if (cmp > 0) {
    // ADR-0018's escape hatch: a live PATCH above git is authoritative.
    advisories.push({ name, gitVer, liveVer });
  }
}

for (const { name, gitVer, liveVer, why } of skews) {
  console.error(`[ADR-0018] skew=${name} git=${gitVer} live=${liveVer} — ${why}`);
}
for (const { name, gitVer, liveVer } of advisories) {
  console.log(
    `advisory: skill=${name} git=${gitVer} live=${liveVer} — live ahead of git (legal per ADR-0018 API-edit escape hatch)`,
  );
}

if (skews.length === 0 && (advisories.length === 0 || !STRICT)) {
  console.log(
    `\ncheck-skill-version-sync: no stale live skill bodies — every git version reached its SKILL# row.`,
  );
  process.exit(0);
}

if (skews.length > 0) {
  console.error(
    `\n${skews.length} skill(s) whose live body is stale. The runtime is composing an OLD judgment body for these — re-run the data-plane seed (wf-seed-skills) and re-check; do not loosen this gate.`,
  );
} else {
  console.error(
    `\n${advisories.length} skill(s) ahead of git (--strict).`,
  );
}
process.exit(1);
