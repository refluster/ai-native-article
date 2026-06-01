---
name: article-level2
description: Convert one L1 source entry into one L2 explanation (briefing-document) article in Japanese — the agent-workforce equivalent of the GAS L1→L2 batch. Use when an editorial-stream agent must turn an uncovered L1 source into a faithful, evidence-grounded explanation: an Executive Summary up front, source-specific section headings, and every number/name/date/quote taken verbatim from the source. Published to Notion as Type=explanation, Author={agent_slug}, Status=ready_for_L4.
---

# article-level2

Convert **one** L1 source entry into **one** L2 explanation article in Japanese.

This is the agent-workforce counterpart of the GAS `L2_BATCH` / `handleL2Create`
pipeline (`gas/src/Code.gs`). The GAS path fetches a source URL, builds a
briefing-document prompt, calls Azure, and writes an `explanation`-type row into
the unified Notion Articles DB. This skill produces the *same deliverable* — a
faithful briefing-document explanation — attributed to the running agent so the
article carries a byline on `kohuehara.xyz`.

## Instructions

1. Pick **one** L1 source that is not yet covered by an existing L2 explanation
   (oldest-uncovered-first, mirroring `handleL2Batch`). The source — its title,
   L1 summary, source URL, and (when fetchable) the source body — is supplied in
   your operator brief / run context. **Ground every claim in that source.**
2. Produce **one** Japanese briefing-document explanation (target ~3000 字).
3. Follow the L2 briefing format (identical to the GAS `buildL2Prompt` contract):
   - **Line 1**: a `#` H1 — a concrete Japanese title specific to the source's
     subject. No generic placeholders ("AIの可能性", "変化への対応" are banned).
   - **Directly below**: a `## Executive Summary` section — a 2–3 sentence lead
     surfacing the single most important takeaway before the reader scrolls.
   - **Body**: 2–5 `##` sections, each named after a source-specific theme.
     Separate evidence (facts from the source) from conclusion (the implication
     you draw). Use short paragraphs plus bullet lists carrying the actual
     numbers, names, dates, and direct quotations.
4. Append the agent's bias-disclosure footer (from the agent's `system.md`).

## Hard rules (editorial integrity — C-1, fail loud — C-4)

- **Never invent facts.** Every concrete figure, proper noun, date, or quotation
  must come verbatim from the supplied source. Do not abstract, round, or alter
  them.
- If the source body could not be fetched (X.com posts, paywalls, JS-only pages),
  work from the L1 summary *only* and do not supply facts, statistics, company
  names, or people the summary doesn't contain.
- If you cannot link to or quote the source, **do not publish** — escalate.
- Objective, incisive tone. Avoid reviewer-voice hedges ("重要だ", "今後注目される")
  and throat-clearing preambles.

## Outputs

Markdown body suitable for direct Notion insertion. The runner attaches
`Author={agent_slug}`, `Type=explanation`, `Kind=article`, `Status=ready_for_L4`.
The existing GAS L4 batch picks up `Status=ready_for_L4` rows and publishes them
to `kohuehara.xyz`; `scripts/fetch-notion.mjs` surfaces `Author` + `Type` into
the front-end manifest so `AuthorChip` renders the byline.

## When NOT to use

- A source already covered by an existing L2 explanation — skip and pick the next
  uncovered entry (the GAS coverage check keys on source URL).
- A test/placeholder source (`example.com`) — never flows to L2.
- A source whose original text is a one-line headline only — escalate, do not pad.
