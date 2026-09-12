// workforce/lambdas/shared/board.ts
//
// Q&A BOARD row family + helpers (ADR-0034). A board is a password-gated,
// nickname-identified public discussion surface at
// `workforce.kohuehara.xyz/boards/{board_id}` where invited guests post,
// reply, and @-mention workforce agents, who answer from their persona,
// their own record and the public knowledge pack.
//
// Mirrors the posture of shared/messaging.ts (Epic-013): the runtime
// *shape* lives here so both the agents-api handler (guest reads/writes)
// and the wf-board-reply Lambda (agent writes) share one trust domain and
// one row shape — an agent reply is written via `createBoardPost`, never
// through the HTTP route, so a reply can never re-enter the dispatch path
// (loop safety by construction, same argument as ADR-0006).
//
// Row family (catalogued in workforce/docs/data-model.md):
//   BOARD#{board_id} / META          — board descriptor + password hash
//   BOARD#{board_id} / POST#{ulid}   — one post (human guest or agent)
//
// Auth (ADR-0034 §Decision 2): one shared password per board. `POST
// /boards/{id}/enter` verifies it (scrypt) and mints a board-scoped bearer
// token — HMAC-SHA256 over `{board_id, nickname, exp}` keyed on the
// board's own password hash. No new secret to provision (R-N3 is
// untouched: the hash lives on the META row, the same store that holds
// the board); rotating the password invalidates every outstanding token
// for that board and no other.
//
// CLAUDE.md / W-4 (fail-loud): a row whose `body_ref` does not resolve in
// S3 throws rather than returning a silent partial.

