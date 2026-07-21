// Unit tests for shared/memory-write-token.ts (ADR-0021 ephemeral tokens).
// Mirrors engagement-token-tests.ts — same mock shape, same assertions,
// different pk namespace (AUTH#MEMORY_WRITE vs AUTH#ENGAGEMENT).
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

const { mintMemoryWriteToken, isValidMemoryWriteToken } = await import("./memory-write-token.js");

beforeEach(() => sendMock.mockReset());

describe("mintMemoryWriteToken", () => {
  it("writes an AUTH#MEMORY_WRITE row with a future expiry + ttl, returns the token", async () => {
    sendMock.mockResolvedValue({});
    const { token, expires_at } = await mintMemoryWriteToken(60);
    expect(token.length).toBeGreaterThan(10);
    expect(Date.parse(expires_at)).toBeGreaterThan(Date.now());
    expect(sendMock).toHaveBeenCalledOnce();
    const cmd = sendMock.mock.calls[0]![0] as { _kind: string; input: { Key: { pk: string; sk: string }; ExpressionAttributeValues: Record<string, unknown> } };
    expect(cmd._kind).toBe("update");
    expect(cmd.input.Key.pk).toBe("AUTH#MEMORY_WRITE");
    expect(cmd.input.Key.sk).toBe(`TOKEN#${token}`);
    expect(cmd.input.ExpressionAttributeValues[":t"]).toBeTypeOf("number"); // ttl epoch seconds
  });

  it("defaults to a 90-minute TTL when none is given", async () => {
    sendMock.mockResolvedValue({});
    const before = Math.floor(Date.now() / 1000);
    await mintMemoryWriteToken();
    const cmd = sendMock.mock.calls[0]![0] as { input: { ExpressionAttributeValues: Record<string, unknown> } };
    const ttlEpoch = cmd.input.ExpressionAttributeValues[":t"] as number;
    expect(ttlEpoch).toBeGreaterThanOrEqual(before + 5400 - 2);
    expect(ttlEpoch).toBeLessThanOrEqual(before + 5400 + 2);
  });
});

describe("isValidMemoryWriteToken", () => {
  it("true for an unexpired row", async () => {
    sendMock.mockResolvedValue({ Item: { expires_at: new Date(Date.now() + 60_000).toISOString() } });
    expect(await isValidMemoryWriteToken("abc")).toBe(true);
  });
  it("false for an expired row", async () => {
    sendMock.mockResolvedValue({ Item: { expires_at: new Date(Date.now() - 60_000).toISOString() } });
    expect(await isValidMemoryWriteToken("abc")).toBe(false);
  });
  it("false when the row is missing", async () => {
    sendMock.mockResolvedValue({});
    expect(await isValidMemoryWriteToken("abc")).toBe(false);
  });
  it("false for an empty token without a DDB read", async () => {
    expect(await isValidMemoryWriteToken("")).toBe(false);
    expect(sendMock).not.toHaveBeenCalled();
  });
});
