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

## 2. Two-loop quality model — with panels

Two feedback loops with different time constants. Each guards the other. Both the generator side and the judge side are **panels** — multiple models, multiple perspectives — not single calls. A single generator and a single judge share blind spots; a panel exposes them to each other.

### Inner loop — minutes, no readers needed

```
L1/L2 sources
      │
      ▼
generator panel ─▶ candidates[] ─┐
  (N perspectives)               ▼
                           judge panel
                         (M perspectives) ─▶ score each candidate on every dim
                                                    │
                                                    ▼
                                           aggregate → winner
                                                    │
                  ┌───────────── pass gate? ────────┘
                  │ yes                 │ no
                  ▼                     ▼
               publish        regen top candidate
                              with combined critiques
                              (≤ 3 rounds)
```

1. The **generator panel** produces N candidates for the same set of source IDs. Each generator has a distinct `(model, systemPromptVersion)`. For L3 the starter panel has two members — "pattern-matcher" (Claude) and "skeptic-editor" (GPT-4o) — so the ensemble has room to disagree.
2. The **judge panel** scores every candidate on every rubric dimension. Each judge is a distinct `(model, rubricVersion, perspective)`. Starter panel: `editor`, `domain`, `reader` (see §2a below).
3. For each candidate we compute a weighted aggregate score across judges; winner = highest aggregate that clears both the mean gate (L2 ≥ 7.0, L3 ≥ 7.5) and the per-dimension floor (no dim ≤ 4 across *any* judge — panel disagreement on a single low score still blocks).
4. If no candidate clears the gate, the top-ranked candidate is regenerated with every judge's critique concatenated as feedback; N=3 rounds total.
5. Every attempt — all candidates, all judges, all regenerations — is written to a sidecar `.eval.json` (schema: [src/types/quality.ts](src/types/quality.ts)). Losing candidates are training data for the rubric.

### Outer loop — weeks, ground truth

```
published articles ──▶ GA4 bucketed by prompt_version
                            │
                            ▼
                   prompt-version leaderboard ──▶ next bump to a panel member
```

1. Weekly GAS job calls the GA4 Data API, bucketed by `(prompt_version, category, slug)`. `prompt_version` now identifies the *winning candidate's generator*, not a single prompt — e.g., `l3-claude-pattern-2026-04-23a`.
2. Rank prompt versions by `article_read_complete` / `article_view`.
3. A panel member's new prompt version is accepted only if its outer-loop rank is **not worse** than its predecessor after ≥ 5 articles shipped with it as the chosen candidate.
4. If inner said "great" and outer says "worse," roll back that panel member and add a failure entry to the rubric calibration set.

The panel approach generalizes the proxy/true-loss pairing: the **judge panel** is a higher-fidelity proxy than a single judge (cross-model blind spots cancel), and the **generator panel** is a broader search over the prompt space than a single generator (more candidates to pick from per article).

### 2a. Panels — starter roster

Zone A (see [AGENTS.md](AGENTS.md)). The roster — which providers, which perspectives, which weights — is a product-shape decision, not an implementation detail.

