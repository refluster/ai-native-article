import { describe, it, expect } from "vitest";
import type { Pcm } from "./gemini-tts.js";
import { analyzeChunk, normalizeChunks, tilt, timeStretch } from "./normalize.js";

const SR = 24000;

// Speech-like: a 150 Hz voice with harmonics, 4 Hz syllable envelope, and a
// 0.3 s pause every 2 s (so articulation ≠ overall rate).
function speech(seconds: number, opts: { gain?: number; bright?: number; speed?: number } = {}): Float32Array {
  const n = Math.round(seconds * SR);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const tp = t * (opts.speed ?? 1); // speaking tempo, not pitch
    const inPause = tp % 2 > 1.7;
    const env = inPause ? 0 : 0.5 + 0.5 * Math.sin(2 * Math.PI * 4 * tp);
    const v = Math.sin(2 * Math.PI * 150 * t) + 0.5 * Math.sin(2 * Math.PI * 300 * t) + 0.25 * Math.sin(2 * Math.PI * 1200 * t) + 0.08 * Math.sin(2 * Math.PI * 4500 * t);
    x[i] = env * v * 6000 * (opts.gain ?? 1);
  }
  return opts.bright ? tilt(x, opts.bright) : x;
}

function pcm(x: Float32Array): Pcm {
  const data = Buffer.alloc(x.length * 2);
  for (let i = 0; i < x.length; i++) data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i]!))), i * 2);
  return { sampleRate: SR, channels: 1, bits: 16, data };
}

/** Dominant period via zero crossings on voiced samples → Hz. */
function pitchHz(x: Float32Array): number {
  let crossings = 0;
  let voiced = 0;
  for (let i = 1; i < x.length; i++) {
    if (Math.abs(x[i]!) < 200 && Math.abs(x[i - 1]!) < 200) continue;
    voiced++;
    if ((x[i - 1]! < 0 && x[i]! >= 0)) crossings++;
  }
  return (crossings / voiced) * SR;
}

describe("timeStretch (WSOLA)", () => {
  it("scales duration and preserves pitch", () => {
    const x = speech(6);
    for (const r of [0.88, 1.12]) {
      const y = timeStretch(x, SR, r);
      expect(y.length).toBe(Math.round(x.length * r));
      expect(pitchHz(y)).toBeGreaterThan(pitchHz(x) * 0.97);
      expect(pitchHz(y)).toBeLessThan(pitchHz(x) * 1.03);
    }
  });
});

describe("normalizeChunks", () => {
  it("passes a single-chunk episode through untouched", () => {
    const a = pcm(speech(4));
    const { pcms, report } = normalizeChunks([a], [200]);
    expect(pcms[0]).toBe(a);
    expect(report.chunks[0]).toMatchObject({ gainDb: 0, tilt: 0, stretch: 1 });
  });

  it("pulls two drifting chunks together on tempo, brightness and loudness", () => {
    const base = speech(20);
    const a = pcm(base);
    // Chunk B: same text spoken 8% faster (same pitch), brighter, 3 dB louder.
    const b = pcm(tilt(speech(20 / 1.08, { gain: 1.41, speed: 1.08 }), 0.8));
    const chars = [200, 200];
    const before = [analyzeChunk(a, 200), analyzeChunk(b, 200)];
    expect(Math.abs(before[0]!.hfDb - before[1]!.hfDb)).toBeGreaterThan(3);
    expect(Math.abs(before[0]!.rmsDb - before[1]!.rmsDb)).toBeGreaterThan(2);
    expect(before[1]!.articJiPerMin / before[0]!.articJiPerMin).toBeGreaterThan(1.06);

    const { pcms } = normalizeChunks([a, b], chars);
    const after = pcms.map((p) => analyzeChunk(p, 200));
    expect(Math.abs(after[0]!.hfDb - after[1]!.hfDb)).toBeLessThan(0.8);
    expect(Math.abs(after[0]!.rmsDb - after[1]!.rmsDb)).toBeLessThan(0.8);
    expect(after[1]!.articJiPerMin / after[0]!.articJiPerMin).toBeLessThan(1.03);
  });

  it("bounds the correction for a pathological chunk", () => {
    const a = pcm(speech(10));
    const b = pcm(timeStretch(speech(10, { gain: 0.1 }), SR, 0.6)); // −20 dB, 40% faster
    const { report } = normalizeChunks([a, b], [100, 100]);
    for (const c of report.chunks) {
      expect(Math.abs(c.stretch - 1)).toBeLessThanOrEqual(0.12 + 1e-9);
      expect(Math.abs(c.gainDb)).toBeLessThanOrEqual(6 + 1e-9);
    }
  });

  it("never clips", () => {
    const a = pcm(speech(5, { gain: 5 })); // near full scale
    const b = pcm(speech(5, { gain: 0.5 }));
    const { pcms } = normalizeChunks([a, b], [50, 50]);
    for (const p of pcms) {
      let peak = 0;
      for (let i = 0; i < p.data.length; i += 2) peak = Math.max(peak, Math.abs(p.data.readInt16LE(i)));
      expect(peak).toBeLessThan(32767);
    }
  });

  it("tolerates silent chunks without NaN", () => {
    const s: Pcm = { sampleRate: SR, channels: 1, bits: 16, data: Buffer.alloc(SR * 2 * 3) };
    const { pcms, report } = normalizeChunks([s, pcm(speech(3))], [30, 30]);
    expect(pcms).toHaveLength(2);
    for (const c of report.chunks) {
      expect(Number.isFinite(c.gainDb)).toBe(true);
      expect(Number.isFinite(c.stretch)).toBe(true);
    }
  });
});
