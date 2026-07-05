#!/usr/bin/env node
// check-skill-body-version.mjs — ADR-0018 drift guard.
//
// Under version-gated seed (ADR-0018), wf-seed-skills only propagates a
// skill's authored judgment fields (body / description / status / owners /
// cost_class / improvement_agent) to its live DDB row when the git
// `meta.json:version` is STRICTLY NEWER than the row's version. So editing a
// SKILL.md body WITHOUT bumping the version is a silent no-op: the change
// lands in git, CI is green, but the running cadence never sees it — exactly
// the drift that left podcast-script on its v0.1.0 body while git carried the
// v0.3.0 "up to 5 per fire" loop.
//
// This lint closes that gap at PR time: if a PR changes any authored judgment
// field of an ALREADY-EXISTING skill (present on the base ref), the same PR
// MUST bump `meta.json:version`. New skills (absent on base) are exempt — the
// seed creates them wholesale.
//
// Base ref: env BASE_REF (CI passes the PR base), else origin/main, resolved
// to the merge-base with HEAD. If no base can be resolved (a local run with no
// origin), the check SKIPS with exit 0 — it is a PR-diff gate, not a
// working-tree validator (that is validate-skills.mjs).
//
// Exit codes: 0 clean/skipped, 1 drift (a bump is required), 2 lint-internal.

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const WORKFORCE_ROOT = join(HERE, "..");
const REPO_ROOT = join(WORKFORCE_ROOT, "..");
const SKILLS_DIR = join(WORKFORCE_ROOT, "skills");

function git(args) {
  return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
}
function gitOrNull(args) {
  try {
    return git(args);
  } catch {
    return null;
  }
}

// Resolve the base commit to diff against. Prefer the merge-base with the PR
// base ref so we compare only what THIS PR changed, not unrelated main drift.
function resolveBase() {
  const baseRef = (process.env.BASE_REF || "main").trim();
  for (const ref of [`origin/${baseRef}`, baseRef, "origin/main", "main"]) {
    const sha = gitOrNull(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    if (sha) {
      const mb = gitOrNull(["merge-base", sha, "HEAD"]);
      return mb || sha;
    }
  }
  return null;
}

// The authored judgment fields that the version gate propagates. `deliverable`
// is intentionally EXCLUDED — the seed reconciles it every run regardless of
// version, so a deliverable-only change needs no bump.
function syncSignature(dir, base) {
  const metaRaw =
    base === null
      ? readFileSync(join(dir.abs, "meta.json"), "utf8")
      : dir.baseMeta;
  const skillRaw =
    base === null
      ? readFileSync(join(dir.abs, "SKILL.md"), "utf8")
      : dir.baseSkill;
  const meta = JSON.parse(metaRaw);
  const { description, body } = splitFrontmatter(skillRaw);
  return JSON.stringify({
    body,
    description,
    status: meta.status,
    owners: meta.owners,
    cost_class: meta.cost_class,
    improvement_agent: meta.improvement_agent,
  });
}

function splitFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) throw new Error("SKILL.md must begin with --- YAML frontmatter ---");
  let description = "";
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.startsWith("description:")) continue;
    description = line.slice("description:".length).trim();
    if (description.startsWith('"') && description.endsWith('"')) {
      description = description.slice(1, -1);
    }
  }
  return { description, body: m[2].trim() };
}

function versionOf(raw) {
  return JSON.parse(raw).version;
}

// >0 if a newer than b (mirror of handler.ts compareSemver).
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
    .filter((n) => existsSync(join(SKILLS_DIR, n, "meta.json")));
}

function main() {
  const base = resolveBase();
  if (base === null) {
    console.log(
      "check-skill-body-version: no base ref resolvable (local run); skipping — this is a PR-diff gate.",
    );
    process.exit(0);
  }

  const violations = [];
  for (const name of listSkillDirs()) {
    const relSkill = `workforce/skills/${name}/SKILL.md`;
    const relMeta = `workforce/skills/${name}/meta.json`;
    const abs = join(SKILLS_DIR, name);

    const baseSkill = gitOrNull(["show", `${base}:${relSkill}`]);
    const baseMeta = gitOrNull(["show", `${base}:${relMeta}`]);
    // New skill (absent on base) — seed creates it wholesale, no bump needed.
    if (baseSkill === null || baseMeta === null) continue;

    let headSig, baseSig, headVer, baseVer;
    try {
      headSig = syncSignature({ abs }, null);
      baseSig = syncSignature({ abs, baseMeta, baseSkill }, base);
      headVer = versionOf(readFileSync(join(abs, "meta.json"), "utf8"));
      baseVer = versionOf(baseMeta);
    } catch (err) {
      console.error(
        `check-skill-body-version: could not parse ${name}: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(2);
    }

    if (headSig === baseSig) continue; // no authored-field change → no bump owed

    const cmp = compareSemver(headVer, baseVer);
    if (cmp > 0) continue; // authored change + a proper bump → will propagate
    if (cmp === 0) {
      violations.push({
        name,
        msg: `authored judgment fields changed but meta.json:version is unchanged (${headVer}). Bump it so wf-seed-skills (ADR-0018) propagates the edit to the live DDB row; otherwise the running cadence keeps the old body.`,
      });
    } else {
      violations.push({
        name,
        msg: `meta.json:version regressed ${baseVer} → ${headVer} while authored fields changed. A version not newer than the live row never syncs; bump forward instead.`,
      });
    }
  }

  if (violations.length === 0) {
    console.log(
      "check-skill-body-version: no un-versioned skill-body drift — every authored change carries a version bump.",
    );
    process.exit(0);
  }
  for (const { name, msg } of violations) {
    console.error(`[ADR-0018] workforce/skills/${name}: ${msg}`);
  }
  console.error(
    `\n${violations.length} skill(s) changed without a propagating version bump. Bump meta.json:version in the same PR — do not loosen this lint.`,
  );
  process.exit(1);
}

main();
