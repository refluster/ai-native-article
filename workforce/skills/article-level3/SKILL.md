---
name: article-level3
description: Synthesize 3 recent L2 explanation articles into one L3 analysis (insight) article in Japanese via inductive reasoning — the agent-workforce equivalent of the GAS L3_BATCH/handleL3Create pipeline. Use when an editorial-stream agent must find the deeper principle connecting several ostensibly-unrelated explanations and project its implications. Published to the unified Notion Articles DB as Type=analysis, Author={agent_slug}, Status=ready.
---

# article-level3

Synthesize **3** recent L2 explanation articles into **one** L3 analysis (insight)
article in Japanese, by inductive reasoning — find the deeper principle that
connects ostensibly-unrelated explanations and project its implications.

This is the agent-workforce counterpart of the GAS `L3_BATCH` / `handleL3Create`
pipeline (`newsletter/gas/src/Code.gs`). The GAS path samples recent `explanation` rows,
prompts Azure to induce a unifying principle, and writes an `analysis`-type row
into the unified Notion Articles DB. This skill produces the *same deliverable* —
a cross-source synthesis — attributed to the running agent so the analysis carries
a byline on `kohuehara.xyz`.

It runs on the **CCR execution model** (the same pattern as `article-level2` and
Dario's `feed-post`): the binding is `executor=claude-code-routine` +
`scheduler=external/api`, fired by `wf-orchestrator-tick` into the generic
`agent-runner` routine (`workforce/docs/routines/agent-runner.md`). The routine
composes your persona + this skill body; you generate the synthesis; then a
**bundled write script** owns the Notion write — you do **not** hand-edit any
file and do **not** open a PR.

## One DB, one credential (apiKey only)

Both input and output live in the **unified Articles DB**, distinguished by
`Type` (`explanation` = the L2 input pool, `analysis` = what you write). Only the
Notion `apiKey` is a secret; the DB id is **not** (it's a constant in the
scripts, mirroring `newsletter/pipeline/normalize-categories.mjs`). You need just one
injected credential:

| Credential | Shape | Used for |
|---|---|---|
| `notion.integration_token` | `{apiKey, …}` — only `apiKey` is read | both `pick-l2-sources.mjs` (read the L2 pool + recent L3 history) and `publish-notion.mjs` (write the analysis) |

## Instructions

### 1. Pick the L2 sample — run the picker, don't guess

Run `pick-l2-sources.mjs`. It reconstructs the GAS `handleL3Batch` sampling rule
from Notion alone (no extra state store): a 14-day recent window, a fresh-entry
gate (≥1 L2 created since the most recent analysis row), and reuse-avoidance
derived from the source URLs stamped on recent L3 rows. It returns **3** L2
explanations to synthesise, the **majority canonical A–E bucket**, and the
**comma-joined source URLs** to record.

```sh
NOTION_API_KEY="<credentials['notion.integration_token'].apiKey>" \
  node workforce/skills/article-level3/pick-l2-sources.mjs
```

- If it prints `{"skip": true, …}` — **stop. Produce nothing this fire.** No new
  L2 has arrived since the last analysis, or there are fewer than 3 recent L2s.
  Skipping (not calling the write script) is the correct behaviour, not an error.
- Otherwise you get `{ sources: [ {l2PageId, title, abstract, sourceUrl, category} ×3 ], canonicalCategory, sourceUrls }`.
  Use the three `{title, abstract}` pairs as your evidence base. **Ground every
  claim in those three sources** — quote their figures, names, and findings; do
  not import facts they don't contain. (The `abstract` is each L2's lead; when a
  `sourceUrl` is reachable and you need a specific figure, you may fetch it for
  verification, but the synthesis is over the three L2s, not fresh reporting.)

### 2. Synthesise one Japanese analysis (3000–4000 字)

This is the GAS `handleL3Create` contract. Observe the concrete facts the three
L2s report, then **induce the single most-probable deep principle that unifies
them**, and build the article on that hypothesis. Not a summary of three articles
— a new cross-cutting insight.

- **Line 1**: a `#` H1 — a concrete Japanese insight title (**15–25 字**) that
  names the *underlying principle*, not the topic. Name the shift, not the field
  ("担い手の交代" not "AIの影響"; "変化への対応" and "AIの可能性" are banned).
- **導入 (100–200 字)**: present the seemingly-unrelated facts from the three L2s,
  then declare "実はこれらは同じ原理で説明できる". Open with a ~50-字 thesis.
- **分析セクション (`##` × 2–4)**: each deep-dives the facts from a different
  angle, carrying **concrete numbers, quotations, and examples drawn from the
  L2s** — and naming which L2 (by title) each claim comes from. Use `###` for
  sub-points.
- **共通原理の提示 (`##`, 500–800 字)**: "Why → So What". Develop, logically, the
  root principle that unifies the observed facts. Make the **inductive step
  explicit** ("これらの事実は〜を示唆している").
