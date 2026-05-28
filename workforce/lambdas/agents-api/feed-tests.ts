// Unit tests for workforce/lambdas/agents-api/handler.ts — feed routes.
//
// Epic-011 Story 5 (#132). The handler under test wires four routes:
//   GET   /feed                  reverse-chrono across all agents
//   GET   /feed/{post_id}        one post + full body
//   GET   /agents/{slug}/posts   per-agent stream, partition-scoped
//   PATCH /feed/{post_id}        operator-only hide (IAM-auth at API GW)
//
// These tests target the handler-layer concerns:
//
//   - Routekey dispatch correctness
//   - Pagination cursor round-trip (30 synthetic posts × pageSize=10 →
//     three pages with no duplicates / no gaps — locks the AC for
//     "pagination correctness for 30-post / 10-per-page" from #132)
//   - Hidden-post default exclusion + ?include_hidden=true admission
//   - PATCH 400 paths (missing reason, empty body, wrong visibility,
//     missing agent_slug)
//   - PATCH calls the (stubbed) `hidePost` helper from shared/post.ts
//     and propagates its throw — locks the Story 4 (#131) sequencing
//     contract: the API route fails LOUDLY until the helper lands rather
//     than silently no-op'ing
//   - body_preview vs body hydration (≤320 chars cheap-paths the S3
//     fetch; longer bodies invoke fetchPostBody)
//
// CORS-origin enforcement is not tested at the handler layer — that
// gate lives in API Gateway's CorsConfiguration (`AllowOrigins`). The
// handler does not see rejected origins; the SAM template carries the
// enforcement. We assert in this file that the handler emits the
// permissive `access-control-allow-origin: *` header — API GW overrides
// that with the configured origin before the response leaves the edge.
// (Pattern mirrors agents-api's existing tests.)

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";

// ─── DDB fakes ─────────────────────────────────────────────────────────

interface AnyRow {
  pk: string;
  sk: string;
  [k: string]: unknown;
}
const rows = new Map<string, AnyRow>();
const key = (pk: string, sk: string) => `${pk}|${sk}`;

// Track GSI query inputs so pagination tests can assert ScanIndexForward + the
// cursor round-trip.
interface PagedCall {
  index: string;
  pk: string;
  cursor?: string;
  scanIndexForward?: boolean;
  limit?: number;
}
const pagedGsiCalls: PagedCall[] = [];
const pagedSkCalls: PagedCall[] = [];

vi.mock("../shared/ddb.js", () => ({
  getItem: vi.fn(async <T extends object>(pk: string, sk: string): Promise<T | undefined> => {
    return rows.get(key(pk, sk)) as T | undefined;
  }),
  queryBySkPrefix: vi.fn(async <T extends object>(pk: string, skPrefix: string, _limit?: number): Promise<T[]> => {
    return Array.from(rows.values()).filter(
      (r) => r.pk === pk && typeof r.sk === "string" && r.sk.startsWith(skPrefix),
    ) as T[];
  }),
  scanPrefix: vi.fn(
    async <T extends object>(pkPrefix: string, sk: string, limit: number, _cursor?: string) => {
      const items = Array.from(rows.values()).filter(
        (r) => r.pk.startsWith(pkPrefix) && r.sk === sk,
      );
      return { items: items.slice(0, limit) as T[], cursor: undefined };
    },
  ),
  queryByGsi: vi.fn(async () => []),
  updateOperational: vi.fn(),
  // The two new paged helpers under test in this file. We replicate the
  // GSI3 / partition behaviour over the in-memory `rows` map, with a
  // synthetic cursor so the round-trip locks the AC for pagination.
  queryByGsiPaged: vi.fn(
    async <T extends object>(
      indexName: string,
      pk: string,
      query: {
        limit?: number;
        cursor?: string;
        scanIndexForward?: boolean;
        skGte?: string;
        skLte?: string;
      } = {},
    ) => {
      pagedGsiCalls.push({
        index: indexName,
        pk,
        cursor: query.cursor,
        scanIndexForward: query.scanIndexForward,
        limit: query.limit,
      });
      const pkAttr = indexName === "GSI3" ? "gsi3pk" : `${indexName.toLowerCase()}pk`;
      const skAttr = indexName === "GSI3" ? "gsi3sk" : `${indexName.toLowerCase()}sk`;
      const all = Array.from(rows.values())
        .filter((r) => r[pkAttr] === pk)
        .filter((r) => {
          const skv = r[skAttr];
          if (typeof skv !== "string") return false;
          if (query.skGte && skv < query.skGte) return false;
          if (query.skLte && skv > query.skLte) return false;
          return true;
        })
        .sort((a, b) => {
          const av = a[skAttr] as string;
          const bv = b[skAttr] as string;
          return query.scanIndexForward === false ? bv.localeCompare(av) : av.localeCompare(bv);
        });
      const startIdx = query.cursor ? parseInt(Buffer.from(query.cursor, "base64url").toString("utf8"), 10) : 0;
      const limit = query.limit ?? 100;
      const slice = all.slice(startIdx, startIdx + limit);
      const nextIdx = startIdx + slice.length;
      const cursor = nextIdx < all.length ? Buffer.from(String(nextIdx)).toString("base64url") : undefined;
      return { items: slice as T[], cursor };
    },
  ),
  queryBySkPrefixPaged: vi.fn(
    async <T extends object>(
      pk: string,
      skPrefix: string,
      limit = 100,
      cursor?: string,
      scanIndexForward = true,
    ) => {
      pagedSkCalls.push({ index: "PARTITION", pk, cursor, scanIndexForward, limit });
      const all = Array.from(rows.values())
        .filter((r) => r.pk === pk && typeof r.sk === "string" && (r.sk as string).startsWith(skPrefix))
        .sort((a, b) => {
          const av = a.sk as string;
          const bv = b.sk as string;
          return scanIndexForward ? av.localeCompare(bv) : bv.localeCompare(av);
        });
      const startIdx = cursor ? parseInt(Buffer.from(cursor, "base64url").toString("utf8"), 10) : 0;
      const slice = all.slice(startIdx, startIdx + limit);
      const nextIdx = startIdx + slice.length;
      const next = nextIdx < all.length ? Buffer.from(String(nextIdx)).toString("base64url") : undefined;
      return { items: slice as T[], cursor: next };
    },
  ),
}));

