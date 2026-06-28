# Epic-017 — Podcast production & Spotify distribution from analysis articles

- **Status**: In-progress
- **Owner**: Maya
- **Created**: 2026-06-27
- **Implemented by**: branch `claude/epic-017-spotify-podcast-k8z11e` — Stories 1–7 A-authority artifacts (seed, governance/ADR-0016, podcast-script/synthesize/rss skills, wf-podcast Lambda + SAM, reader/pipeline). Architecture per tracker #379: workforce skills + backing `wf-podcast` Lambda (no GAS/Actions synthesis). B-gated steps (register, SAM deploy, Notion props, cron enable, Spotify submission) tracked in [runbooks/podcast-pipeline.md](../runbooks/podcast-pipeline.md).

## Problem

The L3/L4 analysis articles on `kohuehara.xyz/ai-native-article` are text-only. The operator wants to **repurpose each analysis article into a podcast episode distributed on Spotify**, with a Spotify deep-link on the article page so readers can jump to the episode (example article: `/article/c91368439868`).

Three gaps block this today:

1. **No production path.** There is no mechanism that turns a published article into a spoken-word script, then into audio, then into a podcast feed. The operator's constraint is explicit: **script generation must not use Bedrock** — it must run on the existing **Cadence** mechanism (a workforce member executing a Claude Routine), the same archetype that already produces `article-level2/3`. Audio synthesis and feed assembly are deterministic and belong in the CI pipeline, not in a judgment Cadence.

2. **No org owner for external communications or media.** The current functions are Policy, Finance, IR, Engineering, Product, Customer Experience, and People & Legal. **Nobody owns the integrated external-communications surface** (news + podcast + brand outbound as one view), podcast production, narrator casting, or media-specific rights compliance. This is a new functional axis.

3. **Copyright / citation risk.** A podcast derived from third-party news must be **derivative commentary, never verbatim reproduction**, and **every episode must carry source citations** (in the Spotify show notes). Without an owner and a mechanical guard, this is an editorial-integrity (C-1) and legal exposure.

## Proposed solution

Stand up a **dedicated Media & External Communications team**, give it a **`podcast-script` Cadence** for script generation, and build a **deterministic synthesis → RSS → Spotify** pipeline. The reader site gains only a Spotify link (no in-page player). Confirmed product decisions from the operator:

- **D1 — Format.** Single narrator (colloquial, conversational-style narration); **one Polly voice per episode, chosen at random from a JA Neural voice pool each cast**, for V1 (so the same single-voice episode varies its narrator across casts). Multi-host dialogue is a later version (Phase 2).
- **D2 — Org.** A **new, independent Media & External Communications team**, headed by a **net-new Marketing VP (統括)** with integrated oversight of all outbound channels; multiple new positions. **The W-3 budget ceiling is raised to $250/mo (operator-approved).**
- **D3 — Distribution scope.** **Spotify only.** **No in-page audio player** — the operator explicitly dropped on-site playback to avoid the time-cost of download-protection work. The article page carries a **Spotify icon link only**. MP3s are hosted on S3 **solely as the RSS enclosure** for Spotify's crawler, never linked from the site; frontmatter therefore needs `spotifyUrl` (+ `hasPodcast`), not `audioUrl`.
- **D4 — No GAS.** Script generation runs entirely on the cadence-forge `podcast-script` Cadence (calling its own bundled scripts is fine); **Google Apps Script is not used anywhere in this Epic.** The `spotifyUrl` frontmatter field flows only through the CI sync path — the GAS `Code.gs` publish path is explicitly excluded.

### Architecture

