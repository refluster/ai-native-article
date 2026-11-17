// Slug / GUID / audio-key ownership in the wf-podcast handler. Same-day Notion
// pages share the head of their id, so the old head-based slug gave them one
// GUID and one MP3 key: later syntheses overwrote earlier audio and Spotify
// dropped every duplicated GUID. These pin the fix.
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { S3Client, PutObjectCommand, HeadObjectCommand, CopyObjectCommand, DeleteObjectCommand, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import {
  PollyClient,
  StartSpeechSynthesisTaskCommand,
  GetSpeechSynthesisTaskCommand,
} from "@aws-sdk/client-polly";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const s3Mock = mockClient(S3Client);
const pollyMock = mockClient(PollyClient);
const smMock = mockClient(SecretsManagerClient);

let pages: any[] = [];
let heads: Record<string, Record<string, string>> = {};
let feed = "";
let notionPatches: any[] = [];

let handler: (e: any, ctx?: any) => Promise<{ statusCode: number; body: string }>;
let slugFromId: (id: string) => string;
let episodeGuid: (audioUrl: string, fallback: string) => string;

const SCRIPT = "これはテスト用の台本です。".repeat(40);
const rt = (s: string) => ({ type: "rich_text", rich_text: s ? [{ plain_text: s }] : [] });
const page = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  created_time: "2026-09-22T00:00:00Z",
  properties: {
    Title: { type: "title", title: [{ plain_text: `title-${id}` }] },
    podcastScript: rt(SCRIPT),
    podcastSources: rt("出典: https://example.com/a"),
    PublishedAt: { type: "date", date: { start: "2026-09-22" } },
    ...extra,
  },
});
const status = (name: string) => ({ podcastStatus: { type: "status", status: { name } } });
const audio = (url: string) => ({ audioUrl: { type: "url", url } });

beforeAll(async () => {
  process.env.PODCAST_TTS_ENGINE = "polly";
  process.env.BUCKET_NAME = "wf-bucket";
  process.env.PODCAST_PUBLIC_BASE_URL = "https://cdn.example";
  ({ handler, slugFromId, episodeGuid } = await import("./handler.js"));
});

beforeEach(() => {
  pages = [];
  heads = {};
  feed = "";
  notionPatches = [];
  s3Mock.reset();
  pollyMock.reset();
  smMock.reset();
  smMock.on(GetSecretValueCommand).resolves({ SecretString: JSON.stringify({ apiKey: "k" }) });
  // Missing keys answer HeadObject with 403 (no unconditioned s3:ListBucket);
  // existence must come from the list call.
  s3Mock.on(ListObjectsV2Command).callsFake(async (i: any) => ({
    Contents: Object.keys(heads).filter((k) => k.startsWith(i.Prefix)).map((Key) => ({ Key })),
  }));
  s3Mock.on(HeadObjectCommand).callsFake(async (i: any) => {
    if (!(i.Key in heads)) throw Object.assign(new Error("Forbidden"), { name: "Forbidden", $metadata: { httpStatusCode: 403 } });
    return { Metadata: heads[i.Key], ContentLength: 1000 };
  });
  s3Mock.on(PutObjectCommand).callsFake(async (i: any) => { if (i.Key === "podcast/feed.xml") feed = String(i.Body); return {}; });
  s3Mock.on(CopyObjectCommand).callsFake(async (i: any) => { heads[i.Key] = i.Metadata ?? {}; return {}; });
  s3Mock.on(DeleteObjectCommand).resolves({});
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (url.endsWith("/query")) return new Response(JSON.stringify({ results: pages, has_more: false }));
    if (init.method === "PATCH") { notionPatches.push({ url, ...JSON.parse(String(init.body)) }); return new Response("{}"); }
    const id = url.split("/pages/")[1];
    return new Response(JSON.stringify(pages.find((p) => p.id === id)));
  });
});

const post = async (path: string, body: unknown = {}) => {
  const res = await handler({ rawPath: path, body: JSON.stringify(body) });
  return { status: res.statusCode, json: JSON.parse(res.body) };
};

