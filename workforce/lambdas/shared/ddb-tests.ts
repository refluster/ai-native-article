// Unit tests for workforce/lambdas/shared/ddb.ts — ML-029 / #613 regression.
//
// Every other test file in this Lambda `vi.mock`s "./ddb.js" wholesale
// (see project-tests.ts, agents-api/handler-tests.ts, …), which is right
// for testing the *consumers* but means ddb.ts's own QueryCommand/GetCommand
// construction has never been exercised against a fake DynamoDB client. That
// gap is exactly how ML-029 shipped unnoticed: the mocked `queryBySkPrefix`
// / `queryByGsi` fakes are always instantly consistent (a plain in-memory
// Map), so no handler-level test could ever have caught a missing
// `ConsistentRead`.
//
// This file exercises the real ddb.ts against `aws-sdk-client-mock`
// (the same pattern backfill-tasks/handler-tests.ts already uses) and
// locks in the ML-029 fix: the two base-table primary-key query helpers
// (`queryBySkPrefix`, `queryBySkPrefixPaged` — the primitive behind
// `GET /agents/{slug}/posts`) must request a strongly consistent read, so
// a read racing a same-flow write can never observe a stale replica. The
// GSI-backed helpers (`queryByGsi`, `queryByGsiPaged` — behind
// `GET /agents/{slug}/executions`) are asserted to NOT set it, because
// DynamoDB rejects `ConsistentRead: true` on a GSI query outright; that
// endpoint's residual staleness is a documented AWS platform limitation
// (see the ddb.ts comment on queryByGsi), not something this test can
// close.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

process.env.TABLE_NAME = "wf-table-test";
process.env.STAGE = "test";

// Mock must be installed BEFORE importing ddb.ts so the module-level
// singleton `DynamoDBDocumentClient.from()` inherits the patched send().
const ddbMock = mockClient(DynamoDBDocumentClient);

const {
  queryBySkPrefix,
  queryBySkPrefixPaged,
  queryByGsi,
  queryByGsiPaged,
} = await import("./ddb.js");

beforeEach(() => {
  ddbMock.reset();
  ddbMock.on(QueryCommand).resolves({ Items: [] });
});

afterEach(() => {
  // mock state is cleared in the next beforeEach; nothing to do here.
});

describe("ddb.ts — ML-029 / #613 read consistency", () => {
  it("queryBySkPrefix requests a strongly consistent read (base-table query)", async () => {
    await queryBySkPrefix("AGENT#ren", "POST#", 1, false);

    const calls = ddbMock.commandCalls(QueryCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args[0].input.ConsistentRead).toBe(true);
  });

  it("queryBySkPrefixPaged requests a strongly consistent read (backs GET /agents/{slug}/posts)", async () => {
    await queryBySkPrefixPaged("AGENT#ren", "POST#", 1, undefined, false);

    const calls = ddbMock.commandCalls(QueryCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args[0].input.ConsistentRead).toBe(true);
  });

  it("queryByGsi does NOT set ConsistentRead — DynamoDB rejects it on a GSI query", async () => {
    await queryByGsi("GSI1", "AGENT#ren", { limit: 1, scanIndexForward: false });

    const calls = ddbMock.commandCalls(QueryCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args[0].input.ConsistentRead).toBeUndefined();
  });

  it("queryByGsiPaged does NOT set ConsistentRead — same GSI restriction", async () => {
    await queryByGsiPaged("GSI1", "AGENT#ren", { limit: 1, scanIndexForward: false });

    const calls = ddbMock.commandCalls(QueryCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args[0].input.ConsistentRead).toBeUndefined();
  });
});
