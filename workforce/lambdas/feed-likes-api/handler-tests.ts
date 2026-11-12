// Unit tests for workforce/lambdas/feed-likes-api/handler.ts — 👍 likes.
//
// Pins: the agent path needs the feed-write bearer + a registered liker,
// cannot self-like or like as the operator, and is idempotent (DynamoDB
// string set); the operator path toggles with the liker pinned to
// `operator` and re-checks the IAM principal; hidden / missing posts are
// refused fail-loud.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";

interface AnyRow { pk: string; sk: string; [k: string]: unknown }
const rows = new Map<string, AnyRow>();
const key = (pk: string, sk: string) => `${pk}|${sk}`;

vi.mock("../shared/ddb.js", () => ({
  getItem: vi.fn(async (pk: string, sk: string) => rows.get(key(pk, sk))),
  // setPostLike's UpdateCommand (ADD / DELETE on the `likers` set),
  // replayed over the in-memory rows map.
  ddb: {
    send: vi.fn(async (cmd: { input: {
      Key: { pk: string; sk: string };
      UpdateExpression: string;
      ExpressionAttributeValues: Record<string, unknown>;
    } }) => {
      const { Key, UpdateExpression, ExpressionAttributeValues } = cmd.input;
      const row = rows.get(key(Key.pk, Key.sk));
      if (!row) throw new Error("ConditionalCheckFailedException");
      const cur = new Set<string>((row.likers as Set<string> | undefined) ?? []);
      for (const w of ExpressionAttributeValues[":liker"] as Set<string>) {
        if (UpdateExpression.startsWith("ADD")) cur.add(w);
        else cur.delete(w);
      }
      if (cur.size > 0) row.likers = cur;
      else delete row.likers;
      return { Attributes: row };
    }),
  },
  putItem: vi.fn(),
  queryByGsiPaged: vi.fn(),
  queryBySkPrefixPaged: vi.fn(),
  updateOperational: vi.fn(),
}));
vi.mock("../shared/project.js", () => ({ selfProjectId: (s: string) => `self/${s}`, appendExecution: vi.fn() }));

const TOKEN = "tok-feed-write-test";
vi.mock("@aws-sdk/client-secrets-manager", () => ({
  SecretsManagerClient: class {
    async send() {
      return { SecretString: JSON.stringify({ token: TOKEN }) };
    }
  },
  GetSecretValueCommand: class {
    constructor(public input: unknown) {}
  },
}));

const { handler } = await import("./handler.js");

const POST_ID = "01LIKETESTPOST000000000000";
const AGENT = "POST /feed/{post_id}/like";
const OPERATOR = "POST /feed/{post_id}/operator-like";

function evt(
  routeKey: string,
  body: unknown,
  opts: { token?: string; author?: string; postId?: string; iam?: boolean } = {},
): APIGatewayProxyEventV2 {
  const postId = opts.postId ?? POST_ID;
  return {
    version: "2.0",
    routeKey,
    rawPath: "/",
    rawQueryString: "",
    headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {},
    requestContext: {
      http: { method: "POST", path: "/" },
      ...(opts.iam === false ? {} : { authorizer: { iam: { userArn: "arn:aws:sts::1:assumed-role/op/x" } } }),
    } as unknown as APIGatewayProxyEventV2["requestContext"],
    pathParameters: { post_id: postId },
    queryStringParameters: opts.author === "" ? {} : { agent_slug: opts.author ?? "maya" },
    body: JSON.stringify(body),
    isBase64Encoded: false,
  } as APIGatewayProxyEventV2;
}
const statusOf = (r: APIGatewayProxyResultV2) => (r as { statusCode: number }).statusCode;
const bodyOf = (r: APIGatewayProxyResultV2) => JSON.parse((r as { body: string }).body) as Record<string, unknown>;
const storedLikers = () =>
  [...((rows.get(key("AGENT#maya", `POST#${POST_ID}`))!.likers as Set<string> | undefined) ?? [])].sort();

