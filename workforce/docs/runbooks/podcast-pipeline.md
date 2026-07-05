# Runbook — Podcast production & Spotify distribution (Epic-017)

The operator's end-to-end procedure for turning analysis articles into Spotify
podcast episodes, and the **operator-gated (B-authority)** steps that the
A-authored skills/Lambda/seed cannot perform autonomously.

Design record: [`epics/epic-017-podcast-spotify-distribution.md`](../epics/epic-017-podcast-spotify-distribution.md).
Governance: [ADR-0016](../adr/adr-0016-podcast-production-surface.md), `governance.md` R-N1 / §2 W-3 / §5.

---

## 1. Notion article-DB properties (Story 4 — operator pre-creates)

Create these properties on the **unified Articles DB** (the same DB the L2/L3
pipeline writes). Names and types are the stable contract the skills and the
frontmatter sync reference — **use these exact names** (camelCase):

| Property | Type | Written by | Read by | Notes |
|---|---|---|---|---|
| `podcastStatus` | **Status** | `podcast-script`, `wf-podcast` Lambda | every stage | Notion `status`-type property. Options: `none`, `script-ready`, `approved`, `audio-ready`, `published`. Absent/`none` ⇒ no podcast. |
| `podcastScript` | **Text** (rich_text) | `podcast-script` (Rhys) | synthesis | The narration script (chunked rich_text). |
| `podcastSources` | **Text** (rich_text) | `podcast-script` (Rhys) | RSS description | Mandatory source citations. Empty ⇒ the write hard-fails (exit 2). |
| `complianceVerdict` | **Text** (rich_text) | `podcast-script` (Idris) | operator (before approve) | Idris's no-verbatim + citation-completeness verdict (`PASS`/`FLAG: …`). |
| `podcastVoice` | **Text** (rich_text) | `podcast-publish` (Celeste, Odette's pool) | synthesis | The cast JA Neural voice (`Takumi`/`Kazuha`/`Tomoko`); else random. |
| `podcastShowNotes` | **Text** (rich_text) | `podcast-publish` (Celeste) | RSS description | Show-notes framing; leads the feed description, citations follow. |
| `audioUrl` | **URL** | `wf-podcast` Lambda (synthesis) | RSS enclosure | Internal S3/CDN MP3 URL. **Never** linked from the reader site (D3). |
| `spotifyUrl` | **URL** | operator (manual, Phase 1) | frontmatter sync → reader | Spotify deep-link; drives the reader icon link. |

`podcastStatus` option spelling must match exactly — the picker and the Lambda
filter on these literal strings.

The state machine (judgment = **two** persona cadences writing Notion params;
execution = the daily CI job; the only human gate is `script-ready → approved`):

```
(none) ──podcast-script (Rhys+Idris: script+verdict)──▶ script-ready
       ──operator reviews + approves──▶ approved
       ──podcast-publish (Celeste: voice + show-notes)──▶ approved (params set)
       ──CI synthesize (Polly→S3)──▶ audio-ready
       ──CI publish (flip + RSS)──▶ published
```

Cadences (CCR, Notion-only, ≤5/fire, daily, land **paused**): **`podcast-script`**
(rhys — the prepare half) and **`podcast-publish`** (celeste — the publish half;
sets `podcastVoice` from Odette's pool + `podcastShowNotes` on `approved`
episodes). Deterministic execution: `.github/workflows/podcast-pipeline.yml`
(daily, AWS OIDC) runs `podcast-publish`'s bundled `synthesize` then `publish`,
≤5 each. (Epic-017 consolidated the former four skills — `podcast-cast`,
`podcast-shownotes`, `podcast-synthesize`, `podcast-rss` — into `podcast-publish`.)

---

## 2. Stand up the team & governance (Phase 0)

1. **Merge** the Epic-017 PR (raises W-3 to $250/mo, lands ADR-0016, the
   `media-group` seed, the `podcast-script` skill, the `wf-podcast` Lambda +
   skills, and the reader/pipeline changes). PR merge is B-authority.
2. **Register the media team** (after the data-plane deploy that ships the
   `POST /agents` route, and after the W-3 raise is live):
   ```bash
   node workforce/seed/media-group/register.mjs --dry-run
   aws-vault exec <profile> -- node workforce/seed/media-group/register.mjs
   ```
   Verifies `GET /agents/{slug}` → 200 for celeste, rhys, odette, idris.
   Rebuild the console manifest afterward (predev/prebuild does it).

---

## 3. Deploy the synthesis/RSS Lambda (Phase 1 — B: new AWS service)

`wf-podcast` adds **Amazon Polly** to the SAM template — a §5 B-authority "new
AWS service" action. Review the IAM (Polly + S3 `podcast/*` + the Notion-egress)
then deploy:

```bash
cd workforce/lambdas && npm ci && npm run typecheck && npm run test
cd ../infra/sam && sam build && sam deploy   # review the changeset first
```

The MP3 enclosure is served publicly to Spotify's crawler via the CloudFront
distribution scoped to the `wf` bucket's `podcast/*` prefix (OAC) — the bucket
keeps its full `PublicAccessBlock`. Note the distribution domain; it is the
Lambda's `PODCAST_PUBLIC_BASE_URL`.

---

## 4. Enable the podcast cadences (Phase 1 — B: cron enable)

Both bindings (`podcast-script` → rhys, `podcast-publish` → celeste) land
**paused** (`scheduler:"manual"`). Wire them (A-authored script, operator runs
it), then enable when ready:

```bash
# after the podcast-script + podcast-publish SKILL# rows are synced post-deploy (R8):
aws-vault exec <profile> -- node workforce/seed/media-group/wire-cadences.mjs
```

To enable each: PATCH the binding to the live trigger (`scheduler:"external"` +
`invoked_by:"api"` + a staggered daily cron) — see the ENABLE_SNIPPET at the
bottom of `wire-cadences.mjs`. Stagger `podcast-publish` (celeste) **before** the
18:37 UTC CI workflow so the day's voice/show-notes params are set before
synthesis. Enabling a cron is B-authority (governance §5).

For a first manual episode without enabling the cron, fire each cadence once via
the orchestrator's manual-dispatch path (rhys + `podcast-script`; then, after the
operator approves, celeste + `podcast-publish`).

