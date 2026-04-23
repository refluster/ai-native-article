# Growth Plan — Software 2.0 for AI NATIVE ARTICLE

This site is a content product. Its value is not pageviews, not article count — it is **the quality of synthesis**. L2 compresses disparate L1 sources into a blog post. L3 finds the principle that connects otherwise-unrelated L2s. If that synthesis is shallow, no amount of SEO or GA4 instrumentation matters: readers arrive once and don't come back. So this plan starts at the generation layer, not the distribution layer. Distribution work (GA4, sitemap, SEO, IA cleanup — already shipped) is downstream of whether the articles are worth reading.

## 0. The Software 2.0 thesis, made concrete

Karpathy's framing: Software 2.0 replaces hand-coded rules with learned parameters. Applied to this pipeline:

- **The prompt is the model.** L2 and L3 are LLM calls whose behavior is almost entirely determined by prompt text. The prompts in [skills/l2-ai-blog/SKILL.md](skills/l2-ai-blog/SKILL.md), [skills/l3-insight/SKILL.md](skills/l3-insight/SKILL.md), and [gas/src/Code.gs](gas/src/Code.gs) are this product's weights.
- **The rubric is the proxy loss.** An LLM judge that scores output against a rubric is a fast, cheap signal we can run every generation.
- **Reader behavior is the true loss.** GA4's `article_read_complete` per prompt version, broken out by category, is the external signal the rubric is calibrated against.
- **Prompt versioning is gradient descent.** Every new prompt version is a step; the judge decides if it passes local inspection; the reader data decides if it survives.

Growth on this site, therefore, has two jobs:

1. **Improve the prompts.** Better synthesis = better articles = better retention.
2. **Improve the measurement of the prompts.** Without versioning and a signal, step 1 is vibes.

GA4 (shipped last round) is part of #2. This revision makes #1 and the coupling between the two first-class.

## 1. North-star — revised

Previous: *weekly L3 `article_read_complete`*.

Revised: **weekly L3 `article_read_complete` on articles that cleared the quality gate (`judge_score ≥ 7.5 / 10`).** Articles that fail the gate are either regenerated or published with a visible `draft` status and excluded from the numerator. This prevents the metric from rewarding us for shipping work that happens to be clicked on by accident.

Secondary metrics:

- **Inner-loop first-pass rate** — % of generations that clear the gate without regeneration. A declining trend means the model or the prompt is drifting; an increasing trend may mean the rubric has become too loose.
- **Outer-loop correlation** — Spearman correlation between `judge_score` bucket and `article_read_complete` rate, rolling 90 days. If this goes negative, the judge is miscalibrated and the rubric needs revision before the prompts do.

## 2. Two-loop quality model

Two feedback loops with different time constants. Each guards the other.

### Inner loop — minutes, no readers needed

```
generate (L2 or L3) ──▶ judge ──▶ score ≥ gate? ──▶ publish
                          ▲           │ no
                          └───────────┘ regenerate with critique (≤ 3 attempts)
```

1. L2 or L3 skill produces the article.
2. A separate LLM judge scores the output against the rubric below.
3. If `judge_score ≥ gate` → candidate for publish.
4. If `judge_score < gate` → feed the judge's critique into the generator prompt, regenerate, repeat up to N=3.
5. Every attempt (pass or fail) writes a sidecar `.eval.json` next to the article (schema: [src/types/quality.ts](src/types/quality.ts)). Fails are kept — they are the training data for rubric calibration.

### Outer loop — weeks, ground truth

```
published articles ──▶ GA4 bucketed by prompt_version
                            │
                            ▼
                   prompt-version leaderboard ──▶ next prompt-version bump
```

1. Weekly GAS job calls the GA4 Data API, bucketed by `(prompt_version, category, slug)`.
2. Rank prompt versions by `article_read_complete` / `article_view`.
3. A prompt-version bump is accepted only if the outer-loop rank is **not worse** than its predecessor after ≥ 5 articles shipped under it.
4. If the inner loop said "great" and the outer loop says "worse," the prompt version is rolled back **and** a failure entry is added to the rubric calibration set.

