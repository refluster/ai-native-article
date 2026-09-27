// End-to-end (mocked) test of the ADR-0043 Gemini engine in the wf-podcast
// handler: kickoff returns a task-less handle + the function to invoke, a direct
// invocation advances waves of chunks while time remains with S3 as the only
// progress state, and the episode is stitched + flipped to audio-ready once
// every chunk exists. The HTTP-API finalize refuses Gemini handles (30 s).
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const s3Mock = mockClient(S3Client);
const smMock = mockClient(SecretsManagerClient);
const store = new Map<string, Buffer>();

function wav(seconds: number): Buffer {
  const data = Buffer.alloc(Math.round(seconds * 24000) * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8); h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(24000, 24);
  h.writeUInt32LE(48000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

// ~2,400字 script → with GEMINI_CHUNK_CHARS=500 → 5 chunks.
const SCRIPT = Array.from({ length: 150 }, (_, i) => `これは${i}番目の説明の文です。`).join("");
let notionPatches: any[] = [];
let geminiCalls = 0;
let geminiMode: "ok" | "daily" | "short" | "shortOnce" = "ok";

let handler: (e: any, ctx?: any) => Promise<{ statusCode: number; body: string }>;

beforeAll(async () => {
  process.env.PODCAST_TTS_ENGINE = "gemini";
  process.env.BUCKET_NAME = "wf-bucket";
  process.env.PODCAST_PUBLIC_BASE_URL = "https://cdn.example";
  process.env.GEMINI_CHUNK_CHARS = "500";
  process.env.GEMINI_CONCURRENCY = "2";
  process.env.GEMINI_WAVE_RESERVE_MS = "1000";
  process.env.AWS_LAMBDA_FUNCTION_NAME = "wf-podcast-test";
  ({ handler } = await import("./handler.js"));
});

beforeEach(() => {
  store.clear();
  notionPatches = [];
  geminiCalls = 0;
  geminiMode = "ok";
  s3Mock.reset();
  smMock.reset();
  smMock.on(GetSecretValueCommand).callsFake(async (i: any) => ({ SecretString: JSON.stringify({ apiKey: `key-for-${i.SecretId}` }) }));
  s3Mock.on(PutObjectCommand).callsFake(async (i: any) => { store.set(i.Key, Buffer.from(i.Body)); return {}; });
  s3Mock.on(GetObjectCommand).callsFake(async (i: any) => ({ Body: { transformToByteArray: async () => new Uint8Array(store.get(i.Key)!) } }));
  s3Mock.on(ListObjectsV2Command).callsFake(async (i: any) => ({ Contents: [...store.keys()].filter((k) => k.startsWith(i.Prefix)).map((Key) => ({ Key })) }));
  s3Mock.on(DeleteObjectsCommand).callsFake(async (i: any) => { for (const o of i.Delete.Objects) store.delete(o.Key); return {}; });

  const page = {
    id: "page-1",
    created_time: "2026-09-01T00:00:00Z",
    properties: {
      podcastStatus: { type: "status", status: { name: "approved" } },
      podcastScript: { type: "rich_text", rich_text: [{ plain_text: SCRIPT }] },
      podcastVoice: { type: "rich_text", rich_text: [{ plain_text: "Kazuha" }] },
      LegacySlug: { type: "rich_text", rich_text: [{ plain_text: "ep1" }] },
    },
  };
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (url.includes("api.notion.com")) {
      if (url.endsWith("/query")) return new Response(JSON.stringify({ results: [page], has_more: false }));
      if (init.method === "PATCH") { notionPatches.push(JSON.parse(String(init.body))); return new Response("{}"); }
      return new Response(JSON.stringify(page));
    }
    if (url.includes("generativelanguage.googleapis.com")) {
      geminiCalls++;
      if (geminiMode === "daily") {
        return new Response('{"error":{"message":"Rate limit exceeded for model gemini-3.8-flash-tts (limit: 10 requests per day on Free Tier). Please retry in 38s"}}', { status: 429, headers: { "retry-after": "38" } });
      }
      const body = JSON.parse(String(init.body));
      const chars = body.input[0].content[0].text.length;
      const bad = geminiMode === "short" || (geminiMode === "shortOnce" && geminiCalls === 1);
      const sec = bad ? 1 : (chars / 350) * 60; // 350字/分
      return new Response(JSON.stringify({ status: "completed", steps: [{ type: "model_output", content: [{ type: "audio", data: wav(sec).toString("base64") }] }] }));
    }
    throw new Error(`unexpected fetch ${url}`);
  });
});

