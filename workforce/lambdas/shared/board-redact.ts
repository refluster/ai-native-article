// workforce/lambdas/shared/board-redact.ts
//
// Runtime redaction for the public Q&A boards (ADR-0034, operator direction
// 2026-09-12): what an agent says on a board must not disclose
//   1. external client projects (name, id, repository, or what they are),
//   2. code-hosting detail (repositories, URLs, PR/issue numbers, file
//      names, workflow names),
//   3. the founder's identity (name, personal domain).
//
// The channel contract in the prompt asks the model for this; this module
// is the mechanical backstop applied to what goes INTO the prompt (the
// agent's recall + memory notes) and to what comes OUT (the finished
// answer). The build-time twin for the knowledge pack lives in
// workforce/scripts/build-board-knowledge.mjs (`scrub`); the two are kept
// in the same shape by hand — see the tests on both sides.

export const EXTERNAL_PROJECT_PLACEHOLDER = "an external client project";

/** Founder identity terms. Domain terms become "the site", name terms
 *  become "the founder". Kept explicit rather than derived: the persona
 *  prompts and memory notes address the operator by name. */
export const FOUNDER_DOMAIN_TERMS: readonly string[] = ["workforce.kohuehara.xyz", "kohuehara.xyz", "kohuehara"];
export const FOUNDER_NAME_TERMS: readonly string[] = ["Koh Uehara", "Uehara Koh", "Uehara", "上原"];

/** Client-work topics that identify an external project even unnamed.
 *  Mirrors CLIENT_TOPIC_TERMS in workforce/scripts/build-board-knowledge.mjs. */
export const CLIENT_TOPIC_TERMS: readonly string[] = [
  "India", "インド", "DISCOM", "smart-meter", "smart meter", "smartmeter", "スマートメーター",
  "home energy", "sponsor", "スポンサー", "run-of-show", "investor", "投資家",
];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Match an external project term as a whole token (not inside a longer
 *  slug), case-insensitively. */
function projectTermRe(term: string): RegExp {
  // ASCII terms match as whole tokens; CJK terms have no word boundary.
  return /^[\x00-\x7f]+$/.test(term)
    ? new RegExp(`(?<![A-Za-z0-9_/-])${escapeRe(term)}(?![A-Za-z0-9_-])`, "gi")
    : new RegExp(escapeRe(term), "g");
}

/** Is a project id one of the workforce's own (never redacted)? */
export function isInternalProjectId(id: string): boolean {
  return id.startsWith("self/") || id === "agent-workforce";
}

/** Longest-first, deduplicated term list from raw project fields. */
export function normaliseProjectTerms(raw: ReadonlyArray<string | undefined | null>): string[] {
  const out = new Set<string>();
  for (const t of raw) {
    if (typeof t === "string" && t.trim().length >= 3) out.add(t.trim());
  }
  return [...out].sort((a, b) => b.length - a.length);
}

/** Replace external client project mentions (names, ids, repos, and the
 *  operator-maintained client topics) with the placeholder. */
export function redactExternalProjects(text: string, terms: ReadonlyArray<string>): string {
  let s = text;
  for (const term of [...terms, ...CLIENT_TOPIC_TERMS]) s = s.replace(projectTermRe(term), EXTERNAL_PROJECT_PLACEHOLDER);
  return s;
}

/** Strip repositories, URLs, PR/issue refs, file names and workflow names. */
export function redactCodeHosting(text: string): string {
  return text
    .replace(/https?:\/\/[^\s)\]>"']+/g, "")
    .replace(/\b(?:refluster|PSVL)\/[A-Za-z0-9_.-]+/g, "the repository")
    .replace(/\bgithub\b(?:\.com)?/gi, "the code host")
    .replace(/\b(?:PR|pull request|issue)s?\s*#\d{1,5}\b/gi, "a code change")
    .replace(/(?<![A-Za-z0-9])#\d{2,5}\b/g, "")
    .replace(/\b(?:workforce|newsletter|scripts|docs|packages|\.github)\/[A-Za-z0-9_./{}*-]+/g, "(a file in the codebase)")
    .replace(/\b[A-Za-z0-9_.-]+\.(?:mjs|cjs|ts|tsx|js|yml|yaml|toml)\b/g, "(a file in the codebase)");
}

/** Replace the founder's domain and name. */
export function redactFounder(text: string): string {
  let s = text;
  for (const term of FOUNDER_DOMAIN_TERMS) s = s.replace(new RegExp(escapeRe(term), "gi"), "the site");
  for (const term of FOUNDER_NAME_TERMS) s = s.replace(new RegExp(escapeRe(term), "g"), "the founder");
  return s;
}

export interface RedactReport {
  text: string;
  /** Which classes fired — for the metric, never for the guest. */
  hits: Array<"external_project" | "code_hosting" | "founder">;
}

/** All three classes in one pass, reporting which ones changed the text. */
export function redactForBoard(text: string, externalTerms: ReadonlyArray<string>): RedactReport {
  const hits: RedactReport["hits"] = [];
  let s = redactExternalProjects(text, externalTerms);
  if (s !== text) hits.push("external_project");
  const afterHosting = redactCodeHosting(s);
  if (afterHosting !== s) hits.push("code_hosting");
  s = afterHosting;
  const afterFounder = redactFounder(s);
  if (afterFounder !== s) hits.push("founder");
  return { text: afterFounder, hits };
}
