// Client helpers for the public Q&A boards (ADR-0034) at /boards/:id.
//
// Transport: the agents-api board routes. Every read and write after
// `enterBoard` carries the board token as a Bearer header; the token is a
// board-scoped credential the API mints from the shared password, kept in
// localStorage per board so a guest re-opens the page without re-typing
// the password (until it expires or the operator rotates it — either
// surfaces as a 401 and the gate comes back).
//
// The pure helpers (post merging, mention splitting, the @-autocomplete
// probe) live here so the page stays a view and the logic is unit-tested.

import { WORKFORCE_AGENTS_API_BASE } from '../config/api';

// The board reads MUST work on a bare build (no VITE_ base): fall back to
// the stable custom domain, same as the roster read (ADR-0004).
const API_BASE = WORKFORCE_AGENTS_API_BASE.length > 0 ? WORKFORCE_AGENTS_API_BASE : 'https://workforce-api.kohuehara.xyz';

export type BoardAuthorKind = 'human' | 'agent';

export interface BoardPost {
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

export interface BoardAgent {
  slug: string;
  name: string;
  role: string;
}

export interface BoardInfo {
  board_id: string;
  name: string;
  created_at: string;
  agents: BoardAgent[];
}

export interface BoardSession {
  token: string;
  nickname: string;
  expires_at?: string;
}

/** Thrown on a non-2xx response; `status` lets the page treat 401 as
 *  "session gone" and everything else as a banner. */
export class BoardApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'BoardApiError';
  }
}

// ----- localStorage session -----

const STORAGE_PREFIX = 'wf:board:';

export function loadBoardSession(boardId: string): BoardSession | undefined {
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${boardId}`);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<BoardSession>;
    if (typeof parsed.token !== 'string' || typeof parsed.nickname !== 'string') return undefined;
    if (parsed.expires_at && Date.parse(parsed.expires_at) <= Date.now()) return undefined;
    return { token: parsed.token, nickname: parsed.nickname, expires_at: parsed.expires_at };
  } catch {
    return undefined;
  }
}

export function saveBoardSession(boardId: string, session: BoardSession): void {
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${boardId}`, JSON.stringify(session));
  } catch {
    /* private mode / quota — the session simply does not persist */
  }
}

export function clearBoardSession(boardId: string): void {
  try {
    window.localStorage.removeItem(`${STORAGE_PREFIX}${boardId}`);
  } catch {
    /* nothing to clear */
  }
}

// ----- API -----

async function readError(res: Response): Promise<BoardApiError> {
  let code = `http_${res.status}`;
  let detail: string | undefined;
  try {
    const data = (await res.json()) as { error?: string; detail?: string; message?: string };
    if (data.error) code = data.error;
    detail = data.detail ?? data.message;
  } catch {
    /* non-JSON error body */
  }
  return new BoardApiError(res.status, code, detail);
}

async function call<T>(path: string, init: RequestInit, token?: string): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as T;
}

export interface EnterResult {
  session: BoardSession;
  board: BoardInfo;
}

export async function enterBoard(boardId: string, password: string, nickname: string): Promise<EnterResult> {
  const data = await call<{ token: string; nickname: string; expires_at?: string; board: BoardInfo }>(
    `/boards/${encodeURIComponent(boardId)}/enter`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password, nickname }),
    },
  );
  return { session: { token: data.token, nickname: data.nickname, expires_at: data.expires_at }, board: data.board };
}

export async function fetchBoard(boardId: string, token: string): Promise<BoardInfo> {
  const data = await call<{ board: BoardInfo }>(`/boards/${encodeURIComponent(boardId)}`, { method: 'GET' }, token);
  return data.board;
}

export interface PostsPage {
  posts: BoardPost[];
  older_cursor?: string;
}

/** Newest page (or the older page at `cursor`), chronological. */
export async function fetchPosts(boardId: string, token: string, opts: { cursor?: string; pageSize?: number } = {}): Promise<PostsPage> {
  const params = new URLSearchParams();
  if (opts.cursor) params.set('cursor', opts.cursor);
  if (opts.pageSize !== undefined) params.set('page_size', String(opts.pageSize));
  const qs = params.size > 0 ? `?${params.toString()}` : '';
  return call<PostsPage>(`/boards/${encodeURIComponent(boardId)}/posts${qs}`, { method: 'GET' }, token);
}

