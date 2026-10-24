// Unit tests for rooms-api/handler.ts — the thin wf-rooms-api entry point.
// The route logic itself is pinned by ./routes-tests.ts; this file pins the
// seam: each of the six route keys reaches the routes module with the deps
// the handler owns, an unknown key is a 404 (never a fall-through into the
// module), a throw is a 500, and the dispatch dep async-invokes the debate
// Lambda named by ROOM_DEBATE_FUNCTION with the run's payload as-is.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";

const { handleRoomsRoute, lambdaSend, cwSend } = vi.hoisted(() => ({
  handleRoomsRoute: vi.fn(),
  lambdaSend: vi.fn(),
  cwSend: vi.fn(),
}));

vi.mock("./routes.js", () => ({ handleRoomsRoute }));
vi.mock("@aws-sdk/client-lambda", () => ({
  LambdaClient: class {
    send = lambdaSend;
  },
  InvokeCommand: class {
    kind = "invoke";
    constructor(public input: Record<string, unknown>) {}
  },
}));
vi.mock("@aws-sdk/client-cloudwatch", () => ({
  CloudWatchClient: class {
    send = cwSend;
  },
  PutMetricDataCommand: class {
    kind = "metric";
    constructor(public input: Record<string, unknown>) {}
  },
}));

import { handler } from "./handler.js";
import type { RoomTurnDispatch, RoomsDeps } from "./routes.js";

const ROUTE_KEYS = [
  "GET /rooms",
  "GET /rooms/{id}",
  "POST /rooms",
  "POST /rooms/{id}/turns",
  "POST /rooms/{id}/conclude",
  "PATCH /rooms/{id}",
] as const;

function event(routeKey: string, userArn?: string): APIGatewayProxyEventV2 {
  return {
    routeKey,
    pathParameters: { id: "01J00000000000000000000001" },
    requestContext: {
      http: { method: routeKey.split(" ")[0], path: "/rooms" },
      ...(userArn ? { authorizer: { iam: { userArn } } } : {}),
    },
  } as unknown as APIGatewayProxyEventV2;
}

async function call(ev: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  return (await handler(ev)) as APIGatewayProxyStructuredResultV2;
}

/** The deps object the handler passed to the routes module on its last call. */
function lastDeps(): RoomsDeps {
  const args = handleRoomsRoute.mock.calls.at(-1);
  if (!args) throw new Error("handleRoomsRoute was not called");
  return args[2] as RoomsDeps;
}

const PAYLOAD: RoomTurnDispatch = {
  room_id: "01J00000000000000000000001",
  run_id: "01J00000000000000000000002",
  speaker: "maya",
  round: 1,
  kind: "statement",
  then: [
    { speaker: "ren", round: 1, kind: "statement" },
    { speaker: "maya", round: 2, kind: "conclusion" },
  ],
};

beforeEach(() => {
  handleRoomsRoute.mockReset();
  lambdaSend.mockReset();
  cwSend.mockReset();
  cwSend.mockResolvedValue({});
  process.env.ROOM_DEBATE_FUNCTION = "wf-room-debate-test";
});

afterEach(() => {
  delete process.env.ROOM_DEBATE_FUNCTION;
  vi.restoreAllMocks();
});

