# ADR-0016 — Podcast production & distribution execution surface

- **Status**: Proposed
- **Date**: 2026-06-28
- **Deciders**: operator (refluster), maya, celeste
- **Epics**: [017](../epics/epic-017-podcast-spotify-distribution.md)

> **Update (2026-06-29) — skill consolidation (no decision reversed).** The
> production skills were consolidated from five into **two persona cadences**:
> **`podcast-script`** (Rhys + Idris — the prepare half) and **`podcast-publish`**
> (Celeste — the publish half, which absorbs the former `podcast-cast`,
> `podcast-shownotes`, `podcast-synthesize`, and `podcast-rss`). Every decision
> below stands: the prepare cadence still runs on the R-N1 exception (a) surface;
> the deterministic Polly/S3/RSS work still runs in the `wf-podcast` Lambda
> (triggered by the daily CI workflow via OIDC, never the Notion-only cadence);
> Polly + public-CloudFront egress, the mandatory-citation guard, and the
> authority placement are unchanged. Odette still owns voice-pool membership and
> Idris still owns the rights checklist — only the mechanical *writes* moved into
> the two cadences. See `epic-017` for the consolidation rationale.

> **Update (2026-06-30) — end-to-end sequence, triggers & status model documented (no decision reversed).** Clarifies the as-built flow after operator confusion over "which component does what." See the new [§ Operational sequence & status model](#operational-sequence--status-model-added-2026-06-30): the per-article `podcastStatus` machine, the three triggers (the two CCR cadences + the `podcast-pipeline.yml` workflow), and the skill↔workflow↔Lambda division of labour. It also records the `/podcast/synthesize` route's **kickoff + finalize-poll** shape ([#409](https://github.com/refluster/ai-native-article/pull/409)): a full-episode Polly synthesis outlasts the API Gateway HTTP-API hard 30s integration timeout, so the Lambda starts the Polly async task and returns `202` while the caller polls — the wait lives in Polly, not the Lambda, and **no per-Lambda nested invocation** is introduced (R-N1). No decision below is reversed.

## Context

Epic-017 repurposes the L3/L4 analysis articles on `kohuehara.xyz` into
single-narrator podcast episodes distributed on Spotify, with a Spotify
deep-link on each article page. That introduces a production/distribution
pipeline the workforce has not run before: script generation, audio synthesis,
RSS feed assembly, and a public audio enclosure for Spotify's crawler.

Three governance questions follow:

1. **Where does each step execute?** [R-N1](../governance.md) declares that agent
   reasoning runs on AWS Lambda by default, with two documented exceptions (the
   CC-routine surface and client-side execution). The pipeline must fit that
   rule, not quietly add a third reasoning surface.
2. **What new AWS egress does it add?** Audio synthesis needs **Amazon Polly**,
   and Spotify needs a **publicly-fetchable** RSS feed + MP3 enclosure — both new
   relative to the existing DDB/S3/Secrets-Manager/Notion/GitHub egress set.
3. **Where does authority sit for the copyright/citation risk?** A podcast
   derived from third-party news is editorial-integrity (C-1) and legal exposure
   if it reproduces source text verbatim or drops citations.

The operator's constraints (Epic-017 D1–D4, confirmed 2026-06-27): script
generation runs on the **Cadence** mechanism (no Bedrock); synthesis/RSS are
deterministic and belong in a backing Lambda; distribution is **Spotify-only**
with **no in-page player**; and **GAS is not used anywhere** in this Epic.

## Decision

Declare the **podcast production & distribution surface** as an additive,
governed extension of the existing execution model — **not** a new reasoning
surface — composed of:

1. **The `podcast-script` Cadence** (`workforce/skills/podcast-script/`) runs on
   the existing R-N1 exception (a) CC-routine surface, exactly like
   `article-level2/3` and `feed-post`. Its judgment (the narration script +
   citations) is LLM-produced; its side effect is a deterministic bundled
   write-script that attaches the script to the article's **Notion** page (C-2:
   Notion stays the source of truth). It carries the `article-level2` W-1 guards
   **plus** a mandatory-citation guard (empty citations → exit 2).