---

## 5. Synthesize & build the feed (Phase 1)

Once an article is `approved` (and `podcast-publish` has set its voice/notes):

1. **Synthesize** — `node workforce/skills/podcast-publish/synthesize.mjs` →
   `wf-podcast` synthesize route. It reads the episode's `podcastVoice` (else a
   random JA Neural Polly voice), `StartSpeechSynthesisTask`, writes the MP3 to
   `s3://…/podcast/audio/{slug}.mp3`, and sets `audioUrl` +
   `podcastStatus=audio-ready`. Up to 5 oldest `approved` per run.
2. **Publish + build RSS** — `node workforce/skills/podcast-publish/publish.mjs`
   → `wf-podcast` publish route. It flips up to 5 oldest `audio-ready` episodes to
   `published` and rebuilds the podcast RSS (enclosure = the CDN MP3,
   `<description>` = `podcastShowNotes` then the mandatory `podcastSources`
   citations, GUID = slug) to the public `podcast/feed.xml`. (For a standalone
   feed refresh without flipping status: `build-rss.mjs`.)
3. The daily `.github/workflows/podcast-pipeline.yml` runs steps 1–2 in CI (AWS
   OIDC). Validate the feed against a podcast-feed checker (e.g. Cast Feed
   Validator, Podba.se) before the first Spotify submission.

---

## 6. Submit to Spotify & capture spotifyUrl (Phase 1 — B: one-time, manual)

1. **Submit the RSS URL** (the CDN `podcast/feed.xml`) to **Spotify for
   Podcasters** once. Subsequent episodes auto-ingest from the same feed.
2. After Spotify ingests episode 1, copy its Spotify episode/show URL into the
   article page's `spotifyUrl` property and set `podcastStatus=published`.
   (`spotify.token` API automation is Phase 2 — Phase 1 is manual, Q5.)
3. The next `deploy-article-site.yml` run syncs `spotifyUrl` → frontmatter →
   `manifest.json`, and the article page renders the Spotify icon link. For
   "make it live now": `gh workflow run deploy-article-site.yml`.

---

## 7. Verify

- `node workforce/scripts/validate-skills.mjs` green (podcast-* skills C1–C3).
- The reader article page shows the Spotify link only when `spotifyUrl` is
  present, and renders **no** `<audio>` element (D3).
- `article-health` reports no truncation regression.
- End-to-end target article: `c91368439868`.

---

## Authority summary (what only the operator may do)

| Step | Authority | Why |
|---|---|---|
| Create the 5 Notion properties | **B** | Notion schema is operator-managed (C-2). |
| Merge the Epic-017 PR | **B** | Agents never merge. |
| Run `register.mjs` (persona existence) | **B** | priya/operator; gated by the W-3 raise. |
| `sam deploy` (Polly = new AWS service) | **B** | §5 new-AWS-service row. |
| Enable the `podcast-script` + `podcast-publish` crons | **B** | §5 cron-enable row. |
| Submit the RSS feed to Spotify | **B** | External publication, one-time. |
| Record `spotifyUrl` → `published` | **B** (Phase 1 manual) | Closes the loop; reader link goes live. |
