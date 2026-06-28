# ADR-0016 — Podcast production & distribution execution surface

- **Status**: Proposed
- **Date**: 2026-06-28
- **Deciders**: operator (refluster), maya, celeste
- **Epics**: [017](../epics/epic-017-podcast-spotify-distribution.md)

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
- **Cost.** The W-3 raise to USD 250/mo (Epic-017 Story 2) funds the four
  salaries; Polly/S3/CloudFront are cents per episode (~$0.08 TTS, ~$0.15–0.30
  all-in) **outside** the token budget.

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
