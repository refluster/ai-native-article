// wf-rooms-api Lambda handler — the Rooms route family (workforce/adr-0048
// proposed), behind the SAME HTTP API as wf-agents-api (WfAgentsHttpApi).
//
// Routes (auth per route; reads public on the CORS gate like /threads,
// writes AWS_IAM at API GW and re-checked in ./routes.ts):
//   GET    /rooms                  newest-first list (GSI3 ROOMS; ?page_size=&cursor=)   public
//   GET    /rooms/{id}             room + every turn, S3-hydrated; ?after={turn_id}      public
//   POST   /rooms                  create; async-invokes wf-room-debate for turn one     AWS_IAM
//   POST   /rooms/{id}/turns       operator steer; reopens a concluded room;             AWS_IAM
//                                  409 room_concluding while only the conclusion is left
//   POST   /rooms/{id}/conclude    re-dispatch only the chair's conclusion (new run)     AWS_IAM
//   PATCH  /rooms/{id}             {archived?, title?}                                   AWS_IAM
//
// Why this is its own function. SAM emits one AWS::Lambda::Permission — one
// statement in the function's resource-based policy — per HttpApi event, and
// Lambda caps that policy at 20 480 bytes. wf-agents-api already carried ~51
// routes; the six /rooms events (#847) pushed it to 20 639 bytes, all six
// permissions failed ("The final policy size (20639) is bigger than the limit
// (20480)") and CloudFormation rolled the whole data-plane stack back
// (deploy-workforce-data-plane.yml run 40126740456, commit 65d0262). The
// agents-api function is at that wall: a new route family gets its own
// function behind the shared API instead (check-route-permission-budget.mjs
// holds every function to ≤ 48 HttpApi routes).
//
// This file stays thin: it owns the two things ./routes.ts cannot — the
// async invoke of wf-room-debate and the IAM-principal check — and the
// 404 / 500 envelope. The six routeKey comparison literals below are
// load-bearing: check-openapi-routes.mjs reads them (the spec in
// agents-api/openapi.ts documents the one HTTP API, both functions).

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { CloudWatchClient, PutMetricDataCommand } from "@aws-sdk/client-cloudwatch";

import { handleRoomsRoute, type RoomTurnDispatch, type RoomsDeps } from "./routes.js";

const STAGE = process.env.STAGE ?? "dev";
// One client each per cold start.
const lambda = new LambdaClient({});
const cw = new CloudWatchClient({});

function reply(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
    body: JSON.stringify(body),
  };
}

/** True when API GW's AWS_IAM authorizer resolved a principal (the console's
 *  SigV4-signed Cognito-identity credentials). Same check as agents-api. */
function isIamAuthenticated(event: APIGatewayProxyEventV2): boolean {
  const ctx = event.requestContext as unknown as {
    authorizer?: { iam?: { userArn?: string } };
  };
  return Boolean(ctx.authorizer?.iam?.userArn);
}

/** Async-invoke wf-room-debate for a run's first turn; the debate Lambda
 *  hands the run on itself (the ADR-0047 hand-off). Throws on failure — the
 *  routes module catches, logs `room_dispatch_failed` and records META
 *  `last_error` (W-4: the room landed; the stalled run is visible). */
async function dispatchTurn(payload: RoomTurnDispatch): Promise<void> {
  try {
    const fn = process.env.ROOM_DEBATE_FUNCTION;
    if (!fn) throw new Error("room_debate_function_unset");
    await lambda.send(
      new InvokeCommand({
        FunctionName: fn,
        InvocationType: "Event",
        Payload: Buffer.from(JSON.stringify(payload)),
      }),
    );
  } catch (err) {
    cw.send(
      new PutMetricDataCommand({
        Namespace: "Workforce/Rooms",
        MetricData: [
          {
            MetricName: "WfRoomDispatchFailed",
            Value: 1,
            Unit: "Count",
            Dimensions: [{ Name: "Stage", Value: STAGE }],
          },
        ],
      }),
    ).catch(() => {
      /* metric emission is itself best-effort */
    });
    throw err;
  }
}

const deps: RoomsDeps = { dispatchTurn, isIamAuthenticated };

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const routeKey = event.routeKey;
  try {
    if (
      routeKey === "GET /rooms" ||
      routeKey === "GET /rooms/{id}" ||
      routeKey === "POST /rooms" ||
      routeKey === "POST /rooms/{id}/turns" ||
      routeKey === "POST /rooms/{id}/conclude" ||
      routeKey === "PATCH /rooms/{id}"
    ) {
      // `await` so a throw inside the route lands in the catch below.
      const res = await handleRoomsRoute(routeKey, event, deps);
      if (res) return res;
    }
    return reply(404, { error: "route_not_found", routeKey });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ event: "rooms_api_unhandled", route_key: routeKey, error: message }));
    return reply(500, { error: "internal", message });
  }
}
