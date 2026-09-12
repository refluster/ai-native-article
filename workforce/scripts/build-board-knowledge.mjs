#!/usr/bin/env node
// build-board-knowledge.mjs — assemble the public knowledge pack the
// wf-board-reply Lambda grounds its answers in (ADR-0034 §Decision 3).
//
// Sources (all PUBLIC — nothing here is a credential, a budget line or a
// client detail; the pack is served back to guests verbatim, in prose):
//   - a hand-written orientation section (what these products are, where)
//   - workforce/docs/mvv.md                         mission / vision / values
//   - workforce/app/public/docs/{founding-story,manifesto,whitepaper}.html
//                                                   the /docs/ pages, HTML → text
//   - workforce/docs/agent-workflow-overview.md     plain-language (ja) overview
//   - CLAUDE.md                                     repository map + content flow
//   - workforce/lambdas/README.md                   the Lambda catalogue
//   - workforce/docs/governance.md §2 + §4          W-1..W-5, R-N shape rules
//   - workforce/docs/adr/adr-*.md                   one index line per decision
//   - workforce/ROADMAP.md                          phases
//
// Output: one markdown file of `## [source] Title` sections (a `|pinned`
// suffix marks always-included sections). The Lambda's Makefile runs this
// at `sam build` time with `--out $(ARTIFACTS_DIR)/board-knowledge.md`, so
// the pack is refreshed on every data-plane deploy and never committed.
//
// Dependency-free by design (mirrors the other workforce/scripts/*.mjs):
// the HTML → text conversion is a small tag-stripping pass tuned to the
// three static docs pages, not a general-purpose parser.
//
// Usage:
//   node workforce/scripts/build-board-knowledge.mjs --out <file>
//   node workforce/scripts/build-board-knowledge.mjs --check   (validate sources, print stats)

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");

// --- HTML → text ---------------------------------------------------------

const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", mdash: "—", ndash: "–",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", copy: "©", times: "×", rarr: "→",
};

export function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

/**
 * Convert one of the static docs pages to markdown-ish text: headings keep
 * their level, list items become `- `, table cells join with ` | `, block
 * elements break lines, everything else is stripped. Scripts, styles and
 * the head are dropped first.
 */
export function htmlToText(html) {
  let s = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<(nav|footer)[\s\S]*?<\/\1>/gi, "");
  s = s
    .replace(/<h1[^>]*>/gi, "\n\n# ")
    .replace(/<h2[^>]*>/gi, "\n\n## ")
    .replace(/<h3[^>]*>/gi, "\n\n### ")
    .replace(/<h4[^>]*>/gi, "\n\n#### ")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/(td|th)>/gi, " | ")
    .replace(/<(br|hr)\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|section|article|ul|ol|tr|table|thead|tbody|blockquote|figure|figcaption|pre|dl|dt|dd|main|header|aside)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  s = decodeEntities(s);
  return s
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").replace(/\s+\|\s*$/, "").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// --- Markdown sectioning -------------------------------------------------

/**
 * Split markdown/text into `{title, body}` blocks at `#`/`##` headings.
 * Text before the first heading becomes a block titled `leadTitle`.
 * Deeper headings stay inside their parent block's body.
 */