The two-loop pattern is deliberate: inner is fast but biased (the judge has its own blind spots); outer is unbiased but slow (needs weeks of reader data). Neither alone is safe to optimize against. Together they form the proxy/true-loss pairing at the heart of any Software 2.0 system.

## 3. L2 rubric — "Blog synthesis from L1 sources"

L2's job: compress 1–5 L1 articles into a coherent Japanese blog post that stays faithful to sources while producing a readable narrative for software/design engineers at large Japanese manufacturers (per [skills/l2-ai-blog/SKILL.md](skills/l2-ai-blog/SKILL.md)).

| Dim                      | /10 | What 10/10 looks like                                                                          |
| ------------------------ | --- | ---------------------------------------------------------------------------------------------- |
| Faithfulness             |     | Every factual claim traces to a specific L1 source; no invented stats, dates, or quotes        |
| Coverage                 |     | Every selected L1 is drawn on; none left orphaned; weight roughly matches source importance    |
| Coherence                |     | Sections flow; no internal contradictions; the arc from 導入 to まとめ is legible                |
| Japanese editorial qual. |     | Natural register for the target reader; terminology consistent; no machine-translated odor     |
| Structure                |     | 要旨 → 導入 → body with clear subheads → まとめ; length 3,000–4,000 chars per skill spec        |
| Signal-to-noise          |     | No filler ("important to note," "in conclusion"); each paragraph carries a distinct idea        |

`judge_score = mean(dims)`. **Gate: ≥ 7.0.** Failure of any single dim ≤ 4 also blocks publish regardless of mean — "great average, one fatal flaw" is a common LLM failure mode.

## 4. L3 rubric — "Insight from L2 corpus"

L3's job: find the principle that connects ostensibly unrelated L2s. A summary fails this rubric by definition. Reference: [skills/l3-insight/SKILL.md](skills/l3-insight/SKILL.md).

| Dim                       | /10 | What 10/10 looks like                                                                             |
| ------------------------- | --- | ------------------------------------------------------------------------------------------------- |
| Novel angle               |     | Proposes a principle, not a summary. The title is a claim ("担い手の交代"), not a topic ("AIの影響")  |
| Disparate-source bridging |     | The selected L2s look unrelated on the surface; the article makes them cohere under one lens      |
| Claim-source alignment    |     | Each non-trivial claim cites an L2 (by title, category, or inline reference)                       |
| Actionability             |     | A reader in the target audience could change a decision based on the insight                       |
| Falsifiability            |     | The stated principle takes a side — the kind of thing that could be wrong, not a truism             |
| Japanese editorial qual.  |     | Same criterion as L2                                                                                |

`judge_score = mean(dims)`. **Gate: ≥ 7.5** — higher bar than L2 because L3 is the product surface. Falsifiability ≤ 5 blocks publish regardless of mean — an unfalsifiable "insight" is the exact failure mode that makes the product feel hollow.

## 5. Instrumentation

### Sidecar `.eval.json`

One file per generation attempt, written alongside the article in the operator branch (not published). Schema in [src/types/quality.ts](src/types/quality.ts). Fields: `slug`, `level`, `promptVersion`, `model`, `sourceIds[]`, `judge.{score,dims,critique,judgeModel,judgeVersion}`, `regeneratedFrom?`, `createdAt`. Keeps the full history — failed attempts too — so the rubric can be recalibrated against ground truth when outer-loop data lands.

### Article frontmatter — add two fields

The L4 publish step copies two fields into the published Markdown frontmatter:

```yaml
promptVersion: "l3-2026-04-23a"
judgeScore: 7.8
```

These are what GA4 reports group by and what the operator UI filters on. They are NOT shown to public readers — not yet — but the site reads them and can attach `prompt_version` to GA events.

### GA4 — register a custom dimension

Register `prompt_version` as a user-scoped custom dimension in the GA4 property. The [analytics lib](src/lib/analytics.ts) then passes it on `article_view` and `article_read_complete`. Outer-loop reports group by `prompt_version`.

### Notion — add properties

Add `Prompt Version` (rich_text) and `Judge Score` (number) properties to L2 Blog Repository and L3 Insights DBs. The skill/GAS writers fill these at creation time; `fetch-notion.mjs` copies them into the sitewide manifest and per-article frontmatter.

## 6. Where the prompts live

