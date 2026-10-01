// Cross-chunk normalisation for Gemini TTS episodes (ADR-0043 finding 9).
//
// Each chunk is an independent Gemini request, and independent requests drift:
// on the first production episode (2 chunks, same voice + style) the second
// chunk came out ~7% slower in articulation and 7.4 dB duller in the high band
// (plus ~10% lower in pitch, which the short style prompt largely removed —
// see ADR-0043). The operator heard the join as "the voice and the speed
// change". So before the single MP3 encode, every chunk is pulled toward the
// episode's median on three axes:
//
//   loudness    — gain to the median voiced RMS (peak-limited, never clips)
//   brightness  — a first-order tilt y = x + g·(x[n] − x[n−1]), g bisected so
//                 the chunk's high-band ratio hits the median (bounded)
//   tempo       — WSOLA time-stretch (pitch-preserving) so the chunk's
//                 articulation rate (字 per second of speech, pauses excluded)
//                 hits the median (bounded)
//
// Everything is deterministic, pure TS, and bounded so a pathological chunk
// is only nudged, never mangled. Small deviations are left untouched.

import type { Pcm } from "./gemini-tts.js";

export interface ChunkStats {
  /** Mean power of the louder half of 20 ms frames, dB re 1 LSB². */
  rmsDb: number;
  /** Second-difference / signal energy over the louder half of frames, dB. */
  hfDb: number;
  /** 字 per minute of *speech* (frames within 35 dB of the loud floor). */
  articJiPerMin: number;
}

export interface NormalizeLimits {
  maxGainDb: number;
  maxTiltDb: number;
  maxStretch: number; // fractional, e.g. 0.12 = ±12 %
  /** Deviations below these are left alone. */
  minGainDb: number;
  minTiltDb: number;
  minStretch: number;
}

export const DEFAULT_NORMALIZE_LIMITS: NormalizeLimits = {
  maxGainDb: 6,
  maxTiltDb: 6,
  maxStretch: 0.12,
  minGainDb: 0.5,
  minTiltDb: 1,
  minStretch: 0.02,
};

const FRAME_SEC = 0.02;

function toFloat(p: Pcm): Float32Array {
  const n = p.data.length >> 1;
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = p.data.readInt16LE(i * 2);
  return x;
}

function toPcm(x: Float32Array, sampleRate: number): Pcm {
  const data = Buffer.alloc(x.length * 2);
  for (let i = 0; i < x.length; i++) data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i]!))), i * 2);
  return { sampleRate, channels: 1, bits: 16, data };
}

function frameEnergies(x: Float32Array, fr: number): Float64Array {
  const n = Math.floor(x.length / fr);
  const e = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let s = 0;
    for (let i = k * fr; i < (k + 1) * fr; i++) s += x[i]! * x[i]!;
    e[k] = s / fr;
  }
  return e;
}

function quantile(a: ArrayLike<number>, q: number): number {
  const s = Array.from(a).sort((p, r) => p - r);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))]! : 0;
}

function hfRatioDb(x: Float32Array, fr: number, loud: Uint8Array): number {
  let e = 0;
  let d = 0;
  for (let k = 0; k < loud.length; k++) {
    if (!loud[k]) continue;
    for (let i = Math.max(2, k * fr); i < (k + 1) * fr; i++) {
      const v = x[i]!;
      const dd = v - 2 * x[i - 1]! + x[i - 2]!;
      e += v * v;
      d += dd * dd;
    }
  }
  return e > 0 ? 10 * Math.log10(d / e) : 0;
}

function loudMask(e: Float64Array): Uint8Array {
  const med = quantile(e, 0.5);
  return Uint8Array.from(e, (v) => (v > med ? 1 : 0));
}

