// wf-podcast — the deterministic podcast production/distribution Lambda
// (Epic-017 Stories 5 & 6; ADR-0016). It runs on the DEFAULT Lambda surface
// (R-N1) because it performs NO agent reasoning — synthesis and feed assembly
// are deterministic. Two routes on the IAM-authorized HttpApi:
//
//   POST /podcast/synthesize  {slug?}  — Story 5
//       Read a script-ready episode from Notion (by slug, or the oldest
//       script-ready), strip the script to plain text, synthesise it with
//       Amazon Polly (Neural JA, ONE voice chosen at random per cast,
//       StartSpeechSynthesisTask — async, required because the script exceeds
//       the 3,000-char sync cap), copy the MP3 to the public podcast/audio/
//       prefix, and write audioUrl + podcastStatus=audio-ready back to Notion.
//
//   POST /podcast/rss                  — Story 6
//       Build the podcast RSS from every audio-ready/published episode
//       (enclosure = the public MP3, <description> = the mandatory citations,
//       GUID = slug) and write it to the public podcast/feed.xml.
//
// Auth: IAM (the HttpApi authorizer), invoked by the operator/orchestrator who
// hold AWS credentials — no new project credential type (the synthesis/RSS
// skills SigV4-sign their POST, the register.mjs pattern). The Notion token is
// the shared `wf/notion` secret (apiKey + databaseId) via IAM → Secrets
// Manager — no new credential type there either.
//
// Fail loud (C-4): a Polly/S3/Notion error throws → 500 + the alarm fires. A
// degraded synthesis never silently lands a broken episode.