beforeEach(() => {
  rows.clear();
  rows.set(key("AGENT#maya", `POST#${POST_ID}`), {
    pk: "AGENT#maya",
    sk: `POST#${POST_ID}`,
    agent_slug: "maya",
    posted_at: "2026-11-10T00:00:00.000Z",
    kind: "observation",
  });
  for (const s of ["dario", "ren", "maya"]) rows.set(key(`AGENT#${s}`, "META"), { pk: `AGENT#${s}`, sk: "META" });
});

describe("POST /feed/{post_id}/like (agent)", () => {
  it("lands in the string set and is idempotent", async () => {
    const r1 = await handler(evt(AGENT, { liker: "dario" }, { token: TOKEN }));
    expect(statusOf(r1)).toBe(200);
    expect(bodyOf(r1)).toMatchObject({ liked: true, likers: ["dario"], like_count: 1 });
    const r2 = await handler(evt(AGENT, { liker: "dario" }, { token: TOKEN }));
    expect(bodyOf(r2)).toMatchObject({ like_count: 1 });
    await handler(evt(AGENT, { liker: "ren" }, { token: TOKEN }));
    expect(storedLikers()).toEqual(["dario", "ren"]);
  });

  it("401s without the feed-write bearer", async () => {
    expect(statusOf(await handler(evt(AGENT, { liker: "dario" })))).toBe(401);
    expect(statusOf(await handler(evt(AGENT, { liker: "dario" }, { token: "nope" })))).toBe(401);
  });

  it("422s a self-like, an unknown liker, and liking as the operator", async () => {
    const self = await handler(evt(AGENT, { liker: "maya" }, { token: TOKEN }));
    expect(statusOf(self)).toBe(422);
    expect(bodyOf(self)).toMatchObject({ detail: "self_like" });
    expect(statusOf(await handler(evt(AGENT, { liker: "nobody" }, { token: TOKEN })))).toBe(422);
    const op = await handler(evt(AGENT, { liker: "operator" }, { token: TOKEN }));
    expect(bodyOf(op)).toMatchObject({ detail: "operator_liker_reserved" });
    expect(storedLikers()).toEqual([]);
  });

  it("404s a missing post; 400s a missing author or liker", async () => {
    expect(statusOf(await handler(evt(AGENT, { liker: "dario" }, { token: TOKEN, postId: "NOPE" })))).toBe(404);
    expect(statusOf(await handler(evt(AGENT, { liker: "dario" }, { token: TOKEN, author: "" })))).toBe(400);
    expect(statusOf(await handler(evt(AGENT, {}, { token: TOKEN })))).toBe(400);
  });

  it("refuses to like a hidden post", async () => {
    rows.get(key("AGENT#maya", `POST#${POST_ID}`))!.visibility = "hidden";
    const res = await handler(evt(AGENT, { liker: "dario" }, { token: TOKEN }));
    expect(bodyOf(res)).toMatchObject({ detail: "post_hidden" });
  });
});

describe("POST /feed/{post_id}/operator-like", () => {
  it("toggles on and off with the liker pinned to operator", async () => {
    const on = await handler(evt(OPERATOR, { liked: true, liker: "dario" }));
    expect(statusOf(on)).toBe(200);
    expect(bodyOf(on)).toMatchObject({ liker: "operator", likers: ["operator"], like_count: 1 });
    const off = await handler(evt(OPERATOR, { liked: false }));
    expect(bodyOf(off)).toMatchObject({ liked: false, likers: [], like_count: 0 });
  });

  it("400s a non-boolean liked and 403s without an IAM principal", async () => {
    expect(statusOf(await handler(evt(OPERATOR, { liked: "yes" })))).toBe(400);
    expect(statusOf(await handler(evt(OPERATOR, { liked: true }, { iam: false })))).toBe(403);
  });
});

it("404s an unknown route", async () => {
  expect(statusOf(await handler(evt("GET /feed", {})))).toBe(404);
});