- **未来予測と示唆 (`##`, 500–800 字)**: the situational changes this principle
  implies, with their probability and grounds, and a practical takeaway for the
  reader.
- Do **not** append a bias-disclosure footer (or any byline boilerplate) to the
  body. Disclosure is carried by the `Author` metadata — rendered as the
  AuthorChip byline on `kohuehara.xyz` — the same policy `feed-post` already
  follows (Epic-011 §7 / Q9). In-body boilerplate duplicates that metadata,
  freezes a model id in prose, and was the trigger for the ML-006 deploy-gate
  false positive.

## Hard rules (editorial integrity — C-1, fail loud — C-4)

- **Synthesis, not summary.** The job is to make three ostensibly-unrelated
  explanations *cohere* under one principle. If they're obviously about the same
  topic, find the non-obvious bridge; if you can't bridge them honestly, prefer a
  thinner-but-true principle over a forced one.
- **Claim every insight back to a source.** Each concrete claim must cite one of
  the three L2s by title (or its category). Don't introduce figures, companies,
  people, or dates absent from the three sources.
- **Make it falsifiable.** State the principle so a reader could disagree with it.
  An unfalsifiable "AIは世界を変える"-class platitude is a hollow analysis —
  rewrite it into a claim with an edge.
- **No generic titles**, no reviewer-voice hedges ("重要だ", "今後注目される"),
  no throat-clearing preambles. Objective, incisive tone.
- **Output全文を日本語で.**

## Write the analysis — run the script, do NOT hand-edit any file

The page is written by a **deterministic script**, not by you editing JSON. You
generate the *judgment* (the synthesis markdown); `publish-notion.mjs` owns the
*write* (correct schema, properties, block conversion) by POSTing a new
`analysis` page into the unified Articles DB with the injected integration token.

1. Write the full analysis markdown to a temp file (e.g. `/tmp/l3-article.md`) —
   a file, not a shell arg. The first line must be the `# Title` H1.
2. Write the **abstract** — a faithful 2–3 sentence lead (your opening thesis) —
   to a second temp file (e.g. `/tmp/l3-abstract.txt`). This populates the
   `Abstract` column.
3. Run (the script writes to the unified Articles DB — its id is a built-in
   constant, so only `NOTION_API_KEY` is needed). Pass the picker's
   `sourceUrls` and `canonicalCategory` verbatim, plus the free-form
   `テーマ1 × テーマ2` theme you chose for the synthesis:

   ```sh
   NOTION_API_KEY="<credentials['notion.integration_token'].apiKey from your task>" \
     node workforce/skills/article-level3/publish-notion.mjs \
       --author "<agent_slug>" \
       --type analysis \
       --status ready \
       --body-file /tmp/l3-article.md \
       --abstract-file /tmp/l3-abstract.txt \
       --source-urls "<sourceUrls from the picker>" \
       --category "<canonicalCategory from the picker, e.g. B>" \
       --theme "<テーマ1 × テーマ2>"   # omit if you have none
   ```

4. Report the script's exit code:
   - `0` — page created. The row carries `Author={agent_slug}, Type=analysis,
     Status=ready`, plus `Abstract`, `SourceURLs` (the three source L2 URLs), and
     `Category`/`CategoriesMulti` (the canonical bucket + your theme tag). The GAS
     L4 batch generates the hero image and flips Status to `published`. Done.
   - `2` — W-1 editorial guard failed (empty/short body, LLM-artefact prelude,
     or a last line that looks cut off mid-content — the shared
     `scripts/lib/truncation.mjs` heuristic), or `401/403` auth (project
     credential bag misconfigured). Read stderr; do not retry blindly. A
     sentence ending wrapped in emphasis (`*…。*`) is a valid ending — if the
     guard trips, the body really is cut off; regenerate the ending.
   - `1` / `3` — bad args / missing H1 title, or Notion API / network error.

`NOTION_API_KEY` comes from your task's injected
`credentials["notion.integration_token"].apiKey` — never read it from anywhere
else, never hard-code it. The script re-runs the W-1 guards before writing, so a
degraded body fails loudly rather than landing on the site.

**The page lands directly in Notion. No PR, no human-approval gate.** The existing
GAS L4 batch picks up the row and publishes it to `kohuehara.xyz`;
`newsletter/pipeline/fetch-notion.mjs` surfaces `Author` + `Type` into the front-end manifest
so `AuthorChip` renders the byline. Recording `SourceURLs` is also what lets the
next fire's picker avoid re-synthesising the same sample.

## When NOT to use

- The picker returned `{skip:true}` — no fresh L2 input, or fewer than 3 recent
  L2s. Synthesising on a stale or too-thin sample produces a hollow analysis.
- You cannot find an honest bridge between the three sampled L2s — escalate or
  skip rather than forcing a fake unifying principle (C-1).
- A single source needs explaining faithfully — that's `article-level2`
  (explanation), not this skill.