import {
  PollyClient,
  StartSpeechSynthesisTaskCommand,
  GetSpeechSynthesisTaskCommand,
} from "@aws-sdk/client-polly";
import {
  S3Client,
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";

import { getSecret } from "../shared/secrets.js";
import { buildPodcastRss, type PodcastEpisode } from "./rss.js";

const NOTION_VERSION = "2022-06-28";
const NOTION_API = "https://api.notion.com/v1";

// The Notion credential is the project-scoped integration token (shape
// {apiKey}); the DB id is a NON-secret constant (the unified Articles DB,
// already committed in the article-level2 scripts + the pipeline) — overridable
// for tests. This mirrors how the article-level2 scripts resolve Notion: apiKey
// from the credential, DB id as a constant.
const NOTION_SECRET_ID =
  process.env.NOTION_SECRET_ID ?? "wf/projects/agent-workforce/notion.integration_token";
const UNIFIED_DB_ID = process.env.NOTION_DB_ID ?? "34fd0f0b-e61e-817a-9f6b-dc65b0d5b4cc";

const BUCKET = process.env.BUCKET_NAME ?? "";
// The public base URL the MP3/feed are served from (CloudFront/OAC over the
// wf bucket's podcast/* prefix — the bucket itself stays private, ADR-0016).
const PUBLIC_BASE = (process.env.PODCAST_PUBLIC_BASE_URL ?? "").replace(/\/+$/, "");
const SITE_BASE = (process.env.PODCAST_SITE_BASE_URL ?? "https://kohuehara.xyz/ai-native-article").replace(/\/+$/, "");

// JA Neural voice pool — one chosen at random per cast (Epic-017 D1/Q6) when
// the Producer (odette) hasn't set a per-episode `podcastVoice`. These are the
// Amazon Polly voices that support the `neural` engine for ja-JP.
const JA_NEURAL_VOICES = ["Takumi", "Kazuha", "Tomoko"];

// Per-run batch cap (operator: "1回の実施で5記事/podcastを上限"). synthesize and
// publish each process at most this many episodes per call.
const BATCH_LIMIT = Number(process.env.PODCAST_BATCH_LIMIT ?? "5");

// Show-level Spotify metadata. Cover art + an owner email are required for a
// publishable show; defaults point at the CloudFront-served cover.
const COVER_URL = process.env.PODCAST_COVER_URL ?? (PUBLIC_BASE ? `${PUBLIC_BASE}/podcast/cover.png` : "");
const CATEGORY = process.env.PODCAST_CATEGORY ?? "Technology";
const OWNER_NAME = process.env.PODCAST_OWNER_NAME ?? "kohuehara";
const OWNER_EMAIL = process.env.PODCAST_OWNER_EMAIL ?? "";

const PREFIX_AUDIO = "podcast/audio";
const FEED_KEY = "podcast/feed.xml";

const polly = new PollyClient({});
const s3 = new S3Client({});

interface ProxyEventV2 {
  rawPath?: string;
  requestContext?: { http?: { path?: string; method?: string } };
  body?: string | null;
  isBase64Encoded?: boolean;
}
interface ProxyResult {
  statusCode: number;
  headers?: Record<string, string>;
  body: string;
}

const json = (statusCode: number, obj: unknown): ProxyResult => ({
  statusCode,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(obj),
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Notion helpers (the unified Articles DB; podcast properties from Story 4) ─

async function notionHeaders(): Promise<{ apiKey: string; databaseId: string }> {
  const sec = await getSecret<{ apiKey?: string }>(NOTION_SECRET_ID);
  const apiKey = sec?.apiKey;
  if (!apiKey) throw new Error(`${NOTION_SECRET_ID} secret missing apiKey`);
  return { apiKey, databaseId: UNIFIED_DB_ID };
}

async function notionFetch(apiKey: string, path: string, init: RequestInit): Promise<unknown> {
  const res = await fetch(`${NOTION_API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${apiKey}`,
      "notion-version": NOTION_VERSION,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) throw new Error(`notion ${res.status} ${path}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

type NotionPage = { id: string; created_time?: string; properties?: Record<string, any> };

function propText(prop: any): string {
  if (!prop) return "";
  switch (prop.type) {
    case "title": return (prop.title ?? []).map((t: any) => t.plain_text).join("");
    case "rich_text": return (prop.rich_text ?? []).map((t: any) => t.plain_text).join("");
    case "date": return prop.date?.start ?? "";
    case "url": return prop.url ?? "";
    case "select": return prop.select?.name ?? "";
    case "status": return prop.status?.name ?? "";
    case "multi_select": return (prop.multi_select ?? []).map((o: any) => o.name).join(", ");
    default: return "";
  }
}

async function queryAll(apiKey: string, databaseId: string): Promise<NotionPage[]> {
  const pages: NotionPage[] = [];
  let cursor: string | undefined;
  do {
    const data = (await notionFetch(apiKey, `/databases/${databaseId}/query`, {
      method: "POST",
      body: JSON.stringify(cursor ? { start_cursor: cursor, page_size: 100 } : { page_size: 100 }),
    })) as { results?: NotionPage[]; has_more?: boolean; next_cursor?: string };
    pages.push(...(data.results ?? []));
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return pages;
}

function slugFromId(id: string): string {
  return id.replace(/-/g, "").slice(0, 12);
}
function pageSlug(p: NotionPage): string {
  return propText(p.properties?.LegacySlug) || slugFromId(p.id);
}

async function patchPodcast(apiKey: string, pageId: string, props: Record<string, unknown>): Promise<void> {
  await notionFetch(apiKey, `/pages/${pageId}`, {
    method: "PATCH",
    body: JSON.stringify({ properties: props }),
  });
}

// ── Script → plain text for TTS (strip markdown so Polly reads prose) ────────
function scriptToPlainText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")        // code fences
    .replace(/`([^`]*)`/g, "$1")            // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")  // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links → text
    .replace(/^#{1,6}\s+/gm, "")            // headings
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, "$1") // emphasis
    .replace(/^\s*[-*+]\s+/gm, "")          // bullets
    .replace(/^\s*>\s?/gm, "")              // blockquotes
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── Story 5: synthesize one approved episode → audio-ready ───────────────────
async function synthesizeOne(apiKey: string, page: NotionPage): Promise<Record<string, unknown>> {
  const theSlug = pageSlug(page);
  const title = propText(page.properties?.Title) || theSlug;
  const script = propText(page.properties?.podcastScript);
  const plain = scriptToPlainText(script);
  if (plain.length < 200) {
    throw new Error(`podcastScript for ${theSlug} is ${plain.length} chars after strip — refusing to synthesise a truncated/empty episode (C-1)`);
  }

  // Voice: the Producer (odette) may set `podcastVoice` per episode; otherwise
  // one is chosen at random from the JA Neural pool (D1/Q6). An unknown value
  // falls back to random rather than failing the cast.
  const casted = propText(page.properties?.podcastVoice).trim();
  const voiceId = JA_NEURAL_VOICES.includes(casted)
    ? casted
    : JA_NEURAL_VOICES[Math.floor(Math.random() * JA_NEURAL_VOICES.length)];
  const tmpPrefix = `podcast/audio/tmp/${theSlug}-`;

  const started = await polly.send(
    new StartSpeechSynthesisTaskCommand({
      Engine: "neural",
      LanguageCode: "ja-JP",
      OutputFormat: "mp3",
      VoiceId: voiceId as any,
      TextType: "text",
      Text: plain,
      OutputS3BucketName: BUCKET,
      OutputS3KeyPrefix: tmpPrefix,
    }),
  );
  const taskId = started.SynthesisTask?.TaskId;
  if (!taskId) throw new Error("Polly StartSpeechSynthesisTask returned no TaskId");

  // Poll until the async task completes. Fail loud on a Polly failure (C-4).
  let outputUri: string | undefined;
  for (let i = 0; i < 50; i++) {
    await sleep(3000);
    const got = await polly.send(new GetSpeechSynthesisTaskCommand({ TaskId: taskId }));
    const status = got.SynthesisTask?.TaskStatus;
    if (status === "completed") { outputUri = got.SynthesisTask?.OutputUri; break; }
    if (status === "failed") {
      throw new Error(`Polly task ${taskId} failed: ${got.SynthesisTask?.TaskStatusReason ?? "unknown"}`);
    }
  }
  if (!outputUri) throw new Error(`Polly task ${taskId} did not complete within the poll budget`);

  // OutputUri is https://s3.<region>.amazonaws.com/<bucket>/<key>. Copy it to
  // the clean public path podcast/audio/{slug}.mp3.
  const srcKey = decodeURIComponent(new URL(outputUri).pathname.replace(new RegExp(`^/${BUCKET}/`), "").replace(/^\//, ""));
  const destKey = `${PREFIX_AUDIO}/${theSlug}.mp3`;
  await s3.send(new CopyObjectCommand({
    Bucket: BUCKET,
    CopySource: `/${BUCKET}/${srcKey}`,
    Key: destKey,
    ContentType: "audio/mpeg",
    MetadataDirective: "REPLACE",
  }));
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: srcKey })).catch(() => { /* best-effort temp cleanup */ });

  const audioUrl = `${PUBLIC_BASE}/${destKey}`;
  await patchPodcast(apiKey, page.id, {
    audioUrl: { url: audioUrl },
    podcastStatus: { status: { name: "audio-ready" } },
  });
  return { slug: theSlug, title, voiceId, audioUrl, status: "audio-ready" };
}

// Batch driver: synthesise up to BATCH_LIMIT oldest `approved` episodes
// (or a specific --slug). The human-approval gate is `approved`; nothing is
// cast until a person has reviewed the script and flipped script-ready→approved.
async function synthesize(slug: string | undefined): Promise<ProxyResult> {
  if (!BUCKET) throw new Error("BUCKET_NAME env var is required");
  if (!PUBLIC_BASE) throw new Error("PODCAST_PUBLIC_BASE_URL env var is required");
  const { apiKey, databaseId } = await notionHeaders();

  const pages = await queryAll(apiKey, databaseId);
  const approved = pages
    .filter((p) => propText(p.properties?.podcastStatus).toLowerCase() === "approved")
    .sort((a, b) => (a.created_time ?? "").localeCompare(b.created_time ?? ""));

  const targets = slug
    ? approved.filter((p) => pageSlug(p) === slug)
    : approved.slice(0, BATCH_LIMIT);
  if (targets.length === 0) {
    return json(200, { skip: true, reason: slug ? `no approved page for slug ${slug}` : "no approved episode", results: [] });
  }

  const results: Record<string, unknown>[] = [];
  for (const page of targets) results.push(await synthesizeOne(apiKey, page));
  return json(200, { count: results.length, results });
}

// ── Celeste's stage: publish audio-ready → published, then rebuild the feed ──
async function publish(): Promise<ProxyResult> {
  const { apiKey, databaseId } = await notionHeaders();
  const pages = await queryAll(apiKey, databaseId);
  const audioReady = pages
    .filter((p) => propText(p.properties?.podcastStatus).toLowerCase() === "audio-ready" && !!propText(p.properties?.audioUrl))
    .sort((a, b) => (a.created_time ?? "").localeCompare(b.created_time ?? ""))
    .slice(0, BATCH_LIMIT);

  const published: string[] = [];
  for (const p of audioReady) {
    // Citation guard before publish (ADR-0016).
    if (!propText(p.properties?.podcastSources).trim()) {
      throw new Error(`episode ${pageSlug(p)} has empty podcastSources — refusing to publish an uncited episode (ADR-0016)`);
    }
    await patchPodcast(apiKey, p.id, { podcastStatus: { status: { name: "published" } } });
    published.push(pageSlug(p));
  }

  // Always rebuild the feed so newly-published episodes appear for Spotify.
  const feed = await buildRss();
  const feedBody = JSON.parse(feed.body) as { feedUrl?: string; episodes?: number };
  return json(200, { published, feedUrl: feedBody.feedUrl, episodes: feedBody.episodes });
}

// ── Story 6: build RSS ───────────────────────────────────────────────────────
async function buildRss(): Promise<ProxyResult> {
  if (!BUCKET) throw new Error("BUCKET_NAME env var is required");
  if (!PUBLIC_BASE) throw new Error("PODCAST_PUBLIC_BASE_URL env var is required");
  const { apiKey, databaseId } = await notionHeaders();

  const pages = await queryAll(apiKey, databaseId);
  const ready = pages.filter((p) => {
    const status = propText(p.properties?.podcastStatus).toLowerCase();
    const audioUrl = propText(p.properties?.audioUrl);
    return (status === "audio-ready" || status === "published") && !!audioUrl;
  });

  const episodes: PodcastEpisode[] = [];
  for (const p of ready) {
    const citations = propText(p.properties?.podcastSources).trim();
    // Citation guard at the feed boundary too (defense in depth — ADR-0016):
    // never publish an item with empty show-note citations.
    if (!citations) {
      throw new Error(`episode ${pageSlug(p)} has empty podcastSources — refusing to build a feed with an uncited episode (ADR-0016)`);
    }
    const audioUrl = propText(p.properties?.audioUrl);
    let byteLength = 0;
    try {
      const key = audioUrl.startsWith(PUBLIC_BASE) ? audioUrl.slice(PUBLIC_BASE.length + 1) : `${PREFIX_AUDIO}/${pageSlug(p)}.mp3`;
      const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
      byteLength = head.ContentLength ?? 0;
    } catch { /* length is optional in the enclosure; 0 is tolerated by readers */ }
    // Celeste's stage: an optional `podcastShowNotes` framing leads the
    // <description>; the mandatory citations always follow it.
    const showNotes = propText(p.properties?.podcastShowNotes).trim();
    episodes.push({
      slug: pageSlug(p),
      title: propText(p.properties?.Title) || pageSlug(p),
      description: showNotes ? `${showNotes}\n\n${citations}` : citations,
      audioUrl,
      pubDate: propText(p.properties?.Date) || (p.created_time ?? "").slice(0, 10),
      byteLength,
    });
  }
  episodes.sort((a, b) => (b.pubDate || "").localeCompare(a.pubDate || ""));

  const feedSelfUrl = `${PUBLIC_BASE}/${FEED_KEY}`;
  const xml = buildPodcastRss(
    {
      title: "AI Native Article — Podcast",
      link: SITE_BASE,
      description: "L3/L4 分析記事を一話完結のナレーション・ポッドキャストに再構成（出典明記）。AI Native Article (kohuehara.xyz).",
      language: "ja",
      author: "Workforce / kohuehara.xyz",
      feedSelfUrl,
      imageUrl: COVER_URL || undefined,
      category: CATEGORY,
      explicit: false,
      ownerName: OWNER_NAME,
      ownerEmail: OWNER_EMAIL || undefined,
      type: "episodic",
    },
    episodes,
  );

  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: FEED_KEY,
    Body: xml,
    ContentType: "application/rss+xml; charset=utf-8",
  }));

  return json(200, { feedUrl: feedSelfUrl, episodes: episodes.length });
}

// ── Router ───────────────────────────────────────────────────────────────────
export async function handler(event: ProxyEventV2): Promise<ProxyResult> {
  const path = event.rawPath ?? event.requestContext?.http?.path ?? "";
  let body: Record<string, unknown> = {};
  if (event.body) {
    try {
      const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
      body = raw ? JSON.parse(raw) : {};
    } catch {
      return json(400, { error: "invalid JSON body" });
    }
  }

  try {
    if (path.endsWith("/podcast/synthesize")) {
      return await synthesize(typeof body.slug === "string" ? body.slug : undefined);
    }
    if (path.endsWith("/podcast/publish")) {
      return await publish();
    }
    if (path.endsWith("/podcast/rss")) {
      return await buildRss();
    }
    return json(404, { error: `unknown route ${path}` });
  } catch (err) {
    // Fail loud (C-4) — surface the error and let the alarm fire.
    console.error(JSON.stringify({ event: "wf_podcast_error", path, error: String(err) }));
    return json(500, { error: err instanceof Error ? err.message : String(err) });
  }
}
