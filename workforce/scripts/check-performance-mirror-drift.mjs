#!/usr/bin/env node
// check-performance-mirror-drift.mjs — #686 follow-up from the #682 review
// (dario, D5).
//
// workforce/lambdas/shared/performance.ts says of itself, in its own header:
//
//   "The TypeScript shapes here MIRROR
//   workforce/app/src/types/performance.ts (the client contract). The two
//   trees can't share a module, so a change to one is a change to both."
//
// That sentence was true when it was written and then silently stopped being
// true: three optional blocks (`repo`, `idle`, `human_touch`) were added to
// the server's `PerformanceSeries` without a matching edit on the client
// side, and nothing failed — every one of them is optional, so TypeScript's
// structural typing has nothing to complain about. The mirror was a comment,
// not a contract.
//
// This gate makes the sentence mechanically true: it parses the exported
// `PerformanceSeries` interface out of both files and fails when the two
// field-name sets disagree. Same family as check-skill-spec-drift.mjs /
// check-openapi-routes.mjs — a hand-maintained "these two things must match"
// comment, turned into something that reddens CI instead of rotting quietly.
//
// What's checked
// --------------
//   The *field names* of `export interface PerformanceSeries` in:
//     server: workforce/lambdas/shared/performance.ts
//     client: workforce/app/src/types/performance.ts
//   must be identical sets. Field TYPES are intentionally not compared here —
//   the client is free to `Pick<>`/narrow a block's internal shape (see
//   PerfIdleBlock) as long as the top-level field is present under the same
//   name; that's the same latitude the two files already take for LIFECYCLE's
//   HumanTouchBlock/RepoActivityBlock sub-fields. A future PR is free to
//   tighten this to full structural equality if a drift class shows up there
//   too — deliberately narrow scope beats a check nobody can get green.
//
// Exit codes
// ----------
//   0  Field sets match.
//   1  Drift detected (fields on one side only); listed to stderr.
//   2  Lint-internal error (interface not found / files unreadable).

import { readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const WORKFORCE_ROOT = join(HERE, "..");
const REPO_ROOT = join(WORKFORCE_ROOT, "..");

const SERVER_PATH = join(WORKFORCE_ROOT, "lambdas", "shared", "performance.ts");
const CLIENT_PATH = join(WORKFORCE_ROOT, "app", "src", "types", "performance.ts");
const INTERFACE_NAME = "PerformanceSeries";

function readOrDie(path) {
  if (!existsSync(path)) {
    console.error(
      `check-performance-mirror-drift: ${relative(REPO_ROOT, path)} not found.`,
    );
    process.exit(2);
  }
  return readFileSync(path, "utf8");
}

// Strip both comment forms so a field-shaped token inside a `/** ... */` doc
// comment (there are many in these two files) never gets mistaken for a
// field declaration.
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

// Return the text between the outer `{ ... }` of `export interface <name>`,
// tracking brace depth so nested object-literal field types (e.g.
// `window: { start: string; end: string }`) don't close the interface early.
function extractInterfaceBody(source, name, path) {
  const re = new RegExp(`export interface ${name}\\s*\\{`);
  const m = re.exec(source);
  if (!m) {
    console.error(
      `check-performance-mirror-drift: could not find "export interface ${name}" in ${relative(REPO_ROOT, path)}.`,
    );
    process.exit(2);
  }
  let i = m.index + m[0].length;
  let depth = 1;
  const start = i;
  while (i < source.length && depth > 0) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") depth--;
    i++;
  }
  if (depth !== 0) {
    console.error(
      `check-performance-mirror-drift: unbalanced braces reading "${name}" in ${relative(REPO_ROOT, path)}.`,
    );
    process.exit(2);
  }
  return source.slice(start, i - 1);
}

// Split the interface body into top-level members (on `;` at brace/paren/
// generic depth 0) and pull each member's field name (identifier before an
// optional `?` and the `:`). Index signatures / spreads (no leading
// identifier-colon) are skipped rather than mis-parsed.
function topLevelFieldNames(body) {
  const segments = [];
  let depth = 0;
  let cur = "";
  for (const ch of body) {
    if (ch === "{" || ch === "(" || ch === "<" || ch === "[") depth++;
    else if (ch === "}" || ch === ")" || ch === ">" || ch === "]") depth--;
    if (ch === ";" && depth === 0) {
      segments.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) segments.push(cur);

  const names = [];
  for (const seg of segments) {
    const t = seg.trim();
    if (!t) continue;
    const fm = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\??\s*:/);
    if (fm) names.push(fm[1]);
  }
  return names;
}

function fieldSet(path) {
  const source = stripComments(readOrDie(path));
  const body = extractInterfaceBody(source, INTERFACE_NAME, path);
  return new Set(topLevelFieldNames(body));
}

function main() {
  const serverFields = fieldSet(SERVER_PATH);
  const clientFields = fieldSet(CLIENT_PATH);

  const serverOnly = [...serverFields].filter((f) => !clientFields.has(f)).sort();
  const clientOnly = [...clientFields].filter((f) => !serverFields.has(f)).sort();

  if (serverOnly.length === 0 && clientOnly.length === 0) {
    console.log(
      `check-performance-mirror-drift: ${INTERFACE_NAME} field sets match (${serverFields.size} fields) between ` +
        `${relative(REPO_ROOT, SERVER_PATH)} and ${relative(REPO_ROOT, CLIENT_PATH)}.`,
    );
    process.exit(0);
  }

  for (const f of serverOnly) {
    console.error(
      `[mirror-drift] "${f}" is on ${INTERFACE_NAME} in ${relative(REPO_ROOT, SERVER_PATH)} but missing from ${relative(REPO_ROOT, CLIENT_PATH)}.`,
    );
  }
  for (const f of clientOnly) {
    console.error(
      `[mirror-drift] "${f}" is on ${INTERFACE_NAME} in ${relative(REPO_ROOT, CLIENT_PATH)} but missing from ${relative(REPO_ROOT, SERVER_PATH)}.`,
    );
  }
  console.error(
    `\n${serverOnly.length + clientOnly.length} mirror-drift violation(s). Both files' header comments say a ` +
      `change to one is a change to both — mirror the field(s) rather than loosening this gate.`,
  );
  process.exit(1);
}

main();
