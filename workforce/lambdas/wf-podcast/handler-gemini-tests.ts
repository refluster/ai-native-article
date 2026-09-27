// End-to-end (mocked) test of the ADR-0043 Gemini engine in the wf-podcast
// handler: kickoff returns a task-less handle, finalize polls advance one wave
// of chunks per call with S3 as the only progress state, and the episode is
// stitched + flipped to audio-ready once every chunk exists.
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
let geminiMode: "ok" | "throttle" | "short" = "ok";

let handler: (e: any) => Promise<{ statusCode: number; body: string }>;

beforeAll(async () => {
  process.env.PODCAST_TTS_ENGINE = "gemini";
  process.env.BUCKET_NAME = "wf-bucket";
  process.env.PODCAST_PUBLIC_BASE_URL = "https://cdn.example";
  process.env.GEMINI_CHUNK_CHARS = "500";
  process.env.GEMINI_CONCURRENCY = "2";
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
      if (geminiMode === "throttle") return new Response("quota", { status: 429, headers: { "retry-after": "12" } });
      const body = JSON.parse(String(init.body));
      const chars = body.input[0].content[0].text.length;
      const sec = geminiMode === "short" ? 1 : (chars / 350) * 60; // 350字/分
      return new Response(JSON.stringify({ status: "completed", steps: [{ type: "model_output", content: [{ type: "audio", data: wav(sec).toString("base64") }] }] }));
    }
    throw new Error(`unexpected fetch ${url}`);
  });
});

const call = async (body: unknown) => {
  const res = await handler({ rawPath: "/podcast/synthesize", body: JSON.stringify(body) });
  return { status: res.statusCode, json: JSON.parse(res.body) };
};

describe("wf-podcast Gemini engine", () => {
  it("kickoff returns a task-less gemini handle without calling Gemini", async () => {
    const k = await call({});
    expect(k.status).toBe(202);
    expect(k.json.started).toEqual([{ pageId: "page-1", slug: "ep1", voiceId: "Kazuha", engine: "gemini" }]);
    expect(geminiCalls).toBe(0);
  });

  it("finalize advances one wave per poll, resumes from S3, then stitches → audio-ready", async () => {
    const { json: k } = await call({});
    const handles = k.started;

    const p1 = await call({ finalize: handles });
    expect(p1.status).toBe(200);
    expect(p1.json.results[0]).toMatchObject({ done: false, chunksDone: 2, chunksTotal: 5 });
    const p2 = await call({ finalize: handles });
    expect(p2.json.results[0]).toMatchObject({ done: false, chunksDone: 4 });
    const p3 = await call({ finalize: handles });
    expect(p3.json.error).toBeUndefined();
    expect(p3.json.done).toBe(true);
    expect(p3.json.results[0]).toMatchObject({ status: "audio-ready", chunks: 5, geminiVoice: "Kore" });
    expect(geminiCalls).toBe(5); // no chunk synthesised twice

    const final = store.get("podcast/audio/ep1.mp3")!;
    expect(final.length).toBeGreaterThan(0);
    expect([...store.keys()].filter((key) => key.includes("/tmp/"))).toEqual([]); // tmp cleaned
    expect(notionPatches.at(-1).properties.podcastStatus.status.name).toBe("audio-ready");
    expect(notionPatches.at(-1).properties.audioUrl.url).toBe("https://cdn.example/podcast/audio/ep1.mp3");
  });

  it("reports a 429 as a pending poll with retryAfterSec (not a 5xx)", async () => {
    const { json: k } = await call({});
    geminiMode = "throttle";
    const p = await call({ finalize: k.started });
    expect(p.status).toBe(200);
    expect(p.json.results[0]).toMatchObject({ done: false, chunksDone: 0, retryAfterSec: 12 });
  });

  it("fails loud when a chunk's audio is far too short for its text (C-1)", async () => {
    const { json: k } = await call({});
    geminiMode = "short";
    const p = await call({ finalize: k.started });
    expect(p.status).toBe(500);
    expect(p.json.error).toMatch(/too short/);
    expect(notionPatches).toEqual([]);
  });
});
