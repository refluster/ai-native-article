---
name: hypothesis
description: Maya's weekly product-hypothesis article in Japanese and English — a concrete, falsifiable claim about user needs, market direction, or AI-product dynamics, grounded in recent observations and structured with evidence, implications, and a test plan. Published to the unified Notion Articles DB as Type=analysis, Author=maya, Status=ready, with the English edition on an `EN` child page.
---

# hypothesis

Write **one** product-hypothesis article — in Japanese **and** English (ADR-0005).

A hypothesis article is Maya's weekly product-thinking piece: a concrete, falsifiable claim about what users need, what the market is doing, or what an AI-native product should do next — grounded in recent observations and published under the Maya byline on `kohuehara.xyz`.

This skill runs on the **CCR execution model**: the binding is `executor=claude-code-routine` + `scheduler=external/api`, fired weekly by `wf-orchestrator-tick` into the generic `agent-runner` routine (`workforce/docs/routines/agent-runner.md`). The routine composes your persona + this skill body; you generate the hypothesis article; then a **bundled write script** owns the Notion write — you do **not** hand-edit any file and do **not** open a PR.

## One credential

| Credential | Shape | Used for |
|---|---|---|
| `notion.integration_token` | `{apiKey, …}` — only `apiKey` is read | `publish-notion.mjs` (write the article to the unified DB) |

## Instructions

### 1. Choose a hypothesis focus

Pick one concrete, answerable question from the AI-product space — something you can state as a claim: "I believe X is happening because Y, and therefore Z is the right product move." The hypothesis must be specific enough that you could describe a test that would confirm or refute it within 4–6 weeks. Reject vague generalities before starting; if you cannot name a concrete observable outcome for `## 検証方法`, narrow the hypothesis until you can.

Draw the focus from:
- Patterns you observe across recent L2/L3 articles in the unified Articles DB
- Your task context (agent memory, project state)
- Concrete market signals in AI / software products this week

### 2. Write the article (~1500–2500 字)

Structure — follow exactly:

- **Line 1**: `#` H1 — a concrete Japanese title that names the hypothesis directly. No generic placeholders ("AIの可能性" is forbidden). Title must be a specific claim: `# 週次1on1はAIとのチェックインに置き換えられる` is acceptable; `# AIが変える未来` is not.
- **Directly below**: `## 仮説` — one paragraph stating the hypothesis in full. Begin with「私は〜と考える」or「〜という仮説を立てる」. State the mechanism: what you believe, why now, and what outcome you expect.
- `## 観察` — 2–3 paragraphs of what you see in recent AI product / market signals that prompted this hypothesis. Be specific about patterns; avoid assertions without a grounding signal.
- `## 根拠` — the evidence and reasoning chain that support the hypothesis. Use bullet lists for specific signals or data points.
- `## インプリケーション` — what this hypothesis implies for product decisions: what to build, what to stop, what to monitor.
- `## 検証方法` — how to test this hypothesis within 4–6 weeks. Name a **concrete observable outcome** and the method to measure it.

Do **not** append a byline, AI-disclosure footer, or boilerplate. The `Author=maya` property carries the byline and renders as the AuthorChip on `kohuehara.xyz`.

### 3. Issue the same hypothesis in English (ADR-0005)

Every article ships in Japanese **and** English. This does not double the thinking:

- **Everything upstream of the writing is shared.** One hypothesis, one reasoning chain, one set of market signals, one set of conclusions. Do not re-derive the claim for the English edition; do not let the two editions reach different conclusions or carry different figures.
- **Only the rendering differs.** Write the Japanese article first — it is the article. Then write the English edition of *that* article: same structure, same section order, same evidence.
- **English is an edition, not a gloss.** Write it as an English-language publication would: natural English prose, not transliterated Japanese sentence order. Keep the headline concrete and specific in the same way the Japanese one is. Japanese terms with no clean English equivalent keep the original with a short parenthetical.
- **The same hard rules apply to both.** No invented observations, no rounded figures, no boilerplate.

Format for the English edition, identical in shape to the Japanese one:

- **Line 1**: `#` H1 — the English title (the same specific claim, not a generic paraphrase).
- `## Hypothesis` — the hypothesis in full, beginning "I believe…" or "My hypothesis is…"
- `## Observations` — same signals, English prose.
- `## Evidence` — same evidence bullets in English.
- `## Implications` — same product implications.
- `## How to test` — the same concrete observable outcome and measurement method.

### 4. Choose 3–5 tags

Pick from the controlled flat vocabulary (ADR-0003):

`AI Productivity` · `Agentic AI` · `Verification & Trust` · `Engineering Process` ·
`Developer Tools` · `Role Blurring` · `Emerging Roles` · `Skills & Learning` ·
`Org Transformation` · `Labor Market` · `Big Tech` · `AI Infrastructure` ·
`Manufacturing AI` · `AI Strategy`

Use the labels **verbatim** — the script silently drops anything outside the vocabulary.

### 5. Run the write script

1. Write the full hypothesis markdown to a slug-unique temp file, e.g. `/tmp/hypothesis-maya-<ulid>.md`. The first line must be the `# Title` H1.
2. Write the English edition to `/tmp/hypothesis-maya-<ulid>.en.md`, also starting with its own `# Title` H1.
3. Write a 2–3 sentence abstract (the `## 仮説` condensed) to `/tmp/hypothesis-maya-<ulid>-abstract.txt`.
4. Write a 2–3 sentence English abstract to `/tmp/hypothesis-maya-<ulid>-abstract.en.txt`.
5. Run:

   ```sh
   NOTION_API_KEY="<credentials['notion.integration_token'].apiKey>" \
     node workforce/skills/hypothesis/publish-notion.mjs \
       --author maya \
       --status ready \
       --body-file /tmp/hypothesis-maya-<ulid>.md \
       --body-en-file /tmp/hypothesis-maya-<ulid>.en.md \
       --abstract-file /tmp/hypothesis-maya-<ulid>-abstract.txt \
       --abstract-en-file /tmp/hypothesis-maya-<ulid>-abstract.en.txt \
       --tags "AI Strategy,Agentic AI"
   ```

   `--body-en-file` is **required**. There is no Japanese-only publish path — an article without its English edition is an incomplete fire (ADR-0005).

6. Report the exit code:
   - `0` — page created in both editions. `Author=maya, Type=analysis, Status=ready` in Notion. Done.
   - `2` — W-1 guard failed in either edition (body too short, LLM-artefact prelude, or cut-off last line). Regenerate the missing content and retry.
   - `1` — bad args, missing `--body-en-file`, or no H1 title. Fix and retry.
   - `3` — Notion API / network error; nothing was created. Retry once; escalate if it persists.
   - `4` — the Japanese row was created but the English edition failed. The article is live but Japanese-only. Repair with: `node newsletter/pipeline/backfill-en.mjs --page-id <id>`. **Do not** re-run the publish command — it would duplicate the Japanese row.

`NOTION_API_KEY` comes from `credentials["notion.integration_token"].apiKey` — never hard-code it.

Use **slug-unique** temp paths (include `maya` and a ULID/timestamp) so concurrent cadence tasks on the same filesystem cannot overwrite each other's body files mid-flight (ML-020).

## Hard rules (C-1 / W-1 / C-4)

- **State a falsifiable claim.** A hypothesis that cannot be tested is an opinion piece — rename it or narrow it until the `## 検証方法` section has a concrete, measurable outcome.
- **Do not invent observations.** Ground `## 観察` and `## 根拠` in patterns or signals you have genuine context for. Do not cite statistics you cannot trace.
- **Never publish an empty or cut-off article.** The write script rejects short bodies, LLM-failure preludes, and truncated last lines (exit 2). Do not retry blindly on exit 2 — regenerate the content that is missing.
- **Both editions or nothing.** A Japanese-only fire is a failed fire (ADR-0005 / C-4). Exit 4 (the row exists, EN write failed) is handled by `backfill-en.mjs`, not by re-running publish.
