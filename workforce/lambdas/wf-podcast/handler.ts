// wf-podcast — the deterministic podcast production/distribution Lambda
// (Epic-017 Stories 5 & 6; ADR-0016). It runs on the DEFAULT Lambda surface
// (R-N1) because it performs NO agent reasoning — synthesis and feed assembly
// are deterministic. Two routes on the IAM-authorized HttpApi:
//
//   POST /podcast/synthesize  {slug?}        — Story 5 (kickoff)
//       Start an Amazon Polly async task (Neural JA, per-cast voice) for up to
//       BATCH_LIMIT oldest `approved` episodes and return 202 immediately with
//       the task handles. Polly — not the Lambda — does the waiting, so the
//       call never approaches the API Gateway HTTP-API hard 30s integration
//       timeout (the old path polled Polly to completion inside the request and
//       a real batch ran ~55s → the HTTP API 503'd at 30s even though the
//       synthesis succeeded).
//   POST /podcast/synthesize  {finalize:[…]} — Story 5 (finalize poll)
//       The caller echoes the kickoff handles back; for each completed Polly
//       task we copy the MP3 to the public podcast/audio/ key and write
//       audioUrl + podcastStatus=audio-ready to Notion. Returns {done,pending}.
//       No per-Lambda nested invocation (R-N1): the taskId is the only state,
//       carried by the caller; GetSpeechSynthesisTask is the status check.
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

// ── Story 5: synthesise approved episodes → audio-ready (kickoff + finalize) ──
//
// The waiting happens INSIDE Amazon Polly's async task service, never inside
// the Lambda request, so every HTTP call stays well under the API Gateway
// HTTP-API hard 30s integration timeout. No per-Lambda nested invocation is
// introduced (R-N1): the Polly taskId is the only state, carried by the caller
// between the 202 kickoff and the finalize polls.

type SynthHandle = { pageId: string; slug: string; taskId: string; voiceId?: string };

// Start one Polly task for an approved episode and return the handle the caller
// echoes back on each finalize poll. Does NOT wait for completion.
async function startSynthesis(page: NotionPage): Promise<SynthHandle> {
  const theSlug = pageSlug(page);
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
  if (!taskId) throw new Error(`Polly StartSpeechSynthesisTask returned no TaskId for ${theSlug}`);
  return { pageId: page.id, slug: theSlug, taskId, voiceId };
}

// Finalize one started task: if Polly has completed it, copy the MP3 to the
// clean public key and flip Notion to audio-ready; if Polly failed, throw
// (C-4). Idempotent — re-running on a finished episode overwrites the same key
// and re-patches the same status. Returns {done:false} while still in progress.
async function finalizeOne(apiKey: string, h: SynthHandle): Promise<Record<string, unknown>> {
  const got = await polly.send(new GetSpeechSynthesisTaskCommand({ TaskId: h.taskId }));
  const status = got.SynthesisTask?.TaskStatus;
  if (status === "failed") {
    throw new Error(`Polly task ${h.taskId} (${h.slug}) failed: ${got.SynthesisTask?.TaskStatusReason ?? "unknown"}`);
  }
  if (status !== "completed") {
    return { pageId: h.pageId, slug: h.slug, status: status ?? "inProgress", done: false };
  }

  // OutputUri is https://s3.<region>.amazonaws.com/<bucket>/<key>. Copy it to
  // the clean public path podcast/audio/{slug}.mp3.
  const outputUri = got.SynthesisTask?.OutputUri;
  if (!outputUri) throw new Error(`Polly task ${h.taskId} (${h.slug}) completed without an OutputUri`);
  const srcKey = decodeURIComponent(new URL(outputUri).pathname.replace(new RegExp(`^/${BUCKET}/`), "").replace(/^\//, ""));
  const destKey = `${PREFIX_AUDIO}/${h.slug}.mp3`;
  await s3.send(new CopyObjectCommand({
    Bucket: BUCKET,
    CopySource: `/${BUCKET}/${srcKey}`,
    Key: destKey,
    ContentType: "audio/mpeg",
    MetadataDirective: "REPLACE",
  }));
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: srcKey })).catch(() => { /* best-effort temp cleanup */ });

  const audioUrl = `${PUBLIC_BASE}/${destKey}`;
  await patchPodcast(apiKey, h.pageId, {
    audioUrl: { url: audioUrl },
    podcastStatus: { status: { name: "audio-ready" } },
  });
  return { pageId: h.pageId, slug: h.slug, voiceId: h.voiceId, audioUrl, status: "audio-ready", done: true };
}

// KICKOFF: start Polly tasks for up to BATCH_LIMIT oldest `approved` episodes
// (or a specific --slug) and return 202 immediately with the handles to poll.
// The human-approval gate is `approved`; nothing is cast until a person has
// reviewed the script and flipped script-ready→approved.
async function synthesizeKickoff(slug: string | undefined): Promise<ProxyResult> {
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
    return json(200, { skip: true, reason: slug ? `no approved page for slug ${slug}` : "no approved episode", started: [] });
  }

  const started: SynthHandle[] = [];
  for (const page of targets) started.push(await startSynthesis(page));
  return json(202, { status: "synthesizing", pending: started.length, started });
}

// FINALIZE: the caller echoes the kickoff handles back; for each completed
// Polly task we flip the episode to audio-ready. done === all handles finished.
async function synthesizeFinalize(handles: SynthHandle[]): Promise<ProxyResult> {
  if (!BUCKET) throw new Error("BUCKET_NAME env var is required");
  if (!PUBLIC_BASE) throw new Error("PODCAST_PUBLIC_BASE_URL env var is required");
  const { apiKey } = await notionHeaders();
  const results: Record<string, unknown>[] = [];
  for (const h of handles) results.push(await finalizeOne(apiKey, h));
  const pending = results.filter((r) => !r.done).length;
  return json(200, { done: pending === 0, pending, results });
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
    // feed.xml is overwritten in place on every publish/rebuild, so a long
    // CloudFront TTL makes new episodes invisible at the edge until the cache
    // expires (the S3 object updates, the edge keeps serving the stale feed).
    // A short max-age bounds that staleness to ~5 min without a CloudFront
    // invalidation (no extra IAM / per-invalidation cost). The MP3s don't need
    // this — each episode is a fresh, immutable key, so it's never a stale hit.
    CacheControl: "max-age=300",
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
      if (Array.isArray(body.finalize)) {
        return await synthesizeFinalize(body.finalize as SynthHandle[]);
      }
      return await synthesizeKickoff(typeof body.slug === "string" ? body.slug : undefined);
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