const call = async (body: unknown) => {
  const res = await handler({ rawPath: "/podcast/synthesize", body: JSON.stringify(body) });
  return { status: res.statusCode, json: JSON.parse(res.body) };
};
// A direct invocation with `waves` wave-starts' worth of remaining time.
const invoke = async (handles: unknown, waves = 99) => {
  let checks = 0;
  const ctx = { getRemainingTimeInMillis: () => (checks++ < waves ? 600_000 : 0) };
  const res = await handler({ source: "wf-podcast-direct", finalize: handles }, ctx);
  return { status: res.statusCode, json: JSON.parse(res.body) };
};

describe("wf-podcast Gemini engine", () => {
  it("kickoff returns a task-less gemini handle + the function to invoke, without calling Gemini", async () => {
    const k = await call({});
    expect(k.status).toBe(202);
    expect(k.json.started).toEqual([{ pageId: "page-1", slug: "ep1", voiceId: "Kazuha", engine: "gemini" }]);
    expect(k.json.invoke).toEqual({ functionName: "wf-podcast-test" });
    expect(geminiCalls).toBe(0);
  });

  it("refuses to finalize gemini handles over the HTTP API (30 s window)", async () => {
    const { json: k } = await call({});
    const p = await call({ finalize: k.started });
    expect(p.status).toBe(400);
    expect(geminiCalls).toBe(0);
  });

  it("one direct invocation runs every wave, stitches, and flips audio-ready", async () => {
    const { json: k } = await call({});
    const r = await invoke(k.started);
    expect(r.status).toBe(200);
    expect(r.json.done).toBe(true);
    expect(r.json.results[0]).toMatchObject({ status: "audio-ready", chunks: 5, geminiVoice: "Kore" });
    expect(r.json.results[0].normalize).toHaveLength(5); // every chunk went through normalizeChunks
    expect(geminiCalls).toBe(5);
    expect(store.get("podcast/audio/ep1.mp3")!.length).toBeGreaterThan(0);
    expect([...store.keys()].filter((key) => key.includes("/tmp/"))).toEqual([]); // tmp cleaned
    expect(notionPatches.at(-1).properties.podcastStatus.status.name).toBe("audio-ready");
    expect(notionPatches.at(-1).properties.audioUrl.url).toBe("https://cdn.example/podcast/audio/ep1.mp3");
  });

  it("resumes from S3 when an invocation runs out of time (no chunk synthesised twice)", async () => {
    const { json: k } = await call({});
    const r1 = await invoke(k.started, 1); // time for one wave only
    expect(r1.json.results[0]).toMatchObject({ done: false, chunksDone: 2, chunksTotal: 5 });
    expect(notionPatches).toEqual([]);
    const r2 = await invoke(k.started);
    expect(r2.json.done).toBe(true);
    expect(geminiCalls).toBe(5);
  });

  it("stops on the free-tier daily quota without failing, keeping finished chunks", async () => {
    const { json: k } = await call({});
    await invoke(k.started, 1); // 2 chunks land
    geminiMode = "daily";
    const r = await invoke(k.started);
    expect(r.status).toBe(200);
    expect(r.json.results[0]).toMatchObject({ done: false, chunksDone: 2, quotaExhausted: true });
    geminiMode = "ok";
    const r3 = await invoke(k.started); // "tomorrow"
    expect(r3.json.done).toBe(true);
  });

  it("re-synthesises a chunk once when a quality guard rejects it", async () => {
    const { json: k } = await call({});
    geminiMode = "shortOnce";
    const r = await invoke(k.started);
    expect(r.status).toBe(200);
    expect(r.json.done).toBe(true);
    expect(geminiCalls).toBe(6); // 5 chunks + 1 retake
  });

  it("fails loud when a chunk's audio is far too short for its text (C-1)", async () => {
    const { json: k } = await call({});
    geminiMode = "short";
    const r = await invoke(k.started);
    expect(r.status).toBe(500);
    expect(r.json.error).toMatch(/too short/);
    expect(notionPatches).toEqual([]);
  });
});