describe("wf-podcast slug + GUID", () => {
  it("slugs by the id tail, so same-day pages differ", () => {
    expect(slugFromId("3e3d0f0b-e61e-8101-aaaa-a1a1a1a1a1a1")).toBe("a1a1a1a1a1a1");
    expect(slugFromId("3e3d0f0b-e61e-8101-aaaa-a1a1a1a1a1a1")).not.toBe(slugFromId("3e3d0f0b-e61e-8102-bbbb-b2b2b2b2b2b2"));
  });

  it("derives the GUID from the audio key, not the page", () => {
    expect(episodeGuid("https://cdn.example/podcast/audio/3e8d0f0be61e.mp3", "x")).toBe("3e8d0f0be61e");
    expect(episodeGuid("", "fallback")).toBe("fallback");
  });

  it("keeps an already-ingested episode's GUID (its audioUrl) and fails loud on a shared enclosure", async () => {
    pages = [
      page("3e8d0f0b-e61e-8101-aaaa-a1a1a1a1a1a1", { ...status("published"), ...audio("https://cdn.example/podcast/audio/3e8d0f0be61e.mp3") }),
      page("3e3d0f0b-e61e-8102-bbbb-b2b2b2b2b2b2", { ...status("published"), ...audio("https://cdn.example/podcast/audio/b2b2b2b2b2b2.mp3") }),
    ];
    const ok = await post("/podcast/rss");
    expect(ok.status).toBe(200);
    expect(feed).toContain('<guid isPermaLink="false">3e8d0f0be61e</guid>');
    expect(feed).toContain('<guid isPermaLink="false">b2b2b2b2b2b2</guid>');

    pages.push(page("3e3d0f0b-e61e-8103-cccc-c3c3c3c3c3c3", { ...status("published"), ...audio("https://cdn.example/podcast/audio/b2b2b2b2b2b2.mp3") }));
    const bad = await post("/podcast/rss");
    expect(bad.status).toBe(500);
    expect(bad.json.error).toMatch(/duplicate episode GUID b2b2b2b2b2b2/);
  });
});