/** Posts newer than `afterPostId` — the poll. */
export async function fetchPostsAfter(boardId: string, token: string, afterPostId: string): Promise<BoardPost[]> {
  const data = await call<{ posts: BoardPost[] }>(
    `/boards/${encodeURIComponent(boardId)}/posts?after=${encodeURIComponent(afterPostId)}`,
    { method: 'GET' },
    token,
  );
  return data.posts;
}

export interface CreatePostResult {
  post: BoardPost;
  /** Agent slugs the API summoned for this post. */
  dispatched: string[];
}

export async function createPost(boardId: string, token: string, body: string, replyTo?: string): Promise<CreatePostResult> {
  return call<CreatePostResult>(
    `/boards/${encodeURIComponent(boardId)}/posts`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body, ...(replyTo ? { reply_to: replyTo } : {}) }),
    },
    token,
  );
}

// ----- Pure helpers -----

/** Union two slices of one board's history, deduplicated by post id and
 *  ordered by id (ULIDs are time-ordered, so id order is post order). */
export function mergePosts(a: BoardPost[], b: BoardPost[]): BoardPost[] {
  const byId = new Map<string, BoardPost>();
  for (const p of [...a, ...b]) byId.set(p.post_id, p);
  return [...byId.values()].sort((x, y) => (x.post_id < y.post_id ? -1 : x.post_id > y.post_id ? 1 : 0));
}

export type BodySegment = { kind: 'text'; text: string } | { kind: 'mention'; slug: string; text: string };

const MENTION_SPLIT = /(^|[^A-Za-z0-9_@])(@[a-z0-9][a-z0-9-]{0,39})/gi;

/** Split a body into text and mention segments so the page can highlight
 *  roster mentions without dangerouslySetInnerHTML. Unknown handles stay
 *  plain text. */
export function splitMentions(body: string, known: ReadonlySet<string>): BodySegment[] {
  const out: BodySegment[] = [];
  let last = 0;
  for (const m of body.matchAll(MENTION_SPLIT)) {
    const prefix = m[1] ?? '';
    const handle = m[2] ?? '';
    const slug = handle.slice(1).toLowerCase();
    const start = (m.index ?? 0) + prefix.length;
    if (!known.has(slug)) continue;
    if (start > last) out.push({ kind: 'text', text: body.slice(last, start) });
    out.push({ kind: 'mention', slug, text: handle });
    last = start + handle.length;
  }
  if (last < body.length) out.push({ kind: 'text', text: body.slice(last) });
  return out;
}

export interface MentionProbe {
  /** Index of the `@` in the text. */
  start: number;
  /** Characters typed after the `@`, lowercased. */
  query: string;
}

/** When the caret sits inside an `@handle` being typed, return it so the
 *  composer can show the roster picker; otherwise undefined. */
export function probeMention(text: string, caret: number): MentionProbe | undefined {
  const before = text.slice(0, caret);
  const m = /(^|[^A-Za-z0-9_@])@([a-z0-9-]*)$/i.exec(before);
  if (!m) return undefined;
  const start = before.length - (m[2] ?? '').length - 1;
  return { start, query: (m[2] ?? '').toLowerCase() };
}

/** Replace the handle under the caret with `@slug ` and return the new
 *  text plus the caret position after the inserted mention. */
export function applyMention(text: string, probe: MentionProbe, slug: string): { text: string; caret: number } {
  const head = text.slice(0, probe.start);
  const tailStart = probe.start + 1 + probe.query.length;
  const tail = text.slice(tailStart);
  const inserted = `@${slug} `;
  return { text: `${head}${inserted}${tail}`, caret: head.length + inserted.length };
}

/** Filter + rank the roster for the picker: slug prefix first, then name
 *  substring, at most `limit`. */
export function rankAgents(agents: BoardAgent[], query: string, limit = 6): BoardAgent[] {
  const q = query.toLowerCase();
  const prefix = agents.filter((a) => a.slug.startsWith(q));
  const rest = agents.filter((a) => !a.slug.startsWith(q) && (a.name.toLowerCase().includes(q) || a.role.toLowerCase().includes(q)));
  return [...prefix, ...rest].slice(0, limit);
}

/** Initials for a guest avatar — first two grapheme-ish characters of the
 *  first two words (`Hana Sato` → `HS`, `上原` → `上`). */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) {
    const w = words[0];
    return /^[A-Za-z]/.test(w) ? w.slice(0, 2).toUpperCase() : [...w][0];
  }
  return words
    .slice(0, 2)
    .map((w) => [...w][0].toUpperCase())
    .join('');
}
