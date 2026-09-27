// Gemini TTS engine for wf-podcast (ADR-0043 — Polly → Gemini 3.8 Flash TTS).
//
// Pure building blocks the handler composes into a *resumable, chunked*
// synthesis. Gemini has no Polly-style "async task that writes the MP3 to S3",
// and one request returns at most 16,384 audio tokens (25 tok/s ≈ 10.9 min), so
// an episode is:
//
//   script ─chunkScript→ N chunks ─(one Gemini call each)→ WAV/PCM
//          ─rate + hiss guards→ per-chunk WAV (S3 tmp)
//          ─normalizeChunks (tempo / brightness / loudness)→ join with 0.4 s
//          ─encodeMp3 once→ podcast/audio/{slug}.mp3
//
// Each chunk's WAV is persisted to S3 as soon as it exists, so progress
// survives across invocations: every invocation synthesises only the missing
// chunks. Script length therefore has no upper bound — a 30-min (or 2-hour)
// script just takes more waves (and, on the free tier's 10 requests/day, more
// days) — and a timeout or quota stop never loses finished chunks.
//
// PoC (2026-09-27, real podcastScript bodies, ADR-0043): one request costs a
// ~25–30 s fixed latency plus ~0.17× real time (404字 → 31 s, 1,772字 → 52 s,
// 3,582字 → 142 s, 5,572字 → 262 s), so NO request fits the API Gateway HTTP-API
// 30 s window — the Gemini path runs on direct Lambda invocation (≤15 min).
//
// Fail loud (C-4 / W-4): a non-200, a missing audio part, or a duration outside
// the expected band throws. An LLM-based TTS can skip, repeat, or truncate
// text; the band is the mechanical check Polly never needed.

import { createHash } from "node:crypto";
import { Mp3Encoder } from "@breezystack/lamejs";

export const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta";
export const DEFAULT_MODEL = "gemini-3.8-flash-tts";

/** Documented per-request output ceiling: 16,384 audio tokens at 25 tokens/s
 *  (≈655 s). NOT enforced in practice — the PoC got 904 s from one 5,572字
 *  request — so the chunk default stays under it for safety and the rate band
 *  (not this constant) is the truncation guard. */
export const MAX_AUDIO_SEC_PER_REQUEST = 16384 / 25;

/** Default delivery direction, sent as speech_metadata.style (never spoken).
 *  Kept SHORT on purpose: Google's guidance is to let the voice carry identity
 *  and keep per-request style minimal, and the ADR-0043 A/B on a 2-chunk
 *  episode measured the cross-chunk pitch gap at −10% with the former long
 *  persona prompt, −2.4% with none, −0.6% with this one. */
export const DEFAULT_STYLE = "落ち着いた一定のテンポで話すナレーター";

/**
 * Accepted speech rate, in 字/分. Measured on the live corpus: Polly median
 * ~350 (300–410, 12 episodes); Gemini 3.8 Flash TTS 273–379 (9 requests,
 * 404–5,572字). A chunk outside the band means the model dropped text (too
 * fast / too short — e.g. a 5,572字 request cut at the 655 s documented cap
 * would read as 510 字/分) or looped/inserted (too slow / too long). Either is
 * a C-1 defect, so it throws.
 */
export interface RateBand {
  minJiPerMin: number;
  maxJiPerMin: number;
}
export const DEFAULT_RATE_BAND: RateBand = { minJiPerMin: 220, maxJiPerMin: 480 };

// ── Script chunking ──────────────────────────────────────────────────────────

/**
 * Split a narration script into chunks of at most `maxChars`, breaking on
 * sentence ends (。！？) and preferring paragraph ends, with chunk sizes
 * balanced (no 9-字 tail chunk). A single sentence longer than `maxChars` is
 * hard-split — the script-writing skill never produces one in practice.
 */
