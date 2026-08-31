#!/usr/bin/env node
// Seeds PROJECT#{id}/META rows from workforce/projects/{id}/project.json
// files. Runs from the operator's machine — invokes the AWS CLI directly,
// using whichever AWS credentials are in scope (aws-vault / SSO / env vars).
//
// The membership concept was removed 2026-07-03 (every registered agent
// participates in every project) — this seed no longer writes MEMBER rows.
// `name` is CREATE-ONLY on existing rows: a name PATCHed via the API
// (PATCH /projects/{id}) survives re-seeds; project.json's name applies
// only at first creation.
//
// Why a CLI shell-out script (vs. a sibling Lambda to wf-seed-agents):
//   - Project rows are written rarely (one per external repo). A new
//     Lambda + IAM grant for a sub-monthly cadence is over-engineered.
//   - Shelling out to `aws dynamodb` keeps the script dependency-free —
//     no @aws-sdk/* deps in the root package.json, no build step. The
//     row shape mirrors workforce/lambdas/shared/project.ts (PROJECT#{id}
//     /META and /MEMBER#{slug}); when the canonical helpers there change
//     row shape, this script needs the same update.
//
// `self/{slug}` rows are NOT seeded here — the agent-runner auto-seeds
// them on first invocation per Epic-010 §3. Per-agent personal projects
// stay out of workforce/projects/.
//
// Usage:
//   node workforce/scripts/seed-projects.mjs [stage]   (default: prod)
//
// Requires:
//   - `aws` CLI on PATH.
//   - AWS credentials in scope.
//   - validate-projects.mjs passing first.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, statSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const WORKFORCE_ROOT = join(HERE, "..");
const PROJECTS_DIR = join(WORKFORCE_ROOT, "projects");

const stage = (process.argv[2] ?? "prod").trim();
if (!/^(dev|prod)$/.test(stage)) {
  console.error(`Invalid stage "${stage}". Expected dev or prod.`);
  process.exit(2);
}
const region = process.env.AWS_REGION ?? "us-west-2";
const tableName = `wf-table-${stage}`;
const tmp = mkdtempSync(join(tmpdir(), "wf-seed-projects-"));

function aws(args, { stdin } = {}) {
  return execFileSync("aws", args, {
    encoding: "utf8",
    stdio: stdin ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
    input: stdin,
  });
}

function projectIdentityHash(data) {
  const stable = JSON.stringify({
    id: data.id,
    name: data.name,
    owner_agent: data.owner_agent ?? null,
    github: data.github ?? null,
    governance_docs: (data.governance_docs ?? []).slice().sort(),
    credential_types: data.credential_types.slice().sort(),
    status: data.status ?? "active",
    note: data.note ?? null,
  });
  return createHash("sha256").update(stable).digest("hex").slice(0, 16);
}

function ddbItem(obj) {
  // Convert a plain JS object to DynamoDB wire-format AttributeValue map.
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) {
      out[k] = { NULL: true };
    } else if (typeof v === "string") {
      out[k] = { S: v };
    } else if (typeof v === "number") {
      out[k] = { N: String(v) };
    } else if (typeof v === "boolean") {
      out[k] = { BOOL: v };
    } else if (Array.isArray(v)) {
      if (v.length === 0) {
        out[k] = { L: [] };
      } else if (v.every((x) => typeof x === "string")) {
        out[k] = { SS: v };
      } else {
        out[k] = { L: v.map((x) => Object.values(ddbItem({ _: x }))[0]) };
      }
    } else if (typeof v === "object") {
      out[k] = { M: ddbItem(v) };
    }
  }
  return out;
}

function projectMetaRow(data, now) {
  return {
    pk: `PROJECT#${data.id}`,
    sk: "META",
    project_id: data.id,
    name: data.name,
    owner_agent: data.owner_agent ?? null,
    github_owner: data.github?.owner ?? null,
    github_repo: data.github?.repo ?? null,
    governance_docs: data.governance_docs ?? [],
    credential_types: data.credential_types,
    status: data.status ?? "active",
    note: data.note ?? null,
    identity_hash: projectIdentityHash(data),
    created_at: data.created_at ?? now,
    updated_at: now,
  };
}

function getItem(pk, sk) {
  const key = JSON.stringify(ddbItem({ pk, sk }));
  const keyFile = join(tmp, `key-${pk.replace(/[^a-z0-9]/gi, "-")}-${sk.replace(/[^a-z0-9]/gi, "-")}.json`);
  writeFileSync(keyFile, key);
  let raw;
  try {
    raw = aws([
      "dynamodb",
      "get-item",
      "--table-name",
      tableName,
      "--region",
      region,
      "--key",
      `file://${keyFile}`,
      "--output",
      "json",
    ]);
  } catch (err) {
    throw new Error(`get-item failed for ${pk}/${sk}: ${err.message ?? err}`);
  }
  const parsed = JSON.parse(raw || "{}");
  return parsed.Item ?? null;
}

function putItem(item) {
  const wire = JSON.stringify(ddbItem(item));
  const itemFile = join(tmp, `put-${item.pk.replace(/[^a-z0-9]/gi, "-")}-${item.sk.replace(/[^a-z0-9]/gi, "-")}.json`);
  writeFileSync(itemFile, wire);
  aws([
    "dynamodb",
    "put-item",
    "--table-name",
    tableName,
    "--region",
    region,
    "--item",
    `file://${itemFile}`,
  ]);
}