describe("wf-podcast feed pubDate", () => {
  const ep = (id: string, guid: string, publishedAt: string) =>
    page(id, { ...status("published"), ...audio(`https://cdn.example/podcast/audio/${guid}.mp3`), PublishedAt: { type: "date", date: { start: publishedAt } } });
  const pubDateOf = (xml: string, guid: string) =>
    new RegExp(`${guid}</guid>\\s*<pubDate>([^<]*)</pubDate>`).exec(xml)?.[1];
  // Persist the feed the way S3 would, so the next rebuild can read it back.
  const persistFeed = () => {
    s3Mock.on(PutObjectCommand).callsFake(async (i: any) => {
      if (i.Key === "podcast/feed.xml") { feed = String(i.Body); heads["podcast/feed.xml"] = {}; }
      return {};
    });
    s3Mock.on(GetObjectCommand).callsFake(async (i: any) => {
      if (i.Key !== "podcast/feed.xml" || !("podcast/feed.xml" in heads)) throw new Error("NoSuchKey");
      const body = feed;
      return { Body: { transformToString: async () => body } };
    });
  };

  it("first build (no prior feed) keeps the PublishedAt dates", async () => {
    pages = [ep("p1", "aaaaaaaaaaaa", "2026-11-03")];
    expect((await post("/podcast/rss")).status).toBe(200);
    expect(pubDateOf(feed, "aaaaaaaaaaaa")).toBe("Tue, 03 Nov 2026 09:00:00 GMT");
  });

  it("puts a back-catalogue episode cast today at the top, and keeps every existing date", async () => {
    persistFeed();
    pages = [ep("p1", "aaaaaaaaaaaa", "2026-11-10"), ep("p2", "bbbbbbbbbbbb", "2026-11-12")];
    expect((await post("/podcast/rss")).status).toBe(200); // seeds the feed
    const before = feed;

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-16T18:40:00Z"));
    try {
      // A new episode for an article published 11-03 (older than both).
      pages.push(ep("p3", "cccccccccccc", "2026-11-03"));
      expect((await post("/podcast/rss")).status).toBe(200);
    } finally { vi.useRealTimers(); }

    expect(pubDateOf(feed, "cccccccccccc")).toBe("Mon, 16 Nov 2026 18:40:00 GMT");
    expect(feed.indexOf("cccccccccccc</guid>")).toBeLessThan(feed.indexOf("bbbbbbbbbbbb</guid>"));
    expect(pubDateOf(feed, "aaaaaaaaaaaa")).toBe(pubDateOf(before, "aaaaaaaaaaaa"));
    expect(pubDateOf(feed, "bbbbbbbbbbbb")).toBe(pubDateOf(before, "bbbbbbbbbbbb"));
  });

  it("does not re-date an episode whose MP3 key is rewritten", async () => {
    persistFeed();
    pages = [ep("p1", "aaaaaaaaaaaa", "2026-05-01"), ep("p2", "bbbbbbbbbbbb", "2026-09-01")];
    expect((await post("/podcast/rss")).status).toBe(200);
    const before = feed;
    // e.g. the collided-audio restore or a re-finalize rewrites the public key.
    heads["podcast/audio/aaaaaaaaaaaa.mp3"] = { "page-id": "p1" };
    expect((await post("/podcast/rss")).status).toBe(200);
    expect(pubDateOf(feed, "aaaaaaaaaaaa")).toBe("Fri, 01 May 2026 09:00:00 GMT");
    expect(pubDateOf(feed, "bbbbbbbbbbbb")).toBe(pubDateOf(before, "bbbbbbbbbbbb"));
    expect(feed.indexOf("bbbbbbbbbbbb</guid>")).toBeLessThan(feed.indexOf("aaaaaaaaaaaa</guid>"));
  });

  it("fails loud when the prior feed exists but cannot be read", async () => {
    heads["podcast/feed.xml"] = {};
    s3Mock.on(GetObjectCommand).rejects(Object.assign(new Error("AccessDenied"), { name: "AccessDenied" }));
    pages = [ep("p1", "aaaaaaaaaaaa", "2026-11-03")];
    const r = await post("/podcast/rss");
    expect(r.status).toBe(500);
    expect(feed).toBe(""); // no degraded feed was written
  });

  // Seed a prior feed holding `n` dated items, then serve it from S3.
  const seedPriorFeed = async (n: number) => {
    persistFeed();
    pages = Array.from({ length: n }, (_, i) => ep(`s${i}`, `seed${String(i).padStart(8, "0")}`, "2026-06-01"));
    expect((await post("/podcast/rss")).status).toBe(200);
  };

  it("refuses to re-date the catalogue when the prior feed is readable but empty", async () => {
    persistFeed();
    pages = [];
    expect((await post("/podcast/rss")).status).toBe(200); // an empty feed is written
    pages = Array.from({ length: 12 }, (_, i) => ep(`p${i}`, `ep${String(i).padStart(10, "0")}`, "2026-06-01"));
    const empty = feed;
    const r = await post("/podcast/rss");
    expect(r.status).toBe(500);
    expect(r.json.error).toMatch(/12 episodes are new to podcast\/feed\.xml/);
    expect(feed).toBe(empty); // the empty feed was not overwritten with 12 re-dated items
  });

  it("refuses when the prior feed's pubDates are unparsable", async () => {
    await seedPriorFeed(12);
    feed = feed.replace(/<pubDate>[^<]*<\/pubDate>/g, "<pubDate>garbage</pubDate>");
    const r = await post("/podcast/rss");
    expect(r.status).toBe(500);
    expect(r.json.error).toMatch(/12 unparsable/);
  });

  it("allows exactly the limit (10) of new episodes and refuses one more", async () => {
    await seedPriorFeed(1);
    const base = [...pages];
    pages = [...base, ...Array.from({ length: 10 }, (_, i) => ep(`m${i}`, `max${String(i).padStart(9, "0")}`, "2026-11-01"))];
    expect((await post("/podcast/rss")).status).toBe(200);
    pages = [...pages, ...Array.from({ length: 11 }, (_, i) => ep(`o${i}`, `over${String(i).padStart(8, "0")}`, "2026-11-02"))];
    const r = await post("/podcast/rss");
    expect(r.status).toBe(500);
    expect(r.json.error).toMatch(/11 episodes are new .* limit 10/);
  });

  it("lets a deliberate bulk add through when PODCAST_MAX_NEW_PER_REBUILD is raised", async () => {
    await seedPriorFeed(1);
    pages.push(...Array.from({ length: 12 }, (_, i) => ep(`b${i}`, `bulk${String(i).padStart(8, "0")}`, "2026-11-01")));
    vi.stubEnv("PODCAST_MAX_NEW_PER_REBUILD", "50");
    vi.resetModules();
    try {
      const fresh = (await import("./handler.js")).handler;
      const res = await fresh({ rawPath: "/podcast/rss", body: "{}" });
      expect(res.statusCode).toBe(200);
      expect(feed).toContain("bulk00000011</guid>");
    } finally { vi.unstubAllEnvs(); vi.resetModules(); }
  });

  it("allows a normal batch of new episodes", async () => {
    await seedPriorFeed(3);
    pages.push(...Array.from({ length: 5 }, (_, i) => ep(`n${i}`, `new${String(i).padStart(9, "0")}`, "2026-11-01")));
    expect((await post("/podcast/rss")).status).toBe(200);
  });

  it("orders two episodes new in the same rebuild by their article date, one second apart", async () => {
    persistFeed();
    pages = [ep("p1", "aaaaaaaaaaaa", "2026-11-01")];
    expect((await post("/podcast/rss")).status).toBe(200);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-17T18:40:00Z"));
    try {
      // Notion returns the newer article first; the feed must not depend on that.
      pages.push(ep("p3", "cccccccccccc", "2026-11-05"), ep("p2", "bbbbbbbbbbbb", "2026-11-03"));
      expect((await post("/podcast/rss")).status).toBe(200);
    } finally { vi.useRealTimers(); }
    expect(pubDateOf(feed, "cccccccccccc")).toBe("Tue, 17 Nov 2026 18:40:00 GMT");
    expect(pubDateOf(feed, "bbbbbbbbbbbb")).toBe("Tue, 17 Nov 2026 18:39:59 GMT");
    expect(feed.indexOf("cccccccccccc</guid>")).toBeLessThan(feed.indexOf("bbbbbbbbbbbb</guid>"));
  });

  it("matches an XML-escaped GUID back to its episode", async () => {
    persistFeed();
    pages = [ep("p1", "it's&co", "2026-05-01")];
    expect((await post("/podcast/rss")).status).toBe(200);
    expect(feed).toContain("it&apos;s&amp;co</guid>");
    const before = pubDateOf(feed, "it&apos;s&amp;co");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-17T18:40:00Z"));
    try { expect((await post("/podcast/rss")).status).toBe(200); } finally { vi.useRealTimers(); }
    expect(pubDateOf(feed, "it&apos;s&amp;co")).toBe(before);
  });
});

