#!/usr/bin/env node
// build-board-knowledge.mjs — assemble the public knowledge pack the
// wf-board-reply Lambda grounds its answers in (ADR-0034 §Decision 3).
//
// Sources (all PUBLIC — nothing here is a credential, a budget line or a
// client detail; the pack is spoken back to guests, in prose). Operator
// direction 2026-09-12: the organisation's THESIS — MVV, manifesto,
// founding story — plus the public research articles is the corpus; the
// implementation catalogues are not. Pinned (always in the prompt, in
// full): orientation, mvv.md, manifesto, founding story. Selected by the
// question: the technical whitepaper, the plain-language (ja) workflow
// overview, and every article of the AI Native Article corpus (the
// console's /research reader; newsletter/app/public/posts/*.md).
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
This corpus describes an organisation built and run by a single human founder (referred to here only as "the founder" or "the operator") together with an AI agent workforce, and the article site that workforce writes:

- **Software Talent Network / Agent Workforce** — an organisation of roughly fifty persistent AI professionals, each with a job description, a position, operating principles, long-term memory and a track record, assembling around projects, delivering, and disbanding — under written governance where the human owns purpose and consequence. It has a public console with a landing page, a research reader and public documents (founding story, manifesto, technical whitepaper). The documents below are that organisation's own account of why it exists and how it should work.
- **AI Native Article** — a bilingual (Japanese / English) research site the workforce writes: source material is captured, the agents turn it into explanations and deeper analyses, and an automated publish step rebuilds the reader several times a day. Its articles are included below as the organisation's published thinking.

Themes people ask about: multi-agent organisations, an AI workforce as "virtual labour capital", speeding up software delivery with agents, outsourcing work outside one's expertise to AI agents, and how governance keeps an autonomous organisation safe.
`.trim();

// --- Redaction (ADR-0034 §Decision 3, operator direction 2026-09-12) ------
//
// The pack is spoken back to outside guests, so three classes of text are
// scrubbed at build time regardless of which source they came from:
//   1. external client projects — every project.json under workforce/projects/
//      except the workforce's own `agent-workforce` (id, display name, repo);
//   2. code-hosting detail — URLs, repository slugs, PR/issue numbers, file
//      paths, workflow names;
//   3. the founder's identity — the personal domain and name.
// The reply Lambda applies the same class of scrub at runtime to recall,
// memory and the finished answer (board-reply/handler.ts), so a slip in
// one layer is caught by the other.

const EXTERNAL_PROJECT_PLACEHOLDER = "an external client project";

/**
 * Project ids that are ordinary words ("conference"): matching them would
 * drop every line that uses the word. Their client identity is carried by
 * CLIENT_TOPIC_TERMS instead. Mirrored in shared/board-redact.ts.
 */
export const GENERIC_PROJECT_TERMS = new Set(["conference"]);

/** External client project identifiers read from workforce/projects/. */
export function externalProjectTerms() {
  const dir = join(REPO_ROOT, "workforce", "projects");
  const terms = new Set();
  if (!existsSync(dir)) return [];
  for (const id of readdirSync(dir)) {
    const file = join(dir, id, "project.json");
    if (!existsSync(file) || id === "agent-workforce") continue;
    let data;
    try {
      data = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    for (const t of [data.id, data.name, data.github?.repo, data.github?.owner && data.github?.repo ? `${data.github.owner}/${data.github.repo}` : undefined]) {
      if (typeof t === "string" && t.trim().length >= 3 && !GENERIC_PROJECT_TERMS.has(t.trim().toLowerCase())) terms.add(t.trim());
    }
  }
  // Longest first so "Project IND" is replaced before "IND"-style prefixes.
  return [...terms].sort((a, b) => b.length - a.length);
}

/**
 * Client-work topics that identify an external project even when its name
 * is absent (the whitepaper describes the desks by subject). Operator-
 * maintained; a line mentioning one is dropped like a named mention.
 * Mirrored in workforce/lambdas/shared/board-redact.ts CLIENT_TOPIC_TERMS.
 */
export const CLIENT_TOPIC_TERMS = [
  "India", "インド", "DISCOM", "smart-meter", "smart meter", "smartmeter", "スマートメーター",
  "home energy", "sponsor", "スポンサー", "run-of-show", "investor", "投資家",
];

/** The founder's identity: personal domain (→ "the site") and name. */
const FOUNDER_DOMAIN_TERMS = ["workforce.kohuehara.xyz", "kohuehara.xyz", "kohuehara"];
const FOUNDER_NAME_TERMS = ["Koh Uehara", "Uehara Koh", "Uehara", "上原"];

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function projectTermRe(term) {
  // ASCII terms match as whole tokens; CJK terms have no word boundary.
  return /^[\x00-\x7f]+$/.test(term)
    ? new RegExp(`(?<![A-Za-z0-9_/-])${escapeRe(term)}(?![A-Za-z0-9_-])`, "i")
    : new RegExp(escapeRe(term));
}

/**
 * Scrub one block of text. A line that mentions an external client project
 * is DROPPED whole (a table row or bullet about a client is about the
 * client, not about this organisation); everything else is rewritten in
 * place. Exported so the test can pin each class.
 */
export function scrub(text, projectTerms = externalProjectTerms()) {
  const projectRes = [...projectTerms, ...CLIENT_TOPIC_TERMS].map(projectTermRe);
  const kept = text
    .split("\n")
    .filter((line) => !projectRes.some((re) => re.test(line)));
  let s = kept.join("\n");
  // 2. code-hosting detail + money.
  s = s
    .replace(/https?:\/\/[^\s)\]>"']+/g, "")
    .replace(/\b(?:refluster|PSVL)\/[A-Za-z0-9_.-]+/g, "the repository")
    .replace(/\bgh-pages\b/gi, "the static host")
    .replace(/\bGitHub(?: Actions| Pages)?\b/g, "the code host")
    .replace(/\b(?:PR|pull request|issue)s?\s*#\d{1,5}\b/gi, "a code change")
    .replace(/(?<![A-Za-z0-9])#\d{2,5}\b/g, "")
    .replace(/\b(?:workforce|newsletter|scripts|docs|packages|\.github)\/[A-Za-z0-9_./{}*-]+/g, "(a file in the codebase)")
    .replace(/\b[A-Za-z0-9_.-]+\.(?:mjs|cjs|ts|tsx|js|yml|yaml|toml)\b/g, "(a file in the codebase)")
    .replace(/\bUSD\s?[\d,.]+(?:\s*(?:\/|per)\s*(?:mo|month))?/gi, "a fixed monthly amount")
    .replace(/(?<![A-Za-z])\$\s?\d[\d,.]*(?:\s*(?:\/|per)\s*(?:mo|month))?/g, "a fixed amount");
  // 3. the founder's identity.
  for (const term of FOUNDER_DOMAIN_TERMS) s = s.replace(new RegExp(escapeRe(term), "gi"), "the site");
  for (const term of FOUNDER_NAME_TERMS) s = s.replace(new RegExp(escapeRe(term), "g"), "the founder");
  return s.replace(/\n{3,}/g, "\n\n").trim();
}

/** `<title>` of a docs page, cleaned of the site suffix. */
export function htmlTitle(html) {
  const m = /<title>([\s\S]*?)<\/title>/i.exec(html);
  if (!m) return undefined;
  return decodeEntities(m[1]).replace(/\s+/g, " ").replace(/\s*[—|-]\s*Software Talent Network\s*$/i, "").trim() || undefined;
}

const POSTS_DIR = join(REPO_ROOT, "newsletter", "app", "public", "posts");

/**
 * The AI Native Article corpus (the console's /research reader) as
 * `{title, body}` articles. Frontmatter is dropped; images and links are
 * reduced to their text. An article is EXCLUDED whole when its text
 * mentions an external client project or a client topic — it is client
 * work, and a line-dropped article would be a mutilated one.
 */
export function researchArticles(projectTerms = externalProjectTerms()) {
  const articles = [];
  let excluded = 0;
  if (!existsSync(POSTS_DIR)) return { articles, excluded };
  const files = readdirSync(POSTS_DIR).filter((f) => f.endsWith(".md") && !f.endsWith(".en.md")).sort();
  const clientRes = [...projectTerms, ...CLIENT_TOPIC_TERMS].map(projectTermRe);
  for (const f of files) {
    const raw = readFileSync(join(POSTS_DIR, f), "utf8");
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(raw);
    const front = fm ? fm[1] : "";
    let body = fm ? raw.slice(fm[0].length) : raw;
    const titleMatch = /^title:\s*"?(.*?)"?\s*$/m.exec(front);
    const title = (titleMatch ? titleMatch[1] : basename(f, ".md")).replace(/[*_`]/g, "").trim();
    body = body
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/^#{1,2} .*$/m, "")
      .trim();
    if (body.length < 200) continue;
    if (clientRes.some((re) => re.test(body) || re.test(title))) {
      excluded += 1;
      continue;
    }
    articles.push({ title, body });
  }
  return { articles, excluded };
}

