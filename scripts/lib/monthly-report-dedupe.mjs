// monthly-report-dedupe.mjs — the "one letter per author per calendar month"
// rule, as a pure predicate over Notion query rows.
//
// Why this exists as code and not as prose: the rule was written in
// `workforce/skills/monthly-report/SKILL.md` ("The skip path") and in
// `vp-monthly-report/SKILL.md` as an instruction to the LLM, and the writer
// script enforced nothing. On 2026-09-02 that produced two `Monthly Report`
// rows for author `maya`, same date, byte-identical bodies differing only in
// the sign-off line — a revision re-posted as a new page, because the writer
// offered no way to revise. Both went live on the reader site.
//
// A rule the writer does not enforce is a rule the org only has on paper —
// the exact "declared vs actual" class the 2026-08/09 letters kept naming. So
// the predicate lives here (pure, unit-tested) and the write path calls it.
//
// Shape of a `page` argument: a raw row from `POST /v1/databases/{id}/query`.
// Only the fields this rule reads are required; anything else is ignored, so
// a test fixture can stay small.

/** Notion `Date` property → "YYYY-MM", or "" when absent/unparseable. */
function monthOf(page) {
  const start = page?.properties?.Date?.date?.start;
  if (typeof start !== "string") return "";
  const m = start.match(/^(\d{4})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}` : "";
}

/** Concatenated plain text of a `rich_text` property, trimmed. */
function richText(prop) {
  const parts = prop?.rich_text;
  if (!Array.isArray(parts)) return "";
  return parts.map((p) => p?.plain_text ?? p?.text?.content ?? "").join("").trim();
}

/** Names of a `multi_select` property. */
function multiSelect(prop) {
  const opts = prop?.multi_select;
  if (!Array.isArray(opts)) return [];
  return opts.map((o) => o?.name).filter((n) => typeof n === "string");
}

/**
 * The current UTC calendar month as "YYYY-MM".
 * Explicit param so tests never depend on the wall clock.
 */
export function currentMonth(now = new Date()) {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Find the letter that already occupies this (author, month) slot.
 *
 * A row blocks a new write when ALL of these hold:
 *   - it carries the series tag (default "Monthly Report"),
 *   - its `Author` is exactly this agent slug,
 *   - its `Date` falls in the same calendar month,
 *   - it is not itself retired — neither Notion-trashed (`archived: true`,
 *     which the query API already excludes, belt-and-braces here) nor
 *     `Status = archived` (the in-DB retirement the SKILL.md revision path
 *     tells an agent to apply before re-posting).
 *
 * Returns the first blocking row, or null. Callers treat null as "go".
 *
 * @param {object[]} pages   rows from the Notion database query
 * @param {object}   opts
 * @param {string}   opts.agent  author slug, e.g. "maya"
 * @param {string}   opts.month  "YYYY-MM"
 * @param {string}  [opts.tag]   series tag, default "Monthly Report"
 */
export function findExistingReport(pages, { agent, month, tag = "Monthly Report" }) {
  if (!Array.isArray(pages)) return null;
  if (!agent || !month) return null;
  for (const page of pages) {
    if (page?.archived === true || page?.in_trash === true) continue;
    const props = page?.properties ?? {};
    if (!multiSelect(props.Tags).includes(tag)) continue;
    if (richText(props.Author) !== agent) continue;
    if (monthOf(page) !== month) continue;
    if (props.Status?.select?.name === "archived") continue;
    return page;
  }
  return null;
}

/** Human-readable one-liner for a blocking row, for the guard's stderr. */
export function describeExisting(page) {
  const title = page?.properties?.Title?.title?.[0]?.plain_text
    ?? page?.properties?.Title?.title?.[0]?.text?.content
    ?? "(untitled)";
  const date = page?.properties?.Date?.date?.start ?? "(no date)";
  return `${date} "${title}" ${page?.url ?? page?.id ?? ""}`.trim();
}
