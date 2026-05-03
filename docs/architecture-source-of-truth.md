# Source-of-truth architecture

**Status:** Adopted (governance L1).
**Last updated:** 2026-05-03.
**Audience:** anyone editing `gas/src/Code.gs`, `scripts/fetch-notion.mjs`, or article content.

This is the one-paragraph doc I wish I'd had at the start of the L2 truncation fix — it would have saved an hour of wrong-direction debugging. Read it before designing any "republish all articles" or "fix existing content" change.

## TL;DR

**Notion is the source of truth for article bodies.** Everything else is a derived view that gets overwritten on the next deploy.

## The four data locations and what they actually mean

| Location | Mutability | Role |
|---|---|---|
| **Notion** (`unified_db_id`, also legacy `l1`/`l2`/`l3` DBs) | Authoritative — the only place with stable, edit-able article state | Source of truth for: titles, abstracts, categories, body blocks, source URLs, dates, status |
| **`main:public/posts/*.md`** | Stale legacy export; written by `handleL4Publish`; **also overwritten** by `scripts/fetch-notion.mjs` during CI | Historical / backup snapshot. **Not** what the user-facing site reads. The committed copy is allowed to drift from Notion — every CI build clobbers it. |
| **gh-pages `posts/*.md` + `manifest.json`** | What the user actually reads at `kohuehara.xyz/...` | Built fresh from Notion every deploy. Lags Notion by up to ~6 hours (deploy cron: 06:17 / 12:17 / 18:17 UTC, plus push-to-`main` triggers) |
| **`main:public/posts/images/*.jpg`** | Authoritative for cover images (idempotent: present = "L4 has imaged this slug") | Skipped by `fetch-notion.mjs`; each slug's image is generated once by `handleL4Publish` and reused thereafter |

## Implications

1. **To fix article content, edit Notion.** The next deploy will republish.

2. **Never read `main:public/posts/<slug>.md` to decide whether content is "current."** Half of those files are stale and CI will overwrite them next deploy anyway. Read the live `gh-pages` raw URL or read Notion via a GAS handler.

3. **`handleL4Publish`'s GitHub write is best-effort.** If it fails, `fetch-notion.mjs` will still publish the article on the next deploy because it reads Notion directly. The L4 GitHub write exists for change-history continuity (so you can `git log` the export), not for serving.

4. **Image existence is a separate, idempotent concern.** `handleL4Batch` uses image presence on `main` as the "has L4 run for this slug?" signal — see the in-code comment at `handleL4Batch`. Don't conflate the markdown export with image generation.

5. **`gh workflow run deploy.yml`** is the manual lever to force-pull current Notion content. Use it when you've just run a Notion-mutating handler (e.g. `runL2Backfill`) and don't want to wait for the cron.

## Common mistakes this prevents

- **Reading from `main` to decide what to regenerate.** Caught me on the first L2 backfill design — I read `public/posts/<slug>.md` from main, found 4 of 5 sampled slugs missing entirely, and concluded "nothing to do." The correct source is Notion (via `notionReadPageBlocks` in GAS) or gh-pages raw URLs (for what users see).

- **Writing markdown directly to `main`.** Bypasses Notion. The next CI build overwrites your write. If the change isn't in Notion, it doesn't exist.

- **Manually deleting `main:public/posts/<slug>.md`** to "republish." Doesn't work; CI rewrites the file from Notion. To unpublish, set the Notion row's `Status` to `archived` (read by `handleL4Batch`).

## Verification

The `article-health` skill (`.claude/skills/article-health/`) implements the contract this doc declares: it compares Notion (authoritative) against gh-pages (live view) and reports drift. Run it after any Notion mutation to confirm the deploy pipeline picked up your change.
