# Growth Plan — Software 2.0 for AI NATIVE ARTICLE

This site is a content product. The value it delivers is the *selection* and *synthesis* of AI-industry signal into L3 insights. Growth here is not a marketing funnel — it is a feedback loop that makes next week's L3 articles more read, more shared, and more trusted than this week's. The growth work below is designed so reader behavior flows back into the L1→L4 pipeline as a learned signal, in the Software 2.0 sense: behaviors replace heuristics, measurement replaces taste.

## 1. North-star, inputs, guardrails

- **North-star metric:** weekly L3 read-completions (scroll ≥ 80% of article body). A completion is a stronger quality signal than a click.
- **Input metrics (leading):** article_view, category_filter_click, share_click, read_time_p50, outbound_click on source L1.
- **Guardrail metrics:** bounce rate on `/`, time-to-first-paint on `/article/:slug`, broken-link rate, build-fail rate. Regressions here block further growth bets.
- **What we are NOT optimizing:** pageviews in isolation, session count, "engagement time" without a depth signal. Those have a long history of misleading editorial teams.

## 2. Measurement layer — GA4

GA4 is wired opt-in via `VITE_GA_ID`. When unset, analytics is a no-op — no script tag, no network calls. This keeps local dev, preview builds, and forks clean by default.

### Events emitted

| Event                     | When it fires                               | Params                                      |
| ------------------------- | ------------------------------------------- | ------------------------------------------- |
| `page_view`               | React Router location changes               | `page_path`, `page_title`                   |
| `article_view`            | Article page loads and meta resolves        | `slug`, `category`, `date`                  |
| `article_read_25/50/75/90`| Scroll depth thresholds crossed once each   | `slug`, `category`                          |
| `article_read_complete`   | Reader scrolls ≥ 90% AND dwell ≥ 30s        | `slug`, `category`, `dwell_ms`              |
| `category_click`          | Sidebar category clicked                    | `category`                                  |
| `featured_click`          | Hero article clicked                        | `slug`, `category`                          |
| `internal_link_click`     | In-article internal link click              | `slug`, `href`                              |
| `outbound_click`          | In-article external link click              | `slug`, `href`, `host`                      |

Privacy posture: we respect `navigator.doNotTrack` and `navigator.globalPrivacyControl` — both short-circuit initialization. IP anonymization is GA4 default. No PII is emitted. No session recording. The `page_title` is the article title, which is already public.

### Feedback loop into content pipeline (planned)

The measurement exists to change what we publish. The feedback path:

1. Weekly GAS trigger (not yet built) pulls a GA4 Data API report: top 20 `(slug, category)` by `article_read_complete`, top 10 `category_click`.
2. Report lands in a Notion page the L2/L3 skills read before synthesis.
3. L2 prompts are templated with `PRIORITY_CATEGORIES: [...]` and `UNDERINDEXED_CATEGORIES: [...]`, biasing source selection.
4. L3 prompts receive the same priority list plus titles of top-performing L3s as "style exemplars."

This is the Software 2.0 bridge: editorial judgment that used to be hand-coded as "what feels interesting this week" becomes a ranked list derived from readers' actual completions.

## 3. SEO and distribution

- `public/robots.txt` and `public/sitemap.xml` are generated at build from the manifest.
- JSON-LD `Article` structured data is injected on `/article/:slug` via a runtime meta helper. Static OG per slug is deferred: it needs SSG or a prerender step, and the cost/benefit pencils out only once we see meaningful referral traffic.
- Canonical URLs and `<meta name="description">` are set dynamically on route change.
- **Known limitation:** Twitter and LinkedIn scrape the static HTML, so per-article OG images require prerender. Tracked as future work below.

## 4. Design-system consistency

The design system is documented in [DESIGN.md](DESIGN.md) and tokenized in [tailwind.config.ts](tailwind.config.ts). Rules now enforced:

- **No raw hex in components.** `scripts/lint-design-tokens.mjs` greps `src/**/*.{ts,tsx}` for `#[0-9a-f]{3,8}` and fails the build. Tokens live in one place.
- **No `rounded-*` classes** (other than `rounded-full` for pills/avatars). The "0px radius" rule is linted, not hoped for.
- **No `border-*` solid dividers** between content blocks — the "No-Line" rule. Spacing and surface shifts only. This one is advisory (grep-heuristic), not a hard fail.

Design tokens (`src/config/site.ts`, `tailwind.config.ts`, `src/index.css` layer `base`/`utilities`) require human review — see CODEOWNERS.

## 5. Site IA cleanup

The L1–L4 pipeline pages are *internal operator tools*. Exposing them in the public footer confuses readers and leaks build state. Cleanup:

- Public header: `INDEX`, `DESIGN SYSTEM`, `DESIGN GUIDE`.
- Public footer: `INDEX`, `DESIGN SYSTEM`, `DESIGN GUIDE` only.
- Operator pages (`/l1-register`, `/l2-blog`, `/l3-insight`, `/l4-publish`) remain routed and reachable by URL, but are not linked from the public chrome. They should eventually sit behind an auth check; for now, obscurity is documented as a conscious choice.

## 6. Companion apps and integration surface

Ranked by expected ROI for the current stack:

1. **GA4 + GA4 Data API (via GAS)** — already the plan above. Closes the measure→generate loop.
2. **Notion (existing)** — source of truth for L1/L2/L3. No change needed.
3. **Azure OpenAI (existing)** — synthesis engine. Worth adding prompt-version tagging in the GAS handler so we can A/B prompt revisions against `read_complete`.
4. **Search Console** — verify domain, submit sitemap, read query impressions. Free, additive to GA4 (GA4 does not show search queries).
5. **X (Twitter) + LinkedIn scheduled post via GAS** — later. Only once OG images are prerendered; otherwise preview cards are garbage.
6. **RSS feed** — cheap, high-value for technical readers. Generate at build from manifest. Not in this round.

## 7. Roadmap (ranked, not promised)

- [ ] Weekly GAS trigger that fetches GA4 Data API → Notion. Closes the loop.
- [ ] Prompt-version tagging on L2/L3 outputs so we can correlate prompt versions with read-completion.
- [ ] SSG or per-article prerender for real OG images and zero-JS article loads.
- [ ] RSS feed from `public/posts/manifest.json`.
- [ ] Prompt A/B runner in the L2 skill.
- [ ] Auth gate on `/l[1-4]-*` (GitHub OAuth via GAS).

Each roadmap item has a hypothesis and a metric in its PR description — no unlabeled ships.