2. **The `wf-podcast` Lambda** (`workforce/lambdas/wf-podcast/`) runs on the
   **default** Lambda surface. It performs **no agent reasoning** — synthesis
   (Amazon Polly Neural JA, one voice chosen at random per cast,
   `StartSpeechSynthesisTask` → MP3 to S3) and RSS assembly are deterministic.
   It is therefore squarely within "Lambda by default" and adds no exception to
   R-N1's "no other reasoning surfaces" clause.

3. **New AWS egress, explicitly declared:**
   - **Amazon Polly** (`polly:StartSpeechSynthesisTask` / `polly:GetSpeechSynthesisTask`)
     — a new AWS service in the SAM template. Adding it is the governance §5
     **B-authority** "new AWS service to the SAM template" action: the operator
     reviews and deploys.
   - **Public S3 RSS/MP3 egress** — the podcast RSS feed and its MP3 enclosures
     must be publicly fetchable for Spotify's crawler. They live under the
     **existing `wf` bucket's `podcast/` prefix** (no dedicated bucket, Epic-017
     Q3). The bucket keeps its full `PublicAccessBlock`; public read is served
     via a **CloudFront distribution with Origin Access Control** scoped to the
     `podcast/*` prefix — never via a public bucket ACL/policy. The MP3 is the
     RSS enclosure only; the reader site never links it (Epic-017 D3).

