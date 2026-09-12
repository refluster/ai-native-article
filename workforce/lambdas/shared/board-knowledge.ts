// workforce/lambdas/shared/board-knowledge.ts
//
// The public knowledge pack a board reply is grounded in (ADR-0034
// §Decision 3). The pack is one markdown file assembled at `sam build`
// time by workforce/scripts/build-board-knowledge.mjs from the repository's
// PUBLIC documents — the founding story, manifesto and whitepaper served at
// workforce.kohuehara.xyz/docs/, the MVV, the repository map from
// CLAUDE.md, the Lambda catalogue, the ADR index — and shipped inside the
// wf-board-reply artefact. Nothing here reads the network or DDB.
//
// Retrieval is deliberately lexical (ADR-0002: no vector store). A guest
// question is tokenised into ASCII words + CJK bigrams, every section is
// scored by the distinct terms it shares with the question (rarer terms
// weigh more), and the top sections are folded into the prompt under a
// character cap. Pinned sections (mission, what-this-is) always ride
// along so an off-topic question still gets a grounded answer.

export interface KnowledgeSection {
  /** Short source tag, e.g. `founding-story`, `mvv`, `repo`. */
  source: string;
  title: string;
  body: string;
  /** Always included, in pack order, ahead of the scored selection. */
  pinned: boolean;
}

/** `## [source] Title` or `## [source|pinned] Title`. */
const SECTION_HEADING = /^## \[([a-z0-9-]+)(\|pinned)?\] (.+)$/;

/** Parse the generated pack into sections. Lines before the first section
 *  heading (the file banner) are ignored. */
export function parseKnowledgePack(markdown: string): KnowledgeSection[] {
  const sections: KnowledgeSection[] = [];
  let current: KnowledgeSection | undefined;
  const bodyLines: string[] = [];
  const flush = () => {
    if (!current) return;
    current.body = bodyLines.join("\n").trim();
    if (current.body.length > 0) sections.push(current);
    bodyLines.length = 0;
  };
  for (const line of markdown.split("\n")) {
    const m = SECTION_HEADING.exec(line);
    if (m) {
      flush();
      current = { source: m[1] ?? "", title: (m[3] ?? "").trim(), body: "", pinned: m[2] !== undefined };
      continue;
    }
    if (current) bodyLines.push(line);
  }
  flush();
  return sections;
}

// --- Tokenisation --------------------------------------------------------

const ASCII_STOP = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "any", "can", "had", "her", "was", "one",
  "our", "out", "has", "have", "this", "that", "with", "from", "they", "what", "your", "how", "why",
  "who", "does", "did", "about", "into", "than", "then", "them", "there", "their", "which", "when",
  "where", "will", "would", "could", "should", "also", "just", "like", "some", "such", "these",
  "those", "were", "been", "being", "over", "under", "more", "most", "very", "much", "many",
]);

