// Unit tests for shared/engagement-token.ts (ADR-0005 ephemeral tokens).
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

const { mintEngagementToken, isValidEngagementToken } = await import("./engagement-token.js");

beforeEach(() => sendMock.mockReset());

describe("mintEngagementToken", () => {
  it("writes an AUTH#ENGAGEMENT row with a future expiry + ttl, returns the token", async () => {
    sendMock.mockResolvedValue({});
    const { token, expires_at } = await mintEngagementToken(60);
    expect(token.length).toBeGreaterThan(10);
    expect(Date.parse(expires_at)).toBeGreaterThan(Date.now());
    expect(sendMock).toHaveBeenCalledOnce();
    const cmd = sendMock.mock.calls[0]![0] as { _kind: string; input: { Key: { pk: string; sk: string }; ExpressionAttributeValues: Record<string, unknown> } };
    expect(cmd._kind).toBe("update");
    expect(cmd.input.Key.pk).toBe("AUTH#ENGAGEMENT");
    expect(cmd.input.Key.sk).toBe(`TOKEN#${token}`);
    expect(cmd.input.ExpressionAttributeValues[":t"]).toBeTypeOf("number"); // ttl epoch seconds
  });
});

describe("isValidEngagementToken", () => {
  it("true for an unexpired row", async () => {
    sendMock.mockResolvedValue({ Item: { expires_at: new Date(Date.now() + 60_000).toISOString() } });
    expect(await isValidEngagementToken("abc")).toBe(true);
  });
  it("false for an expired row", async () => {
    sendMock.mockResolvedValue({ Item: { expires_at: new Date(Date.now() - 60_000).toISOString() } });
    expect(await isValidEngagementToken("abc")).toBe(false);
  });
  it("false when the row is missing", async () => {
    sendMock.mockResolvedValue({});
    expect(await isValidEngagementToken("abc")).toBe(false);
  });
  it("false for an empty token without a DDB read", async () => {
    expect(await isValidEngagementToken("")).toBe(false);
    expect(sendMock).not.toHaveBeenCalled();
  });
});