4. **Authority placement.** The new **Media & External Communications** team
   (Epic-017 Story 1) owns production: Rhys (script), Odette (synthesis QA + voice
   pool), Idris (operational rights/citation checklist + the mechanical guard).
   **Legal authority does not move into the team** — fair-use / derivative-work /
   IP-authority questions escalate to **levi** (Product Counsel) and **priya**
   (VP People & Legal). The mandatory-citation rule is enforced **mechanically**
   (the write-script's empty-citations → exit 2), not by reviewer diligence.

5. **Operator-gated terminal steps (Spotify, Phase 1).** Spotify feed submission
   is a one-time **B-authority** operator act; per-episode `spotifyUrl` capture
   back to Notion is **manual** in Phase 1 (`spotify.token` API automation is
   deferred to Phase 2). `spotifyUrl` then flows Notion → frontmatter → the
   reader Spotify link through the existing non-GAS CI sync (Epic-017 D4/E).

## Operational sequence & status model (added 2026-06-30)

The pipeline spans **four components** with **distinct triggers**; the single
source of per-article truth is the `podcastStatus` property on the unified
Articles DB row (C-2). This section documents the as-built flow — it
operationalises the Decision above and reverses none of it.

### Components & triggers

| Component | Kind / surface | Trigger | Touches |
|---|---|---|---|
| `podcast-script` skill | CCR Cadence (R-N1 exc. (a)) | `wf-orchestrator-tick` cron (per binding) **or** manual | Notion only — writes `podcastScript` + `podcastSources` + `complianceVerdict` |
| operator approval | human gate | **manual** (Notion) | flips `podcastStatus` `script-ready → approved` |
| `podcast-publish` — **judgment half** | CCR Cadence (Notion-only, no AWS) | `wf-orchestrator-tick` cron (per binding) **or** manual | Notion only — writes `podcastVoice` + `podcastShowNotes` |
| `podcast-publish` — **deterministic half** (`synthesize.mjs` / `publish.mjs` / `build-rss.mjs`, **bundled in the skill**) | scripts run in CI, **not** in the cadence | **`.github/workflows/podcast-pipeline.yml`** — `cron: 37 18 * * *` + `workflow_dispatch`; OIDC → IAM | SigV4-POST to the `wf-podcast` HttpApi |
| `wf-podcast` Lambda | **default** Lambda surface (deterministic) | invoked by the bundled scripts via the IAM HttpApi | Amazon Polly, S3 (`podcast/*`), Notion writes, RSS |

The division the table makes explicit (the point that caused the confusion):
**the deterministic scripts are *owned by* the `podcast-publish` skill but
*executed by* the `podcast-pipeline.yml` workflow** — by R-N1 design, CCR
cadences are Notion-only and never hold AWS credentials. The workflow is the
executor/trigger, **not** where the logic lives; the heavy work (Polly / S3 /
Notion / RSS) is in the Lambda. So no single component "does everything": the
**script** is `podcast-script`; the **voice + show-notes** are `podcast-publish`'s
judgment half; the **synthesis + feed** are `podcast-publish`'s bundled scripts
run by the workflow against the Lambda.

### Per-article `podcastStatus` machine

```
(none / empty)
   │  podcast-script Cadence → publish-notion.mjs:
   │  write podcastScript + podcastSources + complianceVerdict
   ▼
script-ready
   │  operator: manual review (reads Idris's compliance verdict) → flip in Notion
   ▼
approved        ◀── podcast-publish judgment half writes podcastVoice +
   │                podcastShowNotes here (does NOT change podcastStatus)
   │  podcast-pipeline.yml → synthesize.mjs → wf-podcast Lambda:
   │  Polly StartSpeechSynthesisTask (kickoff → 202) → caller polls finalize →
   │  MP3 copied to podcast/audio/<slug>.mp3 + audioUrl written
   ▼
audio-ready
   │  podcast-pipeline.yml → publish.mjs → wf-podcast Lambda:
   │  flip status + rebuild podcast/feed.xml
   ▼
published ──► feed.xml (S3) ──CloudFront/OAC (~5 min edge cache)──► Spotify crawler
```

| `podcastStatus` | set by | when |
|---|---|---|
| `none` / empty | — | article has no podcast yet (the `podcast-script` picker's eligibility) |
| `script-ready` | `podcast-script` `publish-notion.mjs` | script + citations + compliance attached |
| `approved` | **operator (manual)** | human approves the `script-ready` episode |
| `audio-ready` | `wf-podcast` Lambda (synthesize finalize) | Polly task complete; MP3 + `audioUrl` written |
| `published` | `wf-podcast` Lambda (publish) | episode included in the rebuilt feed |

Notes:
- `podcastVoice` / `podcastShowNotes` are written while the row is still
  `approved` and do **not** advance `podcastStatus`; synthesize consumes
  `podcastVoice`, the feed builder consumes `podcastShowNotes`.
- **synthesize processes only `approved` rows; publish only `audio-ready` rows.**
  A `script-ready` row that was never approved is invisible to both — the most
  common "why didn't my episode publish?" cause.
- The feed includes every `audio-ready`-or-`published` row that has an `audioUrl`.

### Synthesize: kickoff + finalize poll ([#409](https://github.com/refluster/ai-native-article/pull/409))

A full ~10-min JA episode's Polly synthesis runs longer than the API Gateway
**HTTP API's hard 30s integration timeout** (the original synchronous
poll-to-completion 503'd at 30s on a real batch while the synthesis actually
succeeded). So `/podcast/synthesize` does **not** wait: the kickoff (`POST {}`)
calls `StartSpeechSynthesisTask` for up to `BATCH_LIMIT` `approved` rows and
returns `202` with the task handles; `synthesize.mjs` then polls
(`POST {finalize:[…]}`) until each completed task is copied to its public key
and flipped to `audio-ready`. The wait lives inside **Polly's async task
service**, not the Lambda, and the Polly `taskId` is carried by the caller — so
there is **no per-Lambda nested invocation** (which R-N1 forbids without a Zone A
amendment). Fail-loud (C-4) on a Polly `failed` status or a poll-budget timeout.

### Feed propagation (not a pipeline step)

`feed.xml` is written to S3 with `Cache-Control: max-age=300` and served via
CloudFront/OAC. After a rebuild, the edge (and the browser) serve the prior feed
for **up to ~5 minutes** — by design, to avoid a per-publish CloudFront
invalidation (cost/IAM). For an immediate refresh, invalidate `/podcast/feed.xml`
on the distribution. "The run succeeded but the feed hasn't changed yet" within
that window is expected, **not** a failure.

## Alternatives considered

- **Synthesis/RSS as a GitHub-Actions CI job** (the original Epic-017 §C draft).
  Rejected by the operator in favour of the workforce-skill + backing-Lambda
  shape (tracker #379): it keeps the pipeline inside the workforce execution
  model and IAM rather than spreading podcast-specific AWS credentials into CI.
- **A dedicated public S3 bucket for audio.** Rejected (Epic-017 Q3): reuse the
  existing `wf` bucket's `podcast/` prefix behind CloudFront/OAC — one fewer
  bucket to provision, and the bucket's PublicAccessBlock stays intact.
- **In-page audio player + download protection.** Dropped by the operator (D3):
  the article page carries a Spotify icon link only; the MP3 is never linked
  from the site, so there is no download-protection work.
- **Bedrock for script generation.** Excluded (D4): generation runs on the
  Cadence mechanism, the same archetype that already produces `article-level2/3`.
- **Adding a new reasoning execution surface.** Not needed and not done — the
  Lambda is deterministic; reasoning stays on the two R-N1 surfaces.

## Consequences

- **The surface is legible and bounded.** Every new capability — Polly, public
  RSS egress, the Cadence binding — is named here and gated (SAM deploy, cron
  enable, Spotify submission are all B-authority). Nothing about the podcast
  pipeline is implicit.
- **R-N1 is unchanged in substance.** No new reasoning surface; the Lambda is the
  default surface. R-N1 gains a cross-reference (clause (c)) to this ADR so the
  Polly + public-egress declaration is discoverable from the rule it qualifies.
- **C-2 preserved.** Script, citations, status, and `spotifyUrl` all attach to
  the article's Notion page; only the MP3 binary lives in S3, and it is never the
  source of truth or a site link.
- **C-1 / legal exposure mechanically contained.** The mandatory-citation guard
  fails the write loud (exit 2) rather than publishing an uncited derivative; the
  no-verbatim-reproduction discipline is owned operationally by Idris and
  escalated to Levi/Priya, so the legal blast-radius does not widen with team or
  episode growth.
- **Cost (the derivation behind the W-3 raise — @dario cycle 1).** The
  $190→$250/mo (+$60) raise funds **salaries**, not synthesis. The two are
  separate budgets:
  - **Salaries (inside W-3).** The four hires draw `celeste 8 + rhys 6 +
    odette 6 + idris 6 = USD 26/mo` (the persona `budget_monthly_usd_default`
    sum the API enforces against the cap). The +$60 raise covers that $26 with
    ~$34 of deliberate headroom for Phase-2 (multi-voice, episode-volume growth)
    — so the cap is the salary line plus a stated buffer, not a round number.
  - **Synthesis/distribution (outside W-3 — AWS infra, not token budget).**
    Amazon Polly Neural bills ~$16 per 1M chars; a ~10-min JA episode ≈ 5,000
    chars → **~$0.08/episode** TTS. CloudFront egress on a ~10 MB MP3 ≈
    $0.00085/download → **<$1/episode even at ~1,000 listens**; S3 storage is
    negligible. All-in **~$0.15–0.30/episode** at launch volume — i.e. a few
    dollars a month of AWS spend at any plausible cadence, covered by the
    deployment-wide CloudWatch billing alarm, **never** the per-agent token cap.

  So W-3 governs the $26 of salaries (+headroom); Polly/S3/CloudFront are cents
  per episode on a different budget line entirely.

## Related

- [governance.md](../governance.md) — R-N1 (execution surfaces; clause (c) cross-refs
  this ADR), §2 W-3 (cap raised to USD 250/mo), §5 action-authority matrix (new
  AWS service / cron enable / Spotify submission are B).
- [adr-0005](adr-0005-single-execution-model-ccr.md) — the single CCR execution
  model the `podcast-script` Cadence runs under.
- [adr-0007](adr-0007-agent-config-single-source.md) — the persona/binding write
  path the media-group registration and the paused podcast-script binding use.
- [epic-017](../epics/epic-017-podcast-spotify-distribution.md) — the user/business
  outcome this decision serves.
