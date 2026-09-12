// agents-api — Q&A board routes (ADR-0034).
//
//   POST  /boards/{id}/enter             password + nickname → board token (public)
//   GET   /boards/{id}                   board card + roster                (board token)
//   GET   /boards/{id}/posts             newest page | ?after= poll         (board token)
//   POST  /boards/{id}/posts             guest post; dispatches mentions    (board token)
//   PATCH /boards/{id}/posts/{post_id}   operator hide/unhide               (AWS_IAM at GW)
//
// Kept in its own module so the route logic is testable without the
// handler's 3000-line mock surface: the handler passes the two things
// this module cannot own — the async Lambda invoke and the IAM check.
//
// Auth model. The API GW has no authorizer on the guest routes (guests
// have neither Cognito nor SigV4); the board token is validated here
// against the board's META row (shared/board.ts). Reads are NOT public:
// unlike the feed and threads, every board read requires the token, so a
// guessed board id yields nothing without the password. The CORS gate is
// the usual friction layer on top.

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";

import { type AgentMetaRow } from "../shared/agent.js";
import {
  BOARD_HUMAN_HOP,
  BOARD_POSTS_PAGE_DEFAULT,
  createBoardPost,
  getBoardMeta,
  getBoardPost,
  isValidBoardId,
  listBoardPosts,
  listBoardPostsAfter,
  mintBoardToken,
  normaliseNickname,
  parseMentions,
  setBoardPostHidden,
  toBoardPostView,
  validateBoardBody,
  verifyBoardPassword,
  verifyBoardToken,
  type BoardMetaRow,
  type BoardSession,
} from "../shared/board.js";
import { scanAllPrefix } from "../shared/ddb.js";

/** Cap on agents one guest post can summon. A fourth mention is stored
 *  (the UI highlights it) but not dispatched. */
export const BOARD_MAX_DISPATCH_PER_POST = 3;

const PAGE_SIZE_MAX = 100;

export interface BoardReplyDispatch {
  board_id: string;
  post_id: string;
  addressed_slug: string;
}

export interface BoardsDeps {
  /** Async-invoke wf-board-reply. Best-effort: a dispatch failure must not
   *  fail the guest's post — it already landed (W-4: log loudly). */
  dispatchReply(payload: BoardReplyDispatch): Promise<void>;
  isIamAuthenticated(event: APIGatewayProxyEventV2): boolean;
}

export interface BoardRosterEntry {
  slug: string;
  name: string;
  role: string;
}

export interface BoardView {
  board_id: string;
  name: string;
  created_at: string;
  agents: BoardRosterEntry[];
}

function reply(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
    body: JSON.stringify(body),
  };
}

function parseJsonBody(raw: string | undefined): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function parsePageSize(qs: Record<string, string | undefined>): number {
  const n = Number.parseInt(qs.page_size ?? "", 10);
  if (!Number.isFinite(n) || n <= 0) return BOARD_POSTS_PAGE_DEFAULT;
  return Math.min(n, PAGE_SIZE_MAX);
}

