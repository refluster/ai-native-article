// Unit tests for shared/agent-config.ts — the ADR-0007 write-time
// validator. Ports the checks that used to live in CI
// (workforce/scripts/validate-agent-json.mjs) plus the blast-radius
// guards, so each rule gets a direct accept/reject pair here.

import { describe, expect, it } from "vitest";
import {
  validateAgentCreate,
  validateBudgetOverride,
  validateBudgetRunway,
  validateIdentityCoherence,
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

  describe("S9-binding-duplicate — one (skill, project) per agent", () => {
    const bound = (skill: string, project_id: string, cron: string) =>
      ccrBinding({ skill, project_id }, { scheduler: "external", invoked_by: "api", cron });

    it("rejects the live grace shape: the same skill twice on one project", () => {
      // grace, 2026-09-07: daily-research@agent-workforce at cron(20 13 ? * * *)
      // AND at cron(20 0/2 ? * * *) — the second firing 12x a day.
      const violations = validateIdentityPatch(
        {
          bindings: [
            bound("feed-post", "agent-workforce", "cron(20 13 ? * * *)"),
            bound("feed-post", "agent-workforce", "cron(20 0/2 ? * * *)"),
          ],
        },
        ctx(),
      );
      const dup = violations.filter((x) => x.rule === "S9-binding-duplicate");
      expect(dup).toHaveLength(1);
      // Points at the SECOND one — the first is the keeper — and names both.
      expect(dup[0]!.field).toBe("bindings[1]");
      expect(dup[0]!.msg).toContain("bindings[0]");
    });

    it("accepts the same skill on two different projects", () => {
      // ren really does hold issue-implement on both agent-workforce and asp-cloud.
      expect(
        rules({
          bindings: [
            bound("feed-post", "agent-workforce", "cron(20 13 ? * * *)"),
            bound("feed-post", "asp-cloud", "cron(20 13 ? * * *)"),
          ],
        }),
      ).toEqual([]);
    });

    it("accepts two different skills on one project", () => {
      const both = ctx({ skillOwners: (n) => (n === "feed-post" || n === "daily-research" ? ["grace"] : undefined) });
      expect(
        rules(
          {
            bindings: [
              bound("feed-post", "agent-workforce", "cron(20 13 ? * * *)"),
              bound("daily-research", "agent-workforce", "cron(40 13 ? * * *)"),
            ],
          },
          both,
        ),
      ).toEqual([]);
    });

    it("flags each extra occurrence, not just the second", () => {
      const dup = validateIdentityPatch(
        {
          bindings: [
            bound("feed-post", "agent-workforce", "cron(1 1 ? * * *)"),
            bound("feed-post", "agent-workforce", "cron(2 2 ? * * *)"),
            bound("feed-post", "agent-workforce", "cron(3 3 ? * * *)"),
          ],
        },
        ctx(),
      ).filter((x) => x.rule === "S9-binding-duplicate");
      expect(dup.map((x) => x.field)).toEqual(["bindings[1]", "bindings[2]"]);
    });

    it("treats a missing project_id as its own key rather than matching every binding", () => {
      const withNoProject = { skill: "feed-post", executor: "lambda" };
      const dup = validateIdentityPatch(
        { bindings: [withNoProject, { ...withNoProject }] },
        ctx(),
      ).filter((x) => x.rule === "S9-binding-duplicate");
      expect(dup).toHaveLength(1);
    });

    it("does not pile a duplicate violation onto a malformed binding", () => {
      // 42 and {} already have their own violations; they must not also
      // collide with each other on an empty key.
      const dup = validateIdentityPatch({ bindings: [42, {}, {}] }, ctx()).filter(
        (x) => x.rule === "S9-binding-duplicate",
      );
      expect(dup).toEqual([]);
    });

    it("a single binding is never a duplicate", () => {
      expect(rules({ bindings: [ccrBinding()] })).toEqual([]);
    });
  });

  it("cross-checks skill existence against SKILL rows", () => {
    expect(rules({ bindings: [ccrBinding({ skill: "ghost-skill" })] })).toContain(
      "R8-binding-skill-exists",
    );
  });

  it("rejects a NEW binding to an archived skill (ADR-0017 soft delete)", () => {
    const c = ctx({
      skillOwners: (name) => (name === "old-skill" || name === "feed-post" ? ["sora"] : undefined),
      skillStatus: (name) => (name === "old-skill" ? "archived" : "active"),
    });
    expect(rules({ bindings: [ccrBinding({ skill: "old-skill" })] }, c)).toContain(
      "R8-binding-skill-archived",
    );
    // active skills bind fine under the same ctx
    expect(rules({ bindings: [ccrBinding()] }, c)).toEqual([]);
    // callers that don't resolve status (no skillStatus) skip the check
    expect(rules({ bindings: [ccrBinding()] })).toEqual([]);
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

  it("#574: accepts a well-formed bound_at, and bindings without one (pre-existing bindings)", () => {
    expect(rules({ bindings: [ccrBinding({ bound_at: "2026-08-12T03:41:30Z" })] })).toEqual([]);
    expect(rules({ bindings: [ccrBinding()] })).toEqual([]);
  });

  it("#574: rejects a bound_at that isn't a parseable ISO instant", () => {
    expect(rules({ bindings: [ccrBinding({ bound_at: "not-a-date" })] })).toContain(
      "S9-binding-bound-at",
    );
    expect(rules({ bindings: [ccrBinding({ bound_at: 12345 })] })).toContain(
      "S9-binding-bound-at",
    );
  });
});

describe("validateIdentityCoherence — S19 role ↔ prompt header title (ML-014)", () => {
  const coherence = (effective: Record<string, unknown>) =>
    validateIdentityCoherence(effective).map((x) => x.rule);

  it("accepts a matching header title and role", () => {
    expect(
      coherence({
        role: "President",
        system_prompt: "# Maya Okonkwo — President — San Francisco, US\n\nBody.",
      }),
    ).toEqual([]);
  });

  it("rejects a header title that disagrees with role (the maya incident)", () => {
    expect(
      coherence({
        role: "President",
        system_prompt: "# Maya Okonkwo — Founder — San Francisco, US\n\nBody.",
      }),
    ).toEqual(["S19-role-prompt-title"]);
  });

  it("does not constrain prompts without the header convention", () => {
    expect(coherence({ role: "President", system_prompt: "You are Maya." })).toEqual([]);
    expect(coherence({ role: "President", system_prompt: "# Maya Okonkwo\n\nBody." })).toEqual([]);
  });

  it("skips when role or prompt is absent (structural rules own those)", () => {
    expect(coherence({ system_prompt: "# A — B — C" })).toEqual([]);
    expect(coherence({ role: "President" })).toEqual([]);
  });

  it("trims whitespace around the title segment", () => {
    expect(
      coherence({
        role: "VP, Finance & Capital Strategy",
        system_prompt: "# Silas Brandt —  VP, Finance & Capital Strategy  — New York, NY, US",
      }),
    ).toEqual([]);
  });

  it("is enforced on create via validateAgentCreate", () => {
    const body = {
      slug: "testa",
      first_name: "Test",
      last_name: "Agent",
      residence: "Osaka, JP",
      role: "Engineer",
      model: "anthropic:claude-sonnet-4-6",
      prompt_version: "0.1.0",
      budget_monthly_usd_default: 1,
      default_project: "agent-workforce",
      streams: ["internal"],
      bindings: [],
      system_prompt: "# Test Agent — Designer — Osaka, JP\n\nBody.",
    };
    expect(validateAgentCreate(body, ctx()).map((x) => x.rule)).toContain(
      "S19-role-prompt-title",
    );
    expect(
      validateAgentCreate(
        { ...body, system_prompt: "# Test Agent — Engineer — Osaka, JP\n\nBody." },
        ctx(),
      ).map((x) => x.rule),
    ).toEqual([]);
  });
});

// ─── W3-runway (ML-038) ───────────────────────────────────────────────────────
// #661 made the cap real; this rule makes the cap cover the cadence. The
// fixture is Nadia's live shape on 2026-09-13: six orchestrator-owned bindings
// modelled at USD 75/month, written against an USD 8 cap.
describe("validateIdentityPatch — W3-runway", () => {
  const owned = (skill: string, cron: string, project_id = "agent-workforce") => ({
    skill,
    project_id,
    executor: "claude-code-routine",
    routine_spec: "workforce/docs/routines/agent-runner.md",
    trigger: { scheduler: "external", invoked_by: "api", cron, fired_from: "wf-orchestrator-tick" },
  });
  const nadia = [
    owned("pr-autopilot", "cron(45 1/6 ? * * *)", "asp-cloud"),
    owned("feed-post", "cron(30 1 ? * * *)"),
    owned("pr-autopilot", "cron(23 0,6,12,18 ? * * *)"),
    owned("backlog-reconcile", "cron(41 2 ? * * *)"),
    owned("daily-research", "cron(18 16 ? * * *)"),
    owned("issue-triage", "cron(23 2 ? * * *)"),
  ];
  // The bindings validator cross-checks skill existence; give it every skill
  // the fixture names so only the runway rule is under test.
  const owners = (name: string) =>
    ["pr-autopilot", "feed-post", "backlog-reconcile", "daily-research", "issue-triage"].includes(name)
      ? ["nadia"]
      : undefined;

  it("rejects writing bindings whose burn outruns the cap the row keeps", () => {
    const c = ctx({ skillOwners: owners, existingBudgetDefaultUsd: 8, existingBudgetOverrideUsd: null });
    const v = validateIdentityPatch({ bindings: nadia }, c).filter((x) => x.rule === "W3-runway");
    expect(v).toHaveLength(1);
    expect(v[0]!.field).toBe("bindings");
    expect(v[0]!.msg).toMatch(/USD 75 exceeds the effective cap USD 8/);
    expect(v[0]!.msg).toMatch(/day 4/);
  });

  it("rejects lowering a budget below the bindings the row keeps", () => {
    const c = ctx({ existingBindings: nadia as never, existingBudgetOverrideUsd: null });
    expect(rules({ budget_monthly_usd_default: 8 }, c)).toContain("W3-runway");
    expect(validateBudgetRunway({ budget_monthly_usd_override: 8 }, { existingBindings: nadia as never, existingBudgetDefaultUsd: 90, existingBudgetOverrideUsd: null }).map((x) => x.rule)).toEqual(["W3-runway"]);
  });

  it("accepts the same bindings when the budget rides in the same write", () => {
    const c = ctx({ skillOwners: owners, existingBudgetDefaultUsd: 8, existingBudgetOverrideUsd: null });
    expect(rules({ bindings: nadia, budget_monthly_usd_default: 90 }, c)).not.toContain("W3-runway");
  });

  it("an override in force is the cap that counts, and nulling it falls back to the default", () => {
    const base = { existingBindings: nadia as never, existingBudgetDefaultUsd: 8, existingBudgetOverrideUsd: 100 };
    // Row is fine today because the override covers it…
    expect(validateBudgetRunway({ budget_monthly_usd_default: 8 }, base)).toEqual([]);
    // …and clearing the override would drop the cap to the default, which does not.
    expect(validateBudgetRunway({ budget_monthly_usd_override: null }, base).map((x) => x.rule)).toEqual(["W3-runway"]);
  });

  it("charges nothing for bindings the orchestrator does not fire", () => {
    const declarative = [{ ...owned("feed-post", "cron(30 1 ? * * *)"), trigger: { scheduler: "gha", cron: "cron(30 1 ? * * *)" } }];
    const c = ctx({ skillOwners: owners, existingBudgetDefaultUsd: 1, existingBudgetOverrideUsd: null });
    expect(rules({ bindings: declarative }, c)).not.toContain("W3-runway");
  });

  it("stays silent when the write touches neither side of the pair, or the context cannot say", () => {
    expect(validateBudgetRunway({ role: "PM" }, {})).toEqual([]);
    // Bindings written with no cap knowable: nothing honest to compare against.
    expect(validateBudgetRunway({ bindings: nadia }, {})).toEqual([]);
    // A budget written with no bindings knowable: likewise.
    expect(validateBudgetRunway({ budget_monthly_usd_default: 1 }, {})).toEqual([]);
  });

  it("a create carries both halves, so the rule runs there with no context", () => {
    const body = {
      slug: "nadia",
      first_name: "Nadia",
      last_name: "Roy",
      residence: "Singapore, SG",
      role: "Product Manager",
      model: "anthropic:claude-sonnet-4-6",
      prompt_version: "0.2.1",
      budget_monthly_usd_default: 8,
      default_project: "agent-workforce",
      streams: ["internal"],
      bindings: nadia,
      system_prompt: "# Nadia Roy — Product Manager — Singapore, SG\n\nPM.",
    };
    const v = validateAgentCreate(body, ctx({ skillOwners: owners })).map((x) => x.rule);
    expect(v).toContain("W3-runway");
    expect(validateAgentCreate({ ...body, budget_monthly_usd_default: 90 }, ctx({ skillOwners: owners })).map((x) => x.rule)).not.toContain("W3-runway");
  });
});