describe("wf-podcast numeric env vars", () => {
  it("rejects a malformed value instead of turning it into NaN", async () => {
    const { envInt } = await import("./handler.js");
    for (const bad of ["abc", "", " ", "1.5", "-1", "10x"]) {
      vi.stubEnv("PODCAST_TEST_INT", bad);
      expect(() => envInt("PODCAST_TEST_INT", 10, 0)).toThrow(/is not an integer >= 0/);
    }
    vi.stubEnv("PODCAST_TEST_INT", " 25 ");
    expect(envInt("PODCAST_TEST_INT", 10, 0)).toBe(25);
    vi.unstubAllEnvs();
    expect(envInt("PODCAST_TEST_INT", 10, 0)).toBe(10);
  });
});

describe("wf-podcast audio-key ownership", () => {
  const finalize = (pageId: string, slug: string) =>
    post("/podcast/synthesize", { finalize: [{ pageId, slug, taskId: "t1", voiceId: "Takumi" }] });

  beforeEach(() => {
    pollyMock.on(GetSpeechSynthesisTaskCommand).resolves({
      SynthesisTask: { TaskStatus: "completed", OutputUri: "https://s3.us-west-2.amazonaws.com/wf-bucket/podcast/audio/tmp/x-t1.mp3" },
    });
    pollyMock.on(StartSpeechSynthesisTaskCommand).resolves({ SynthesisTask: { TaskId: "t1" } });
  });

  it("kicks off under the tail slug", async () => {
    pages = [page("3e3d0f0b-e61e-8101-aaaa-a1a1a1a1a1a1", status("approved"))];
    const k = await post("/podcast/synthesize");
    expect(k.json.started[0].slug).toBe("a1a1a1a1a1a1");
  });

  it("treats a key that only shares a prefix as free", async () => {
    heads["podcast/audio/k1.mp3.bak"] = { "page-id": "p0" };
    pages = [page("p1", status("approved"))];
    expect((await finalize("p1", "k1")).status).toBe(200);
  });

  it("writes a free key and stamps it with the page id", async () => {
    pages = [page("p1", status("approved"))];
    const r = await finalize("p1", "k1");
    expect(r.status).toBe(200);
    expect(heads["podcast/audio/k1.mp3"]).toEqual({ "page-id": "p1" });
    expect(notionPatches.at(-1).properties.audioUrl.url).toBe("https://cdn.example/podcast/audio/k1.mp3");
  });

  it("re-synthesises over its own audio", async () => {
    heads["podcast/audio/k1.mp3"] = { "page-id": "p1" };
    pages = [page("p1", status("approved"))];
    expect((await finalize("p1", "k1")).status).toBe(200);
  });

  it("refuses to overwrite another page's audio", async () => {
    heads["podcast/audio/k1.mp3"] = { "page-id": "p0" };
    pages = [page("p1", status("approved"))];
    const r = await finalize("p1", "k1");
    expect(r.status).toBe(500);
    expect(r.json.error).toMatch(/already holds another episode's audio/);
    expect(notionPatches).toEqual([]);
  });

  it("accepts a pre-metadata object only when it is this page's own audioUrl", async () => {
    heads["podcast/audio/k1.mp3"] = {};
    pages = [page("p1", { ...status("approved"), ...audio("https://cdn.example/podcast/audio/k1.mp3") })];
    expect((await finalize("p1", "k1")).status).toBe(200);

    heads["podcast/audio/k2.mp3"] = {};
    pages = [page("p2", status("approved"))];
    expect((await finalize("p2", "k2")).status).toBe(500);
  });
});
