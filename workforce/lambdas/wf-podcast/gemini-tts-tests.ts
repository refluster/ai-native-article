import { describe, it, expect } from "vitest";
import {
  assertDuration,
  chunkScript,
  encodeMp3,
  GeminiTtsError,
  parseWav,
  pcmSeconds,
  synthesisKey,
  synthesizeChunk,
  type Pcm,
} from "./gemini-tts.js";

const squash = (s: string) => s.replace(/\s+/g, "");

function wav(seconds: number, sampleRate = 24000): Buffer {
  const data = Buffer.alloc(Math.round(seconds * sampleRate) * 2);
  for (let i = 0; i < data.length / 2; i++) data.writeInt16LE(Math.round(4000 * Math.sin(i / 10)), i * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

describe("chunkScript", () => {
  const para = (n: number) => Array.from({ length: n }, (_, i) => `これは${i}番目の文で、内容を説明しています。`).join("");
  const script = [para(30), para(25), para(40), para(10)].join("\n\n");

  it("returns the whole script as one chunk when it fits", () => {
    expect(chunkScript("短い台本です。", 1800)).toEqual(["短い台本です。"]);
    expect(chunkScript("   ", 1800)).toEqual([]);
  });

  it("never loses or reorders text", () => {
    expect(squash(chunkScript(script, 500).join(""))).toBe(squash(script));
  });

  it("respects maxChars and breaks only at sentence ends", () => {
    const chunks = chunkScript(script, 500);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(500);
      expect(c.endsWith("。")).toBe(true);
    }
  });

  it("balances chunk sizes (no tiny tail chunk)", () => {
    const text = "これはテストの文です。".repeat(360); // 3,960字
    const chunks = chunkScript(text, 1800);
    expect(chunks).toHaveLength(3);
    const lens = chunks.map((c) => c.length);
    expect(Math.min(...lens)).toBeGreaterThan(1000);
  });

  it("scales to a 30-minute script (~10,500字)", () => {
    const text = Array.from({ length: 60 }, () => para(8)).join("\n\n");
    expect(text.length).toBeGreaterThan(10000);
    const chunks = chunkScript(text, 1800);
    expect(chunks.length).toBe(Math.ceil(text.length / 1800));
    expect(squash(chunks.join(""))).toBe(squash(text));
  });

  it("hard-splits a single sentence longer than maxChars", () => {
    const run = "あ".repeat(1200) + "。";
    const chunks = chunkScript(run, 500);
    expect(chunks.every((c) => c.length <= 500)).toBe(true);
    expect(chunks.join("")).toBe(run);
  });
});

describe("synthesisKey", () => {
  const base = { model: "m", voice: "Kore", style: "s", text: "台本", maxChars: 1800 };
  it("is stable and changes with any audio-affecting input", () => {
    expect(synthesisKey(base)).toBe(synthesisKey({ ...base }));
    expect(synthesisKey(base)).not.toBe(synthesisKey({ ...base, voice: "Puck" }));
    expect(synthesisKey(base)).not.toBe(synthesisKey({ ...base, text: "台本2" }));
    expect(synthesisKey(base)).not.toBe(synthesisKey({ ...base, maxChars: 900 }));
  });
});

describe("parseWav", () => {
  it("reads fmt + data from a RIFF buffer", () => {
    const p = parseWav(wav(2));
    expect(p.sampleRate).toBe(24000);
    expect(pcmSeconds(p)).toBeCloseTo(2, 3);
  });

  it("treats headerless bytes as 24 kHz mono L16", () => {
    const p = parseWav(Buffer.alloc(48000));
    expect(pcmSeconds(p)).toBeCloseTo(1, 3);
  });

  it("tolerates a streaming-style 0xFFFFFFFF data size", () => {
    const b = wav(1);
    b.writeUInt32LE(0xffffffff, 40);
    expect(pcmSeconds(parseWav(b))).toBeCloseTo(1, 3);
  });
});

describe("assertDuration (C-1 guard)", () => {
  it("accepts a normal Japanese narration rate", () => {
    expect(() => assertDuration(1750, 300)).not.toThrow(); // 350字/分
  });
  it("rejects audio too short for its text (skipped/truncated)", () => {
    expect(() => assertDuration(1800, 60)).toThrow(/too short/);
  });
  it("rejects audio too long for its text (repetition)", () => {
    expect(() => assertDuration(300, 300)).toThrow(/too long/);
  });
  it("accepts the rates the PoC measured (273–379字/分)", () => {
    expect(() => assertDuration(1669, 366.6)).not.toThrow(); // 273
    expect(() => assertDuration(5572, 904.3)).not.toThrow(); // 370, one 15-min request
  });
  it("catches a long request cut at the documented 655 s cap", () => {
    expect(() => assertDuration(5572, 16384 / 25)).toThrow(/too short/);
  });
  it("rejects empty audio", () => {
    expect(() => assertDuration(100, 0)).toThrow(/empty/);
  });
});

describe("encodeMp3", () => {
  it("produces MPEG audio frames whose duration matches the input + padding", () => {
    const p: Pcm = parseWav(wav(3));
    const mp3 = encodeMp3(p, 64, 0.5);
    expect(mp3[0]).toBe(0xff);
    expect((mp3[1]! & 0xe0) === 0xe0).toBe(true); // frame sync
    // 64 kbps CBR → 8,000 bytes/s; 3.5 s ≈ 28 KB (± one frame of padding).
    expect(mp3.length).toBeGreaterThan(8000 * 3.3);
    expect(mp3.length).toBeLessThan(8000 * 3.8);
  });
});

describe("synthesizeChunk", () => {
  const ok = (audio: Buffer) =>
    new Response(JSON.stringify({ status: "completed", steps: [{ type: "model_output", content: [{ type: "audio", data: audio.toString("base64") }] }] }), {
      status: 200,
    });

  it("returns PCM from the model_output audio part and sends voice + style", async () => {
    let sent: any;
    const f = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return ok(wav(1.5));
    }) as unknown as typeof fetch;
    const p = await synthesizeChunk({ apiKey: "k", text: "こんにちは。", voice: "Kore", fetchImpl: f });
    expect(pcmSeconds(p)).toBeCloseTo(1.5, 3);
    expect(sent.generation_config.speech_config[0].voice).toBe("Kore");
    expect(sent.input[0].content[0].text).toBe("こんにちは。");
    expect(sent.input[0].content[0].annotations[0].type).toBe("speech_metadata");
  });

  it("throws with status + retry-after on a 429", async () => {
    const f = (async () => new Response("quota", { status: 429, headers: { "retry-after": "17" } })) as unknown as typeof fetch;
    const err = await synthesizeChunk({ apiKey: "k", text: "x", voice: "Kore", fetchImpl: f }).catch((e) => e);
    expect(err).toBeInstanceOf(GeminiTtsError);
    expect(err.status).toBe(429);
    expect(err.retryAfterSec).toBe(17);
  });

  it("classifies the free-tier daily quota apart from per-minute throttling", async () => {
    const daily = new GeminiTtsError('gemini 429: {"error":{"message":"Rate limit exceeded for model gemini-3.8-flash-tts (limit: 10 requests per day on Free Tier). Please retry in 38s"}}', 429, 38);
    expect(daily.dailyQuota).toBe(true);
    expect(daily.retryable).toBe(false);
    const rpm = new GeminiTtsError("gemini 429: Rate limit exceeded (per minute)", 429, 20);
    expect(rpm.dailyQuota).toBe(false);
    expect(rpm.retryable).toBe(true);
    expect(new GeminiTtsError("gemini 402: prepayment credits are depleted", 402).retryable).toBe(false);
  });

  it("throws when the response has no audio part", async () => {
    const f = (async () => new Response(JSON.stringify({ status: "completed", steps: [] }), { status: 200 })) as unknown as typeof fetch;
    await expect(synthesizeChunk({ apiKey: "k", text: "x", voice: "Kore", fetchImpl: f })).rejects.toThrow(/no audio/);
  });
});