import { randomBytes, scrypt as scryptCb, createHmac, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";

import { ddb, getItem, putItem, updateOperational } from "./ddb.js";
import { newUlid } from "./task.js";

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

const BUCKET_NAME = process.env.BUCKET_NAME;
const TABLE_NAME = process.env.TABLE_NAME ?? "";
const s3 = new S3Client({});

// --- Caps + constants ----------------------------------------------------

/** Hard cap on a post body. A question can run longer than a work-register
 *  message (2000c on THREAD rows), and an agent answer of 2–4 paragraphs in
 *  Japanese routinely passes 2000 — 4000 gives both room without letting a
 *  "post" become a document. */
export const BOARD_POST_HARD_MAX_CHARS = 4000;

/** Inline preview cap — a body at or under this is fully contained in
 *  `body_preview` and needs no S3 round-trip (same split as MSG rows). */
export const BOARD_POST_PREVIEW_MAX_CHARS = 320;

/** Preview length denormalised onto a reply so the quote header renders
 *  even when the parent has paged out of the client's window. */
export const BOARD_REPLY_QUOTE_CHARS = 120;

/** Default page size for the newest-page read. */
export const BOARD_POSTS_PAGE_DEFAULT = 50;

/** Board token lifetime. Guests re-enter with the password after this. */
export const BOARD_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Nickname shape: 1–32 visible chars, no control chars, no leading `@`
 *  (so a guest can never render as a mention). */
export const NICKNAME_MAX_CHARS = 32;

/** Board id: kebab/uuid shaped, URL-safe. */
export const BOARD_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;

/** `hop` of a human post. Agent replies carry `parent.hop + 1`; the reply
 *  Lambda only honours mentions on posts whose hop is below
 *  BOARD_MAX_HOP, so a cascade is human → agent → delegated agent → stop. */
export const BOARD_HUMAN_HOP = 0;
export const BOARD_MAX_HOP = 2;

// --- Row types -----------------------------------------------------------

export interface BoardMetaRow {
  pk: `BOARD#${string}`;
  sk: "META";
  board_id: string;
  /** Display name shown in the page header. */
  name: string;
  /** Hex salt + scrypt hash of the shared entry password. */
  password_salt: string;
  password_hash: string;
  /** Agent slugs guests may mention. Absent ⇒ every non-archived agent. */
  agents?: string[];
  archived: boolean;
  created_at: string;
  last_post_at?: string;
  updated_at?: string;
}

export type BoardAuthorKind = "human" | "agent";

export interface BoardPostRow {
  pk: `BOARD#${string}`;
  sk: `POST#${string}`;
  post_id: string;
  board_id: string;
  author_kind: BoardAuthorKind;
  /** Guest nickname (human) or agent slug (agent). */
  author: string;
  at: string;
  body_preview: string;
  /** S3 key under `boards/{board_id}/{ulid}.md`; absent when inline. */
  body_ref?: string;
  /** Parent post id when this is a reply. */
  reply_to?: string;
  reply_to_author?: string;
  reply_to_author_kind?: BoardAuthorKind;
  reply_to_preview?: string;
  /** The human post that started this cascade (self for human posts). */
  root_post_id: string;
  hop: number;
  /** Agent slugs mentioned in the body, deduplicated, roster-filtered. */
  mentions: string[];
  /** Operator moderation flag — hidden posts are dropped from reads. */
  hidden?: boolean;
  // LLM metadata on agent posts (mirrors MSG rows).
  finish_reason?: string;
  tokens_in?: number;
  tokens_out?: number;
  skill_version?: string;
}

// --- API view types ------------------------------------------------------

export interface BoardPostView {
  post_id: string;
  author_kind: BoardAuthorKind;
  author: string;
  at: string;
  body: string;
  reply_to?: string;
  reply_to_author?: string;
  reply_to_author_kind?: BoardAuthorKind;
  reply_to_preview?: string;
  hop: number;
  mentions: string[];
}

export interface BoardPostsPage {
  posts: BoardPostView[];
  /** Resumes the walk toward the start of the board (newest-page read). */
  older_cursor?: string;
}

// --- Key + id helpers ----------------------------------------------------

export function boardPk(boardId: string): `BOARD#${string}` {
  return `BOARD#${boardId}`;
}

export function postSk(postId: string): `POST#${string}` {
  return `POST#${postId}`;
}

export function postIdFromSk(sk: string): string {
  return sk.startsWith("POST#") ? sk.slice("POST#".length) : sk;
}

export function isValidBoardId(id: string): boolean {
  return BOARD_ID_PATTERN.test(id);
}

/** Smallest ULID whose time component is `ms` — the lower bound for a
 *  "posts since" key-range query (ULIDs are Crockford base32, 10 time
 *  chars + 16 random chars, so a zero random tail sorts first). */
export function ulidLowerBound(ms: number): string {
  const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let s = "";
  let t = Math.max(0, Math.floor(ms));
  for (let i = 0; i < 10; i++) {
    s = ALPHABET[t % 32] + s;
    t = Math.floor(t / 32);
  }
  return `${s}0000000000000000`;
}

// --- Nickname + mention parsing -----------------------------------------

/** Trim + validate a guest nickname. Returns undefined when unusable. */
export function normaliseNickname(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const nick = raw.replace(/\s+/g, " ").trim();
  if (nick.length === 0 || nick.length > NICKNAME_MAX_CHARS) return undefined;
  if (nick.startsWith("@")) return undefined;
  for (const ch of nick) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return undefined;
  }
  return nick;
}

const MENTION_RE = /(^|[^A-Za-z0-9_@])@([a-z0-9][a-z0-9-]{0,39})/gi;

/**
 * Extract `@slug` mentions from a post body, lowercased and deduplicated
 * in first-seen order, keeping only slugs in `known`. A mention must not
 * be glued to a preceding word character (so an e-mail address is not a
 * mention); a trailing CJK character is fine (`@mayaさん`).
 */
export function parseMentions(body: string, known: ReadonlySet<string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of body.matchAll(MENTION_RE)) {
    const slug = (m[2] ?? "").toLowerCase();
    if (!known.has(slug) || seen.has(slug)) continue;
    seen.add(slug);
    out.push(slug);
  }
  return out;
}

// --- Password + token ----------------------------------------------------

export function newPasswordSalt(): string {
  return randomBytes(16).toString("hex");
}

/** scrypt(password, salt) → hex. Node defaults (N=16384, r=8, p=1); the
 *  create-board script computes the same shape from the operator's
 *  machine, so both sides must agree on this function's parameters. */
export async function hashBoardPassword(password: string, saltHex: string): Promise<string> {
  const buf = await scrypt(password, saltHex, 32);
  return buf.toString("hex");
}

