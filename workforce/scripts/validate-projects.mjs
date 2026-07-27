#!/usr/bin/env node
// Validates workforce/projects/{id}/project.json files against
// workforce/scripts/schemas/project.schema.json + cross-file invariants:
//
//  P-1   project.json:id MUST equal the parent directory name.
//  P-2   id MUST NOT start with "self/" (reserved per Epic-010 §3 for the
//        runner-auto-seeded per-agent personal projects).
//  (P-3 / P-4 retired 2026-07-03 with the membership concept — every
//   registered agent participates in every project.)
//  P-5   credential_types[] base types MUST be in the Epic-010 §5 type
//        registry (anthropic.api_key / discord.bot_token / github.token /
//        notion.integration_token) — enforced by schema pattern; this
//        validator additionally checks the variant suffix doesn't collide
//        with itself.
//
// Exits non-zero on violation. Designed to be wired into CI alongside
// workforce:agents / workforce:skills.

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const WORKFORCE_ROOT = join(HERE, "..");
const REPO_ROOT = join(WORKFORCE_ROOT, "..");
const PROJECTS_DIR = join(WORKFORCE_ROOT, "projects");
const SCHEMA_PATH = join(HERE, "schemas", "project.schema.json");

const violations = [];
const v = (rule, path, msg) =>
  violations.push({ rule, path: relative(REPO_ROOT, path), msg });

const ID = /^[a-z][a-z0-9-]*$/;
const CREDENTIAL_KEY =
  /^(anthropic\.api_key|discord\.bot_token|discord\.webhook_url|github\.token|notion\.integration_token|workforce\.feed_write_token|workforce\.memory_write_token)(@[a-z][a-z0-9_-]*)?$/;

const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
const requiredKeys = new Set(schema.required ?? []);
const allowedKeys = new Set(Object.keys(schema.properties ?? {}));

function listProjectDirs() {
  if (!existsSync(PROJECTS_DIR)) return [];
  return readdirSync(PROJECTS_DIR)
    .map((name) => join(PROJECTS_DIR, name))
    .filter((p) => statSync(p).isDirectory());
}

function shallowSchemaCheck(file, data) {
  for (const key of Object.keys(data)) {
    if (!allowedKeys.has(key)) {
      v("schema:unknown-key", file, `unknown property "${key}"`);
    }
  }
  for (const key of requiredKeys) {
    if (data[key] === undefined) {
      v("schema:required", file, `missing required property "${key}"`);
    }
  }

  if (typeof data.id === "string" && !ID.test(data.id)) {
    v("schema:id-pattern", file, `id "${data.id}" must match ${ID}`);
  }
  if (typeof data.name === "string" && (data.name.length === 0 || data.name.length > 80)) {
    v("schema:name-length", file, `name length must be 1..80`);
  }
  if (data.github !== undefined) {
    const g = data.github;
    if (typeof g !== "object" || g === null) {
      v("schema:github-type", file, `github must be an object`);
    } else {
      if (typeof g.owner !== "string" || !/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(g.owner)) {
        v("schema:github-owner", file, `github.owner missing or invalid`);
      }
      if (typeof g.repo !== "string" || !/^[A-Za-z0-9._-]+$/.test(g.repo)) {
        v("schema:github-repo", file, `github.repo missing or invalid`);
      }
    }
  }
  if (data.credential_types !== undefined) {
    if (!Array.isArray(data.credential_types)) {
      v("schema:cred-type", file, `credential_types must be an array`);
    } else {
      const seen = new Set();
      for (const t of data.credential_types) {
        if (typeof t !== "string" || !CREDENTIAL_KEY.test(t)) {
          v("schema:cred-pattern", file, `credential_types entry "${t}" does not match the Epic-010 type registry`);
        }
        if (seen.has(t)) {
          v("schema:cred-duplicate", file, `duplicate credential_types entry "${t}"`);
        }
        seen.add(t);
      }
    }
  }
}

function main() {
  const dirs = listProjectDirs();

  for (const dir of dirs) {
    const file = join(dir, "project.json");
    const slug = dir.split("/").pop();
    if (!existsSync(file)) {
      v("structure:missing-json", dir, `workforce/projects/${slug}/ must contain project.json`);
      continue;
    }

    let data;
    try {
      data = JSON.parse(readFileSync(file, "utf8"));
    } catch (err) {
      v("schema:json-parse", file, `JSON parse error: ${err.message}`);
      continue;
    }

    shallowSchemaCheck(file, data);

    // P-1
    if (data.id !== slug) {
      v("P-1", file, `id "${data.id}" must equal parent directory "${slug}"`);
    }

    // P-2
    if (typeof data.id === "string" && data.id.startsWith("self")) {
      v("P-2", file, `id "${data.id}" cannot start with "self" — reserved for per-agent runner-auto-seeded projects (Epic-010 §3)`);
    }

  }

  if (violations.length === 0) {
    console.log(`workforce/projects/: ${dirs.length} project(s) validated, no violations.`);
    process.exit(0);
  }

  for (const { rule, path, msg } of violations) {
    console.error(`[${rule}] ${path}: ${msg}`);
  }
  console.error(`\n${violations.length} violation(s) — fix and re-run.`);
  process.exit(1);
}

main();