export function chunkScript(text: string, maxChars: number): string[] {
  const clean = text.trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  const pieces: string[] = [];
  for (const para of clean.split(/\n{2,}/)) {
    const sentences = para.match(/[^。！？!?]+[。！？!?」』）)]*|[^。！？!?]+$/g) ?? [para];
    sentences.forEach((s, i) => {
      const t = s.trim();
      if (!t) return;
      const piece = i === sentences.length - 1 ? `${t}\n\n` : t;
      if (piece.length <= maxChars) pieces.push(piece);
      else for (let j = 0; j < piece.length; j += maxChars) pieces.push(piece.slice(j, j + maxChars));
    });
  }

  const target = Math.ceil(clean.length / Math.ceil(clean.length / maxChars));
  const chunks: string[] = [];
  let cur = "";
  for (const p of pieces) {
    if (cur && (cur.length + p.length > maxChars || cur.length >= target)) {
      chunks.push(cur.trim());
      cur = "";
    }
    cur += p;
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}

/**
 * Content hash of everything that changes the audio. A re-cast (new voice),
 * an edited script, or a model/style change produces a fresh tmp prefix, so a
 * stale chunk from an earlier attempt is never stitched into a new episode.
 */
export function synthesisKey(parts: { model: string; voice: string; style: string; text: string; maxChars: number }): string {
  return createHash("sha256")
    .update(JSON.stringify([parts.model, parts.voice, parts.style, parts.maxChars, parts.text]))
    .digest("hex")
    .slice(0, 16);
}

// ── WAV / PCM ────────────────────────────────────────────────────────────────

export interface Pcm {
  sampleRate: number;
  channels: number;
  bits: number;
  data: Buffer;
}

/** Parse a RIFF/WAVE buffer (Gemini's unary default); headerless bytes are
 *  treated as Gemini's documented raw L16 (24 kHz, mono, 16-bit LE). */
export function parseWav(buf: Buffer): Pcm {
  if (buf.length < 12 || buf.toString("latin1", 0, 4) !== "RIFF" || buf.toString("latin1", 8, 12) !== "WAVE") {
    return { sampleRate: 24000, channels: 1, bits: 16, data: buf };
  }
  let sampleRate = 0;
  let channels = 0;
  let bits = 0;
  let data: Buffer | undefined;
  let off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString("latin1", off, off + 4);
    let size = buf.readUInt32LE(off + 4);
    if (id === "fmt ") {
      channels = buf.readUInt16LE(off + 10);
      sampleRate = buf.readUInt32LE(off + 12);
      bits = buf.readUInt16LE(off + 22);
    } else if (id === "data") {
      // Streaming-style writers put 0 / 0xFFFFFFFF here; take the rest.
      if (size === 0 || size === 0xffffffff || off + 8 + size > buf.length) size = buf.length - off - 8;
      data = buf.subarray(off + 8, off + 8 + size);
    }
    off += 8 + size + (size & 1);
  }
  if (!data || !sampleRate) throw new Error("WAV has no fmt/data chunk");
  if (bits !== 16 || channels !== 1) throw new Error(`unsupported WAV ${channels}ch/${bits}bit (expected mono 16-bit)`);
  return { sampleRate, channels, bits, data };
}

export function pcmSeconds(p: Pcm): number {
  return p.data.length / (p.sampleRate * p.channels * (p.bits / 8));
}

/** Throws unless the chunk's speech rate sits inside the band (C-1 guard). */
export function assertDuration(chars: number, seconds: number, band: RateBand = DEFAULT_RATE_BAND): void {
  if (seconds <= 0) throw new Error(`Gemini returned empty audio for a ${chars}字 chunk`);
  const rate = (chars / seconds) * 60;
  if (rate > band.maxJiPerMin) {
    throw new Error(`chunk too short: ${chars}字 in ${seconds.toFixed(1)}s = ${rate.toFixed(0)}字/分 > ${band.maxJiPerMin} — text likely skipped/truncated`);
  }
  if (rate < band.minJiPerMin) {
    throw new Error(`chunk too long: ${chars}字 in ${seconds.toFixed(1)}s = ${rate.toFixed(0)}字/分 < ${band.minJiPerMin} — repetition/insertion likely`);
  }
}

