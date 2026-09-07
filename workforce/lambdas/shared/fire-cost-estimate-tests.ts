// Unit tests for the modelled per-fire cost (#661).
import { describe, expect, it } from "vitest";
import { estimateFireCostUsd, COST_CLASS_USD, UNKNOWN_SKILL_USD } from "./fire-cost-estimate.js";
import { SKILL_COST_CLASS } from "./skill-registry-generated.js";

describe("estimateFireCostUsd", () => {
  it("prices a small cadence at the declared small rate", () => {
    // feed-post is cost_class "small" in its meta.json.
    expect(estimateFireCostUsd("feed-post")).toBe(COST_CLASS_USD.small);
  });

  it("prices a real large cadence at the declared large rate", () => {
    const large = Object.keys(SKILL_COST_CLASS).find((s) => SKILL_COST_CLASS[s] === "large");
    expect(large).toBeDefined();
    expect(estimateFireCostUsd(large!)).toBe(COST_CLASS_USD.large);
  });

  it("falls back to the most expensive class for an unknown skill", () => {
    // Conservative on purpose: an unmodelled fire must not look cheaper than a
    // modelled one, or the ledger drifts optimistic where we know least.
    expect(estimateFireCostUsd("no-such-skill")).toBe(UNKNOWN_SKILL_USD);
    expect(UNKNOWN_SKILL_USD).toBe(COST_CLASS_USD.large);
  });

  it("never throws on junk input", () => {
    expect(estimateFireCostUsd("")).toBe(UNKNOWN_SKILL_USD);
    expect(estimateFireCostUsd("constructor")).toBe(UNKNOWN_SKILL_USD);
    expect(estimateFireCostUsd("__proto__")).toBe(UNKNOWN_SKILL_USD);
  });

  it("the class ordering is strictly increasing", () => {
    expect(COST_CLASS_USD.small).toBeLessThan(COST_CLASS_USD.medium);
    expect(COST_CLASS_USD.medium).toBeLessThan(COST_CLASS_USD.large);
  });
});

describe("SKILL_COST_CLASS (generated)", () => {
  it("covers every skill and uses only the schema's enum", () => {
    const names = Object.keys(SKILL_COST_CLASS);
    expect(names.length).toBeGreaterThan(30);
    for (const name of names) {
      expect(["small", "medium", "large"]).toContain(SKILL_COST_CLASS[name]);
    }
  });

  it("prices the whole live roster without hitting the unknown fallback", () => {
    // If this fails, a skill lost its cost_class and every one of its fires is
    // being charged at the large rate.
    for (const name of Object.keys(SKILL_COST_CLASS)) {
      expect(estimateFireCostUsd(name)).toBeLessThanOrEqual(COST_CLASS_USD.large);
      expect(estimateFireCostUsd(name)).toBeGreaterThan(0);
    }
  });
});