```
[L3/L4 article (Notion = SoT, C-2)]
        │  ① podcast-script Cadence (Claude Routine — the judgment step)
        │     persona(scriptwriter) × skill(podcast-script) × project(agent-workforce)
        ▼
[Notion article page ← script + source citations + podcastStatus=script-ready]
        │  ② synthesis CI job (deterministic) newsletter/pipeline/podcast/synthesize.mjs
        │     Amazon Polly (Neural JA, single voice, StartSpeechSynthesisTask) → MP3 to S3
        ▼
[Notion ← audioUrl (internal) + podcastStatus=audio-ready]
        │  ③ RSS build build-rss.mjs → podcast RSS (XML, citations in <description>) to public S3
        │     Spotify ingests the feed → operator records spotifyUrl back to Notion
        │       (Phase 1: manual / Phase 2: Spotify API)
        ▼
[deploy CI (existing deploy-article-site.yml) fetch-notion → frontmatter spotifyUrl]
        ▼
[Reader SPA: Spotify icon link on the article page when spotifyUrl present]
```

Design principle: **judgment (the script) = Cadence; determinism (synthesis, RSS, publish) = pipeline/CI.** Polly, S3, and RSS carry no judgment, so they are not Cadences. C-2 is preserved by attaching the script, citations, and metadata to the article's **Notion** page and riding the existing Notion→frontmatter sync; only the MP3 binary lives in S3 (and is never linked from the site).

### A. New Media & External Communications team — `workforce/seed/media-group/`

A new independent team under Maya (Founder). Four new positions, registered via the standard `POST /agents` seed flow (`register.mjs` modeled on `workforce/seed/policy-group/register.mjs`; SigV4, `validateAgentCreate`, idempotent 409):

1. **VP, Marketing & External Communications (統括)** — integrated oversight of every outbound channel (news / podcast / brand). Head of the team. Boundary with elena (VP CX, customer experience) handled by `lateral`.
2. **Podcast Scriptwriter** — owner/executor of the `podcast-script` Cadence; colloquial script + source citations.
3. **Podcast Producer / Narration & Voice Casting** — **narrator casting** (Polly voice selection and article↔voice mapping), episode QA, Spotify operations.
4. **Media Rights & Compliance Coordinator** — owns the operational no-verbatim-reproduction / mandatory-citation checklist and the mechanical guard. **Legal authority (fair-use / derivative-work judgment) escalates to levi (Product Counsel) and priya (VP People & Legal)** — IP/legal authority stays centralized per workforce governance (priya decides whether a persona exists).

Each persona = `{slug}.json` + `{slug}-system.md` (slug/role/model/budget/reports_to/lateral/jd/identity). **Budget:** ≈ +$24–26/mo for four hires → **raise W-3** from $190/mo to **$250/mo (operator-approved)** (headroom for Phase-2 multi-voice and episode growth) — a **Zone A** edit to `workforce/docs/governance.md §2`. The VP is a net-new hire: integrated external communications is too broad to cover from the CX seat, so elena is not expanded.

### B. `podcast-script` Cadence — `workforce/skills/podcast-script/`

Scaffolded with `cadence-forge` (`node .claude/skills/cadence-forge/scaffold.mjs --name podcast-script --owners <scriptwriter>,<producer> --credential notion.integration_token --cost-class medium`). Following the `article-level2` reference implementation:

- **`SKILL.md`** — Recall packet (pick the oldest L3/L4 article without a podcast from the unified DB) / The one thing (**one single-narrator colloquial script** + source citations) / Skip rule (no eligible article → don't call the write-script) / Write step. The body stays persona-agnostic; tone/voice come from the bound persona's `system.md`.
- **`meta.json`** — `archetype:"cadence"`, `requires:["notion.integration_token"]`, `cost_class:"medium"`.
- **`publish-notion.mjs`** — attaches script + citations + `podcastStatus=script-ready` to the article's Notion page. **Reuses the W-1 guards** from `article-level2/publish-notion.mjs` (empty body / LLM-failure prelude / `scripts/lib/truncation.mjs` cut-off check) and **adds a citation guard: empty `--citations-file` → exit 2** (the mechanical L2 implementation of the team's citation-mandatory policy).

Bound to the scriptwriter persona via the `wire-cadences.mjs` pattern (executor=`claude-code-routine`, scheduler=`external`, invoked_by=`api`, `routine_spec=workforce/docs/routines/agent-runner.md`, project=`agent-workforce`, djb2-staggered cron). The new EventBridge cron is a **Zone B** operator gate (lands paused). Passes `npm run workforce:skills` (C1–C3) and `npm run workforce:skill-registry:check`.