// CJK ideographs + katakana (the content-bearing scripts in Japanese
// text). Hiragana is skipped: bigrams over particles and inflections are
// noise, not signal.
const CJK_RUN = /[\u4e00-\u9fff\u3400-\u4dbf\u30a0-\u30ff\uff66-\uff9f]+/g;
const ASCII_WORD = /[a-z0-9][a-z0-9+.#-]{2,}/g;

/** Light English stemmer so "dispatches" meets "dispatch" and "routines"
 *  meets "routine". Applied to both sides, so it only has to be consistent,
 *  not linguistically right. */
export function stem(word: string): string {
  if (word.length > 5 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 6 && word.endsWith("ing")) return word.slice(0, -3);
  if (word.length > 5 && word.endsWith("ed")) return word.slice(0, -2);
  if (word.length > 4 && word.endsWith("s") && !word.endsWith("ss")) {
    const base = word.slice(0, -1);
    // "dispatches" → "dispatche" → "dispatch"; "routines" → "routine" stays.
    return /(?:ch|sh|x|z|ss)e$/.test(base) ? base.slice(0, -1) : base;
  }
  return word;
}

/** Query/section terms: lowercased ASCII words (≥3 chars, no stopwords,
 *  stemmed; a hyphenated compound also yields its parts, so
 *  "wf-orchestrator" meets "orchestrator") and bigrams over kanji/katakana
 *  runs (a 1-char run is kept whole). */
export function tokenise(text: string): Set<string> {
  const out = new Set<string>();
  const lower = text.toLowerCase();
  for (const m of lower.matchAll(ASCII_WORD)) {
    const w = m[0];
    if (ASCII_STOP.has(w)) continue;
    out.add(stem(w));
    if (/[-.+#]/.test(w)) {
      for (const part of w.split(/[-.+#]+/)) {
        if (part.length >= 3 && !ASCII_STOP.has(part)) out.add(stem(part));
      }
    }
  }
  for (const m of lower.matchAll(CJK_RUN)) {
    const run = m[0];
    if (run.length === 1) {
      out.add(run);
      continue;
    }
    for (let i = 0; i + 1 < run.length; i++) out.add(run.slice(i, i + 2));
  }
  return out;
}

// --- Selection -----------------------------------------------------------

export interface SelectKnowledgeOptions {
  /** Total character budget for the rendered block (pinned + selected). */
  maxChars?: number;
  /** Cap on scored (non-pinned) sections. */
  maxSections?: number;
  /** Per-section body cap before it is folded in. */
  sectionMaxChars?: number;
  /** Per-pinned-section body cap. */
  pinnedMaxChars?: number;
  /** Render the pinned sections ahead of the selection (default true).
   *  The board reply renders them separately via renderPinned() so the
   *  thesis corpus sits BEFORE the persona in the prompt. */
  includePinned?: boolean;
}

export interface ScoredSection {
  section: KnowledgeSection;
  score: number;
}

/**
 * Rank non-pinned sections against a question. Score = Σ over distinct
 * shared terms of 1 / (1 + ln df), where df is the number of sections the
 * term appears in — a term every section shares (the product name) barely
 * counts, a term only two sections share counts fully. A title hit doubles
 * the term's weight. Sections with no shared term are dropped.
 */
export function rankSections(sections: KnowledgeSection[], question: string): ScoredSection[] {
  const qTerms = tokenise(question);
  if (qTerms.size === 0) return [];
  const candidates = sections.filter((s) => !s.pinned);
  const perSection = candidates.map((s) => ({
    section: s,
    body: tokenise(s.body),
    title: tokenise(s.title),
  }));
  const df = new Map<string, number>();
  for (const t of qTerms) {
    let n = 0;
    for (const p of perSection) if (p.body.has(t) || p.title.has(t)) n += 1;
    df.set(t, n);
  }
  const scored: ScoredSection[] = [];
  for (const p of perSection) {
    let score = 0;
    for (const t of qTerms) {
      const inTitle = p.title.has(t);
      if (!inTitle && !p.body.has(t)) continue;
      const w = 1 / (1 + Math.log(df.get(t) ?? 1));
      score += inTitle ? 2 * w : w;
    }
    if (score > 0) scored.push({ section: p.section, score });
  }
  return scored.sort((a, b) => b.score - a.score);
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}\n…(section truncated)`;
}

function renderSection(s: KnowledgeSection, bodyMax: number): string {
  return `### ${s.title}\n_Source: ${s.source}_\n\n${clip(s.body, bodyMax)}`;
}

/** Every pinned section, in pack order, rendered in full (up to
 *  `pinnedMaxChars` each). The organisation's thesis corpus. */
export function renderPinned(sections: KnowledgeSection[], opts: { pinnedMaxChars?: number } = {}): string {
  const pinnedMax = opts.pinnedMaxChars ?? 3_000;
  return sections
    .filter((s) => s.pinned)
    .map((s) => renderSection(s, pinnedMax))
    .join("\n\n");
}

/**
 * Compose the knowledge block for one question: every pinned section (in
 * pack order, unless `includePinned` is false) followed by the best-scoring
 * sections that still fit the character budget. Returns "" when nothing
 * qualifies.
 */
export function selectKnowledge(
  sections: KnowledgeSection[],
  question: string,
  opts: SelectKnowledgeOptions = {},
): string {
  const maxChars = opts.maxChars ?? 18_000;
  const maxSections = opts.maxSections ?? 8;
  const sectionMax = opts.sectionMaxChars ?? 5_000;
  const pinnedMax = opts.pinnedMaxChars ?? 3_000;

  const parts: string[] = [];
  let used = 0;
  if (opts.includePinned ?? true) {
    for (const s of sections.filter((x) => x.pinned)) {
      const rendered = renderSection(s, pinnedMax);
      parts.push(rendered);
      used += rendered.length;
    }
  }
  let taken = 0;
  for (const { section } of rankSections(sections, question)) {
    if (taken >= maxSections) break;
    const remaining = maxChars - used;
    if (remaining < 400) break;
    const rendered = renderSection(section, Math.min(sectionMax, remaining));
    parts.push(rendered);
    used += rendered.length;
    taken += 1;
  }
  return parts.join("\n\n");
}
