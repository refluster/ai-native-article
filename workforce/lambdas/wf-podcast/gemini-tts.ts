// Gemini TTS engine for wf-podcast (ADR-0043 — Polly → Gemini 3.8 Flash TTS).
//
// Pure building blocks the handler composes into a *resumable, chunked*
// synthesis. Gemini has no Polly-style "async task that writes the MP3 to S3",
// and one request returns at most 16,384 audio tokens (25 tok/s ≈ 10.9 min), so
// an episode is:
//
//   script ─chunkScript→ N chunks ─(one Gemini call each)→ WAV/PCM
//          ─durationGuard→ + inter-chunk silence ─encodeMp3→ per-chunk MP3 (S3 tmp)
//          ─byte-concat→ podcast/audio/{slug}.mp3
//
// Each chunk's MP3 is persisted to S3 as soon as it exists, so progress
// survives across finalize polls: every poll synthesises only the missing
// chunks within its time budget. Script length therefore has no upper bound —
// a 30-min (or 2-hour) script just takes more polls — and no call approaches
// the API Gateway HTTP-API 30s integration timeout.
//
// Fail loud (C-4 / W-4): a non-200, a missing audio part, or a duration outside
// the expected band throws. An LLM-based TTS can skip, repeat, or truncate
// text; the band is the mechanical check Polly never needed.

import { createHash } from "node:crypto";
import { Mp3Encoder } from "@breezystack/lamejs";

export const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta";
export const DEFAULT_MODEL = "gemini-3.8-flash-tts";

/** Per-request output ceiling: 16,384 audio tokens at 25 tokens/s. */
export const MAX_AUDIO_SEC_PER_REQUEST = 16384 / 25;

/** Default delivery direction, sent as speech_metadata.style (never spoken). */
export const DEFAULT_STYLE =
  "落ち着いた、知識のある友人が語りかけるような自然な日本語のナレーション。ニュース原稿の棒読みにしない。";

/**
 * Accepted speech rate, in 字/分. Polly's measured median on the live corpus
 * is ~350 字/分 (range 300–410, 12 episodes). A chunk far outside the band
 * means the model dropped text (too fast / too short) or looped/inserted
 * (too slow / too long) — either is a C-1 defect, so it throws.
 */
export interface RateBand {
  minJiPerMin: number;
  maxJiPerMin: number;
}
export const DEFAULT_RATE_BAND: RateBand = { minJiPerMin: 200, maxJiPerMin: 600 };

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
  if (seconds >= MAX_AUDIO_SEC_PER_REQUEST - 1) {
    throw new Error(`chunk audio hit the per-request output cap (${seconds.toFixed(0)}s) — truncated; lower GEMINI_CHUNK_CHARS`);
  }
  const rate = (chars / seconds) * 60;
  if (rate > band.maxJiPerMin) {
    throw new Error(`chunk too short: ${chars}字 in ${seconds.toFixed(1)}s = ${rate.toFixed(0)}字/分 > ${band.maxJiPerMin} — text likely skipped/truncated`);
  }
  if (rate < band.minJiPerMin) {
    throw new Error(`chunk too long: ${chars}字 in ${seconds.toFixed(1)}s = ${rate.toFixed(0)}字/分 < ${band.minJiPerMin} — repetition/insertion likely`);
  }
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