export async function verifyBoardPassword(meta: BoardMetaRow, password: string): Promise<boolean> {
  if (typeof password !== "string" || password.length === 0 || password.length > 256) return false;
  const presented = Buffer.from(await hashBoardPassword(password, meta.password_salt), "hex");
  const expected = Buffer.from(meta.password_hash, "hex");
  if (presented.length !== expected.length || expected.length === 0) return false;
  return timingSafeEqual(presented, expected);
}

interface BoardTokenPayload {
  b: string;
  n: string;
  exp: number;
}

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

function signPayload(meta: BoardMetaRow, payload: string): string {
  return createHmac("sha256", meta.password_hash).update(payload).digest("base64url");
}

/** Mint a board-scoped bearer token for a nickname. */
export function mintBoardToken(
  meta: BoardMetaRow,
  nickname: string,
  now: number = Date.now(),
  ttlMs: number = BOARD_TOKEN_TTL_MS,
): string {
  const payload: BoardTokenPayload = { b: meta.board_id, n: nickname, exp: now + ttlMs };
  const encoded = b64url(JSON.stringify(payload));
  return `${encoded}.${signPayload(meta, encoded)}`;
}

export interface BoardSession {
  board_id: string;
  nickname: string;
  expires_at: string;
}

/** Verify a token against the board it claims. Returns the session or
 *  undefined on any miss (shape, signature, board mismatch, expiry). */
export function verifyBoardToken(
  meta: BoardMetaRow,
  token: string,
  now: number = Date.now(),
): BoardSession | undefined {
  if (typeof token !== "string") return undefined;
  const dot = token.indexOf(".");
  if (dot <= 0) return undefined;
  const encoded = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = signPayload(meta, encoded);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return undefined;
  let payload: BoardTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as BoardTokenPayload;
  } catch {
    return undefined;
  }
  if (payload.b !== meta.board_id) return undefined;
  if (typeof payload.exp !== "number" || payload.exp <= now) return undefined;
  const nickname = normaliseNickname(payload.n);
  if (!nickname) return undefined;
  return { board_id: meta.board_id, nickname, expires_at: new Date(payload.exp).toISOString() };
}

// --- Row → view ----------------------------------------------------------

export function toBoardPostView(row: BoardPostRow, body: string): BoardPostView {
  return {
    post_id: row.post_id,
    author_kind: row.author_kind,
    author: row.author,
    at: row.at,
    body,
    ...(row.reply_to !== undefined ? { reply_to: row.reply_to } : {}),
    ...(row.reply_to_author !== undefined ? { reply_to_author: row.reply_to_author } : {}),
    ...(row.reply_to_author_kind !== undefined ? { reply_to_author_kind: row.reply_to_author_kind } : {}),
    ...(row.reply_to_preview !== undefined ? { reply_to_preview: row.reply_to_preview } : {}),
    hop: row.hop,
    mentions: row.mentions ?? [],
  };
}

// --- Read helpers --------------------------------------------------------

export async function getBoardMeta(boardId: string): Promise<BoardMetaRow | undefined> {
  return getItem<BoardMetaRow>(boardPk(boardId), "META");
}

export async function getBoardPost(boardId: string, postId: string): Promise<BoardPostRow | undefined> {
  return getItem<BoardPostRow>(boardPk(boardId), postSk(postId));
}

/** Resolve a post body: inline preview, else the S3 object (throws on a
 *  missing object — W-4). */
export async function resolveBoardPostBody(row: BoardPostRow): Promise<string> {
  if (!row.body_ref) return row.body_preview;
  if (!BUCKET_NAME) throw new Error("BUCKET_NAME env var is required to fetch board post bodies");
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET_NAME, Key: row.body_ref }));
  if (!res.Body) throw new Error(`board post body not found in S3: ${row.body_ref}`);
  return await res.Body.transformToString();
}

async function hydrate(rows: BoardPostRow[]): Promise<BoardPostView[]> {
  const out: BoardPostView[] = [];
  for (const row of rows) {
    if (row.hidden) continue;
    out.push(toBoardPostView(row, await resolveBoardPostBody(row)));
  }
  return out;
}

export interface BoardPostsPageQuery {
  pageSize?: number;
  /** Opaque `older_cursor` from a previous page. */
  cursor?: string;
}

/**
 * Newest page of a board (or the page at `cursor`, walking toward the
 * start), returned in chronological order. Same DESC-then-reverse shape
 * as getThreadDetail — an ascending Limit query would keep the OLDEST
 * page and silently drop the newest once a board outgrows the window.
 */