### C. Audio synthesis + RSS (deterministic CI)

- **`newsletter/pipeline/podcast/synthesize.mjs`** — reads `podcastStatus=script-ready` from Notion → **Amazon Polly Neural Japanese, one voice chosen at random per episode from a JA Neural voice pool, `StartSpeechSynthesisTask`** (10 min ≈ 5,000 chars; the async API is required because synchronous `SynthesizeSpeech` caps at 3,000 billed chars; Polly writes the MP3 straight to S3) → MP3 to the **existing `wf` bucket's public prefix** (`…/podcast/audio/{slug}.mp3`, public for Spotify's crawler — no dedicated bucket) → writes `audioUrl` (internal) + `podcastStatus=audio-ready` back to Notion. The producer / voice-casting persona owns the voice-pool definition and QA.
- **`newsletter/pipeline/podcast/build-rss.mjs`** — builds the podcast **RSS** from `audio-ready` episodes (`<item><enclosure>` = S3 MP3, `<item><description>` carries the **mandatory source citations**, GUID = slug) → public S3.
- **`.github/workflows/podcast-synthesize.yml`** — scheduled GitHub Action running both scripts; AWS credentials via GH Secret, IAM scoped to Polly + S3.
- Per-cast cost (≈10 min JA): script-gen via the Cadence's LLM + Polly Neural ≈ **$0.08/episode TTS**, total **~$0.15–0.30/episode** — negligible; the W-3 raise is for salaries, not synthesis.
- **No download-protection work** (out of scope per D3 — a podcast RSS enclosure is public by nature).

Notion article-DB properties (**pre-created by the operator**): `podcastStatus` (select: none/script-ready/audio-ready/published), `podcastScript` (**text** property — Notion exposes no child-block property type, so the script body is stored as text), `podcastSources` (citations), `audioUrl` (internal), `spotifyUrl`. The `podcast-script` write-script writes the script into the `podcastScript` text property.

### D. Reader app — Spotify link only

- `newsletter/app/src/types/article.ts` `ArticleMeta` += `spotifyUrl?`, `hasPodcast?` (no `audioUrl` — the site never plays audio).
- `newsletter/app/src/pages/Article.tsx` header (~L251, the date-meta row) gains a **Spotify icon link** (`meta.spotifyUrl`, new tab). **No `<audio>` element.** Reuse the external-link styling from `newsletter/app/src/components/article/SourcesUsedSection.tsx`; instrument the click with the existing `trackEvent` (`@kohuehara/shared/analytics`). `parseFrontmatter()` is generic, so the new field needs no parser change.

### E. Pipeline frontmatter — `spotifyUrl` only

The **only** path is the CI sync (Path B): `newsletter/pipeline/fetchers/types.mjs` (`ArticleRecord += spotifyUrl?`), `fetchers/notion.mjs` (extract it), `writers/posts-md.mjs` (`frontmatter()` conditional push). **GAS is not used (D4)** — the `newsletter/gas/src/Code.gs` publish path is explicitly excluded, so there is no `Code.gs` change and no `gas-deploy-verify` step.

### Staged rollout

| Phase | Action | Authority |
|---|---|---|
| **0 — Team** | Register `media-group` (4 personas) via `register.mjs`; raise W-3 in governance.md; land the new ADR (podcast execution surface, R-N1). | A (seed/ADR draft) + **B (W-3 cap, persona existence — priya/operator)** |
| **1 — Spotify (primary)** | `podcast-script` Cadence + `synthesize.mjs` (Polly random JA voice → S3) + `build-rss.mjs` + Spotify feed submission + `spotifyUrl` → frontmatter → reader Spotify link. Cadence binding lands **paused**. | A (skill, pipeline, reader) + **B (cron enable, PR merge, Spotify submission)** |
| **2 — Future** | Multi-host dialogue (multiple Polly voices, speaker splitting/joining); Spotify API automation (`spotify.token` credential); Japanese Generative voice if available. | later Epic phase |

## Behaviour at N = 100+ agents

