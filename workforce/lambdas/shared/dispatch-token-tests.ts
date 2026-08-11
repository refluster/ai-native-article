// Unit tests for shared/dispatch-token.ts (adr-0025 ephemeral tokens).
// Mirrors memory-write-token-tests.ts — same mock shape, same assertions,
// different pk namespace (AUTH#DISPATCH).
import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.TABLE_NAME = "wf-table-test";

const sendMock = vi.fn();
vi.mock("@aws-sdk/client-dynamodb", () => ({ DynamoDBClient: class {} }));
vi.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: { from: () => ({ send: sendMock }) },
  GetCommand: class {
    input: unknown;
    _kind = "get";
    constructor(input: unknown) {
      this.input = input;
    }
  },
  UpdateCommand: class {
    input: unknown;
    _kind = "update";
    constructor(input: unknown) {
      this.input = input;
    }
  },
}));

const { mintDispatchToken, isValidDispatchToken } = await import("./dispatch-token.js");

beforeEach(() => sendMock.mockReset());

describe("mintDispatchToken", () => {
  it("writes an AUTH#DISPATCH row with a future expiry + ttl, returns the token", async () => {
    sendMock.mockResolvedValue({});
    const { token, expires_at } = await mintDispatchToken(60);
    expect(token.length).toBeGreaterThan(10);
    expect(Date.parse(expires_at)).toBeGreaterThan(Date.now());
    const cmd = sendMock.mock.calls[0]![0] as {
      _kind: string;
      input: { Key: { pk: string; sk: string }; ExpressionAttributeValues: Record<string, unknown> };
    };
    expect(cmd._kind).toBe("update");
    expect(cmd.input.Key.pk).toBe("AUTH#DISPATCH");
    expect(cmd.input.Key.sk).toBe(`TOKEN#${token}`);
    expect(cmd.input.ExpressionAttributeValues[":t"]).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });
});

describe("isValidDispatchToken", () => {
  it("accepts a live row and rejects an expired one, a missing row, and an empty token", async () => {
    sendMock.mockResolvedValueOnce({ Item: { expires_at: new Date(Date.now() + 60_000).toISOString() } });
    expect(await isValidDispatchToken("live")).toBe(true);

    sendMock.mockResolvedValueOnce({ Item: { expires_at: new Date(Date.now() - 1_000).toISOString() } });
    expect(await isValidDispatchToken("stale")).toBe(false);

    sendMock.mockResolvedValueOnce({});
    expect(await isValidDispatchToken("unknown")).toBe(false);

    expect(await isValidDispatchToken("")).toBe(false);
    // The empty-token case must not even reach DynamoDB.
    expect(sendMock).toHaveBeenCalledTimes(3);
  });
});