/** Non-archived agents the board exposes, lean (slug/name/role). */
export async function loadBoardRoster(meta: BoardMetaRow): Promise<BoardRosterEntry[]> {
  const rows = await scanAllPrefix<AgentMetaRow>("AGENT#", "META");
  const allow = meta.agents ? new Set(meta.agents) : undefined;
  return rows
    .filter((r) => !r.archived && (!allow || allow.has(r.slug)))
    .map((r) => ({ slug: r.slug, name: `${r.first_name} ${r.last_name}`.trim(), role: r.role }))
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

function toBoardView(meta: BoardMetaRow, agents: BoardRosterEntry[]): BoardView {
  return { board_id: meta.board_id, name: meta.name, created_at: meta.created_at, agents };
}

/** Bearer board token → session, or undefined. */
function sessionFromEvent(event: APIGatewayProxyEventV2, meta: BoardMetaRow): BoardSession | undefined {
  const headers = event.headers ?? {};
  const raw = headers.authorization ?? headers.Authorization;
  if (!raw || !raw.startsWith("Bearer ")) return undefined;
  const token = raw.slice("Bearer ".length).trim();
  if (token.length === 0) return undefined;
  return verifyBoardToken(meta, token);
}

// --- Routes --------------------------------------------------------------

async function enterRoute(meta: BoardMetaRow, event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const body = parseJsonBody(event.body);
  if (!body) return reply(400, { error: "invalid_json" });
  const nickname = normaliseNickname(body.nickname);
  if (!nickname) return reply(400, { error: "invalid_nickname" });
  const ok = typeof body.password === "string" && (await verifyBoardPassword(meta, body.password));
  if (!ok) return reply(401, { error: "invalid_password" });
  const token = mintBoardToken(meta, nickname);
  const session = verifyBoardToken(meta, token);
  const agents = await loadBoardRoster(meta);
  return reply(200, {
    token,
    nickname,
    expires_at: session?.expires_at,
    board: toBoardView(meta, agents),
  });
}

async function getBoardRoute(meta: BoardMetaRow, session: BoardSession): Promise<APIGatewayProxyResultV2> {
  const agents = await loadBoardRoster(meta);
  return reply(200, { board: toBoardView(meta, agents), session });
}

async function listPostsRoute(meta: BoardMetaRow, event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const qs = event.queryStringParameters ?? {};
  if (qs.after) {
    const posts = await listBoardPostsAfter(meta.board_id, qs.after, PAGE_SIZE_MAX);
    return reply(200, { posts });
  }
  const page = await listBoardPosts(meta.board_id, { pageSize: parsePageSize(qs), cursor: qs.cursor });
  return reply(200, page);
}

async function createPostRoute(
  meta: BoardMetaRow,
  session: BoardSession,
  event: APIGatewayProxyEventV2,
  deps: BoardsDeps,
): Promise<APIGatewayProxyResultV2> {
  const body = parseJsonBody(event.body);
  if (!body) return reply(400, { error: "invalid_json" });
  let text: string;
  try {
    text = validateBoardBody(body.body);
  } catch (err) {
    return reply(400, { error: "invalid_body", detail: err instanceof Error ? err.message : String(err) });
  }
  let parent = undefined;
  if (body.reply_to !== undefined) {
    if (typeof body.reply_to !== "string" || body.reply_to.length === 0) {
      return reply(400, { error: "invalid_reply_to" });
    }
    parent = await getBoardPost(meta.board_id, body.reply_to);
    if (!parent || parent.hidden) return reply(400, { error: "invalid_reply_to" });
  }

  const roster = await loadBoardRoster(meta);
  const known = new Set(roster.map((r) => r.slug));
  let mentions = parseMentions(text, known);
  // Replying to an agent's post without naming anyone is addressed to
  // that agent — the Discord reading of "reply".
  if (mentions.length === 0 && parent && parent.author_kind === "agent" && known.has(parent.author)) {
    mentions = [parent.author];
  }

  const created = await createBoardPost({
    board_id: meta.board_id,
    author_kind: "human",
    author: session.nickname,
    body: text,
    ...(parent ? { reply_to: parent } : {}),
    mentions,
    hop: BOARD_HUMAN_HOP,
  });

  const dispatched: string[] = [];
  for (const slug of mentions.slice(0, BOARD_MAX_DISPATCH_PER_POST)) {
    try {
      await deps.dispatchReply({ board_id: meta.board_id, post_id: created.view.post_id, addressed_slug: slug });
      dispatched.push(slug);
    } catch (err) {
      console.error(
        JSON.stringify({
          event: "board_reply_dispatch_failed",
          board_id: meta.board_id,
          post_id: created.view.post_id,
          addressed_slug: slug,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }
  return reply(201, { post: created.view, dispatched });
}

async function patchPostRoute(
  meta: BoardMetaRow,
  postId: string,
  event: APIGatewayProxyEventV2,
  deps: BoardsDeps,
): Promise<APIGatewayProxyResultV2> {
  // Defence in depth behind the API GW AWS_IAM authorizer.
  if (!deps.isIamAuthenticated(event)) return reply(403, { error: "forbidden" });
  const body = parseJsonBody(event.body);
  if (!body || typeof body.hidden !== "boolean") return reply(400, { error: "invalid_hidden" });
  const row = await setBoardPostHidden(meta.board_id, postId, body.hidden);
  if (!row) return reply(404, { error: "not_found", post_id: postId });
  return reply(200, { post: toBoardPostView(row, row.body_preview), hidden: Boolean(row.hidden) });
}

/**
 * Dispatch a board route. Returns undefined when `routeKey` is not a board
 * route so the handler's own 404 fall-through applies.
 */
export async function handleBoardsRoute(
  routeKey: string,
  event: APIGatewayProxyEventV2,
  deps: BoardsDeps,
): Promise<APIGatewayProxyResultV2 | undefined> {
  if (!routeKey.includes(" /boards/")) return undefined;
  const boardId = event.pathParameters?.id ?? "";
  const postId = event.pathParameters?.post_id;
  if (!isValidBoardId(boardId)) return reply(400, { error: "invalid_board_id" });
  const meta = await getBoardMeta(boardId);
  if (!meta) return reply(404, { error: "not_found", board_id: boardId });
  if (meta.archived && routeKey !== "PATCH /boards/{id}/posts/{post_id}") {
    return reply(410, { error: "board_archived", board_id: boardId });
  }

  if (routeKey === "POST /boards/{id}/enter") return enterRoute(meta, event);
  if (routeKey === "PATCH /boards/{id}/posts/{post_id}" && postId) return patchPostRoute(meta, postId, event, deps);

  const session = sessionFromEvent(event, meta);
  if (!session) return reply(401, { error: "invalid_token" });
  if (routeKey === "GET /boards/{id}") return getBoardRoute(meta, session);
  if (routeKey === "GET /boards/{id}/posts") return listPostsRoute(meta, event);
  if (routeKey === "POST /boards/{id}/posts") return createPostRoute(meta, session, event, deps);
  return undefined;
}