export function analyzeChunk(p: Pcm, chars: number): ChunkStats {
  const x = toFloat(p);
  const fr = Math.round(p.sampleRate * FRAME_SEC);
  const e = frameEnergies(x, fr);
  const loud = loudMask(e);
  let pow = 0;
  let nLoud = 0;
  for (let k = 0; k < e.length; k++) if (loud[k]) { pow += e[k]!; nLoud++; }
  const db = Array.from(e, (v) => 10 * Math.log10(v + 1e-9));
  const floor = quantile(db, 0.9) - 35;
  const speechSec = db.filter((v) => v > floor).length * FRAME_SEC;
  return {
    rmsDb: 10 * Math.log10(pow / Math.max(1, nLoud) + 1e-9),
    hfDb: hfRatioDb(x, fr, loud),
    articJiPerMin: speechSec > 0 ? (chars / speechSec) * 60 : 0,
  };
}

// ── Tilt EQ ──────────────────────────────────────────────────────────────────

/** y[n] = x[n] + g·(x[n] − x[n−1]); g > 0 brightens, −0.45 < g < 0 dulls. */
export function tilt(x: Float32Array, g: number): Float32Array {
  const y = new Float32Array(x.length);
  let prev = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i]!;
    y[i] = v + g * (v - prev);
    prev = v;
  }
  return y;
}

/** hfDb of a signal, measured exactly as analyzeChunk does. */
function hfOf(x: Float32Array, fr: number): number {
  return hfRatioDb(x, fr, loudMask(frameEnergies(x, fr)));
}