export async function listBoardPosts(
  boardId: string,
  page: BoardPostsPageQuery = {},
): Promise<BoardPostsPage> {
  const limit = page.pageSize ?? BOARD_POSTS_PAGE_DEFAULT;
  const exclusiveStartKey = page.cursor
    ? (JSON.parse(Buffer.from(page.cursor, "base64url").toString("utf8")) as Record<string, unknown>)
    : undefined;
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :skp)",
      ExpressionAttributeNames: { "#pk": "pk", "#sk": "sk" },
      ExpressionAttributeValues: { ":pk": boardPk(boardId), ":skp": "POST#" },
      Limit: limit,
      ScanIndexForward: false,
      ExclusiveStartKey: exclusiveStartKey,
      ConsistentRead: true,
    }),
  );
  const rows = ((res.Items ?? []) as BoardPostRow[]).slice().reverse();
  const older = res.LastEvaluatedKey
    ? Buffer.from(JSON.stringify(res.LastEvaluatedKey)).toString("base64url")
    : undefined;
  return {
    posts: await hydrate(rows),
    ...(older !== undefined ? { older_cursor: older } : {}),
  };
}

/**
 * Posts strictly newer than `afterPostId`, oldest first — the cheap poll
 * the guest page runs every few seconds. Key-range query on the ULID sort
 * key; `limit` bounds one poll, a client that falls further behind simply
 * polls again with the newest id it received.
 */
export async function listBoardPostsAfter(
  boardId: string,
  afterPostId: string,
  limit = 100,
): Promise<BoardPostView[]> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "#pk = :pk AND #sk > :after",
      ExpressionAttributeNames: { "#pk": "pk", "#sk": "sk" },
      ExpressionAttributeValues: { ":pk": boardPk(boardId), ":after": postSk(afterPostId) },
      Limit: limit,
      ScanIndexForward: true,
      ConsistentRead: true,
    }),
  );
  return hydrate((res.Items ?? []) as BoardPostRow[]);
}

/**
 * Rows of one cascade (same `root_post_id`) among the `window` posts that
 * follow the root — enough context for the reply Lambda to know who has
 * already answered. Un-hydrated: callers read authorship, not bodies.
 */
export async function listCascadeRows(
  boardId: string,
  rootPostId: string,
  window = 200,
): Promise<BoardPostRow[]> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "#pk = :pk AND #sk >= :lo",
      ExpressionAttributeNames: { "#pk": "pk", "#sk": "sk" },
      ExpressionAttributeValues: { ":pk": boardPk(boardId), ":lo": postSk(rootPostId) },
      Limit: window,
      ScanIndexForward: true,
      ConsistentRead: true,
    }),
  );
  return ((res.Items ?? []) as BoardPostRow[]).filter((r) => r.root_post_id === rootPostId);
}

/**
 * Number of agent-authored posts on a board since `sinceMs` — the daily
 * reply budget the reply Lambda enforces. Drains every page of the key
 * range (a Limit-capped single page would under-count, the FU-PROJ-SCAN
 * bug class).
 */
export async function countAgentPostsSince(boardId: string, sinceMs: number): Promise<number> {
  let count = 0;
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const res = await ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "#pk = :pk AND #sk >= :lo",
        ExpressionAttributeNames: { "#pk": "pk", "#sk": "sk" },
        ExpressionAttributeValues: { ":pk": boardPk(boardId), ":lo": postSk(ulidLowerBound(sinceMs)) },
        ProjectionExpression: "author_kind",
        ExclusiveStartKey: exclusiveStartKey,
        ConsistentRead: true,
      }),
    );
    for (const item of (res.Items ?? []) as Array<{ author_kind?: string }>) {
      if (item.author_kind === "agent") count += 1;
    }
    exclusiveStartKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (exclusiveStartKey);
  return count;
}

// --- Write path ----------------------------------------------------------

/** Trim + validate a body. Throws on empty / over-cap (C-4 fail-loud). */
export function validateBoardBody(body: unknown): string {
  if (typeof body !== "string") throw new Error("board_post: invalid_body");
  const trimmed = body.trim();
  if (trimmed.length === 0) throw new Error("board_post: empty_body");
  if (trimmed.length > BOARD_POST_HARD_MAX_CHARS) {
    throw new Error(`board_post: body_over_hard_cap: ${trimmed.length} > ${BOARD_POST_HARD_MAX_CHARS}`);
  }
  return trimmed;
}