export function buildKnowledgePack({ now = new Date() } = {}) {
  const sections = [];
  const projectTerms = externalProjectTerms();
  const add = (source, title, body, pinned = false) => {
    // One heading level belongs to the pack (`## [source] Title`); any
    // heading a source carries inside its body is demoted so the Lambda's
    // parser — and a reader — see exactly one section boundary per section.
    const b = scrub(body.trim().replace(/^#{1,2} /gm, "### "), projectTerms);
    if (b.length === 0) return;
    sections.push({ source, title: scrub(title.trim(), projectTerms), body: b, pinned });
  };

  add("about", "What this is (orientation)", ORIENTATION, true);

  // MVV — pinned in full.
  const mvv = cleanMarkdown(read("workforce/docs/mvv.md"));
  for (const block of splitSections(mvv, "Agent Workforce — MVV")) {
    add("mvv", block.title, block.body, true);
  }

  // The three public docs pages. Manifesto + founding story are the thesis
  // (pinned in full); the whitepaper is the technical account (selected).
  for (const [file, source, pinned] of [
    ["founding-story.html", "founding-story", true],
    ["manifesto.html", "manifesto", true],
    ["whitepaper.html", "whitepaper", false],
  ]) {
    const html = read(join("workforce/app/public/docs", file));
    const text = htmlToText(html);
    const docTitle = htmlTitle(html) ?? source;
    for (const block of splitSections(text, docTitle)) {
      add(source, `${docTitle} — ${block.title}`, block.body, pinned);
    }
  }

  // Plain-language Japanese overview of who does what (selected).
  const overview = cleanMarkdown(read("workforce/docs/agent-workflow-overview.md"));
  for (const block of splitSections(overview, "Agent Workforce 全体像")) {
    add("workflow-overview", block.title, block.body);
  }

  // The research corpus — every published article, one section each
  // (selected by the question). An article whose text touches an external
  // client project or client topic is left out whole: it is client work.
  const { articles, excluded } = researchArticles(projectTerms);
  for (const a of articles) add("research", a.title, a.body);
  if (excluded > 0) console.error(`build-board-knowledge: ${excluded} research article(s) excluded (client-work terms)`);

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
