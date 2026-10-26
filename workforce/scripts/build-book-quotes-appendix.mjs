#!/usr/bin/env node
// build-book-quotes-appendix.mjs — regenerate a book's 名言集 appendix chapter
// from its quote register (quotes.md). The manifest marks the target chapter
// with `"generated": "quotes"`; check-book.mjs refuses a build where the two
// have drifted, so the register is the one place a quotation lives.
//
//   node workforce/scripts/build-book-quotes-appendix.mjs sunzi

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { BOOKS_DIR } from "./check-book.mjs";
import { parseQuoteRegister, renderQuotesAppendix } from "./lib/book-quotes.mjs";

const slug = process.argv[2];
if (!slug) {
  console.error("usage: build-book-quotes-appendix.mjs <book-slug>");
  process.exit(1);
}
const dir = join(BOOKS_DIR, slug);
const manifest = JSON.parse(readFileSync(join(dir, "book.json"), "utf8"));
const target = manifest.parts.flatMap((p) => p.chapters).find((c) => c.generated === "quotes");
if (!target) {
  console.error(`${slug}: no chapter with "generated": "quotes" in book.json`);
  process.exit(1);
}
const registerPath = join(dir, "quotes.md");
if (!existsSync(registerPath)) {
  console.error(`${slug}: quotes.md missing`);
  process.exit(1);
}
const entries = parseQuoteRegister(readFileSync(registerPath, "utf8"));
const out = renderQuotesAppendix(entries, target.title);
writeFileSync(join(dir, target.file), out);
console.log(`${slug}: wrote ${target.file} (${entries.length} quotes)`);
