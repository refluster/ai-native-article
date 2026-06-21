// Unit tests for shared/agent-config.ts — the ADR-0007 write-time
// validator. Ports the checks that used to live in CI
// (workforce/scripts/validate-agent-json.mjs) plus the blast-radius
// guards, so each rule gets a direct accept/reject pair here.

import { describe, expect, it } from "vitest";
import {
  validateBudgetOverride,
  validateIdentityPatch,
  W3_BUDGET_CAP_USD,
  type IdentityPatchContext,
} from "./agent-config.js";

const ctx = (over: Partial<IdentityPatchContext> = {}): IdentityPatchContext => ({
  otherAgentsEffectiveBudgetUsd: 0,
  skillOwners: (name) => (name === "feed-post" ? ["sora", "ren"] : undefined),
  ...over,
});

const rules = (patch: Record<string, unknown>, c = ctx()) =>
  validateIdentityPatch(patch, c).map((x) => x.rule);

const ccrBinding = (over: Record<string, unknown> = {}, trigger: Record<string, unknown> = {}) => ({
  skill: "feed-post",
  executor: "claude-code-routine",
  routine_spec: "workforce/docs/routines/feed-post.md",
  trigger: { scheduler: "eventbridge", cron: "cron(15 3 ? * * *)", ...trigger },
  ...over,
});

describe("validateIdentityPatch — scalar fields", () => {
  it("accepts a well-formed full identity patch", () => {
    expect(
      rules({
        first_name: "Sora",
        last_name: "Aoki",
        residence: "Sapporo, Japan",
        role: "Editorial writer",
        model: "anthropic:claude-sonnet-4-6",
        prompt_version: "1.4.0",
        budget_monthly_usd_default: 20,
        default_project: "agent-workforce",
        streams: ["editorial"],
        bindings: [ccrBinding()],
      }),
    ).toEqual([]);
  });

  it("rejects empty names, malformed residence, empty role", () => {
    expect(rules({ first_name: "" })).toContain("S3-name");
    expect(rules({ residence: "Sapporo" })).toContain("S3-residence");
    expect(rules({ role: "" })).toContain("S4-role");
  });

  it("enforces the model allowlist (provider prefix)", () => {
    expect(rules({ model: "anthropic:claude-sonnet-4-6" })).toEqual([]);
    expect(rules({ model: "openai:gpt-5" })).toContain("S5-model");
    expect(rules({ model: "claude-sonnet-4-6" })).toContain("S5-model");
  });

  it("requires semver prompt_version", () => {
    expect(rules({ prompt_version: "1.4" })).toContain("S7-semver");
    expect(rules({ prompt_version: "1.4.0" })).toEqual([]);
  });

  it("validates system_prompt: non-empty, under the G2 size ceiling", () => {
    expect(rules({ system_prompt: "" })).toContain("S16-system-prompt");
    expect(rules({ system_prompt: "   " })).toContain("S16-system-prompt");
    expect(rules({ system_prompt: "x".repeat(32 * 1024 + 1) })).toContain("G2-prompt-size");
    expect(rules({ system_prompt: "You are Sora, an editorial writer." })).toEqual([]);
  });

  it("validates profile blocks and org edges (ADR-0007 step 6a)", () => {
    expect(rules({ owner_email: 42 })).toContain("S14-owner-email");
    expect(rules({ owner_email: null })).toEqual([]);
    expect(rules({ jd: "not-an-object" })).toContain("S17-profile-block");
    expect(rules({ jd: ["array"] })).toContain("S17-profile-block");
    expect(rules({ jd: null })).toEqual([]);
    expect(rules({ jd: { mission: "x".repeat(17 * 1024) } })).toContain("G3-profile-size");
    expect(rules({ experience: { highlights: [] }, memory: { notes: [] } })).toEqual([]);
    expect(rules({ reports_to: ["maya"], lateral: [] })).toEqual([]);
    expect(rules({ reports_to: ["Maya!"] })).toContain("S18-org-edges");
    expect(rules({ lateral: "maya" })).toContain("S18-org-edges");
  });

  it("requires non-empty allowed streams", () => {
    expect(rules({ streams: [] })).toContain("S11-streams");
    expect(rules({ streams: ["editorial", "bogus"] })).toContain("S11-stream-value");
  });
});

