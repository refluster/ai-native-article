# ADR-0043 — Podcast TTS moves from Amazon Polly to Gemini 3.8 Flash TTS: chunked, resumable, directly invoked

- **Status**: Proposed
- **Date**: 2026-09-27
- **Deciders**: operator (refluster)
- **Supersedes (in part)**: [ADR-0016](adr-0016-podcast-production-surface.md) — only the *synthesis engine* (Decision 2's "Amazon Polly Neural JA … `StartSpeechSynthesisTask` → MP3 to S3") and the §"Synthesize: kickoff + finalize poll" mechanics for the new engine. Everything else in ADR-0016 stands: the surfaces, the podcastStatus machine, the citation guard, public CloudFront/OAC egress, and authority placement.
- **Related**: [governance.md](../governance.md) R-N1(c) (amended by this PR), R-N2, R-N3, W-3, W-4; [ai-disclosure-v1](../design/ai-disclosure-v1.md) §2 (watermark requirement); [epic-017](../epics/epic-017-podcast-spotify-distribution.md) Phase 2 (multi-host)
- **Epics**: [017](../epics/epic-017-podcast-spotify-distribution.md)

## Context

The operator asked to synthesise podcast audio with **Google Gemini 3.8 Flash TTS**
(GA 2026-09-23) instead of Amazon Polly. Gemini's appeal:

- LLM-grade Japanese prosody and context-aware readings.
- Style direction that is separate from the transcript.
- Up to two speakers per request (the Epic-017 Phase-2 multi-host format).
- A **SynthID watermark + C2PA manifest on every output**. Polly's stock voices
  get neither, which is the gap ai-disclosure-v1 §2 records.

Gemini does not map onto the ADR-0016 shape one-to-one:

- It has no "async task that writes the MP3 to S3".
- It returns WAV/PCM, not MP3.
- An LLM-based TTS can skip, repeat or truncate text, which Polly never does.

A PoC on **real `podcastScript` bodies from Notion** measured each of these before
anything was decided. The operator chose the **free tier** and accepts that its
content is used to improve Google's products (2026-09-27).

## PoC evidence (2026-09-27)

Corpus: 167 existing scripts, 2,056–5,572字 (median 3,420). Polly's speech rate
on 12 live episodes: median **~350字/分** (range 300–410).

| Request | 字 | Audio | Latency | 字/分 |
|---|---|---|---|---|
| sync, 1 chunk | 404 | 87.0 s | **30.9 s** | 279 |
| sync, 1 chunk | 883 | 148.2 s | 33.3 s | 357 |
| sync, 1 chunk | 1,772 | 297.5 s | 52.1 s | 357 |
| sync, 1 chunk | 3,582 | 643.1 s | 141.9 s | 334 |
| sync, **whole script** | 5,572 | **904.3 s (15 min)** | 261.6 s | 370 |
| sync, 30-min test (11,342字 → 7×≤1,800, 3 in parallel) | 1,669–1,799 | 278–367 s each | 48–100 s | 273–379 |

Findings:

1. **Every request exceeds the HTTP API's 30 s window.** A request pays a
   ~25–30 s fixed cost plus ~0.17× real time, and even the smallest chunk took
   30.9 s. Latency roughly doubles under parallel load. The ADR-0016 "each poll
   is fast" pattern cannot carry Gemini.
2. **The documented per-request cap (16,384 audio tokens ≈ 655 s) was not
   enforced.** A 5,572字 script returned 15 min of audio in one request. We do
   not rely on this; see the chunk-size decision.
3. **`background: true` completes but is unusable for TTS.** The interaction
   reaches `completed` and is billed (2,768 / 35,850 output tokens). But the
   stored interaction, by plain GET and by stream replay, holds only the last
   **1,920 bytes (40 ms) of L16**. Gemini-side async execution (option a) is out.
4. **Free tier: 10 requests/day** for `gemini-3.8-flash-tts`. The 429 message
   says "10 requests per day on Free Tier" while its `retry-after` header gives
   seconds, which is misleading. A key from a *prepaid* project with depleted
   credits returns **402**.
5. **WAV carries a `C2PA` RIFF chunk.** Re-encoding to MP3 drops it. SynthID is
   in the waveform and Google states it is robust to compression, but we have
   not verified that independently.
6. **Voices**: `GET /v1beta/voices` lists 1,000 prebuilt voices, none tagged
   `ja`. The prebuilt voices are multilingual (`Kore` read Japanese fluently).
7. **MP3 encode in pure JS** (the Lambda has no ffmpeg): about 6 s per 5 min of
   audio at 64 kbps.

## Options considered

| | Where the long wait lives | Verdict |
|---|---|---|
| **(a)** Gemini async (Batch API / `background: true`) behind the existing kickoff/finalize | inside Gemini | **Rejected — not viable today.** Batch is documented for `generateContent` only (TTS 3.8 is Interactions-only) and is paid-tier. `background` loses the audio (finding 3). Revisit if Google fixes it: the resumable design below slots it in unchanged. |
| **(b-http)** Lambda behind the HTTP API, one chunk per poll | Lambda, within 30 s | **Rejected.** No chunk fits 30 s (finding 1). Every poll would 503 while the Lambda kept running, and overlapping polls would synthesise the same chunk twice, burning the 10/day quota. |
| **(b) chosen** Lambda, **direct `lambda:InvokeFunction`** from the CI caller, resumable chunks in S3 | Lambda (≤15 min per invocation) | **Chosen.** Keeps ADR-0016's shape: the logic stays in `wf-podcast`, Notion stays in the Lambda, and no Notion/Gemini credential moves into CI. It adds one IAM grant to the CI role. Script length is unbounded because progress persists per chunk. |
| **(c)** Synthesise inside the GitHub Actions job | CI runner (≤6 h) | **Rejected for now.** Technically the most elastic (ffmpeg on the runner, hours of wall time). But it moves the Notion token and the Gemini key into CI and duplicates the Lambda's Notion logic, which is the shape ADR-0016 already rejected. It is the fallback if a single episode ever needs more than about 15 min of *wall time per resumable step*, which (b) does not. |

## Decision

1. **Engine.** `wf-podcast` gains a Gemini 3.8 Flash TTS engine, selected by
   `PODCAST_TTS_ENGINE=gemini`. The Polly path stays intact; `polly` is the
   one-env-var rollback.

2. **Chunked, resumable synthesis.**
   - The script is split on sentence and paragraph ends into balanced chunks of
     at most `GEMINI_CHUNK_CHARS` (default **3,000字** ≈ 8.5 min, inside the
     documented cap).
   - Each chunk's MP3 is written to `podcast/audio/tmp/{slug}-{hash}/{i}.mp3`.
     The hash covers model + voice + style + chunk size + script text, so a
     re-cast or an edited script never reuses stale chunks.
   - When every chunk exists, the chunks are byte-concatenated (independently
     encoded CBR MP3s concatenate into a valid stream) to
     `podcast/audio/{slug}.mp3`, and the episode flips to `audio-ready`.
   - S3 is the only progress state (R-N2).

3. **Invocation.**
   - The kickoff stays on the HTTP API. It starts nothing and returns
     `invoke.functionName`.
   - `synthesize.mjs` then calls **`aws lambda invoke`** directly with the
     handles. Each invocation runs waves of ≤`GEMINI_CONCURRENCY` (default 2)
     chunks while more than `GEMINI_WAVE_RESERVE_MS` (5 min) of its 15-min
     budget remains.
   - The caller re-invokes until done. The Lambda never invokes itself
     (R-N1 "no per-Lambda nested invocation" holds).
   - The HTTP-API finalize **refuses** Gemini handles (400).

4. **Fail loud, but not on quota (C-1 / C-4 / W-4).**
   - A chunk whose speech rate falls outside **220–480字/分** throws. That
     covers skipped or truncated text; for example, a 5,572字 request cut at
     655 s would read as 510字/分. It also covers looped or inserted text.
   - A non-200, a response without audio, or a 402 also throws → 500 → the
     alarm fires.
   - A per-minute 429 or a 503 backs off.
   - The **daily-quota 429** stops the run with `quotaExhausted`, and
     `synthesize.mjs` exits 3 naming the episodes. Finished chunks are kept,
     and the next run resumes where this one stopped.

5. **Voices.** `podcastVoice` keeps its casting names. Odette's pool, the
   `podcast-publish` skill, `set-params.mjs` and existing Notion values are
   unchanged. The Lambda maps them through `GEMINI_VOICE_MAP`, default
   `Takumi→Charon` (male, low, "informative and steady"), `Kazuha→Kore`,
   `Tomoko→Aoede` (female, "breezy, light"). Re-mapping is config, not code.

6. **Credential.** A Gemini API key `{apiKey}` lives in Secrets Manager at
   `wf/projects/agent-workforce/gemini.api_key` (R-N3). Only `wf-podcast` reads
   it; no Cadence `requires` it, so it is not added to the injector registry.

## Scaling — does a 30-minute (or longer) script hold?

Chunk 3,000字, speech ≈350字/分, free tier 10 requests/day:

| Script | 字 | Requests | Wall time (2 in parallel, ~140–260 s each) | Free-tier days |
|---|---|---|---|---|
| median episode | 3,420 | 2 | ~2–4 min, 1 invocation | 1 |
| longest today | 5,572 | 2 | ~3–5 min, 1 invocation | 1 |
| **30 min** | ~10,500 | 4 | ~5–9 min, 1 invocation | 1 |
| 60 min | ~21,000 | 7 | ~12–16 min, 2 invocations | 1 |
| 2 hours | ~42,000 | 14 | 3–4 invocations | **2** (resumes next day) or paid tier |

- **Nothing caps script length.** A longer script only means more waves, and on
  the free tier, more days.
- **Daily volume.** Current volume is about 1.8 episodes/day ≈ 4 requests/day,
  inside 10/day.
- **Paid tier.** Moving to a paid tier needs a new key only (no code change).
  The paid tier also allows `GEMINI_CHUNK_CHARS` up to ~5,600 (finding 2:
  1 request per ≤15-min episode) and higher concurrency.
- **Paid-tier cost for reference.** $9 per 1M audio tokens at 25 tok/s ≈
  **$0.0135/min**: a 10-min episode ≈ $0.14, a 30-min ≈ $0.41 (doubling from
  2027-01-01). That is a few dollars a month at current volume, outside the W-3
  salary line exactly as ADR-0016 treated Polly.

## Consequences

- **Quality and provenance.** Audio carries SynthID. The WAV's C2PA manifest
  does **not** survive the MP3 re-encode. Carrying it (an ID3 `GEOB` frame, or an
  M4A enclosure) is a follow-up under ai-disclosure-v1 §2, as is the RSS
  provenance field.
- **Free tier trade-offs, accepted by the operator.** Scripts, which are public
  derivative commentary, are used to improve Google's products. The 10/day cap
  bounds the backlog drain rate.
- **New operator steps (B-authority).** Listed in the runbook:
  - Register the secret (done 2026-09-27).
  - Grant the CI OIDC role `lambda:InvokeFunction` on `wf-podcast-prod` (the
    role's policies live outside SAM).
  - `sam deploy`. It sets `PODCAST_TTS_ENGINE=gemini`, 1769 MB, a 900 s
    timeout, prefix-scoped `s3:ListBucket`, and read access to the Gemini
    secret.
  - Listen to the first episode.
- **CI budget.** `synthesize.mjs` keeps its 14-min budget inside the 20-min
  job. A day's full quota (10 requests) in waves of 2 fits, but it is tight
  under parallel-load latency. An overrun exits 3 and resumes on the next run.
  Raising the workflow timeout is a separate Zone A change if it ever fires.
- **Dependencies.** `@breezystack/lamejs` (LGPL-3.0) is bundled into an
  internal Lambda that is not distributed, so no LGPL distribution obligation
  applies. The Gemini TTS surface is `v1beta` (Interactions API); expect churn.
- **R-N1(c) is amended** to declare the Gemini egress and the direct-invoke
  caller path. It adds no new reasoning surface.

## Future extensions this shape already admits

- **Two-host episodes (Epic-017 Phase 2).** Gemini supports two prebuilt
  speakers per request. A chunk becomes a dialogue turn-group; the same
  resumable store holds.
- **Gemini async.** If `background` starts returning full audio, or Batch opens
  to TTS, the kickoff can create one interaction per chunk and the finalize can
  collect them. The S3 chunk store and the stitch step stay as they are.
- **Paid tier.** Swap the key, then raise `GEMINI_CHUNK_CHARS` /
  `GEMINI_CONCURRENCY` via env.
