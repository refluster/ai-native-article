# Source-of-truth architecture

**Status:** Adopted (governance L1).
**Last updated:** 2026-05-03.
**Audience:** anyone editing the article-generation cadences (`workforce/skills/article-level2` / `article-level3`), `newsletter/pipeline/fetch-notion.mjs`, or article content.

This is the one-paragraph doc I wish I'd had at the start of the L2 truncation fix — it would have saved an hour of wrong-direction debugging. Read it before designing any "republish all articles" or "fix existing content" change.

## TL;DR

**Notion is the source of truth for article bodies.** Everything else is a derived view that gets overwritten on the next deploy.

## The four data locations and what they actually mean

| Location | Mutability | Role |
|---|---|---|
| **Notion** (`unified_db_id`, also legacy `l1`/`l2`/`l3` DBs) | Authoritative — the only place with stable, edit-able article state | Source of truth for: titles, abstracts, categories, body blocks, source URLs, dates, status |
| **`main:newsletter/app/public/posts/*.md`** | Stale derived export; **overwritten** by `newsletter/pipeline/fetch-notion.mjs` during CI | Historical / backup snapshot. **Not** what the user-facing site reads. The committed copy is allowed to drift from Notion — every CI build clobbers it. |
| **gh-pages `posts/*.md` + `manifest.json`** | What the user actually reads at `kohuehara.xyz/...` | Built fresh from Notion every deploy. Lags Notion by up to ~6 hours (deploy cron: 06:17 / 12:17 / 18:17 UTC, plus push-to-`main` triggers) |
| **`main:newsletter/app/public/posts/images/*.jpg`** | Authoritative for cover images (present = a non-placeholder cover for this slug) | Skipped by `fetch-notion.mjs`. The GAS L4 batch used to auto-generate these; that path is gone, so no new auto-generated covers are produced — add a `<slug>.jpg` by hand to override the placeholder fallback (`writers/posts-md.mjs` `resolveImagePath`). |

## Implications

1. **To fix article content, edit Notion** (directly, or re-run the relevant `article-level2` / `article-level3` cadence so it regenerates the row). The next deploy will republish.

2. **Never read `main:newsletter/app/public/posts/<slug>.md` to decide whether content is "current."** Half of those files are stale and CI will overwrite them next deploy anyway. Read the live `gh-pages` raw URL, or read the Notion row directly.

3. **Publication is `deploy-article-site.yml`, which reads Notion directly.** `fetch-notion.mjs` exports the unified Notion Articles DB (no `Status` filter — every row is exported) on every deploy. The committed `main` markdown export exists for change-history continuity (so you can `git log` the export), not for serving.

4. **Cover images are a separate concern.** Image presence on `main` is what makes a slug serve a non-placeholder cover; `fetch-notion.mjs` skips the image directory. The GAS L4 batch used to generate these automatically — that path is gone, so without a hand-added `<slug>.jpg` the site serves the placeholder. Don't conflate the markdown export with image generation.

5. **`gh workflow run deploy-article-site.yml`** is the manual lever to force-pull current Notion content. Use it when you've just edited Notion (or re-run a cadence) and don't want to wait for the cron.

## Common mistakes this prevents

- **Reading from `main` to decide what to regenerate.** Caught me on the first L2 backfill design — I read `newsletter/app/public/posts/<slug>.md` from main, found 4 of 5 sampled slugs missing entirely, and concluded "nothing to do." The correct source is the Notion row itself, or gh-pages raw URLs (for what users see).

- **Writing markdown directly to `main`.** Bypasses Notion. The next CI build overwrites your write. If the change isn't in Notion, it doesn't exist.

- **Manually deleting `main:newsletter/app/public/posts/<slug>.md`** to "republish." Doesn't work; CI rewrites the file from Notion on the next deploy.

## Verification

The `article-health` skill (`.claude/skills/article-health/`) implements the contract this doc declares: it compares Notion (authoritative) against gh-pages (live view) and reports drift. Run it after any Notion mutation to confirm the deploy pipeline picked up your change.
