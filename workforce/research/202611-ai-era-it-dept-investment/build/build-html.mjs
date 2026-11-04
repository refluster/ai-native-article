#!/usr/bin/env node
// report.md → report.html (self-contained; inline CSS + SVG; no external requests).
// Usage: node build/build-html.mjs [--marked <path-to-marked-package-dir>]
// FIG blocks in report.md:
//   <!-- FIG id="0-1" type="roadmap" -->
//   **図 0-1 caption** (出典: ...)
//   <!-- DATA {json} -->
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { renderFigure } from "./figures.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = resolve(HERE, "..");
const args = process.argv.slice(2);
const markedDir = args.includes("--marked") ? args[args.indexOf("--marked") + 1] : process.env.MARKED_DIR;
let marked;
try {
  const spec = markedDir ? pathToFileURL(join(markedDir, "node_modules/marked/lib/marked.esm.js")).href : "marked";
  ({ marked } = await import(spec));
} catch (e) {
  console.error("marked not found — pass --marked <dir containing node_modules/marked>", e.message);
  process.exit(1);
}

const md = readFileSync(join(DIR, "report.md"), "utf8");
const css = readFileSync(join(HERE, "report.css"), "utf8");

// ---- extract figures ----
// optional trailing group: a markdown table right after the block, consumed when DATA says
// {"table":"following-markdown"} so it renders inside the figure (with its table twin/note).
const figRe = /<!--\s*FIG\s+id="([^"]+)"\s+type="([^"]+)"\s*-->\s*\n([\s\S]*?)\n<!--\s*DATA\s*\n?([\s\S]*?)-->(\n[ \t]*\n((?:\|[^\n]*(?:\n|$))+))?/g;
const splitRow = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
const parseMdTable = (t) => { const ls = t.trim().split("\n").filter((l) => !/^\|?\s*:?-{3,}/.test(l.trim())); return { columns: splitRow(ls[0]).map((c) => marked.parseInline(c)), rows: ls.slice(1).map((l) => splitRow(l).map((c) => marked.parseInline(c))) }; };
const figures = [];
let body = md.replace(figRe, (_, id, type, captionMd, json, tblBlock, tblMd) => {
  let data = {};
  try { data = JSON.parse(json.trim()); } catch (e) { console.error(`FIG ${id}: DATA JSON parse error — ${e.message}`); data = { parseError: e.message }; }
  figures.push({ id, type, data });
  const caption = captionMd.trim().replace(/^\*\*(.+?)\*\*/, "$1");
  let inner;
  const consume = tblMd && data.table === "following-markdown";
  try { inner = renderFigure(type, data, { md, id, table: consume ? parseMdTable(tblMd) : null }); } catch (e) { console.error(`FIG ${id}: render error — ${e.message}`); inner = `<p class="fig-note">描画エラー: ${e.message}</p>`; }
  return `\n<figure class="fig" id="fig-${id}">\n<figcaption>${marked.parseInline(caption)}</figcaption>\n<div class="fig-body">${inner}</div>\n</figure>\n` + (tblBlock && !consume ? tblBlock : "");
});

// ---- metadata & title ----
const titleMatch = body.match(/^#\s+(.+)$/m);
const title = titleMatch ? titleMatch[1].trim() : "Research report";

// ---- headings → ids for TOC ----
const slug = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
const used = new Set();
const renderer = new marked.Renderer();
const headings = [];
renderer.heading = ({ text, depth, tokens }) => {
  const plain = tokens.map((t) => t.text ?? t.raw ?? "").join("");
  let id = slug(plain) || `h${depth}`;
  while (used.has(id)) id += "-";
  used.add(id);
  if (depth === 2) headings.push({ id, text: plain });
  return `<h${depth} id="${id}">${marked.parseInline(text)}</h${depth}>\n`;
};
renderer.table = ({ header, rows }) => {
  const th = header.map((c) => `<th>${marked.parseInline(c.text)}</th>`).join("");
  const tr = rows.map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row">${marked.parseInline(c.text)}</th>` : `<td>${marked.parseInline(c.text)}</td>`)).join("")}</tr>`).join("");
  return `<div class="table-wrap"><table class="data"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>\n`;
};
marked.use({ renderer, gfm: true });

// citation chips [S-x.y] → links to the register
body = body.replace(/\[(S-\d+\.\d+)\]/g, (m, id) => `<a class="cite" href="#src-${id}">${id}</a>`);
let html = marked.parse(body);
// anchor register rows
html = html.replace(/<th scope="row">(S-\d+\.\d+)<\/th>/g, (m, id) => `<th scope="row" id="src-${id}">${id}</th>`);
// drop the markdown TOC body if any (we render our own) — keep heading
const toc = `<nav class="toc" aria-label="目次"><ol>${headings.filter((h) => h.text !== "目次").map((h) => `<li><a href="#${h.id}">${h.text}</a></li>`).join("")}</ol></nav>`;
html = html.replace(/(<h2 id="[^"]*">目次<\/h2>\n)([\s\S]*?)(?=<h2 )/, `$1${toc}\n`);

const chars = md.replace(/```[\s\S]*?```/g, "").replace(/<!--[\s\S]*?-->/g, "").replace(/\s/g, "").length;
const readMin = Math.round(chars / 600);

const page = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title.replace(/<[^>]+>/g, "")}</title>
<meta name="description" content="AI エージェント時代の企業 IT 部門が先行投資すべき領域 — ワークフォースによる 12 段階ゲート付き調査報告">
<style>${css}</style>
</head>
<body>
<a class="skip" href="#main">本文へ</a>
<div class="theme-toggle"><button type="button" data-theme-set="light" aria-label="ライト">☀</button><button type="button" data-theme-set="dark" aria-label="ダーク">☾</button><button type="button" data-theme-set="" aria-label="自動">A</button></div>
<main id="main" class="report">
<p class="meta-line">読了時間 約 ${readMin} 分 · 本文 ${chars.toLocaleString("ja-JP")} 字 · 図表 ${figures.length} 点 · ビルド ${new Date().toISOString().slice(0, 10)}</p>
${html}
</main>
<script>
(function(){var r=document.documentElement;try{var t=localStorage.getItem("theme");if(t)r.setAttribute("data-theme",t);}catch(e){}
document.querySelectorAll("[data-theme-set]").forEach(function(b){b.addEventListener("click",function(){var v=b.getAttribute("data-theme-set");if(v)r.setAttribute("data-theme",v);else r.removeAttribute("data-theme");try{v?localStorage.setItem("theme",v):localStorage.removeItem("theme");}catch(e){}});});})();
</script>
</body>
</html>
`;
writeFileSync(join(DIR, "report.html"), page);
console.log(`report.html written: ${(page.length / 1024).toFixed(0)} KB, ${figures.length} figures, ${chars} chars, ${headings.length} sections`);
const bad = figures.filter((f) => f.data.parseError);
if (bad.length) { console.error("figures with DATA parse errors:", bad.map((f) => f.id).join(", ")); process.exit(2); }