**Provider model registry** lives in [src/types/quality.ts `MODEL_REGISTRY`](src/types/quality.ts) and is the single source of truth for which providers are active. Starting state: **Azure OpenAI only**, using the `AZURE_OPENAPI_KEY` + `AZURE_OPENAPI_ENDPOINT` already configured for the existing L2/L3 GAS calls. Anthropic, OpenAI-direct, and Gemini are pre-shaped in the registry as commented-out stanzas — activating one is a config change (add env var, uncomment, update the relevant roster entry's `modelBinding`).

**Phase 1 — prompt-only diversity (current):**

All panel members bind to the same `azure-gpt5` model and differentiate purely by system prompt. This ships the ensemble against the provider already wired; there is no blocker on external API keys.

*Generator panel:*

| Id         | Model binding  | System-prompt lens                                  |
| ---------- | -------------- | ---------------------------------------------------- |
| `pattern`  | `azure-gpt5`  | "Find the principle that connects these sources"     |
| `skeptic`  | `azure-gpt5`  | "Be the senior editor who cuts weak claims"          |

*Judge panel:*

| Id       | Perspective | Model binding | Weight | Lens                                              |
| -------- | ----------- | ------------- | ------ | -------------------------------------------------- |
| `editor` | editor      | `azure-gpt5` | 0.25   | "Senior Japanese editorial director"               |
| `domain` | domain      | `azure-gpt5` | 0.40   | "Engineering lead at a large Japanese manufacturer" |
| `reader` | reader      | `azure-gpt5` | 0.35   | "Busy target reader skimming in under 3 minutes"   |

Every judge scores every dim. The weight is how much a perspective counts in the aggregate, not which dim it owns. Domain is weighted highest because factual alignment and falsifiability are the claims most likely to go wrong and least likely to be caught by an editor's eye. The reader judge is deliberately terse — its system prompt instructs it to skim, not analyze, because a thorough reader judge is indistinguishable from a domain judge and the panel collapses to one perspective.

**Phase 1 trade-off (accepted, documented):** All panel members on one provider means the generator and its judges share a model. The LLM-as-judge literature (2023–2025) shows this produces a mild self-favoring bias — a judge scores its own family's outputs ~3–8% higher on subjective dims. We accept this in Phase 1 because (a) single-provider shipping is much faster, (b) the three distinct judge system prompts already discipline against charity (the domain judge is instructed to be adversarial on claims, the reader judge to be adversarial on time-to-insight), and (c) the outer loop will surface the bias if it distorts reader behavior. Rubric calibration (§11 roadmap) also catches it.

**Phase 2 — model diversity (unlock when ready):**

Swap individual `modelBinding` values in the rosters to point at activated registry entries. Suggested sequence:
1. `editor` → Anthropic (a different family on the judge side, on the highest-prompt-sensitivity perspective).
2. `pattern` → Anthropic (generator-side diversity; matches the Phase-2 name the previous revision used).
3. `reader` → Gemini (cheap, skim-oriented, third family).

**Model disjointness rule** is Phase 2-gated: when at least two providers are in the registry, no generator may share a `modelBinding` with any judge. In Phase 1 the rule is inactive because there is only one active binding; AGENTS.md rule 12 is written accordingly.

**Cost envelope:** 2 generators + 3 judges = **5 Azure OpenAI calls per article** (~$0.03–0.10 per L3 at current pricing). At ~2–3 L3/week that is under $2/month. For higher throughput the reader judge can be run only on the top-scoring candidate after an initial judge round — a standard cascaded-ranker trick, deferred until throughput justifies it.

**Prompt-version naming scheme (frozen):** `{level}-{rosterId}-{YYYY-MM-DD}{variant}`. Examples: `l3-pattern-2026-04-23a`, `l2-skeptic-2026-04-24a`, `rubric-l3-editor-2026-04-23`. The outer-loop leaderboard keys on this exact string, so changes to the scheme require a migration.

## 3. L2 rubric — "Blog synthesis from L1 sources"

L2's job: compress 1–5 L1 articles into a coherent Japanese blog post that stays faithful to sources while producing a readable narrative for software/design engineers at large Japanese manufacturers (per [skills/l2-ai-blog/SKILL.md](skills/l2-ai-blog/SKILL.md)).

Every judge on the panel scores every dim from its perspective. The per-dim aggregate is the weighted mean across judges.

| Dim                      | /10 | What 10/10 looks like                                                                          |
| ------------------------ | --- | ---------------------------------------------------------------------------------------------- |
| Faithfulness             |     | Every factual claim traces to a specific L1 source; no invented stats, dates, or quotes        |
| Coverage                 |     | Every selected L1 is drawn on; none left orphaned; weight roughly matches source importance    |
| Coherence                |     | Sections flow; no internal contradictions; the arc from 導入 to まとめ is legible                |
| Japanese editorial qual. |     | Natural register for the target reader; terminology consistent; no machine-translated odor     |
| Structure                |     | 要旨 → 導入 → body with clear subheads → まとめ; length 3,000–4,000 chars per skill spec        |
| Signal-to-noise          |     | No filler ("important to note," "in conclusion"); each paragraph carries a distinct idea        |

`judge_score = weighted_mean(dim_aggregates)` where dim weights are equal and judge weights follow the roster in §2a. **Gate: ≥ 7.0.** Per-dim floor: if **any** judge on the panel scores a dim ≤ 4, publish is blocked regardless of the aggregate — panel disagreement on a low score is itself the signal.

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

`judge_score = weighted_mean(dim_aggregates)`. **Gate: ≥ 7.5** — higher bar than L2 because L3 is the product surface. Per-dim floor as in L2 (any judge ≤ 4 on any dim blocks). Additionally, **falsifiability** has a hard floor of 5 from *every* judge — an unfalsifiable "insight" is the exact failure mode that makes the product feel hollow, and a single judge catching it is enough.

## 5. Instrumentation

### Sidecar `.eval.json` — multi-candidate, multi-judge

One file per article (not per candidate), written alongside the article in the operator branch (not published). Schema in [src/types/quality.ts](src/types/quality.ts). Shape:

```
ArticleEval
├─ slug, level, createdAt, regeneratedFrom?
├─ sourceIds[]               ← the L1 (for L2) or L2 (for L3) inputs, same for all candidates
├─ candidates[]              ← one entry per generator, N≥1
│   ├─ candidateId
│   ├─ generator: { id, model, systemPromptVersion }
│   ├─ outputRef             ← Notion page id or local path of the draft
│   ├─ judges[]              ← one entry per judge on the panel
│   │   ├─ judgeId, perspective, model, rubricVersion
│   │   ├─ dims: { [dim]: score }      ← every dim, from this perspective
│   │   └─ critique
│   └─ aggregate: { score, dims: { [dim]: score } }
└─ chosen: { candidateId, reason }
```

Losing candidates and failing judges are kept — they are the training data. A regenerated run chains via `regeneratedFrom` so the full tree is reconstructible.

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

1. **Azure OpenAI** — Phase 1 host for the full panel: 2 generators + 3 judges, differentiated by system prompt. Biggest single leverage surface because *every* prompt in the panel lives against it.
2. **Notion** — host the `Prompt Version`, `Judge Score`, and `Chosen Candidate` columns; operator filters by them pre-publish.
3. **GA4 + GA4 Data API** — outer-loop signal. Event side shipped; Data API reader not yet built.
4. **Google Search Console** — unchanged: verify domain, submit sitemap.
5. **GAS cron scheduler** — weekly report writer, panel A/B runner host.
6. **Anthropic Claude API** — Phase 2 activator. Adds true model diversity to the panel once its key is available. Already shaped in the model registry.
7. **Gemini / OpenAI-direct** — further Phase 2 options, pre-shaped in the registry, activated when the bias signal warrants.
8. **X / LinkedIn scheduled post** — deferred until prerender lands.

## 11. Roadmap — quality layer first

Quality layer is sequenced so the panel ships incrementally — single judge first, then panel, then generator panel, then A/B across members. Each step is independently shippable.

**Step 1 — one generator, one judge (minimum viable inner loop):**

- [ ] Add `Prompt Version`, `Judge Score`, `Chosen Candidate` columns to L2 and L3 Notion DBs. **KPI:** 100% coverage on new articles.
- [ ] Implement `judgeL2` / `judgeL3` in `gas/src/Code.gs` against Azure OpenAI GPT-4o using the rubric system prompt. **KPI:** median `judge_score` trend over a 30-day window.
- [ ] Write sidecar `.eval.json` at generation time (operator branch, gitignored from `public/`). **KPI:** 100% of L4 publishes have a matching sidecar.
- [ ] Regenerate-on-fail loop (N=3, critique in context). **KPI:** inner-loop first-pass rate, trend over time.
- [ ] Show `Judge Score` + `Chosen Candidate` in the L4 publish UI. **KPI:** ratio of flagged-and-regenerated to published.

**Step 2 — judge panel (multi-perspective evaluation, Azure OpenAI only):**

- [ ] Wire `editor` and `reader` judges alongside `domain`, all against `azure-gpt5`. Three rubric system prompts, one per perspective. **KPI:** panel disagreement rate (how often judges disagree by ≥ 1.5 on a dim). If near zero, the system prompts are not differentiated enough.
- [ ] Extend the sidecar writer to emit `candidates[0].judges[]` with 3 entries. **KPI:** schema conformance.
- [ ] Enforce the per-judge per-dim floor and the L3 falsifiability floor. **KPI:** fraction of articles blocked by the floor (should rise initially, settle as prompts mature).

**Step 3 — generator panel (multi-candidate generation, Azure OpenAI only):**

- [ ] Wire `pattern` and `skeptic` generators, both against `azure-gpt5`, differentiated by system prompt. Run in parallel per article. **KPI:** "chosen candidate" distribution — if one generator always wins, the panel is degenerate and the losing prompt needs revision or retirement.
- [ ] Implement aggregate-and-choose logic (`passesGate` + `pickWinner`) over candidates. **KPI:** % of articles where the non-default generator wins (target: neither > 70% over a rolling month).

**Step 4 — outer loop:**

- [ ] Weekly cron (GAS) that pulls GA4 Data API and writes `quality/leaderboard.md` on the operator branch, bucketed by the winning candidate's `systemPromptVersion`. **KPI:** at least one panel-member decision per month informed by it.
- [ ] Rubric calibration ritual: every 90 days, sample 20 articles from the `.eval.json` history and re-score by hand; Spearman against the aggregate panel score; if < 0.5, revise the rubric. **KPI:** rolling 90-day Spearman ≥ 0.5.

**Step 5 — model diversity (Phase 2, unlocks when additional keys are added):**

- [ ] Add Anthropic API key; activate `anthropic-sonnet` in `MODEL_REGISTRY`; migrate `editor` judge to it. **KPI:** change in panel disagreement on subjective dims (expected to rise).
- [ ] Migrate `pattern` generator to Anthropic. **KPI:** change in chosen-candidate distribution.
- [ ] Add Gemini; migrate `reader` judge. **KPI:** same as above.
- [ ] Turn on AGENTS.md rule 12 (model-disjointness) as a hard check in the panel roster linter. **KPI:** zero Phase-2 PRs merge with disjointness violations.

**Distribution layer (carryover):**

- [ ] SSG or per-article prerender for real OG images and zero-JS article loads.
- [ ] RSS feed from `public/posts/manifest.json`.
- [ ] Auth gate on `/l[1-4]-*` (GitHub OAuth via GAS).

Each roadmap item's PR names its KPI in the description. No unlabeled ships.
