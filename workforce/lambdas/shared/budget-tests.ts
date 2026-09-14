// Unit tests for the W-3 cap predicate and the modelled-spend ledger (#661).
//
// The orchestrator's dispatch check and tools-api's throwing guard must agree
// about what "over cap" means, so the comparison lives in one pure function
// and is tested here rather than at two call sites.
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

const { wouldBreachBudget, getMonthSpend, recordEstimatedSpend, assertWithinBudget, recordCapReached } =
  await import("./budget.js");

beforeEach(() => sendMock.mockReset());

describe("wouldBreachBudget", () => {
  it("allows a fire that lands exactly on the cap", () => {
    expect(wouldBreachBudget(9.95, 10, 0.05)).toBe(false);
  });

  it("refuses a fire that would cross the cap", () => {
    expect(wouldBreachBudget(9.95, 10, 0.06)).toBe(true);
  });

  it("allows the first fire of a month against a fresh ledger", () => {
    expect(wouldBreachBudget(0, 7, 0.6)).toBe(false);
  });

  it("refuses when already over cap, even for a free fire", () => {
    expect(wouldBreachBudget(11, 10, 0)).toBe(true);
  });

  it("a zero cap admits nothing", () => {
    expect(wouldBreachBudget(0, 0, 0.05)).toBe(true);
  });
});

describe("getMonthSpend", () => {
  it("returns zeros — not undefined — when the agent has no row yet", async () => {
    sendMock.mockResolvedValueOnce({});
    const s = await getMonthSpend("nadia");
    expect(s).toEqual({
      cost_usd: 0,
      tokens_in: 0,
      tokens_out: 0,
      estimated_cost_usd: 0,
      estimated_fires: 0,
      total_usd: 0,
    });
  });

  it("keeps measured and modelled spend separate, and totals them for the cap", async () => {
    sendMock.mockResolvedValueOnce({
      Item: { cost_usd: 1.5, tokens_in: 10, tokens_out: 20, estimated_cost_usd: 2.25, estimated_fires: 30 },
    });
    const s = await getMonthSpend("ren");
    expect(s.cost_usd).toBe(1.5);
    expect(s.estimated_cost_usd).toBe(2.25);
    expect(s.estimated_fires).toBe(30);
    expect(s.total_usd).toBe(3.75);
  });

  it("reads a legacy row that predates the modelled columns", async () => {
    sendMock.mockResolvedValueOnce({ Item: { cost_usd: 4, tokens_in: 1, tokens_out: 1 } });
    const s = await getMonthSpend("maya");
    expect(s.estimated_cost_usd).toBe(0);
    expect(s.total_usd).toBe(4);
  });
});

describe("recordEstimatedSpend", () => {
  it("ADDs to the modelled columns and never touches the measured ones", async () => {
    sendMock.mockResolvedValueOnce({});
    await recordEstimatedSpend("dario", 0.2);
    const input = (sendMock.mock.calls[0]![0] as { input: Record<string, unknown> }).input;
    const expr = String(input.UpdateExpression);
    expect(expr).toContain("#estimated_cost_usd");
    expect(expr).toContain("#estimated_fires");
    // The whole point of the separate function: a modelled figure must never
    // reach the column that means "metered at an LLM call site".
    expect(expr).not.toContain("#cost_usd");
    expect(expr).not.toContain("#tokens_in");
    const values = input.ExpressionAttributeValues as Record<string, unknown>;
    expect(values[":cost"]).toBe(0.2);
    expect(values[":one"]).toBe(1);
  });

  it("keys the row by agent and calendar month", async () => {
    sendMock.mockResolvedValueOnce({});
    await recordEstimatedSpend("mateo", 0.05);
    const input = (sendMock.mock.calls[0]![0] as { input: Record<string, unknown> }).input;
    const key = input.Key as Record<string, string>;
    expect(key.sk).toBe("AGENT#mateo");
    expect(key.pk).toMatch(/^BUDGET#\d{4}-\d{2}$/);
  });
});

describe("assertWithinBudget", () => {
  it("counts modelled spend against the cap, not only measured spend", async () => {
    // 0 measured, 9.9 modelled: a guard that looked at cost_usd alone would
    // wave this through — which is exactly how the counter read zero while
    // agents were demonstrably working (#661).
    sendMock.mockResolvedValueOnce({ Item: { cost_usd: 0, estimated_cost_usd: 9.9 } });
    await expect(assertWithinBudget("silas", 10, 0.6)).rejects.toThrow(/exceed monthly cap/);
  });

  it("names both halves in the error so the reader can see which is which", async () => {
    sendMock.mockResolvedValueOnce({ Item: { cost_usd: 1, estimated_cost_usd: 9.5 } });
    await expect(assertWithinBudget("silas", 10, 0.05)).rejects.toThrow(/measured 1\.00 \+ modelled 9\.50/);
  });

  it("stays silent when the fire fits", async () => {
    sendMock.mockResolvedValueOnce({ Item: { cost_usd: 1, estimated_cost_usd: 1 } });
    await expect(assertWithinBudget("silas", 10, 0.6)).resolves.toBeUndefined();
  });
});

// ML-038: the first refusal of the month stamps the ledger once; every later
// tick's refusal is old news and must not write again.
describe("recordCapReached", () => {
  it("returns true on the write that sets cap_reached_at, and stamps it conditionally", async () => {
    sendMock.mockResolvedValueOnce({});
    expect(await recordCapReached("nadia", new Date("2026-09-11T15:29:57Z"))).toBe(true);
    const cmd = sendMock.mock.calls[0]![0] as { input: { ConditionExpression: string; UpdateExpression: string; Key: { pk: string; sk: string }; ExpressionAttributeValues: Record<string, string> } };
    expect(cmd.input.ConditionExpression).toBe("attribute_not_exists(#cap_reached_at)");
    expect(cmd.input.Key).toEqual({ pk: "BUDGET#2026-09", sk: "AGENT#nadia" });
    expect(cmd.input.ExpressionAttributeValues[":now"]).toBe("2026-09-11T15:29:57.000Z");
  });

  it("returns false — not an error — once the month is already stamped", async () => {
    sendMock.mockRejectedValueOnce(Object.assign(new Error("conditional"), { name: "ConditionalCheckFailedException" }));
    expect(await recordCapReached("nadia")).toBe(false);
  });

  it("rethrows anything that is not the conditional refusal", async () => {
    sendMock.mockRejectedValueOnce(Object.assign(new Error("throttled"), { name: "ProvisionedThroughputExceededException" }));
    await expect(recordCapReached("nadia")).rejects.toThrow(/throttled/);
  });

  it("getMonthSpend surfaces cap_reached_at only when the row carries it", async () => {
    sendMock.mockResolvedValueOnce({ Item: { estimated_cost_usd: 8, cap_reached_at: "2026-09-11T15:29:57.000Z" } });
    expect((await getMonthSpend("nadia")).cap_reached_at).toBe("2026-09-11T15:29:57.000Z");
    sendMock.mockResolvedValueOnce({ Item: { estimated_cost_usd: 1 } });
    expect((await getMonthSpend("nadia")).cap_reached_at).toBeUndefined();
  });
});
