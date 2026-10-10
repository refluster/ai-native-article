#!/usr/bin/env node
// check-book.mjs — the editorial gate for the console's web books
// (workforce/app/src/content/books/<slug>/). The book-side twin of the
// article pipeline's W-1: a manuscript defect must turn the build red, never
// ship as a blank chapter or a misquoted classic (C-1 / C-4).
//
// Runs from the workforce app's `prebuild`, so `npm run build` (CI) and the
// console deploy both refuse a broken book. Also runnable by hand:
//
//   node workforce/scripts/check-book.mjs            # every book
//   node workforce/scripts/check-book.mjs sunzi      # one book
//
// What it checks, per book:
//   B1  book.json is well-formed (slug matches the folder, parts/chapters
//       non-empty, ids unique, every chapter `file` exists)
//   B2  every chapter opens with a single `# ` title and has no raw HTML
//   B3  every ```quote block carries 原文 / 訓読 / 出典 and its 原文 appears
//       VERBATIM in the book's quote register (quotes.md) — the writers may
//       not cite a sentence the research pack did not verify
//   B4  every ```connect block has a `title:` first line; ```note is non-empty
//   B5  every figure `![…](figures/x.svg)` exists and paints with CSS
//       variables only (no raw hex) so it follows the reader's theme
//   B6  a chapter's visible text is at least MIN_CHARS unless the manifest
//       marks it `"short": true` (an appendix, a generated list)
//   B7  the generated quote appendix (`generated: "quotes"`) is in sync with
//       quotes.md (see build-book-quotes-appendix.mjs)
//
// Exit 0 = clean, 2 = defects (listed), 1 = usage / IO error.

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderQuotesAppendix, parseQuoteRegister } from "./lib/book-quotes.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
export const BOOKS_DIR = join(REPO, "workforce", "app", "src", "content", "books");

/** Minimum visible characters for a real chapter. A 文庫 chapter runs
 *  5,000–7,000; 2,000 is the floor below which a "chapter" is a stub. */
export const MIN_CHARS = 2000;

const HEX_RE = /#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})\b/i;
const QUOTE_KEYS = ["原文", "訓読", "出典"];

/** Strip fences, markdown syntax and whitespace to approximate the text a
 *  reader actually sees. Mirrors `estimateMinutes` in the SPA loosely; the
 *  gate only needs a stable lower bound, not the reader's exact number. */