// ── Hiss guard ───────────────────────────────────────────────────────────────
//
// The PoC's single 15-min request degraded progressively: from ~8 min on, a
// broadband hiss grew until it dominated (operator listening check,
// 2026-09-27). The cheap signature is the energy of the SECOND DIFFERENCE of
// the waveform (a strong high-pass) relative to the signal, over the louder
// half of 20 ms frames in each 30 s window:
//   clean outputs (87 s–10.7 min):  every window ≤ −2.2 dB
//   degraded 15-min output:         −8.7 dB at the start → +1.8 dB at 8.5 min → +9 dB
// A chunk fails if any window is above `maxDb`, or rises more than `maxRiseDb`
// above the chunk's own median window (voice-independent).

export interface HissLimits {
  maxDb: number;
  maxRiseDb: number;
}
export const DEFAULT_HISS_LIMITS: HissLimits = { maxDb: 0, maxRiseDb: 6 };

/** Per-30 s-window high-frequency ratio in dB (see above). */
export function hissProfile(p: Pcm, windowSec = 30): number[] {
  const n = p.data.length >> 1;
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = p.data.readInt16LE(i * 2);
  const fr = Math.round(p.sampleRate * 0.02);
  const win = Math.round(p.sampleRate * windowSec);
  const out: number[] = [];
  for (let w0 = 0; w0 + win / 2 <= n; w0 += win) {
    const w1 = Math.min(n, w0 + win);
    const frames: { e: number; d: number }[] = [];
    for (let f0 = Math.max(w0, 2); f0 + fr <= w1; f0 += fr) {
      let e = 0;
      let d = 0;
      for (let i = f0; i < f0 + fr; i++) {
        const v = x[i]!;
        const dd = v - 2 * x[i - 1]! + x[i - 2]!;
        e += v * v;
        d += dd * dd;
      }
      frames.push({ e, d });
    }
    if (frames.length === 0) continue;
    const median = [...frames.map((f) => f.e)].sort((a, b) => a - b)[frames.length >> 1]!;
    let e = 0;
    let d = 0;
    for (const f of frames) if (f.e > median) { e += f.e; d += f.d; }
    if (e > 0) out.push(10 * Math.log10(d / e));
  }
  return out;
}

/** Throws if the chunk shows the progressive-hiss signature (C-1 guard). */
export function assertNoHiss(p: Pcm, limits: HissLimits = DEFAULT_HISS_LIMITS): void {
  const prof = hissProfile(p);
  if (prof.length === 0) return;
  const max = Math.max(...prof);
  const median = [...prof].sort((a, b) => a - b)[prof.length >> 1]!;
  const at = prof.indexOf(max) * 30;
  if (max > limits.maxDb) {
    throw new Error(`hiss: high-frequency ratio ${max.toFixed(1)} dB at ~${at}s > ${limits.maxDb} dB — degraded audio`);
  }
  if (max - median > limits.maxRiseDb) {
    throw new Error(`hiss: high-frequency ratio rises ${(max - median).toFixed(1)} dB above the chunk median at ~${at}s — degrading audio`);
  }
}

/** Serialise mono 16-bit PCM as a RIFF/WAVE buffer (parseWav's inverse). */
export function wavFile(p: Pcm): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0, "latin1");
  h.writeUInt32LE(36 + p.data.length, 4);
  h.write("WAVE", 8, "latin1");
  h.write("fmt ", 12, "latin1");
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(p.sampleRate, 24);
  h.writeUInt32LE(p.sampleRate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36, "latin1");
  h.writeUInt32LE(p.data.length, 40);
  return Buffer.concat([h, p.data]);
}

// ── MP3 ──────────────────────────────────────────────────────────────────────

/**
 * Encode mono 16-bit PCM to CBR MP3 (pure JS — the Lambda has no ffmpeg).
 * `trailingSilenceSec` pads the chunk so byte-concatenated chunks get a
 * natural breath between them. Independently-encoded CBR MP3 streams with the
 * same rate/bitrate concatenate into a valid stream.
 */