export function splitSections(text, leadTitle) {
  const blocks = [];
  let title = leadTitle;
  let body = [];
  const push = () => {
    const b = body.join("\n").trim();
    if (b.length > 0 && title) blocks.push({ title, body: b });
    body = [];
  };
  for (const line of text.split("\n")) {
    const m = /^#{1,2} (.+)$/.exec(line);
    if (m) {
      push();
      title = m[1].replace(/[*_`]/g, "").trim();
      continue;
    }
    body.push(line);
  }
  push();
  return blocks;
}

/** Drop markdown noise that helps nobody in a prompt: HTML comments,
 *  badge/status banners, mermaid fences (the diagram source is not prose). */
function cleanMarkdown(md) {
  return md
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/```mermaid[\s\S]*?```/g, "(diagram omitted)")
    .trim();
}

function read(rel) {
  const p = join(REPO_ROOT, rel);
  if (!existsSync(p)) throw new Error(`build-board-knowledge: missing source ${rel}`);
  return readFileSync(p, "utf8");
}

function slice(md, fromHeading, toHeading) {
  const start = md.indexOf(fromHeading);
  if (start === -1) throw new Error(`build-board-knowledge: heading not found: ${fromHeading}`);
  const end = toHeading ? md.indexOf(toHeading, start + fromHeading.length) : -1;
  return end === -1 ? md.slice(start) : md.slice(start, end);
}

// --- Sources -------------------------------------------------------------

const ORIENTATION = `
This knowledge pack describes two products in one repository, built and run by a single human operator (Koh Uehara) together with an AI agent workforce:

- **Software Talent Network / Agent Workforce** — an AI-persona "company" of roughly fifty agents on AWS (DynamoDB + S3 state, SAM-deployed Lambdas, an HTTP API) whose skills fire as Claude Code Remote routines. The agents write articles, review and merge pull requests, run a podcast, research markets and report to the operator. Console: https://workforce.kohuehara.xyz/ (public pages: the landing page, /research, /docs/). API: https://workforce-api.kohuehara.xyz/.
- **AI Native Article** — a bilingual (Japanese / English) article site at https://kohuehara.xyz/ai-native-article/. Sources (L1) are captured into Notion; the workforce's article cadences write explanations (L2) and analyses (L3) in both languages; a GitHub Actions deploy exports Notion to markdown and publishes a React reader to GitHub Pages three times a day.
- **Source code** — the monorepo https://github.com/refluster/ai-native-article holds both products plus the governance layer (layered rules: L0 invariants → L1 statute and ADRs → L2 mechanical CI gates → L3 runbooks).

Themes people ask about: multi-agent organisations, an AI workforce as "virtual labour capital", speeding up software delivery with agents, outsourcing work outside one's expertise to AI agents, and how governance keeps an autonomous organisation safe.
`.trim();

export function buildKnowledgePack({ now = new Date() } = {}) {
  const sections = [];
  const add = (source, title, body, pinned = false) => {
    // One heading level belongs to the pack (`## [source] Title`); any
    // heading a source carries inside its body is demoted so the Lambda's
    // parser — and a reader — see exactly one section boundary per section.
    const b = body.trim().replace(/^#{1,2} /gm, "### ");
    if (b.length === 0) return;
    sections.push({ source, title: title.trim(), body: b, pinned });
  };

  add("about", "What this is (orientation)", ORIENTATION, true);

  // MVV: mission + vision pinned; the rest selectable.
  const mvv = cleanMarkdown(read("workforce/docs/mvv.md"));
  for (const [i, block] of splitSections(mvv, "Agent Workforce — MVV").entries()) {
    const pinned = /^(mission|vision)$/i.test(block.title);
    add("mvv", block.title, block.body, pinned || i === 0);
  }

  // The three public docs pages.
  for (const [file, source] of [
    ["founding-story.html", "founding-story"],
    ["manifesto.html", "manifesto"],
    ["whitepaper.html", "whitepaper"],
  ]) {
    const text = htmlToText(read(join("workforce/app/public/docs", file)));
    const titleLine = text.split("\n").find((l) => l.startsWith("# ")) ?? `# ${source}`;
    const docTitle = titleLine.replace(/^# /, "").trim();
    for (const block of splitSections(text, docTitle)) {
      add(source, `${docTitle} — ${block.title}`, block.body);
    }
  }

  // Plain-language Japanese overview of who does what.
  const overview = cleanMarkdown(read("workforce/docs/agent-workflow-overview.md"));
  for (const block of splitSections(overview, "Agent Workforce 全体像")) {
    add("workflow-overview", block.title, block.body);
  }

  // Repository map + content flow from CLAUDE.md.
  const claude = read("CLAUDE.md");
  add("repo", "Repository map", slice(claude, "## Repository map", "## How content flows"));
  add("repo", "How content flows (L1 → L2/L3 → publish)", slice(claude, "## How content flows", "## Doc map"));
  add("repo", "The quality layer (Software 2.0)", slice(claude, "## The quality layer", "## Action authority"));

  // Lambda catalogue.
  const lambdas = read("workforce/lambdas/README.md");
  add("lambdas", "Workforce Lambdas (data plane catalogue)", slice(lambdas, "## Layout", "## Local dev"));

  // Governance: invariants + shape rules.
  const gov = read("workforce/docs/governance.md");
  add("governance", "Workforce L0 invariants (W-1..W-5)", slice(gov, "## §2.", "## §3."));
  add("governance", "Workforce design rules (R-N1..R-N10)", slice(gov, "## §4.", "## §5."));

  // ADR index: one line per decision, from each file's own header.
  const adrDir = join(REPO_ROOT, "workforce/docs/adr");
  const adrLines = readdirSync(adrDir)
    .filter((f) => /^adr-\d{4}-.+\.md$/.test(f))
    .sort()
    .map((f) => {
      const src = readFileSync(join(adrDir, f), "utf8");
      const title = (src.split("\n").find((l) => l.startsWith("# ")) ?? `# ${basename(f, ".md")}`).slice(2).trim();
      const status = (/\*\*Status\*\*:\s*([^\n]+)/.exec(src)?.[1] ?? "").trim();
      return `- ${title}${status ? ` (${status})` : ""}`;
    });
  add("adr", "Architecture decision records (index)", adrLines.join("\n"));

  // Roadmap phases.
  const roadmap = cleanMarkdown(read("workforce/ROADMAP.md"));
  for (const block of splitSections(roadmap, "Workforce — ROADMAP")) {
    add("roadmap", block.title, block.body);
  }

  const banner = [
    "# Board knowledge pack",
    `<!-- generated by workforce/scripts/build-board-knowledge.mjs at ${now.toISOString()} — do not edit; regenerate -->`,
    "",
  ].join("\n");
  const rendered = sections
    .map((s) => `## [${s.source}${s.pinned ? "|pinned" : ""}] ${s.title}\n\n${s.body}\n`)
    .join("\n");
  return { sections, markdown: `${banner}\n${rendered}` };
}

// --- CLI -----------------------------------------------------------------

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf("--out");
  const out = outIdx === -1 ? undefined : args[outIdx + 1];
  const check = args.includes("--check");
  if (!out && !check) {
    console.error("usage: build-board-knowledge.mjs --out <file> | --check");
    process.exit(2);
  }
  const pack = buildKnowledgePack();
  const bySource = {};
  for (const s of pack.sections) bySource[s.source] = (bySource[s.source] ?? 0) + 1;
  console.log(
    `build-board-knowledge: ${pack.sections.length} sections, ${pack.markdown.length} chars — ` +
      Object.entries(bySource).map(([k, v]) => `${k}:${v}`).join(" "),
  );
  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, pack.markdown);
    console.log(`build-board-knowledge: wrote ${out}`);
  }
}