// ─── S3 fake — fetchPostBody short-path ────────────────────────────────

const s3BodyStore = new Map<string, string>();

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    async send(cmd: { input: { Bucket: string; Key: string } }) {
      const body = s3BodyStore.get(cmd.input.Key);
      if (!body) {
        return { Body: undefined };
      }
      return {
        Body: {
          transformToString: async () => body,
        },
      };
    }
  },
  GetObjectCommand: class {
    input: { Bucket: string; Key: string };
    constructor(input: { Bucket: string; Key: string }) {
      this.input = input;
    }
  },
}));

// BUCKET_NAME is required by shared/post.ts on import for fetchPostBody.
process.env.BUCKET_NAME = "wf-bucket-test";

// Stubs for the other agents-api imports.
vi.mock("../shared/agent.js", () => ({
  agentPk: (slug: string) => `AGENT#${slug}`,
  toApiView: (r: { slug?: string }) => ({ slug: r.slug }),
}));
vi.mock("../shared/skill-row.js", () => ({
  skillPk: (name: string) => `SKILL#${name}`,
  toSkillApiView: (r: { name?: string }) => ({ name: r.name }),
}));
vi.mock("../shared/project.js", () => ({
  asProjectId: (s: string) => {
    if (!s || s.includes("#") || s.includes("|")) throw new Error("invalid");
    return s;
  },
  projectPk: (id: string) => `PROJECT#${id}`,
}));

const { handler } = await import("./handler.js");

// ─── Helpers ───────────────────────────────────────────────────────────

function evt(
  routeKey: string,
  pathParams: Record<string, string> = {},
  qs: Record<string, string> = {},
  body?: string,
  authorizerIam?: { userArn?: string; userId?: string },
): APIGatewayProxyEventV2 {
  const reqCtx: {
    http: { method: string; path: string };
    authorizer?: { iam?: { userArn?: string; userId?: string } };
  } = {
    http: {
      method: routeKey.split(" ")[0] ?? "GET",
      path: routeKey.split(" ")[1] ?? "/",
    },
  };
  if (authorizerIam) reqCtx.authorizer = { iam: authorizerIam };
  return {
    version: "2.0",
    routeKey,
    rawPath: routeKey.split(" ")[1] ?? "/",
    rawQueryString: "",
    headers: {},
    requestContext: reqCtx as unknown as APIGatewayProxyEventV2["requestContext"],
    pathParameters: pathParams,
    queryStringParameters: qs,
    body,
    isBase64Encoded: false,
  } as APIGatewayProxyEventV2;
}