describe("validateIdentityPatch — budget ceilings (W-3)", () => {
  it("rejects non-positive budgets", () => {
    expect(rules({ budget_monthly_usd_default: 0 })).toContain("S8-budget");
    expect(rules({ budget_monthly_usd_default: -5 })).toContain("S8-budget");
  });

  it("rejects a default that pushes the aggregate over the cap", () => {
    const c = ctx({ otherAgentsEffectiveBudgetUsd: W3_BUDGET_CAP_USD - 10 });
    expect(rules({ budget_monthly_usd_default: 10 }, c)).toEqual([]);
    expect(rules({ budget_monthly_usd_default: 11 }, c)).toContain("W3-cap");
  });

  it("applies the same ceiling to the operational override; null clears", () => {
    const c = { otherAgentsEffectiveBudgetUsd: W3_BUDGET_CAP_USD - 10 };
    expect(validateBudgetOverride(10, c)).toEqual([]);
    expect(validateBudgetOverride(11, c).map((x) => x.rule)).toContain("W3-cap");
    expect(validateBudgetOverride(null, c)).toEqual([]);
    expect(validateBudgetOverride("12", c).map((x) => x.rule)).toContain("S8-budget");
  });
});

describe("validateIdentityPatch — bindings", () => {
  it("rejects non-array bindings and non-object entries", () => {
    expect(rules({ bindings: "nope" })).toContain("S9-bindings");
    expect(rules({ bindings: [42] })).toContain("S9-binding-object");
  });

  it("cross-checks skill existence against SKILL rows", () => {
    expect(rules({ bindings: [ccrBinding({ skill: "ghost-skill" })] })).toContain(
      "R8-binding-skill-exists",
    );
  });

  it("does NOT gate binding on ownership (adr-0012): a non-owner may bind any existing skill", () => {
    // "maya" is not in feed-post's owners[] (["sora", "ren"]) — still allowed.
    expect(rules({ bindings: [ccrBinding()] })).toEqual([]);
    expect(rules({ bindings: [ccrBinding()] })).not.toContain("R8-binding-skill-owner");
  });

  it("enforces the ADR-0005 executor allowlist", () => {
    expect(rules({ bindings: [ccrBinding({ executor: "lambda" })] })).toContain(
      "S9-binding-executor",
    );
  });

  it("requires cron(...) form for eventbridge triggers", () => {
    expect(
      rules({ bindings: [ccrBinding({}, { cron: "15 3 * * *" })] }),
    ).toContain("S9-binding-cron");
  });

  it("G1 cadence floor: rejects sub-hourly crons", () => {
    expect(rules({ bindings: [ccrBinding({}, { cron: "cron(*/5 * ? * * *)" })] })).toContain(
      "G1-cadence-floor",
    );
    expect(rules({ bindings: [ccrBinding({}, { cron: "cron(* 3 ? * * *)" })] })).toContain(
      "G1-cadence-floor",
    );
    expect(rules({ bindings: [ccrBinding({}, { cron: "cron(0,30 3 ? * * *)" })] })).toContain(
      "G1-cadence-floor",
    );
    expect(rules({ bindings: [ccrBinding()] })).toEqual([]);
  });

  it("requires invoked_by for external scheduler and project_id for CCR-batched bindings", () => {
    expect(
      rules({ bindings: [ccrBinding({}, { scheduler: "external", cron: undefined })] }),
    ).toContain("S9-binding-external-invoked-by");
    expect(
      rules({
        bindings: [ccrBinding({}, { scheduler: "external", invoked_by: "api", cron: undefined })],
      }),
    ).toContain("S9-binding-ccr-batch-project");
    expect(
      rules({
        bindings: [
          ccrBinding(
            { project_id: "agent-workforce" },
            { scheduler: "external", invoked_by: "api", cron: undefined },
          ),
        ],
      }),
    ).toEqual([]);
  });

  it("requires routine_spec for CCR bindings", () => {
    expect(rules({ bindings: [ccrBinding({ routine_spec: undefined })] })).toContain(
      "S9-binding-routine-spec",
    );
  });
});