export function visibleChars(markdown) {
  const noFences = markdown.replace(/```[a-z]*\n([\s\S]*?)```/g, (_m, body) =>
    body.replace(/^(原文|訓読|出典|訳|title):\s*/gm, ""),
  );
  return noFences
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`|\-]+/g, "")
    .replace(/\s+/g, "").length;
}

/** Every fenced block: { lang, body, line }. */
export function fencedBlocks(markdown) {
  const out = [];
  const re = /^```([a-zA-Z0-9_-]*)[^\n]*\n([\s\S]*?)^```/gm;
  let m;
  while ((m = re.exec(markdown))) {
    const line = markdown.slice(0, m.index).split("\n").length;
    out.push({ lang: m[1], body: m[2], line });
  }
  return out;
}

export function parseKeyValues(body) {
  const kv = {};
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const i = line.indexOf(":");
    if (i < 0) continue;
    kv[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return kv;
}

function loadManifest(dir, slug, defects) {
  const file = join(dir, "book.json");
  if (!existsSync(file)) {
    defects.push(`${slug}: book.json missing`);
    return null;
  }
  let m;
  try {
    m = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    defects.push(`${slug}: book.json is not valid JSON (${e.message})`);
    return null;
  }
  if (m.slug !== slug) defects.push(`${slug}: book.json slug "${m.slug}" ≠ folder`);
  for (const k of ["title", "lang", "kicker", "description", "version", "updated"]) {
    if (typeof m[k] !== "string" || !m[k]) defects.push(`${slug}: book.json.${k} missing`);
  }
  if (!Array.isArray(m.authors) || m.authors.length === 0) defects.push(`${slug}: book.json.authors empty`);
  if (!Array.isArray(m.parts) || m.parts.length === 0) {
    defects.push(`${slug}: book.json.parts empty`);
    return m;
  }
  const ids = new Set();
  for (const p of m.parts) {
    if (!p.id || !p.title) defects.push(`${slug}: part without id/title`);
    if (!Array.isArray(p.chapters) || p.chapters.length === 0) defects.push(`${slug}: part "${p.id}" has no chapters`);
    for (const c of p.chapters ?? []) {
      if (!c.id || !c.file || !c.title) defects.push(`${slug}: chapter without id/file/title in part "${p.id}"`);
      if (ids.has(c.id)) defects.push(`${slug}: duplicate chapter id "${c.id}"`);
      ids.add(c.id);
      if (c.file && !existsSync(join(dir, c.file))) defects.push(`${slug}: chapter file missing: ${c.file}`);
    }
  }
  return m;
}

function checkFigure(dir, slug, chapterFile, ref, defects) {
  const path = join(dir, ref);
  if (!existsSync(path)) {
    defects.push(`${slug}/${chapterFile}: figure missing: ${ref}`);
    return;
  }
  const svg = readFileSync(path, "utf8");
  if (!/<svg[\s>]/.test(svg)) defects.push(`${slug}/${ref}: not an <svg> document`);
  if (!/viewBox=/.test(svg)) defects.push(`${slug}/${ref}: svg lacks viewBox`);
  if (HEX_RE.test(svg)) defects.push(`${slug}/${ref}: raw hex colour — paint with var(--book-*) so the night theme works`);
}

export function checkBook(dir, slug) {
  const defects = [];
  const m = loadManifest(dir, slug, defects);
  if (!m) return defects;

  const registerPath = join(dir, "quotes.md");
  const register = existsSync(registerPath) ? parseQuoteRegister(readFileSync(registerPath, "utf8")) : null;
  const originals = new Set((register ?? []).map((q) => q.原文));

  for (const p of m.parts ?? []) {
    for (const c of p.chapters ?? []) {
      if (!c.file || !existsSync(join(dir, c.file))) continue;
      const md = readFileSync(join(dir, c.file), "utf8");
      const tag = `${slug}/${c.file}`;

      // B2
      const h1s = md.split("\n").filter((l) => /^# /.test(l));
      if (h1s.length !== 1 || !md.startsWith("# ")) defects.push(`${tag}: must open with exactly one "# title" line (found ${h1s.length})`);
      const outsideFences = md.replace(/```[\s\S]*?```/g, "");
      if (/<(?!br\s*\/?>)[a-zA-Z][^>]*>/.test(outsideFences)) defects.push(`${tag}: raw HTML is not rendered — use the fenced blocks`);

      // B7 generated appendix
      if (c.generated === "quotes") {
        if (!register) defects.push(`${tag}: generated quote appendix but no quotes.md`);
        else if (renderQuotesAppendix(register, c.title) !== md) defects.push(`${tag}: out of sync with quotes.md — run node workforce/scripts/build-book-quotes-appendix.mjs ${slug}`);
        continue;
      }

      // B3 / B4
      for (const b of fencedBlocks(md)) {
        if (b.lang === "quote") {
          const kv = parseKeyValues(b.body);
          for (const k of QUOTE_KEYS) if (!kv[k]) defects.push(`${tag}:${b.line}: quote block lacks ${k}`);
          if (kv.原文) {
            if (!register) defects.push(`${tag}:${b.line}: quote used but the book has no quotes.md register`);
            else if (!originals.has(kv.原文)) defects.push(`${tag}:${b.line}: 原文 not in quotes.md: 「${kv.原文.slice(0, 40)}…」`);
          }
        } else if (b.lang === "connect") {
          if (!/^title:\s*\S/.test(b.body.trimStart())) defects.push(`${tag}:${b.line}: connect block must start with "title: …"`);
          if (b.body.trim().split("\n").length < 2) defects.push(`${tag}:${b.line}: connect block has no body`);
        } else if (b.lang === "note") {
          if (!b.body.trim()) defects.push(`${tag}:${b.line}: empty note block`);
        } else if (b.lang && !["mermaid"].includes(b.lang)) {
          defects.push(`${tag}:${b.line}: unknown fenced block "${b.lang}" (quote | connect | note)`);
        }
      }

      // B5
      for (const fm of md.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
        const ref = fm[1].trim();
        if (ref.endsWith(".svg")) checkFigure(dir, slug, c.file, ref, defects);
      }

      // B6
      const n = visibleChars(md);
      if (!c.short && n < MIN_CHARS) defects.push(`${tag}: only ${n} visible characters (< ${MIN_CHARS}) — a stub, not a chapter`);
    }
  }
  return defects;
}

function main() {
  const only = process.argv[2];
  if (!existsSync(BOOKS_DIR)) {
    console.log("check-book: no books directory — nothing to check");
    return 0;
  }
  const slugs = readdirSync(BOOKS_DIR).filter((s) => statSync(join(BOOKS_DIR, s)).isDirectory());
  const targets = only ? slugs.filter((s) => s === only) : slugs;
  if (only && targets.length === 0) {
    console.error(`check-book: no book "${only}" under ${BOOKS_DIR}`);
    return 1;
  }
  let total = 0;
  for (const slug of targets) {
    const defects = checkBook(join(BOOKS_DIR, slug), slug);
    total += defects.length;
    if (defects.length) {
      console.error(`check-book: ${slug} — ${defects.length} defect(s)`);
      for (const d of defects) console.error(`  ✗ ${d}`);
    } else {
      console.log(`check-book: ${slug} OK`);
    }
  }
  return total ? 2 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