/** Bisect g so the tilted signal's hfDb hits `target` (monotone in g). */
export function solveTilt(x: Float32Array, fr: number, target: number): number {
  let lo = -0.45;
  let hi = 2.0;
  for (let it = 0; it < 20; it++) {
    const mid = (lo + hi) / 2;
    if (hfOf(tilt(x, mid), fr) < target) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// ── WSOLA time-stretch (pitch-preserving) ────────────────────────────────────

/**
 * Stretch `x` to `ratio`× its length (ratio > 1 = slower/longer) with WSOLA:
 * 40 ms Hann frames at a 20 ms synthesis hop; each frame's input position is
 * nudged within ±10 ms to maximise waveform similarity with the natural
 * continuation of the previous frame (coarse search on every 4th sample,
 * then refined), so periodicity — and therefore pitch — is preserved.
 */
export function timeStretch(x: Float32Array, sampleRate: number, ratio: number): Float32Array {
  if (Math.abs(ratio - 1) < 1e-3) return x;
  const N = Math.round(sampleRate * 0.04);
  const Hs = N >> 1;
  const Ha = Hs / ratio;
  const tol = Math.round(sampleRate * 0.01);
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const outLen = Math.round(x.length * ratio);
  const y = new Float32Array(outLen + N);
  const norm = new Float32Array(outLen + N);
  const at = (i: number) => (i >= 0 && i < x.length ? x[i]! : 0);

  let prevIn = 0; // input start of the previously copied frame
  for (let k = 0; ; k++) {
    const outPos = k * Hs;
    if (outPos >= outLen) break;
    const ideal = Math.round(k * Ha);
    let best = ideal;
    if (k > 0) {
      const nat = prevIn + Hs; // natural continuation of the last frame
      let bestScore = -Infinity;
      for (let d = -tol; d <= tol; d += 2) {
        const s0 = ideal + d;
        let sc = 0;
        for (let i = 0; i < N; i += 4) sc += at(s0 + i) * at(nat + i);
        if (sc > bestScore) { bestScore = sc; best = s0; }
      }
      const c = best;
      for (let d = -1; d <= 1; d++) {
        const s0 = c + d;
        let sc = 0;
        for (let i = 0; i < N; i++) sc += at(s0 + i) * at(nat + i);
        if (sc > bestScore) { bestScore = sc; best = s0; }
      }
    }
    for (let i = 0; i < N; i++) {
      y[outPos + i]! += at(best + i) * win[i]!;
      norm[outPos + i]! += win[i]!;
    }
    prevIn = best;
  }
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) out[i] = norm[i]! > 1e-3 ? y[i]! / norm[i]! : 0;
  return out;
}

// ── Episode-level normalisation ──────────────────────────────────────────────

export interface NormalizeReport {
  target: ChunkStats;
  chunks: { before: ChunkStats; gainDb: number; tilt: number; stretch: number }[];
}

const clamp = (v: number, m: number) => Math.max(-m, Math.min(m, v));
const median = (a: number[]) => {
  const s = [...a].sort((p, r) => p - r);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/**
 * Pull every chunk toward the episode median. `chars[i]` is chunk i's script
 * length (for the articulation rate). Single-chunk episodes pass through.
 */
export function normalizeChunks(
  pcms: Pcm[],
  chars: number[],
  limits: NormalizeLimits = DEFAULT_NORMALIZE_LIMITS,
): { pcms: Pcm[]; report: NormalizeReport } {
  const stats = pcms.map((p, i) => analyzeChunk(p, chars[i]!));
  const target: ChunkStats = {
    rmsDb: median(stats.map((s) => s.rmsDb)),
    hfDb: median(stats.map((s) => s.hfDb)),
    articJiPerMin: median(stats.map((s) => s.articJiPerMin)),
  };
  const report: NormalizeReport = { target, chunks: [] };
  if (pcms.length < 2) {
    report.chunks = stats.map((before) => ({ before, gainDb: 0, tilt: 0, stretch: 1 }));
    return { pcms, report };
  }

  const sr = pcms[0]!.sampleRate;
  const fr = Math.round(sr * FRAME_SEC);

  // Pass 1 — tempo: faster-than-median speech is stretched longer (ratio > 1).
  const stretched = pcms.map((p, i) => {
    const s = stats[i]!;
    let stretch = s.articJiPerMin > 0 ? s.articJiPerMin / target.articJiPerMin : 1;
    stretch = 1 + clamp(stretch - 1, limits.maxStretch);
    if (Math.abs(stretch - 1) < limits.minStretch) stretch = 1;
    const x = toFloat(p);
    if (stretch === 1) return { x, stretch };
    // One secant refinement: the articulation measure does not move exactly
    // 1:1 with the stretch ratio (pause/onset frames), so re-measure and
    // correct once, still inside the bound.
    let y = timeStretch(x, sr, stretch);
    const got = analyzeChunk(toPcm(y, sr), chars[i]!).articJiPerMin;
    if (got > 0 && Math.abs(got / target.articJiPerMin - 1) >= limits.minStretch / 2) {
      const refined = 1 + clamp(stretch * (got / target.articJiPerMin) - 1, limits.maxStretch);
      if (Math.abs(refined - stretch) > 1e-3) { stretch = refined; y = timeStretch(x, sr, stretch); }
    }
    return { x: y, stretch };
  });

  // Pass 2 — brightness, measured AFTER the stretch (WSOLA's overlap-add
  // shifts the high band slightly), toward the median of the stretched set.
  const hf = stretched.map((c) => hfOf(c.x, fr));
  const hfTarget = median(hf);
  target.hfDb = hfTarget;
  const tilted = stretched.map((c, i) => {
    let g = 0;
    let x = c.x;
    if (Math.abs(hf[i]! - hfTarget) >= limits.minTiltDb) {
      g = solveTilt(x, fr, hf[i]! + clamp(hfTarget - hf[i]!, limits.maxTiltDb));
      x = tilt(x, g);
    }
    return { ...c, x, g };
  });

  // Pass 3 — loudness toward the median (after EQ), peak-limited.
  const rms = tilted.map((c, i) => analyzeChunk(toPcm(c.x, sr), chars[i]!).rmsDb);
  const rmsTarget = median(rms);
  target.rmsDb = rmsTarget;
  const out = tilted.map((c, i) => {
    const x = c.x;
    let gainDb = clamp(rmsTarget - rms[i]!, limits.maxGainDb);
    if (Math.abs(gainDb) < limits.minGainDb) gainDb = 0;
    let peak = 0;
    for (let k = 0; k < x.length; k++) peak = Math.max(peak, Math.abs(x[k]!));
    const lin = Math.min(10 ** (gainDb / 20), peak > 0 ? 32000 / peak : 1);
    if (lin !== 1) for (let k = 0; k < x.length; k++) x[k]! *= lin;
    report.chunks.push({ before: stats[i]!, gainDb: 20 * Math.log10(lin), tilt: c.g, stretch: c.stretch });
    return toPcm(x, sr);
  });
  return { pcms: out, report };
}