export function encodeMp3(p: Pcm, kbps = 64, trailingSilenceSec = 0): Buffer {
  const pad = Buffer.alloc(Math.round(p.sampleRate * trailingSilenceSec) * 2);
  const src = pad.length ? Buffer.concat([p.data, pad]) : p.data;
  // Copy into an aligned Int16Array (a subarray of a pooled Buffer may be odd-offset).
  const samples = new Int16Array(src.length >> 1);
  for (let i = 0; i < samples.length; i++) samples[i] = src.readInt16LE(i * 2);
  const enc = new Mp3Encoder(1, p.sampleRate, kbps);
  const out: Buffer[] = [];
  const block = 1152 * 32;
  for (let i = 0; i < samples.length; i += block) {
    const b = enc.encodeBuffer(samples.subarray(i, i + block));
    if (b.length) out.push(Buffer.from(b.buffer, b.byteOffset, b.length));
  }
  const tail = enc.flush();
  if (tail.length) out.push(Buffer.from(tail.buffer, tail.byteOffset, tail.length));
  return Buffer.concat(out);
}

// ── Gemini call ──────────────────────────────────────────────────────────────

export interface GeminiTtsRequest {
  apiKey: string;
  text: string;
  voice: string;
  model?: string;
  style?: string;
  fetchImpl?: typeof fetch;
}

export class GeminiTtsError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfterSec?: number) {
    super(message);
  }
  /** Transient per-minute throttling / overload: back off and retry. */
  get retryable(): boolean {
    return (this.status === 429 && !this.dailyQuota) || this.status === 503;
  }
  /** The free tier's requests-per-day quota (10/day for gemini-3.8-flash-tts):
   *  retrying today only burns calls — stop and resume on the next run. Its
   *  retry-after header is misleading (seconds, not "tomorrow"). */
  get dailyQuota(): boolean {
    return this.status === 429 && /per day/i.test(this.message);
  }
}

/** One unary TTS interaction → PCM. Throws GeminiTtsError on any failure. */
export async function synthesizeChunk(req: GeminiTtsRequest): Promise<Pcm> {
  const f = req.fetchImpl ?? fetch;
  const body = {
    model: req.model ?? DEFAULT_MODEL,
    input: [
      {
        type: "user_input",
        content: [
          {
            type: "text",
            text: req.text,
            annotations: [{ type: "speech_metadata", style: req.style ?? DEFAULT_STYLE }],
          },
        ],
      },
    ],
    response_format: { type: "audio" },
    generation_config: { speech_config: [{ voice: req.voice }] },
    // Free tier keeps interactions 1 day; nothing downstream reads them back.
    store: false,
  };
  const res = await f(`${GEMINI_API}/interactions`, {
    method: "POST",
    headers: { "x-goog-api-key": req.apiKey, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    const ra = Number(res.headers.get("retry-after") ?? "");
    throw new GeminiTtsError(`gemini ${res.status}: ${text.slice(0, 400)}`, res.status, Number.isFinite(ra) && ra > 0 ? ra : undefined);
  }
  let json: { steps?: { type?: string; content?: { type?: string; data?: string }[] }[]; status?: string };
  try {
    json = JSON.parse(text);
  } catch {
    throw new GeminiTtsError(`gemini returned non-JSON: ${text.slice(0, 200)}`, 502);
  }
  if (json.status && json.status !== "completed") {
    throw new GeminiTtsError(`gemini interaction status ${json.status}`, 502);
  }
  const parts = (json.steps ?? [])
    .filter((s) => s.type === "model_output")
    .flatMap((s) => s.content ?? [])
    .filter((c) => c.type === "audio" && typeof c.data === "string" && c.data.length > 0);
  if (parts.length === 0) throw new GeminiTtsError("gemini response carried no audio part", 502);
  return parseWav(Buffer.concat(parts.map((p) => Buffer.from(p.data as string, "base64"))));
}
