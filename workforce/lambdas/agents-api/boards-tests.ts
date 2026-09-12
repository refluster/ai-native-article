// Unit tests for agents-api/boards.ts (ADR-0034) — the guest routes end to
// end through the REAL shared/board.ts (password, token, mentions, row
// shape) over a mocked DDB/S3. Pins: the enter handshake, token gating on
// every read, mention parsing + dispatch fan-out (cap 3, implicit mention
// on a reply to an agent), the poll query shape, and the IAM-only hide.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

const send = vi.fn();
const getItem = vi.fn();
const putItem = vi.fn();
const updateOperational = vi.fn();
const scanAllPrefix = vi.fn();
vi.mock("../shared/ddb.js", () => ({
  ddb: { send: (...args: unknown[]) => send(...args) },
  getItem: (...args: unknown[]) => getItem(...args),
  putItem: (...args: unknown[]) => putItem(...args),
  updateOperational: (...args: unknown[]) => updateOperational(...args),
  scanAllPrefix: (...args: unknown[]) => scanAllPrefix(...args),
}));
vi.mock("../shared/task.js", () => {
  let n = 0;
  return { newUlid: () => `01NEW${String(++n).padStart(3, "0")}` };
});
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    send() {
      return Promise.resolve({});
    }
  },
  GetObjectCommand: class {
    constructor(public input: unknown) {}
  },
  PutObjectCommand: class {
    constructor(public input: unknown) {}
  },
}));
vi.mock("@aws-sdk/lib-dynamodb", () => ({
  QueryCommand: class {
    constructor(public input: Record<string, unknown>) {}
  },
}));

import { hashBoardPassword, mintBoardToken, type BoardMetaRow } from "../shared/board.js";
import { handleBoardsRoute, type BoardsDeps } from "./boards.js";

const AGENTS = [
  { pk: "AGENT#maya", sk: "META", slug: "maya", first_name: "Maya", last_name: "Ishikawa", role: "PM", archived: false },
  { pk: "AGENT#dario", sk: "META", slug: "dario", first_name: "Dario", last_name: "Bianchi", role: "Governance", archived: false },
  { pk: "AGENT#ren", sk: "META", slug: "ren", first_name: "Ren", last_name: "Sato", role: "Engineer", archived: false },
  { pk: "AGENT#sora", sk: "META", slug: "sora", first_name: "Sora", last_name: "K", role: "Writer", archived: false },
  { pk: "AGENT#old", sk: "META", slug: "old", first_name: "Old", last_name: "Timer", role: "Retired", archived: true },
];

let META: BoardMetaRow;
let TOKEN: string;

