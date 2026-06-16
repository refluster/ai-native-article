#!/usr/bin/env node
// L2 mechanical check (Dario; FU-PROJ-SCAN) — forbid the single-page
// `scanPrefix(...)` shape in workforce Lambda code.
//
// A filtered DynamoDB `Scan` applies `Limit` to the number of items
// EVALUATED, not the number that survive the `FilterExpression`. So a
// `scanPrefix` call whose page is consumed once — without a
// `do { ... } while (cursor)` drain — silently truncates the result to
// whatever matched inside the first scan window. That is the 2026-06-15
// projects-console disappearance: `agent-workforce` "vanished" from the
// console while its `PROJECT#/META` row sat intact in DDB, because the
// PROJECT rows scanned past the first 25-item window of a single table
// dominated by EXEC#/MSG#/AGENT# rows. The FOOTGUN doc on
// `shared/ddb.ts:scanPrefix` can only ASK for the drain; this lint enforces
// it so the bug CLASS cannot recur via a new endpoint.
//
// Rule: every `scanPrefix(` CALL SITE under `workforce/lambdas/**`
// (excluding tests and the `shared/ddb.ts` definition) MUST be lexically
// inside a `do { ... } while (...)` block. A list endpoint that returns a
// whole entity type must use `scanAllPrefix()` (which drains internally)
// instead of a hand-rolled single page.
//
// Dependency-free (mirrors the other workforce/scripts/*.mjs — no @aws-sdk
// or typescript import, no build step). Exits non-zero on violation; wired
// into CI alongside workforce:naming / workforce:openapi-routes.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const WORKFORCE_ROOT = join(HERE, "..");
const REPO_ROOT = join(WORKFORCE_ROOT, "..");
const LAMBDAS_DIR = join(WORKFORCE_ROOT, "lambdas");

// Exempt from the rule:
//  - tests: the DDB mock declares a `scanPrefix` fake; it is never a real
//    Scan, and the faithful mock deliberately models a single page.
//  - shared/ddb.ts: defines + documents `scanPrefix`; the definition's
//    `scanPrefix<T>(` would otherwise match the call-site regex.
const isExempt = (rel) =>
  /-tests\.ts$/.test(rel) ||
  /\.test\.ts$/.test(rel) ||
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

// Replace comment + string/template-literal interiors with spaces, preserving
// newlines and structural characters, so the brace scanner never trips on a
// `{` / `}` / `do` that lives inside a comment or a string. Template `${}`
// interpolations are blanked with the rest of the template — scanPrefix is
// never called inside a template literal, so this is safe and avoids a
// nested-brace parser.
function blankNonCode(src) {
  let out = "";
  let state = "code"; // code | line | block | sq | dq | tpl
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const c2 = src[i + 1];
    if (state === "code") {
      if (c === "/" && c2 === "/") { state = "line"; out += "  "; i++; continue; }
      if (c === "/" && c2 === "*") { state = "block"; out += "  "; i++; continue; }
      if (c === "'") { state = "sq"; out += " "; continue; }
      if (c === '"') { state = "dq"; out += " "; continue; }
      if (c === "`") { state = "tpl"; out += " "; continue; }
      out += c;
      continue;
    }
    if (state === "line") {
      if (c === "\n") { state = "code"; out += "\n"; } else out += " ";
      continue;
    }
    if (state === "block") {
      if (c === "*" && c2 === "/") { state = "code"; out += "  "; i++; continue; }
      out += c === "\n" ? "\n" : " ";
      continue;
    }
    // string / template states
    if (c === "\\") { out += "  "; i++; continue; } // skip escaped char
    if (state === "sq" && c === "'") { state = "code"; out += " "; continue; }
    if (state === "dq" && c === '"') { state = "code"; out += " "; continue; }
    if (state === "tpl" && c === "`") { state = "code"; out += " "; continue; }
    out += c === "\n" ? "\n" : " ";
  }
  return out;
}

const CALL_RE = /\bscanPrefix\s*(?:<[^>]*>)?\s*\(/g;

function lineOf(src, idx) {
  let line = 1;
  for (let i = 0; i < idx; i++) if (src[i] === "\n") line++;
  return line;
}

const violations = [];

for (const file of walk(LAMBDAS_DIR)) {
  const rel = relative(REPO_ROOT, file);
  if (isExempt(rel)) continue;

  const code = blankNonCode(readFileSync(file, "utf8"));

  const callIdx = [];
  let m;
  CALL_RE.lastIndex = 0;
  while ((m = CALL_RE.exec(code)) !== null) callIdx.push(m.index);
  if (callIdx.length === 0) continue;

  // One forward pass with a brace stack. Each frame records whether it is a
  // `do { ... }` block (the token immediately before `{` is the `do`
  // keyword). At each call-site index, require SOME enclosing do-frame.
  const stack = []; // booleans: isDoBlock
  let ci = 0;
  for (let i = 0; i < code.length && ci < callIdx.length; i++) {
    while (ci < callIdx.length && callIdx[ci] === i) {
      if (!stack.some(Boolean)) violations.push({ rel, line: lineOf(code, i) });
      ci++;
    }
    const c = code[i];
    if (c === "{") {
      const before = code.slice(Math.max(0, i - 8), i);
      stack.push(/\bdo\s*$/.test(before));
    } else if (c === "}") {
      stack.pop();
    }
  }
}

if (violations.length === 0) {
  const scanned = "workforce/lambdas/**/*.ts";
  console.log(
    `workforce/scripts/check-scan-drain.mjs: OK — every scanPrefix() call site in ${scanned} is inside a do/while drain.`,
  );
  process.exit(0);
}

for (const { rel, line } of violations) {
  console.error(
    `[scan-drain] ${rel}:${line}: single-page scanPrefix() — DynamoDB Scan's Limit bounds items ` +
      `EVALUATED, not matched, so this silently truncates to the first scan window. Wrap it in a ` +
      `\`do { … } while (cursor)\` drain, or use scanAllPrefix() for a whole-entity-type list ` +
      `(FU-PROJ-SCAN; see the FOOTGUN note on shared/ddb.ts:scanPrefix).`,
  );
}
console.error(`\n${violations.length} violation(s).`);
process.exit(1);
