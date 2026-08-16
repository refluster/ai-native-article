#!/usr/bin/env node
// L2 mechanical check (workforce-builder; FU-034) — forbid any object-property
// assignment of `sk: "RUN#..."` or `sk: \`DELIV#...\`` (and variants) in
// workforce Lambda code.
//
// ADR-0005 §5 defines the current write surface: the success path writes
// EXEC# rows only. The RUN# and DELIV# row families were retired when the
// Lambda runner was deleted in commit 99aca10 (PR #241). This lint makes that
// architectural fact structurally enforced: a future component cannot write a
// RUN# or DELIV# sibling on the success path without turning CI red.
// (Epic-010 criterion 2 residual; see FU-034 and workforce/ROADMAP.md §89.)
//
// Rule: no TypeScript source file under workforce/lambdas/** (excluding tests
// and the two shared files where the sk-pattern is legitimately defined) may
// assign `sk: "RUN#..."` / `sk: \`RUN#...\`` / or the DELIV# equivalents to
// an object property — the canonical structural signal that a DynamoDB row is
// being CONSTRUCTED with a legacy key.
//
// Why "sk: …" is the right detection point
// -----------------------------------------
// Read operations do not use `sk:` property assignments:
//   - `getItem(pk, sk)` — positional arguments, no property
//   - `queryBySkPrefix(pk, "DELIV#", limit)` — positional string argument
// Write operations DO use `sk:` in an object literal passed to `putItem()`:
//   - `putItem({ pk: agentPk(slug), sk: \`RUN#${ulid}\`, … })`
// So an `sk:` property whose value starts with `RUN#` or `DELIV#` is almost
// exclusively a write-side object construction. The two known-non-write
// exceptions — the TypeScript interface definitions in shared/task.ts and the
// helper-function docstring in shared/ddb.ts — are covered by the exemptions
// below.
//
// Exemptions
// ----------
//  - Test files (*-tests.ts, *.test.ts): mock stores may use RUN# / DELIV#
//    keys to reproduce historical fixture data.
//  - workforce/lambdas/shared/task.ts: TypeScript interface definitions for
//    RunRow and DelivRow carry `sk: \`RUN#${string}\`` as a TYPE annotation.
//  - workforce/lambdas/shared/ddb.ts: the DDB helper; `scanPrefix` docstring
//    references "DELIV#* rows". Exempted for consistency with check-scan-drain.
//  - Lines inside comments (// … and /* … */): stripped before search.
//
// Dependency-free (mirrors the other workforce/scripts/*.mjs — no build step,
// no @aws-sdk imports). Exits non-zero on violation; add to CI beside the
// existing scan-drain guard.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const WORKFORCE_ROOT = join(HERE, "..");
const REPO_ROOT = join(WORKFORCE_ROOT, "..");
const LAMBDAS_DIR = join(WORKFORCE_ROOT, "lambdas");

// Exempt files — see the header comment for rationale.
const isExempt = (rel) =>
  /-tests\.ts$/.test(rel) ||
  /\.test\.ts$/.test(rel) ||
  rel.endsWith(join("shared", "task.ts")) ||
  rel.endsWith(join("shared", "ddb.ts")) ||
  rel.includes("node_modules");

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (name.endsWith(".ts")) out.push(p);
  }
  return out;
}