function event(
  routeKey: string,
  opts: { id?: string; post_id?: string; body?: unknown; token?: string; qs?: Record<string, string>; iam?: boolean } = {},
): APIGatewayProxyEventV2 {
  const [method] = routeKey.split(" ");
  return {
    version: "2.0",
    routeKey,
    rawPath: "",
    rawQueryString: "",
    headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {},
    queryStringParameters: opts.qs,
    pathParameters: { id: opts.id ?? "demo", ...(opts.post_id ? { post_id: opts.post_id } : {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    isBase64Encoded: false,
    requestContext: {
      http: { method, path: "", protocol: "HTTP/1.1", sourceIp: "", userAgent: "" },
      ...(opts.iam ? { authorizer: { iam: { userArn: "arn:aws:iam::1:user/op" } } } : {}),
    } as unknown as APIGatewayProxyEventV2["requestContext"],
  } as APIGatewayProxyEventV2;
}

function parse(res: unknown): { statusCode: number; body: Record<string, unknown> } {
  const r = res as { statusCode: number; body: string };
  return { statusCode: r.statusCode, body: JSON.parse(r.body) as Record<string, unknown> };
}

const dispatchReply = vi.fn();
const deps: BoardsDeps = {
  dispatchReply: (...args: unknown[]) => dispatchReply(...args),
  isIamAuthenticated: (e) => Boolean((e.requestContext as unknown as { authorizer?: { iam?: unknown } }).authorizer?.iam),
};

beforeEach(async () => {
  META = {
    pk: "BOARD#demo",
    sk: "META",
    board_id: "demo",
    name: "Demo board",
    password_salt: "abcd",
    password_hash: await hashBoardPassword("open-sesame", "abcd"),
    archived: false,
    created_at: "2026-09-12T00:00:00.000Z",
  };
  TOKEN = mintBoardToken(META, "Hana");
  send.mockReset();
  send.mockResolvedValue({ Items: [] });
  getItem.mockReset();
  getItem.mockImplementation(async (pk: string, sk: string) => (pk === "BOARD#demo" && sk === "META" ? META : undefined));
  putItem.mockReset();
  putItem.mockResolvedValue(undefined);
  updateOperational.mockReset();
  updateOperational.mockImplementation(async (_pk: string, _sk: string, patch: Record<string, unknown>) => ({ ...patch }));
  scanAllPrefix.mockReset();
  scanAllPrefix.mockResolvedValue(AGENTS);
  dispatchReply.mockReset();
  dispatchReply.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("routing + board resolution", () => {
  it("returns undefined for non-board routes", async () => {
    expect(await handleBoardsRoute("GET /agents", event("GET /agents"), deps)).toBeUndefined();
  });

  it("400s a malformed id, 404s an unknown board, 410s an archived one", async () => {
    expect(parse(await handleBoardsRoute("GET /boards/{id}", event("GET /boards/{id}", { id: "Bad Id!" }), deps)).statusCode).toBe(400);
    expect(parse(await handleBoardsRoute("GET /boards/{id}", event("GET /boards/{id}", { id: "nope" }), deps)).statusCode).toBe(404);
    META = { ...META, archived: true };
    const r = parse(await handleBoardsRoute("POST /boards/{id}/enter", event("POST /boards/{id}/enter", { body: { password: "x", nickname: "y" } }), deps));
    expect(r.statusCode).toBe(410);
  });
});

describe("POST /boards/{id}/enter", () => {
  const route = "POST /boards/{id}/enter";

  it("mints a token and returns the board card with the non-archived roster", async () => {
    const r = parse(await handleBoardsRoute(route, event(route, { body: { password: "open-sesame", nickname: " Hana " } }), deps));
    expect(r.statusCode).toBe(200);
    expect(r.body.nickname).toBe("Hana");
    expect(typeof r.body.token).toBe("string");
    expect(typeof r.body.expires_at).toBe("string");
    const board = r.body.board as { board_id: string; name: string; agents: Array<{ slug: string }> };
    expect(board.board_id).toBe("demo");
    expect(board.name).toBe("Demo board");
    expect(board.agents.map((a) => a.slug)).toEqual(["dario", "maya", "ren", "sora"]);
    // The minted token opens the gated read.
    const g = parse(await handleBoardsRoute("GET /boards/{id}", event("GET /boards/{id}", { token: r.body.token as string }), deps));
    expect(g.statusCode).toBe(200);
    expect((g.body.session as { nickname: string }).nickname).toBe("Hana");
  });

  it("restricts the roster to the board's allowlist", async () => {
    META = { ...META, agents: ["ren", "maya"] };
    const r = parse(await handleBoardsRoute(route, event(route, { body: { password: "open-sesame", nickname: "Hana" } }), deps));
    expect((r.body.board as { agents: Array<{ slug: string }> }).agents.map((a) => a.slug)).toEqual(["maya", "ren"]);
  });

  it("401s the wrong password, 400s a bad nickname or body", async () => {
    expect(parse(await handleBoardsRoute(route, event(route, { body: { password: "wrong", nickname: "Hana" } }), deps))).toMatchObject({
      statusCode: 401,
      body: { error: "invalid_password" },
    });
    expect(parse(await handleBoardsRoute(route, event(route, { body: { password: "open-sesame", nickname: "@maya" } }), deps))).toMatchObject({
      statusCode: 400,
      body: { error: "invalid_nickname" },
    });
    expect(parse(await handleBoardsRoute(route, event(route), deps))).toMatchObject({ statusCode: 400, body: { error: "invalid_json" } });
  });
});

describe("token gate", () => {
  it("401s every gated route without a valid token", async () => {
    for (const route of ["GET /boards/{id}", "GET /boards/{id}/posts", "POST /boards/{id}/posts"]) {
      expect(parse(await handleBoardsRoute(route, event(route), deps)).statusCode).toBe(401);
      expect(parse(await handleBoardsRoute(route, event(route, { token: "garbage" }), deps)).statusCode).toBe(401);
    }
    // A token minted for a different board never opens this one.
    const other = mintBoardToken({ ...META, board_id: "other" }, "Hana");
    expect(parse(await handleBoardsRoute("GET /boards/{id}", event("GET /boards/{id}", { token: other }), deps)).statusCode).toBe(401);
  });
});

describe("GET /boards/{id}/posts", () => {
  const route = "GET /boards/{id}/posts";

  it("serves the newest page in chronological order with an older cursor", async () => {
    send.mockResolvedValueOnce({
      Items: [
        { post_id: "01B", author_kind: "agent", author: "maya", at: "t2", body_preview: "b", root_post_id: "01A", hop: 1, mentions: [] },
        { post_id: "01A", author_kind: "human", author: "Hana", at: "t1", body_preview: "a", root_post_id: "01A", hop: 0, mentions: ["maya"] },
      ],
      LastEvaluatedKey: { pk: "BOARD#demo", sk: "POST#01A" },
    });
    const r = parse(await handleBoardsRoute(route, event(route, { token: TOKEN, qs: { page_size: "2" } }), deps));
    expect(r.statusCode).toBe(200);
    expect((r.body.posts as Array<{ post_id: string }>).map((p) => p.post_id)).toEqual(["01A", "01B"]);
    expect(typeof r.body.older_cursor).toBe("string");
    const q = (send.mock.calls[0]![0] as { input: Record<string, unknown> }).input;
    expect(q.ScanIndexForward).toBe(false);
    expect(q.Limit).toBe(2);
  });

  it("polls strictly after a post id, ascending, and drops hidden rows", async () => {
    send.mockResolvedValueOnce({
      Items: [
        { post_id: "01C", author_kind: "human", author: "Ken", at: "t3", body_preview: "c", root_post_id: "01C", hop: 0, mentions: [], hidden: true },
        { post_id: "01D", author_kind: "agent", author: "maya", at: "t4", body_preview: "d", root_post_id: "01C", hop: 1, mentions: [] },
      ],
    });
    const r = parse(await handleBoardsRoute(route, event(route, { token: TOKEN, qs: { after: "01B" } }), deps));
    expect((r.body.posts as Array<{ post_id: string }>).map((p) => p.post_id)).toEqual(["01D"]);
    const q = (send.mock.calls[0]![0] as { input: Record<string, unknown> }).input;
    expect(q.KeyConditionExpression).toBe("#pk = :pk AND #sk > :after");
    expect((q.ExpressionAttributeValues as Record<string, string>)[":after"]).toBe("POST#01B");
    expect(q.ScanIndexForward).toBe(true);
  });
});

describe("POST /boards/{id}/posts", () => {
  const route = "POST /boards/{id}/posts";

  it("stores the guest post under the token nickname and dispatches each mentioned agent", async () => {
    const r = parse(
      await handleBoardsRoute(route, event(route, { token: TOKEN, body: { body: "Hi @Maya and @dario — how does this work? @nobody" } }), deps),
    );
    expect(r.statusCode).toBe(201);
    expect(r.body.dispatched).toEqual(["maya", "dario"]);
    const post = r.body.post as Record<string, unknown>;
    expect(post).toMatchObject({ author_kind: "human", author: "Hana", hop: 0, mentions: ["maya", "dario"] });
    expect(putItem).toHaveBeenCalledTimes(1);
    expect(putItem.mock.calls[0]![0]).toMatchObject({ pk: "BOARD#demo", author: "Hana", root_post_id: post.post_id });
    expect(updateOperational).toHaveBeenCalledWith("BOARD#demo", "META", expect.objectContaining({ last_post_at: expect.any(String) }));
    expect(dispatchReply).toHaveBeenCalledTimes(2);
    expect(dispatchReply.mock.calls[0]![0]).toEqual({ board_id: "demo", post_id: post.post_id, addressed_slug: "maya" });
  });

  it("caps dispatch at three agents per post (the fourth mention is stored, not summoned)", async () => {
    const r = parse(await handleBoardsRoute(route, event(route, { token: TOKEN, body: { body: "@maya @dario @ren @sora all of you" } }), deps));
    expect((r.body.post as { mentions: string[] }).mentions).toEqual(["maya", "dario", "ren", "sora"]);
    expect(r.body.dispatched).toEqual(["maya", "dario", "ren"]);
  });

  it("treats a reply to an agent's post with no mention as addressed to that agent, and denormalises the quote", async () => {
    getItem.mockImplementation(async (pk: string, sk: string) => {
      if (sk === "META") return META;
      if (sk === "POST#01P") {
        return {
          pk, sk, post_id: "01P", board_id: "demo", author_kind: "agent", author: "maya", at: "t",
          body_preview: "Here is how it works.", root_post_id: "01Q", hop: 1, mentions: [],
        };
      }
      return undefined;
    });
    const r = parse(await handleBoardsRoute(route, event(route, { token: TOKEN, body: { body: "Thanks, and what about cost?", reply_to: "01P" } }), deps));
    expect(r.statusCode).toBe(201);
    expect(r.body.dispatched).toEqual(["maya"]);
    expect(r.body.post).toMatchObject({
      reply_to: "01P",
      reply_to_author: "maya",
      reply_to_author_kind: "agent",
      reply_to_preview: "Here is how it works.",
      hop: 0,
    });
    // A human post always starts a fresh cascade.
    expect(putItem.mock.calls[0]![0].root_post_id).toBe((r.body.post as { post_id: string }).post_id);
  });

  it("keeps the post when dispatch fails (best-effort), and validates body + reply_to", async () => {
    dispatchReply.mockRejectedValueOnce(new Error("lambda down"));
    const ok = parse(await handleBoardsRoute(route, event(route, { token: TOKEN, body: { body: "@maya hello" } }), deps));
    expect(ok.statusCode).toBe(201);
    expect(ok.body.dispatched).toEqual([]);
    expect(putItem).toHaveBeenCalledTimes(1);

    expect(parse(await handleBoardsRoute(route, event(route, { token: TOKEN, body: { body: "   " } }), deps))).toMatchObject({
      statusCode: 400,
      body: { error: "invalid_body" },
    });
    expect(parse(await handleBoardsRoute(route, event(route, { token: TOKEN, body: { body: "x".repeat(4001) } }), deps)).statusCode).toBe(400);
    expect(parse(await handleBoardsRoute(route, event(route, { token: TOKEN, body: { body: "hi", reply_to: "01MISSING" } }), deps))).toMatchObject({
      statusCode: 400,
      body: { error: "invalid_reply_to" },
    });
  });
});

describe("PATCH /boards/{id}/posts/{post_id}", () => {
  const route = "PATCH /boards/{id}/posts/{post_id}";

  it("is operator-only and hides the row", async () => {
    getItem.mockImplementation(async (pk: string, sk: string) => {
      if (sk === "META") return META;
      if (sk === "POST#01P") return { pk, sk, post_id: "01P", board_id: "demo", author_kind: "human", author: "Troll", at: "t", body_preview: "spam", root_post_id: "01P", hop: 0, mentions: [] };
      return undefined;
    });
    expect(parse(await handleBoardsRoute(route, event(route, { post_id: "01P", body: { hidden: true } }), deps)).statusCode).toBe(403);
    const r = parse(await handleBoardsRoute(route, event(route, { post_id: "01P", body: { hidden: true }, iam: true }), deps));
    expect(r.statusCode).toBe(200);
    expect(updateOperational).toHaveBeenCalledWith("BOARD#demo", "POST#01P", { hidden: true });
    expect(parse(await handleBoardsRoute(route, event(route, { post_id: "01ZZ", body: { hidden: true }, iam: true }), deps)).statusCode).toBe(404);
    expect(parse(await handleBoardsRoute(route, event(route, { post_id: "01P", body: { hidden: "yes" }, iam: true }), deps)).statusCode).toBe(400);
  });
});