function bodyOf(res: APIGatewayProxyResultV2): unknown {
  if (typeof res === "string") return JSON.parse(res);
  const obj = res as { body?: string };
  return obj.body ? JSON.parse(obj.body) : undefined;
}
function statusOf(res: APIGatewayProxyResultV2): number {
  if (typeof res === "string") return 200;
  return (res as { statusCode?: number }).statusCode ?? 200;
}

function seedPost(opts: {
  agent_slug: string;
  ulid: string;
  posted_at: string;
  kind?: "reflection" | "friction" | "improvement" | "observation";
  body_preview?: string;
  body_ref?: string;
  visibility?: "workforce" | "hidden";
  references?: string[];
  full_body?: string;
}) {
  const sk = `POST#${opts.ulid}`;
  const bodyRef = opts.body_ref ?? `posts/${opts.agent_slug}/2026/05/${opts.ulid}.md`;
  rows.set(key(`AGENT#${opts.agent_slug}`, sk), {
    pk: `AGENT#${opts.agent_slug}`,
    sk,
    agent_slug: opts.agent_slug,
    posted_at: opts.posted_at,
    kind: opts.kind ?? "reflection",
    body_ref: bodyRef,
    body_preview: opts.body_preview ?? "preview text under three twenty chars",
    references: opts.references ?? [],
    finish_reason: "end_turn",
    tokens_in: 100,
    tokens_out: 50,
    skill_version: "0.1.0",
    gsi3pk: "FEED",
    gsi3sk: opts.posted_at,
    visibility: opts.visibility,
  });
  if (opts.full_body !== undefined) {
    s3BodyStore.set(bodyRef, opts.full_body);
  }
}