// Strip line comments (//) and block comments (/* */), preserving all string
// and template-literal CONTENT (so we can detect "RUN#" inside string values)
// and preserving newline characters (so lineOf() stays accurate).
//
// We do NOT blank strings — the opposite of check-scan-drain.mjs's strategy —
// because here we need to FIND patterns inside strings ("RUN#", `DELIV#`), not
// prevent the structural scanner from being misled by stray braces inside them.
function stripComments(src) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const c2 = src[i + 1];

    // Line comment: // … until end of line
    if (c === "/" && c2 === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }

    // Block comment: /* … */
    if (c === "/" && c2 === "*") {
      i += 2;
      while (i < src.length) {
        if (src[i] === "*" && src[i + 1] === "/") { i += 2; break; }
        if (src[i] === "\n") out += "\n";
        i++;
      }
      continue;
    }

    // String literals — pass through unchanged so "RUN#..." is preserved.
    // Escape sequences (\n, \", etc.) are copied verbatim; we just skip two
    // characters at a time so a backslash-quote doesn't end the string.
    if (c === '"' || c === "'") {
      const q = c;
      out += src[i++];
      while (i < src.length) {
        if (src[i] === "\\" && i + 1 < src.length) {
          out += src[i++];
          out += src[i++];
          continue;
        }
        out += src[i];
        if (src[i++] === q) break;
      }
      continue;
    }

    // Template literals — pass through with minimal `${…}` depth tracking so
    // a `}` that closes an interpolation is not mistaken for the end of the
    // template body, and a `//` inside a template is not stripped as a comment.
    if (c === "`") {
      out += src[i++];
      let depth = 0; // brace depth inside ${…} interpolation(s)
      while (i < src.length) {
        const tc = src[i];
        if (tc === "\\" && i + 1 < src.length) {
          out += src[i++];
          out += src[i++];
          continue;
        }
        if (tc === "$" && src[i + 1] === "{") {
          depth++;
          out += src[i++]; // $
          out += src[i++]; // {
          continue;
        }
        if (tc === "{" && depth > 0) { depth++; out += src[i++]; continue; }
        if (tc === "}" && depth > 0) { depth--; out += src[i++]; continue; }
        if (tc === "`" && depth === 0) { out += src[i++]; break; }
        out += src[i++];
      }
      continue;
    }

    out += src[i++];
  }
  return out;
}

function lineOf(src, idx) {
  let line = 1;
  for (let i = 0; i < idx; i++) if (src[i] === "\n") line++;
  return line;
}

// Detect: sk property whose value STARTS with "RUN#", 'RUN#', `RUN#,
//                                                   "DELIV#", 'DELIV#', `DELIV#
//
// The \b before `sk` guards against matching `_sk:` or `rsk:` etc.
// The `(?:` alternation covers double-quoted, single-quoted, and template-literal
// string starts; we only need the opening delimiter because the prefix is what
// matters — any suffix (${ulid}, a literal ulid, "…") is a violation regardless.
const SK_LEGACY_RE =
  /\bsk\s*:\s*(?:"(RUN|DELIV)#|'(RUN|DELIV)#|`(RUN|DELIV)#)/g;

const violations = [];

for (const file of walk(LAMBDAS_DIR)) {
  const rel = relative(REPO_ROOT, file);
  if (isExempt(rel)) continue;

  const src = readFileSync(file, "utf8");
  const stripped = stripComments(src);

  SK_LEGACY_RE.lastIndex = 0;
  let m;
  while ((m = SK_LEGACY_RE.exec(stripped)) !== null) {
    violations.push({ rel, line: lineOf(stripped, m.index) });
  }
}

if (violations.length === 0) {
  console.log(
    `workforce/scripts/check-run-deliv-writes.mjs: OK — no RUN# or DELIV# sk` +
      ` assignments found in workforce/lambdas/**/*.ts` +
      ` (ADR-0005 §5 structural enforcement, FU-034).`,
  );
  process.exit(0);
}

for (const { rel, line } of violations) {
  console.error(
    `[no-run-deliv-writes] ${rel}:${line}: object property \`sk:\` starts with` +
      ` RUN# or DELIV#. ADR-0005 §5: the success path writes EXEC# rows only;` +
      ` RUN# and DELIV# row families were retired with the Lambda runner (PR #241,` +
      ` commit 99aca10). To fix:\n` +
      `  • Type annotations → move to shared/task.ts (already exempt).\n` +
      `  • Query/scan filters → use a positional string argument instead of sk:.\n` +
      `  • Genuine write → use EXEC# as the row family (see shared/ccr-fire.ts).\n` +
      `  (FU-034; see workforce/ROADMAP.md Epic-010 criterion 2.)`,
  );
}
console.error(`\n${violations.length} violation(s).`);
process.exit(1);
