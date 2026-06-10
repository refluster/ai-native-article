// Unit tests for shared/llm-anthropic.ts — the extended-thinking budget
// floor (the Epic-013 launch bug: a budget of 1000 < Anthropic's 1024
// minimum made every messaging-reply call 400 at the API and looked like a
// silent no-reply from the operator's seat). The guard converts that into
// an immediate, readable throw before any network or secret I/O.

import { describe, expect, it, vi } from "vitest";

const getSecret = vi.fn();
vi.mock("./secrets.js", () => ({
  getSecret: (...args: unknown[]) => getSecret(...args),
}));

import { complete, ANTHROPIC_MIN_THINKING_BUDGET_TOKENS } from "./llm-anthropic.js";

describe("complete — thinking-budget floor", () => {
  it("throws loudly (before secret/network I/O) when 0 < budget < 1024", async () => {
    await expect(
      complete({
        model: "anthropic:claude-sonnet-4-6",
        system: "s",
        user: "u",
        maxTokens: 400,
        reasoningBudgetTokens: 1000,
      }),
    ).rejects.toThrow(/reasoningBudgetTokens=1000 is below Anthropic's/);
    expect(getSecret).not.toHaveBeenCalled();
  });

  it("documents the floor as 1024", () => {
    expect(ANTHROPIC_MIN_THINKING_BUDGET_TOKENS).toBe(1024);
  });
});