function attrS(av) {
  return av?.S;
}

/** Decode a DynamoDB AttributeValue back to the plain JS value `ddbItem`
 *  would re-encode identically. Only the shapes a project META row uses.
 *
 *  `SS` / `NS` are NOT optional here: `ddbItem` encodes a non-empty string
 *  array as `SS`, so a decoder that omits it returns `undefined` for every
 *  stored `governance_docs` / `credential_types`, and the create-only
 *  carry-forward below then rewrites them as `{NULL:true}` — destroying on
 *  re-seed exactly the fields it exists to protect. Any type `ddbItem` can
 *  emit must round-trip through here; the test pins that property directly
 *  rather than enumerating today's fields. */
function fromAttr(av) {
  if (!av) return undefined;
  if (av.NULL) return null;
  if (av.S !== undefined) return av.S;
  if (av.N !== undefined) return Number(av.N);
  if (av.BOOL !== undefined) return av.BOOL;
  if (av.SS !== undefined) return [...av.SS];
  if (av.NS !== undefined) return av.NS.map(Number);
  if (av.L !== undefined) return av.L.map(fromAttr);
  if (av.M !== undefined) {
    return Object.fromEntries(Object.entries(av.M).map(([k, v]) => [k, fromAttr(v)]));
  }
  return undefined;
}

/**
 * Fields the API owns once a project row exists (ADR-0029).
 *
 * `name` was the first of these: the console could rename a project, so
 * re-seeding from project.json had to stop overwriting the name. ADR-0029
 * widened `PATCH /projects/{id}` to the rest of the descriptive attributes,
 * so the same rule now has to cover them — otherwise the next re-seed for
 * ANY unrelated reason (a changed `note`, a new project added next door)
 * would silently revert every edit the operator made in the console.
 *
 * The consequence is deliberate and matches ADR-0007's direction for agents:
 * for an EXISTING project, DDB is authoritative for these fields and
 * project.json is creation-time input only. To change one on a live project,
 * use the console (or PATCH); editing project.json will not apply.
 */
const API_OWNED_FIELDS = [
  "name",
  "owner_agent",
  "github_owner",
  "github_repo",
  "governance_docs",
  "credential_types",
];

/**
 * Carry the API-owned fields forward from the stored row onto the row the seed
 * is about to write, so a re-seed never reverts a console edit.
 *
 * The predicate is "the row exists", NOT "the attribute is present". An
 * attribute the console CLEARED (`github: null` deletes both halves of the
 * pair) is absent from the stored row, and keying on presence would fall back
 * to project.json and silently restore the value the operator just removed —
 * the same clobber this rule exists to stop, in the one direction that looks
 * like normal seeding. So on an existing row the stored state wins for every
 * API-owned field, including "absent".
 */
function mergeApiOwnedFields(next, existing) {
  if (!existing) return next;
  for (const field of API_OWNED_FIELDS) {
    if (field in existing) next[field] = fromAttr(existing[field]);
    else delete next[field];
  }
  return next;
}

function upsertMeta(data, now) {
  const existing = getItem(`PROJECT#${data.id}`, "META");
  const next = projectMetaRow(data, now);
  if (existing && attrS(existing.identity_hash) === next.identity_hash) {
    return "noop";
  }
  if (existing?.created_at?.S) {
    next.created_at = existing.created_at.S;
  }
  mergeApiOwnedFields(next, existing);
  putItem(next);
  return existing ? "updated" : "created";
}

function listProjectFiles() {
  if (!existsSync(PROJECTS_DIR)) return [];
  return readdirSync(PROJECTS_DIR)
    .map((name) => join(PROJECTS_DIR, name))
    .filter((p) => statSync(p).isDirectory())
    .map((dir) => join(dir, "project.json"))
    .filter((f) => existsSync(f));
}

function main() {
  const files = listProjectFiles();
  if (files.length === 0) {
    console.log(`workforce/projects/: no project.json files; nothing to seed.`);
    return;
  }

  console.log(`Seeding ${files.length} project(s) to ${tableName} in ${region} ...`);
  const now = new Date().toISOString();
  const results = [];

  for (const file of files) {
    const data = JSON.parse(readFileSync(file, "utf8"));
    const metaAction = upsertMeta(data, now);
    results.push({ id: data.id, meta: metaAction });
  }

  console.log(JSON.stringify(results, null, 2));

  const metaCounts = results.reduce(
    (acc, r) => ({ ...acc, [r.meta]: (acc[r.meta] ?? 0) + 1 }),
    {},
  );
  const summary = Object.entries(metaCounts)
    .map(([k, v]) => `${v} ${k}`)
    .join(", ");
  console.log(`\nSeed OK — ${files.length} project(s): ${summary}.`);
}

// Exported for seed-projects-tests.ts. The encode/decode pair and the
// create-only merge are the parts with a correctness property worth pinning;
// everything else in this file is AWS CLI plumbing.
export { ddbItem, fromAttr, mergeApiOwnedFields, API_OWNED_FIELDS };

// Run as a CLI only when invoked directly; importing (tests) has no side effect.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (err) {
    console.error("seed-projects failed:", err.message ?? err);
    process.exit(1);
  }
}