beforeEach(() => {
  rows.clear();
  s3BodyStore.clear();
  pagedGsiCalls.length = 0;
  pagedSkCalls.length = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─── GET /feed ─────────────────────────────────────────────────────────

describe("GET /feed (listFeedRoute)", () => {
  it("returns posts reverse-chrono with API-shaped views", async () => {
    seedPost({ agent_slug: "ren", ulid: "01A", posted_at: "2026-05-25T00:00:00.000Z" });
    seedPost({ agent_slug: "maya", ulid: "01B", posted_at: "2026-05-26T00:00:00.000Z" });
    seedPost({ agent_slug: "ren", ulid: "01C", posted_at: "2026-05-27T00:00:00.000Z" });

    const res = await handler(evt("GET /feed"));
    expect(statusOf(res)).toBe(200);
    const body = bodyOf(res) as {
      posts: Array<{ post_id: string; agent_slug: string; posted_at: string }>;
    };
    // Reverse-chrono — latest first
    expect(body.posts.map((p) => p.post_id)).toEqual(["01C", "01B", "01A"]);
    expect(body.posts[0]!.agent_slug).toBe("ren");
    // GSI3 was queried with ScanIndexForward=false
    expect(pagedGsiCalls).toHaveLength(1);
    expect(pagedGsiCalls[0]!.scanIndexForward).toBe(false);
    expect(pagedGsiCalls[0]!.pk).toBe("FEED");
    expect(pagedGsiCalls[0]!.index).toBe("GSI3");
  });

  it("?kind= post-filters by kind", async () => {
    seedPost({ agent_slug: "ren", ulid: "01A", posted_at: "2026-05-25T00:00:00.000Z", kind: "reflection" });
    seedPost({ agent_slug: "maya", ulid: "01B", posted_at: "2026-05-26T00:00:00.000Z", kind: "friction" });
    const res = await handler(evt("GET /feed", {}, { kind: "friction" }));
    const body = bodyOf(res) as { posts: Array<{ post_id: string }> };
    expect(body.posts.map((p) => p.post_id)).toEqual(["01B"]);
  });

  it("?agent_slug= post-filters by agent", async () => {
    seedPost({ agent_slug: "ren", ulid: "01A", posted_at: "2026-05-25T00:00:00.000Z" });
    seedPost({ agent_slug: "maya", ulid: "01B", posted_at: "2026-05-26T00:00:00.000Z" });
    const res = await handler(evt("GET /feed", {}, { agent_slug: "maya" }));
    const body = bodyOf(res) as { posts: Array<{ post_id: string }> };
    expect(body.posts.map((p) => p.post_id)).toEqual(["01B"]);
  });

  it("excludes hidden posts by default; includes them under ?include_hidden=true", async () => {
    seedPost({ agent_slug: "ren", ulid: "01A", posted_at: "2026-05-25T00:00:00.000Z" });
    seedPost({
      agent_slug: "ren",
      ulid: "01B",
      posted_at: "2026-05-26T00:00:00.000Z",
      visibility: "hidden",
    });

    const defaultRes = await handler(evt("GET /feed"));
    const defaultBody = bodyOf(defaultRes) as { posts: Array<{ post_id: string }> };
    expect(defaultBody.posts.map((p) => p.post_id)).toEqual(["01A"]);

    const withHidden = await handler(evt("GET /feed", {}, { include_hidden: "true" }));
    const withHiddenBody = bodyOf(withHidden) as {
      posts: Array<{ post_id: string; visibility?: string }>;
    };
    expect(withHiddenBody.posts.map((p) => p.post_id)).toEqual(["01B", "01A"]);
    const hidden = withHiddenBody.posts.find((p) => p.post_id === "01B");
    expect(hidden?.visibility).toBe("hidden");
  });

  it("references classify by row-family prefix", async () => {
    seedPost({
      agent_slug: "ren",
      ulid: "01A",
      posted_at: "2026-05-25T00:00:00.000Z",
      references: ["EXEC#01EX", "DELIV#01DV", "TASK#01TK", "01BARE"],
    });
    const res = await handler(evt("GET /feed"));
    const body = bodyOf(res) as {
      posts: Array<{ references: Array<{ type: string; id: string; accessible: boolean }> }>;
    };
    const refs = body.posts[0]!.references;
    expect(refs).toEqual([
      { type: "EXEC", id: "01EX", accessible: true },
      { type: "DELIV", id: "01DV", accessible: true },
      { type: "TASK", id: "01TK", accessible: true },
      { type: "other", id: "01BARE", accessible: true },
    ]);
  });

  it("?page_size= clamps to 100 max + 1 min", async () => {
    seedPost({ agent_slug: "ren", ulid: "01A", posted_at: "2026-05-25T00:00:00.000Z" });
    await handler(evt("GET /feed", {}, { page_size: "9999" }));
    expect(pagedGsiCalls[0]!.limit).toBe(100);
    await handler(evt("GET /feed", {}, { page_size: "0" }));
    expect(pagedGsiCalls[1]!.limit).toBe(25); // 0 → default 25
    await handler(evt("GET /feed", {}, { page_size: "5" }));
    expect(pagedGsiCalls[2]!.limit).toBe(5);
  });

  // The Story #132 AC: "pagination correctness for 30 synthetic posts in
  // pages of 10 returns all 30 in correct order with no duplicates."
  it("pages through 30 posts in pages of 10 with no duplicates and reverse-chrono ordering", async () => {
    for (let i = 0; i < 30; i++) {
      // Two-digit pad so lex sort matches numeric sort
      const stamp = `2026-05-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`;
      seedPost({ agent_slug: "ren", ulid: `01${String(i).padStart(2, "0")}`, posted_at: stamp });
    }

    const collected: string[] = [];
    let cursor: string | undefined = undefined;
    let pages = 0;
    do {
      const qs: Record<string, string> = { page_size: "10" };
      if (cursor) qs.cursor = cursor;
      const res = await handler(evt("GET /feed", {}, qs));
      const body = bodyOf(res) as { posts: Array<{ post_id: string }>; cursor?: string };
      collected.push(...body.posts.map((p) => p.post_id));
      cursor = body.cursor;
      pages++;
      if (pages > 10) throw new Error("pagination did not terminate");
    } while (cursor);

    expect(pages).toBe(3);
    expect(collected).toHaveLength(30);
    expect(new Set(collected).size).toBe(30); // no duplicates
    // Reverse-chrono — last-seeded ulid 0129 corresponds to 2026-05-30 (latest)
    expect(collected[0]).toBe("0129");
    expect(collected[collected.length - 1]).toBe("0100");
  });
});

// ─── GET /agents/{slug}/posts ──────────────────────────────────────────

describe("GET /agents/{slug}/posts (listAgentPostsRoute)", () => {
  it("returns only the requested agent's posts (partition-scoped)", async () => {
    seedPost({ agent_slug: "ren", ulid: "01A", posted_at: "2026-05-25T00:00:00.000Z" });
    seedPost({ agent_slug: "ren", ulid: "01C", posted_at: "2026-05-27T00:00:00.000Z" });
    seedPost({ agent_slug: "maya", ulid: "01B", posted_at: "2026-05-26T00:00:00.000Z" });

    const res = await handler(evt("GET /agents/{slug}/posts", { slug: "ren" }));
    expect(statusOf(res)).toBe(200);
    const body = bodyOf(res) as { posts: Array<{ post_id: string; agent_slug: string }> };
    expect(body.posts.map((p) => p.post_id)).toEqual(["01C", "01A"]);
    expect(body.posts.every((p) => p.agent_slug === "ren")).toBe(true);
    // Partition query (NOT GSI3) — confirms the partition-scoped path
    expect(pagedSkCalls).toHaveLength(1);
    expect(pagedSkCalls[0]!.pk).toBe("AGENT#ren");
    expect(pagedSkCalls[0]!.scanIndexForward).toBe(false);
  });

  it("hidden posts excluded by default; included under ?include_hidden=true", async () => {
    seedPost({ agent_slug: "ren", ulid: "01A", posted_at: "2026-05-25T00:00:00.000Z" });
    seedPost({ agent_slug: "ren", ulid: "01B", posted_at: "2026-05-26T00:00:00.000Z", visibility: "hidden" });
    const defaultRes = await handler(evt("GET /agents/{slug}/posts", { slug: "ren" }));
    expect((bodyOf(defaultRes) as { posts: unknown[] }).posts).toHaveLength(1);
    const withHidden = await handler(
      evt("GET /agents/{slug}/posts", { slug: "ren" }, { include_hidden: "true" }),
    );
    expect((bodyOf(withHidden) as { posts: unknown[] }).posts).toHaveLength(2);
  });

  it("returns 200 with empty posts for an agent with no posts", async () => {
    const res = await handler(evt("GET /agents/{slug}/posts", { slug: "ghost" }));
    expect(statusOf(res)).toBe(200);
    expect((bodyOf(res) as { posts: unknown[] }).posts).toEqual([]);
  });
});

// ─── GET /feed/{post_id} ──────────────────────────────────────────────

describe("GET /feed/{post_id} (getFeedPostRoute)", () => {
  it("returns 400 when ?agent_slug= is missing", async () => {
    const res = await handler(evt("GET /feed/{post_id}", { post_id: "01A" }));
    expect(statusOf(res)).toBe(400);
    expect(bodyOf(res)).toMatchObject({ error: "missing_agent_slug" });
  });

  it("returns 404 for a ghost post", async () => {
    const res = await handler(
      evt("GET /feed/{post_id}", { post_id: "01GHOST" }, { agent_slug: "ren" }),
    );
    expect(statusOf(res)).toBe(404);
    expect(bodyOf(res)).toMatchObject({ error: "not_found" });
  });

  it("short bodies (≤320 chars) skip the S3 fetch", async () => {
    const shortPreview = "short body inline";
    seedPost({
      agent_slug: "ren",
      ulid: "01A",
      posted_at: "2026-05-25T00:00:00.000Z",
      body_preview: shortPreview,
      full_body: "SHOULD NOT BE FETCHED",
    });
    const res = await handler(
      evt("GET /feed/{post_id}", { post_id: "01A" }, { agent_slug: "ren" }),
    );
    expect(statusOf(res)).toBe(200);
    const body = bodyOf(res) as { body: string; body_preview: string };
    expect(body.body).toBe(shortPreview);
    expect(body.body_preview).toBe(shortPreview);
  });

  it("long bodies hydrate from S3", async () => {
    const longPreview = "x".repeat(320); // exactly the preview cap → fetch
    const fullBody = "x".repeat(800);
    seedPost({
      agent_slug: "ren",
      ulid: "01A",
      posted_at: "2026-05-25T00:00:00.000Z",
      body_preview: longPreview,
      full_body: fullBody,
    });
    const res = await handler(
      evt("GET /feed/{post_id}", { post_id: "01A" }, { agent_slug: "ren" }),
    );
    expect(statusOf(res)).toBe(200);
    const body = bodyOf(res) as { body: string };
    expect(body.body).toBe(fullBody);
  });

  it("hidden post is returned by detail (preserves audit trail) with visibility badge", async () => {
    seedPost({
      agent_slug: "ren",
      ulid: "01A",
      posted_at: "2026-05-25T00:00:00.000Z",
      visibility: "hidden",
    });
    const res = await handler(
      evt("GET /feed/{post_id}", { post_id: "01A" }, { agent_slug: "ren" }),
    );
    expect(statusOf(res)).toBe(200);
    expect(bodyOf(res)).toMatchObject({ visibility: "hidden" });
  });
});

// ─── PATCH /feed/{post_id} ────────────────────────────────────────────

describe("PATCH /feed/{post_id} (patchFeedPostRoute)", () => {
  // Note: AWS_IAM signature rejection happens at API GW (not at the
  // handler layer). The handler is invoked only after the signature
  // validates. The infra contract is locked in the SAM template
  // (Events.PatchFeedPost.Auth.Authorizer: AWS_IAM).
  //
  // What the handler IS responsible for:
  //   - 400 on missing body / bad JSON / missing reason / unsupported
  //     visibility / missing agent_slug
  //   - calling the (stubbed) hidePost helper from shared/post.ts
  //   - propagating the helper's throw — Story 4 (#131) fills in the
  //     implementation; until then, the route surfaces a 500 with
  //     `hide_helper_not_wired`, which is the Story 5 task brief's
  //     explicit contract

  function patchEvt(body?: string, qs?: Record<string, string>) {
    return evt(
      "PATCH /feed/{post_id}",
      { post_id: "01A" },
      qs ?? { agent_slug: "ren" },
      body,
      { userArn: "arn:aws:iam::123:user/operator", userId: "AIDAEXAMPLE" },
    );
  }

  it("returns 400 when ?agent_slug= is missing", async () => {
    const res = await handler(
      evt(
        "PATCH /feed/{post_id}",
        { post_id: "01A" },
        {},
        JSON.stringify({ visibility: "hidden", reason: "leaked secret" }),
        { userArn: "arn:aws:iam::123:user/operator" },
      ),
    );
    expect(statusOf(res)).toBe(400);
    expect(bodyOf(res)).toMatchObject({ error: "missing_agent_slug" });
  });

  it("returns 400 when the body is missing", async () => {
    const res = await handler(patchEvt(undefined));
    expect(statusOf(res)).toBe(400);
    expect(bodyOf(res)).toMatchObject({ error: "missing_body" });
  });

  it("returns 400 when the body is malformed JSON", async () => {
    const res = await handler(patchEvt("{not json"));
    expect(statusOf(res)).toBe(400);
    expect(bodyOf(res)).toMatchObject({ error: "invalid_json" });
  });

  it("returns 400 when `visibility` is not `hidden`", async () => {
    const res = await handler(patchEvt(JSON.stringify({ visibility: "workforce", reason: "x" })));
    expect(statusOf(res)).toBe(400);
    expect(bodyOf(res)).toMatchObject({ error: "unsupported_visibility" });
  });

  it("returns 400 when `reason` is missing", async () => {
    const res = await handler(patchEvt(JSON.stringify({ visibility: "hidden" })));
    expect(statusOf(res)).toBe(400);
    expect(bodyOf(res)).toMatchObject({ error: "missing_reason" });
  });

  it("returns 400 when `reason` is an empty string", async () => {
    const res = await handler(patchEvt(JSON.stringify({ visibility: "hidden", reason: "   " })));
    expect(statusOf(res)).toBe(400);
    expect(bodyOf(res)).toMatchObject({ error: "missing_reason" });
  });

  // The "hide_helper_not_wired" sequencing test from Story 5 (#157) was
  // retired by Story 4 (#156) when the real hidePost helper landed. The
  // 500-mapping path is now covered by the hidePost-fails-loudly path in
  // shared/post-tests.ts (e.g. missing-row throws), not via this stub.
});

// ─── CORS posture ──────────────────────────────────────────────────────

describe("CORS posture (Epic-011 Story 5 — handler-layer header check)", () => {
  // The CORS gate that limits browser origins to `workforce.kohuehara.xyz`
  // lives in API Gateway (CorsConfiguration.AllowOrigins in the SAM
  // template). The handler doesn't see the rejection — API GW responds
  // 403 to the preflight before the Lambda is invoked. What we CAN check
  // at the handler layer: the response header shape is consistent across
  // all routes so the API GW CORS override has a clean surface to operate
  // on. (The actual origin restriction is asserted by the SAM template
  // diff; that's a CFN-level integration test, not a unit test.)
  it("includes a permissive access-control-allow-origin header on /feed (API GW overrides)", async () => {
    const res = await handler(evt("GET /feed"));
    const headers = (res as { headers?: Record<string, string> }).headers ?? {};
    expect(headers["access-control-allow-origin"]).toBe("*");
  });
});
