---
name: article-health
description: Audit the L2/L3 article corpus for truncation and Notion↔gh-pages drift. Sweeps every published explanation/analysis, flags articles whose body looks cut off mid-sentence, and reports which slugs on gh-pages still serve content older than the current Notion body (i.e. a stale deploy). Run this proactively after a GAS change or whenever a user reports a broken article. Triggers on requests like "check article health", "any truncated articles?", "is the site in sync with Notion?", "audit published articles".
---

# article-health

One-shot consistency sweep over the published article corpus. Answers two questions in a single report:

1. **Are any published articles truncated mid-content?** (the bug class behind `d17e1d58ec42`)
2. **Is gh-pages in sync with Notion?** (the deploy cron lags Notion by up to ~6 hours)

## Why a skill

Both checks individually are five-line scripts. Combining them removes the most common debugging dead-end this session hit: "I see a broken article on the site, but the GAS backfill says nothing is truncated." The answer was that gh-pages was just stale — Notion had already been fixed. This skill makes that distinction obvious in one report.

## Usage

```bash
node .claude/skills/article-health/scripts/article-health.mjs
```

No args. Reads:
- gh-pages `posts/manifest.json` and each `posts/<slug>.md` (the live site's view).
- The deployed GAS endpoint via `L2_LIST` / `ARTICLE_LIST` to learn what Notion says today.

Reports, per slug:
- `OK` — clean ending on gh-pages, body matches the latest Notion export length within tolerance.
- `TRUNCATED_PUBLISHED` — gh-pages body ends mid-sentence. Backfill via `L2_BACKFILL` (Notion may also be truncated; check the next column).
- `TRUNCATED_NOTION` — Notion body is currently truncated. The fix is `runL2Backfill`; gh-pages will follow on next deploy.
- `STALE_DEPLOY` — gh-pages body is shorter than Notion's (or character-count differs > 5%). The fix is `gh workflow run deploy.yml` or wait for the 06:17 / 12:17 / 18:17 UTC cron.
- `MISSING_ON_PAGES` — exists in Notion as published, but no markdown on gh-pages. Usually means `handleL4Batch` hasn't run yet (image generation pending) — not a bug per se.

## Truncation heuristic

Same rule as `gas/src/Code.gs#isTruncatedMarkdown`:
- Body's last non-empty line is a heading (`#`/`##`/`###`) — heading-with-no-body, the d17e1d58ec42 case.
- OR the last non-empty prose line doesn't end with one of `。`/`！`/`？`/`」`/`）`/`…`/`.`/`!`/`?`/`)`/`]`/<code>`</code>.

List items, blockquotes, fenced-code closes, and horizontal rules are accepted as legitimate endings.

## Exit codes

- `0` — every published article is OK.
- `1` — at least one TRUNCATED_* finding (actionable; fix and re-deploy).
- `2` — only STALE_DEPLOY findings (informational; deploy cron will resolve).
- `>10` — script error.

This makes it safe to wire into a future cron / pre-commit gate without it crying wolf on the staleness window.

## Output format

```
=== article-health: <ISO timestamp> ===
Manifest: 47 published articles
Notion:   62 explanations + 14 analyses

slug          | type        | status              | last line preview
------------- | ----------- | ------------------- | ----------------------------------------
d17e1d58ec42  | explanation | TRUNCATED_PUBLISHED | "### ベンダーロックイン"
e030792741cd  | explanation | TRUNCATED_PUBLISHED | "誤回答の許容範囲"
da5663db6837  | analysis    | OK                  | "...同じ未来を指している理由はそこにある。"

Findings: 2 truncated, 0 stale, 0 missing
```

## Pitfalls

- The script issues N+1 GitHub raw fetches (one per slug). Fine for ~100 articles; if the corpus grows past several hundred, batch via the GitHub API tree endpoint.
- Notion comparison currently uses character-count tolerance because rendering Notion blocks → markdown isn't byte-identical to what `fetch-notion.mjs` produces. A 5% length delta is the noise floor; below that we report OK even if the bodies are technically different.
- For analyses (L3): same heuristic but the threshold is more forgiving since L3 articles already use the 8000-token budget and rarely truncate.