describe("rooms-api handler — routing", () => {
  it.each(ROUTE_KEYS)("dispatches %s to the routes module", async (routeKey) => {
    handleRoomsRoute.mockResolvedValue({ statusCode: 200, body: JSON.stringify({ ok: routeKey }) });
    const ev = event(routeKey);
    const res = await call(ev);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ ok: routeKey });
    expect(handleRoomsRoute).toHaveBeenCalledTimes(1);
    expect(handleRoomsRoute).toHaveBeenCalledWith(routeKey, ev, expect.any(Object));
    const deps = lastDeps();
    expect(typeof deps.dispatchTurn).toBe("function");
    expect(typeof deps.isIamAuthenticated).toBe("function");
  });

  it("returns 404 route_not_found for an unknown route key without calling the module", async () => {
    const res = await call(event("GET /agents"));
    expect(res.statusCode).toBe(404);
    expect(res.headers).toMatchObject({ "content-type": "application/json", "access-control-allow-origin": "*" });
    expect(JSON.parse(res.body as string)).toEqual({ error: "route_not_found", routeKey: "GET /agents" });
    expect(handleRoomsRoute).not.toHaveBeenCalled();
  });

  it("returns 404 when the module declines a room key (undefined)", async () => {
    handleRoomsRoute.mockResolvedValue(undefined);
    const res = await call(event("POST /rooms/{id}/conclude"));
    expect(res.statusCode).toBe(404);
  });

  it("maps a throw in the module to 500 internal with a structured log", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    handleRoomsRoute.mockRejectedValue(new Error("ddb down"));
    const res = await call(event("GET /rooms"));
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body as string)).toMatchObject({ error: "internal", message: "ddb down" });
    const logged = JSON.parse(String(err.mock.calls[0]?.[0]));
    expect(logged).toMatchObject({ event: "rooms_api_unhandled", route_key: "GET /rooms", error: "ddb down" });
  });
});

describe("rooms-api handler — deps", () => {
  it("isIamAuthenticated reads the AWS_IAM authorizer principal", async () => {
    handleRoomsRoute.mockResolvedValue({ statusCode: 200, body: "{}" });
    await call(event("GET /rooms"));
    const deps = lastDeps();
    expect(deps.isIamAuthenticated(event("POST /rooms", "arn:aws:sts::1:assumed-role/op/x"))).toBe(true);
    expect(deps.isIamAuthenticated(event("POST /rooms"))).toBe(false);
  });

  it("dispatchTurn async-invokes ROOM_DEBATE_FUNCTION with the payload verbatim", async () => {
    handleRoomsRoute.mockResolvedValue({ statusCode: 201, body: "{}" });
    lambdaSend.mockResolvedValue({ StatusCode: 202 });
    await call(event("POST /rooms", "arn:aws:sts::1:assumed-role/op/x"));
    await lastDeps().dispatchTurn(PAYLOAD);

    expect(lambdaSend).toHaveBeenCalledTimes(1);
    const cmd = lambdaSend.mock.calls[0]![0] as { input: { FunctionName: string; InvocationType: string; Payload: Uint8Array } };
    expect(cmd.input.FunctionName).toBe("wf-room-debate-test");
    expect(cmd.input.InvocationType).toBe("Event");
    expect(JSON.parse(Buffer.from(cmd.input.Payload).toString("utf8"))).toEqual(PAYLOAD);
    expect(cwSend).not.toHaveBeenCalled();
  });

  it("dispatchTurn throws (and emits WfRoomDispatchFailed) when the invoke fails", async () => {
    handleRoomsRoute.mockResolvedValue({ statusCode: 201, body: "{}" });
    lambdaSend.mockRejectedValue(new Error("AccessDenied"));
    await call(event("POST /rooms", "arn:aws:sts::1:assumed-role/op/x"));
    await expect(lastDeps().dispatchTurn(PAYLOAD)).rejects.toThrow("AccessDenied");
    const metric = cwSend.mock.calls[0]![0] as { input: { Namespace: string; MetricData: Array<{ MetricName: string }> } };
    expect(metric.input.Namespace).toBe("Workforce/Rooms");
    expect(metric.input.MetricData[0]!.MetricName).toBe("WfRoomDispatchFailed");
  });

  it("dispatchTurn throws room_debate_function_unset when the env var is missing", async () => {
    delete process.env.ROOM_DEBATE_FUNCTION;
    handleRoomsRoute.mockResolvedValue({ statusCode: 201, body: "{}" });
    await call(event("POST /rooms", "arn:aws:sts::1:assumed-role/op/x"));
    await expect(lastDeps().dispatchTurn(PAYLOAD)).rejects.toThrow("room_debate_function_unset");
    expect(lambdaSend).not.toHaveBeenCalled();
  });
});
