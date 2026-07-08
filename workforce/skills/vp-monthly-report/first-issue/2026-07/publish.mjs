#!/usr/bin/env node
// One-shot publisher for the inaugural (2026-07) VP letters. Loops the
// skill's deterministic writer (vp-monthly-report/post.mjs → canonical
// monthly-report/post.mjs, W-1 guarded) over the staged bodies in this
// directory. Fails loud on the first non-zero exit (C-4) so a partial
// publish is never mistaken for a complete one.
//
// Usage:
//   NOTION_API_KEY=... node workforce/skills/vp-monthly-report/first-issue/2026-07/publish.mjs [slug ...]
// With no args, publishes all 7; with args, only the named slugs (re-run path).

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const POST = join(HERE, "..", "..", "post.mjs");
const ALL = ["dario", "mateo", "priya", "silas", "celeste", "elena", "tessa"];

if (!process.env.NOTION_API_KEY) {
  console.error("publish.mjs: NOTION_API_KEY env var is required");
  process.exit(1);
}

const requested = process.argv.slice(2);
const unknown = requested.filter((s) => !ALL.includes(s));
if (unknown.length) {
  console.error(`publish.mjs: unknown slug(s) ${unknown.join(", ")} — valid: ${ALL.join(", ")}`);
  process.exit(1);
}
const slugs = requested.length ? requested : ALL;

for (const slug of slugs) {
  const body = join(HERE, `${slug}.md`);
  const abstract = join(HERE, `${slug}-abstract.txt`);
  if (!existsSync(body)) {
    console.error(`publish.mjs: ${body} missing`);
    process.exit(1);
  }
  console.log(`— publishing ${slug} …`);
  const args = [POST, "--agent", slug, "--body-file", body];
  if (existsSync(abstract)) args.push("--abstract-file", abstract);
  const res = spawnSync(process.execPath, args, { stdio: "inherit", env: process.env });
  if (res.status !== 0) {
    console.error(`publish.mjs: ${slug} failed with exit ${res.status} — fix and re-run \`publish.mjs ${slugs.slice(slugs.indexOf(slug)).join(" ")}\``);
    process.exit(res.status ?? 3);
  }
}
console.log(`publish.mjs: all ${slugs.length} letter(s) published. Notion is now authoritative — delete this directory in a follow-up commit (see README).`);