Important for governance: prompts exist in **two** places, and both need to be under the two-loop regime.

- **[skills/l2-ai-blog/SKILL.md](skills/l2-ai-blog/SKILL.md)**, **[skills/l3-insight/SKILL.md](skills/l3-insight/SKILL.md)** — the Claude skill prompts, used for rich interactive generation.
- **[gas/src/Code.gs](gas/src/Code.gs)** — GAS-side prompts, used by the operator UI (`/l2-blog`, `/l3-insight`, `/l4-publish`).

The same `prompt_version` tag must flow from whichever one generated the article. If the two diverge (skill evolves, GAS doesn't), the outer loop will mis-attribute reader behavior. Keep them in sync or clearly label which is in use; [AGENTS.md §3](AGENTS.md) lists prompt-version bumps as human-reviewed.

## 7. SEO and distribution

Shipped in the prior revision; unchanged here.

- `sitemap.xml` and `robots.txt` generated at build.
- Dynamic per-article meta (title, description, canonical, OG, JSON-LD `Article`).
- Known limitation: deep article URLs return HTTP 404 from GitHub Pages before the SPA redirect recovers them. Real scraper-friendly OG and zero-JS article loads need prerender — tracked in the roadmap.

## 8. Design-system consistency

Shipped: `scripts/lint-design-tokens.mjs` in CI blocks raw hex and non-zero border-radius in `src/`. Tokens live only in [tailwind.config.ts](tailwind.config.ts). [DESIGN.md](DESIGN.md) is the spec.

## 9. Site IA cleanup

Shipped: public header/footer show only reader-facing routes. L1–L4 operator pages remain URL-reachable but unlinked; auth is on the roadmap.

## 10. Companion apps — re-ranked by quality leverage

1. **Azure OpenAI** — both generator and judge. Highest leverage because prompts are the product. Add prompt-version tagging first.
2. **Notion** — host the `Prompt Version` and `Judge Score` columns; operator filters by them pre-publish.
3. **GA4 + GA4 Data API** — outer-loop signal. Already shipped on the event side; Data API reader not yet built.
4. **Google Search Console** — unchanged: verify domain, submit sitemap.
5. **GAS cron scheduler** — weekly report writer, prompt A/B runner host.
6. **X / LinkedIn scheduled post** — deferred until prerender lands.

## 11. Roadmap — quality layer first

Quality layer (this revision's core work):

- [ ] Add `Prompt Version` + `Judge Score` columns to L2 and L3 Notion DBs. **KPI:** 100% coverage on new articles.
- [ ] Implement `judgeL2(article)` / `judgeL3(article)` in `gas/src/Code.gs` (Azure OpenAI call with rubric system prompt). **KPI:** median `judge_score` trend over a 30-day window.
- [ ] Write sidecar `.eval.json` at generation time (operator branch, gitignored from `public/`). **KPI:** 100% of new L4 publishes have a matching sidecar.
- [ ] Regenerate-on-fail loop (N=3, critique in context) in both the skill and GAS paths. **KPI:** inner-loop first-pass rate, trend over time.
- [ ] Show `Judge Score` + `Prompt Version` in the L4 publish UI so the operator sees quality before shipping. **KPI:** ratio of flagged-and-regenerated to published.
- [ ] Weekly cron (GAS) that pulls GA4 Data API and writes `quality/leaderboard.md` on the operator branch. **KPI:** at least one prompt-version decision per month informed by it.
- [ ] Prompt A/B runner: for N generations, run two prompt variants, judge both, publish the winner; suffix `prompt_version` with `A`/`B` for later separation. **KPI:** one prompt-version accepted by the outer loop per month.
- [ ] Rubric calibration ritual: every 90 days, sample 20 articles from the `.eval.json` history and re-score by hand; Spearman against the judge; if < 0.5, revise the rubric. **KPI:** rolling 90-day Spearman ≥ 0.5.

Distribution layer (carryover):

- [ ] SSG or per-article prerender for real OG images and zero-JS article loads.
- [ ] RSS feed from `public/posts/manifest.json`.
- [ ] Auth gate on `/l[1-4]-*` (GitHub OAuth via GAS).

Each roadmap item's PR names its KPI in the description. No unlabeled ships.
