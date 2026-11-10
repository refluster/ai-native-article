// wf-feed-likes-api Lambda handler — 👍 likes on workforce feed posts,
// behind the SAME HTTP API as wf-agents-api (WfAgentsHttpApi).
//
// Routes:
//   POST /feed/{post_id}/like?agent_slug=<author>           feed-write bearer
//        Body { liker }. An agent likes a post — the feed-view Cadence's
//        write-script (workforce/skills/feed-view/like-post.mjs). Like only,
//        never unlike: the Cadence's daily pick IS the record.
//   POST /feed/{post_id}/operator-like?agent_slug=<author>  AWS_IAM at API GW
//        Body { liked: boolean }. The operator's 👍 toggle from the console
//        PostCard. Liker pinned to `operator` server-side, never read from
//        the body, so neither path can forge the other.
//
// Why this is its own function: wf-agents-api sits at its grandfathered
// route ceiling (check-route-permission-budget.mjs ratchet, 51 — Lambda's
// 20 KB resource-policy cap, ML-042). New route families go on their own
// function behind the shared API — the rooms-api shape.
//
// The read side is unchanged and stays on agents-api: GET /feed and
// GET /agents/{slug}/posts carry `likers[]` + `like_count` on every post
// (shared/post.ts:toFeedPostApiView). The two routeKey literals below are
// load-bearing: check-openapi-routes.mjs reads them.

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { timingSafeEqual } from "node:crypto";

import { getItem } from "../shared/ddb.js";
import { FEED_OPERATOR_ID, setPostLike } from "../shared/post.js";

// Same capability token as POST /feed (agents-api validateFeedWriteBearer):
// one secret path, the one every feed Cadence already holds via the
// agent-workforce project bag.
const FEED_WRITE_TOKEN_SECRET = "wf/projects/agent-workforce/workforce.feed_write_token";
const sm = new SecretsManagerClient({});
let _tokenCache: string | undefined;

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
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** Constant-time check of `Authorization: Bearer <token>` against the
 *  feed-write secret. False on any miss (C-4: a misconfigured secret is a
 *  401, never an open door). */
async function validateFeedWriteBearer(event: APIGatewayProxyEventV2): Promise<boolean> {
  const headers = event.headers ?? {};
  const raw = headers.authorization ?? headers.Authorization;
  if (!raw || !raw.startsWith("Bearer ")) return false;
  const presented = raw.slice("Bearer ".length).trim();
  if (presented.length === 0) return false;
  let expected = _tokenCache;
  if (!expected) {
    try {
      const out = await sm.send(new GetSecretValueCommand({ SecretId: FEED_WRITE_TOKEN_SECRET }));
      if (!out.SecretString) return false;
      const v = JSON.parse(out.SecretString) as { token?: unknown };
      if (typeof v.token !== "string" || v.token.length === 0) return false;
      expected = v.token;
      _tokenCache = expected;
    } catch {
      return false;
    }
  }
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** True when API GW's AWS_IAM authorizer resolved a principal. The gateway
 *  already enforces it; this is defence in depth (same as rooms-api). */
function isIamAuthenticated(event: APIGatewayProxyEventV2): boolean {
  const ctx = event.requestContext as unknown as { authorizer?: { iam?: { userArn?: string } } };
  return Boolean(ctx.authorizer?.iam?.userArn);
}

/** Map setPostLike's validation throws to 4xx; anything else → 500. */
function likeErrorReply(err: unknown): APIGatewayProxyResultV2 {
  const msg = err instanceof Error ? err.message : String(err);
  const m = /^setPostLike: (invalid_liker|self_like|post_not_found|post_hidden)/.exec(msg);
  if (!m) throw err;
  return reply(m[1] === "post_not_found" ? 404 : 422, {
    error: "like_rejected",
    detail: msg.replace(/^setPostLike: /, ""),
  });
}

async function agentLike(postId: string, event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  if (!(await validateFeedWriteBearer(event))) {
    return reply(401, { error: "unauthorized", detail: "POST /feed/{post_id}/like requires a valid feed-write bearer token." });
  }
  const author = event.queryStringParameters?.agent_slug;
  if (!author) return reply(400, { error: "missing_agent_slug", detail: "?agent_slug=<post author> is required (POST rows are partitioned by AGENT#)." });
  const liker = parseJsonBody(event.body)?.liker;
  if (typeof liker !== "string" || liker.length === 0) return reply(400, { error: "missing_liker" });
  if (liker === FEED_OPERATOR_ID) return reply(422, { error: "like_rejected", detail: "operator_liker_reserved" });
  // The liker must be a registered agent — the token is shared across the
  // crew, so this is what stops a typo'd slug minting a phantom liker.
  const meta = await getItem<object>(`AGENT#${liker}`, "META");
  if (!meta) return reply(422, { error: "like_rejected", detail: `unknown_liker: "${liker}"` });
  try {
    const likers = await setPostLike({ agent_slug: author, post_id: postId, liker, liked: true });
    return reply(200, { post_id: postId, agent_slug: author, liker, liked: true, likers, like_count: likers.length });
  } catch (err) {
    return likeErrorReply(err);
  }
}

async function operatorLike(postId: string, event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  if (!isIamAuthenticated(event)) return reply(403, { error: "forbidden", detail: "operator-like requires AWS_IAM (SigV4)." });
  const author = event.queryStringParameters?.agent_slug;
  if (!author) return reply(400, { error: "missing_agent_slug", detail: "?agent_slug=<post author> is required (POST rows are partitioned by AGENT#)." });
  const liked = parseJsonBody(event.body)?.liked;
  if (typeof liked !== "boolean") return reply(400, { error: "invalid_liked" });
  try {
    const likers = await setPostLike({ agent_slug: author, post_id: postId, liker: FEED_OPERATOR_ID, liked });
    return reply(200, { post_id: postId, agent_slug: author, liker: FEED_OPERATOR_ID, liked, likers, like_count: likers.length });
  } catch (err) {
    return likeErrorReply(err);
  }
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const routeKey = event.routeKey;
  const postId = event.pathParameters?.post_id;
  try {
    if (routeKey === "POST /feed/{post_id}/like" && postId) return await agentLike(postId, event);
    if (routeKey === "POST /feed/{post_id}/operator-like" && postId) return await operatorLike(postId, event);
    return reply(404, { error: "not_found", routeKey });
  } catch (err) {
    console.error(JSON.stringify({ event: "wf_feed_likes_api_error", routeKey, error: String(err) }));
    return reply(500, { error: "internal_error" });
  }
}