async function writeBody(boardId: string, postId: string, body: string): Promise<string | undefined> {
  if (body.length <= BOARD_POST_PREVIEW_MAX_CHARS) return undefined;
  if (!BUCKET_NAME) throw new Error("BUCKET_NAME env var is required to store board post bodies");
  const key = `boards/${boardId}/${postId}.md`;
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: body,
      ContentType: "text/markdown; charset=utf-8",
    }),
  );
  return key;
}

export interface CreateBoardPostInput {
  board_id: string;
  author_kind: BoardAuthorKind;
  author: string;
  body: string;
  /** Parent row, already loaded by the caller (so its quote fields and
   *  cascade root can be denormalised without a second read). */
  reply_to?: BoardPostRow;
  mentions: string[];
  /** Hop of this post — BOARD_HUMAN_HOP for guests, parent.hop + 1 for
   *  agents. The caller decides; this module only stores it. */
  hop: number;
  finish_reason?: string;
  tokens_in?: number;
  tokens_out?: number;
  skill_version?: string;
  now?: () => Date;
  newUlid?: () => string;
}

export interface CreatedBoardPost {
  view: BoardPostView;
  /** The stored row — the reply Lambda passes it straight back in as the
   *  `reply_to` parent of a delegated answer. */
  row: BoardPostRow;
}

/**
 * Append a post. Writes (in order) the S3 body (if long) → the POST row →
 * the META `last_post_at` patch. Throws if the board has no META row
 * (never a dangling post). Returns the stored view + row.
 */
export async function createBoardPost(input: CreateBoardPostInput): Promise<CreatedBoardPost> {
  const meta = await getBoardMeta(input.board_id);
  if (!meta) throw new Error(`createBoardPost: no board META for ${input.board_id}`);
  if (meta.archived) throw new Error(`createBoardPost: board ${input.board_id} is archived`);

  const body = validateBoardBody(input.body);
  const at = (input.now ?? (() => new Date()))().toISOString();
  const postId = (input.newUlid ?? newUlid)();
  const preview = body.slice(0, BOARD_POST_PREVIEW_MAX_CHARS);
  const bodyRef = await writeBody(input.board_id, postId, body);
  const parent = input.reply_to;

  const row: BoardPostRow = {
    pk: boardPk(input.board_id),
    sk: postSk(postId),
    post_id: postId,
    board_id: input.board_id,
    author_kind: input.author_kind,
    author: input.author,
    at,
    body_preview: preview,
    ...(bodyRef !== undefined ? { body_ref: bodyRef } : {}),
    ...(parent
      ? {
          reply_to: parent.post_id,
          reply_to_author: parent.author,
          reply_to_author_kind: parent.author_kind,
          reply_to_preview: parent.body_preview.slice(0, BOARD_REPLY_QUOTE_CHARS),
        }
      : {}),
    root_post_id: input.author_kind === "human" || !parent ? postId : parent.root_post_id,
    hop: input.hop,
    mentions: input.mentions,
    ...(input.finish_reason !== undefined ? { finish_reason: input.finish_reason } : {}),
    ...(input.tokens_in !== undefined ? { tokens_in: input.tokens_in } : {}),
    ...(input.tokens_out !== undefined ? { tokens_out: input.tokens_out } : {}),
    ...(input.skill_version !== undefined ? { skill_version: input.skill_version } : {}),
  };
  await putItem(row);
  await updateOperational<BoardMetaRow>(boardPk(input.board_id), "META", { last_post_at: at });
  return { view: toBoardPostView(row, body), row };
}

/** Operator moderation: hide (or unhide) one post. Hidden rows stay in
 *  the table for the audit trail and drop out of every read. */
export async function setBoardPostHidden(
  boardId: string,
  postId: string,
  hidden: boolean,
): Promise<BoardPostRow | undefined> {
  const row = await getBoardPost(boardId, postId);
  if (!row) return undefined;
  return updateOperational<BoardPostRow>(boardPk(boardId), postSk(postId), { hidden });
}