- **The media team is O(1), not O(N).** It is a fixed four-role function that does not grow with workforce size — unlike the research cohort (Epic-015), it is not fanned out across personas. Adding agents elsewhere does not multiply media headcount.
- **One Cadence, one binding.** `podcast-script` is bound to a single persona (the scriptwriter); skill count stays O(1) and there is no co-versioning fan-out. If episode throughput ever needs more than one scriptwriter, that is an additive binding, not a new skill.
- **Write/episode volume tracks article-publication cadence, not agent count.** Each episode is a bounded set of Notion writes + one S3 object + one RSS `<item>`. The feed/EXEC-ledger load per episode is the same single execution record every Cadence already writes; GSI headroom is unchanged from Epic-011/Epic-010 analysis.
- **Cost (W-3).** A fire is one LLM script generation; Polly/S3 are cents/episode AWS infra **outside** the token budget. The W-3 raise in this Epic funds four salaries, not synthesis — and is a deliberate one-time ceiling bump, not a per-agent scaling cost.
- **Governance scales by centralization.** Legal/IP authority remains with levi/priya no matter how large the org grows; the Media Rights Coordinator owns operational compliance and escalates, so the legal blast-radius does not widen with team size.

## Acceptance criteria

- `workforce/seed/media-group/` registers four personas (`GET /agents/{slug}` → 200 each); `governance.md §2` W-3 ceiling raised; a new ADR declares the podcast production/distribution execution surface.
- `workforce/skills/podcast-script/` exists (`archetype:"cadence"`, `requires:["notion.integration_token"]`) with `publish-notion.mjs`; passes `npm run workforce:skills` + `:skill-registry:check`; **empty citations → exit 2** verified.
- `synthesize.mjs` turns a `script-ready` test article into an S3 MP3 (a random JA Neural voice via async task) and writes `audioUrl` + `audio-ready` to Notion.
- `build-rss.mjs` emits a valid podcast RSS (enclosure = MP3, citations in `<description>`); feed submitted to Spotify (operator).
- `spotifyUrl` flows Notion → `posts/{slug}.md` frontmatter + `manifest.json` → reader; the article page renders a Spotify icon link (and **no** `<audio>`); `article-health` reports no truncation regression.
- End-to-end verified on `c91368439868`. PR body cites the L1 docs / ADRs it touches (governance.md, the new ADR, ADR-0007) per the R-11 citation gate.

## Open questions

All six Phase-1 questions were resolved by operator decision (2026-06-27):

- **Q1 → New hire.** The Marketing VP (統括) is net-new — external communications is too broad to cover from the CX seat, so elena is not expanded.
- **Q2 → Operator pre-creates** the Notion properties; `podcastScript` is a **text** property (Notion has no child-block property type).
- **Q3 → Reuse** the existing `wf` bucket's public prefix (no dedicated bucket).
- **Q4 → W-3 = $250/mo, approved.**
- **Q5 → Manual** `spotifyUrl` capture in Phase 1 (`spotify.token` API automation deferred to Phase 2).
- **Q6 → Random voice per cast** from a JA Neural voice pool.

Residual (non-blocking, implementation-time): the exact JA Neural voice-pool membership (owned by the producer / voice-casting persona), and confirming whether `workforce/docs/epics/` is inside the `autopilot:l0l1-paths` protected set in `governance.md` (decides whether pr-autopilot may merge this PR or must escalate it to a human).

## Out of scope

- **In-page audio player and download protection** — explicitly dropped (D3). The reader gets a Spotify link only.
- **Multi-host dialogue format and multiple voices** — Phase 2.
- **Spotify API automation / `spotify.token` credential** — Phase 2; Phase 1 captures `spotifyUrl` manually.
- **Bedrock for script generation** — explicitly excluded; generation runs on the Cadence mechanism.
- **Google Apps Script (GAS)** — not used anywhere in this Epic (D4). Generation is the cadence-forge `podcast-script` Cadence; `spotifyUrl` frontmatter flows only through the CI sync pipeline, never `Code.gs`.
- **Generative / Long-form Japanese voices** — V1 uses Neural voices (one per episode, random); revisit on availability.
