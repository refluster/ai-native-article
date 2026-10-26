// Unit tests for shared/dispatch.ts (adr-0025 — on-demand binding dispatch).
//
// The two properties worth pinning are the ones that keep this from becoming a
// second scheduler: (1) a dispatch can only name a binding that already exists
// on the agent's META row, and (2) the debounce slot is claimed atomically, so
// a burst of hand-offs produces one fire.
import { describe, expect, it, vi } from "vitest";

process.env.TABLE_NAME = "wf-table-test";

const sendMock = vi.fn();
vi.mock("@aws-sdk/client-dynamodb", () => ({ DynamoDBClient: class {} }));
vi.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: { from: () => ({ send: sendMock }) },
  UpdateCommand: class {
    input: unknown;
    _kind = "update";
    constructor(input: unknown) {
      this.input = input;
    }
  },
}));

const {
  parseDispatchRequest,
  resolveDispatchTarget,
  selectDispatchAgents,
  claimDispatchSlot,
  releaseDispatchSlot,
  dispatchSlotSk,
  isOrchestratorDispatchEvent,
  DEFAULT_DEBOUNCE_SECONDS,
} = await import("./dispatch.js");

// No blanket mockReset() in a beforeEach: resetting a mock whose recorded
// result was an error makes vitest report that error as an unhandled failure
// of the NEXT test. Each test sets the implementation it needs (and clears the
// call log itself when it asserts on calls), which is explicit anyway.
const useSend = (impl: (...args: unknown[]) => unknown) => {
  sendMock.mockClear();
  sendMock.mockImplementation(impl as never);
};

const ccrBinding = (skill: string, project_id: string) => ({
  skill,
  executor: "claude-code-routine" as const,
  trigger: { scheduler: "external" as const, invoked_by: "api" as const, cron: "cron(29 6,18 ? * * *)" },
  routine_spec: "workforce/docs/routines/agent-runner.md",
  project_id,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const agentRow = (bindings: unknown[], extra: Record<string, unknown> = {}): any => ({
  pk: "AGENT#ren",
  sk: "META",
  slug: "ren",
  bindings,
  ...extra,
});

describe("parseDispatchRequest", () => {
  it("accepts (skill, project_id) alone — the owning persona is resolved from bindings", () => {
    const out = parseDispatchRequest({ skill: "pr-remediate", project_id: "asp-cloud" });
    expect(out).toEqual({ agent_slug: undefined, skill: "pr-remediate", project_id: "asp-cloud", reason: undefined });
  });

  it("accepts and trims an explicit agent_slug", () => {
    const out = parseDispatchRequest({ agent_slug: " ren ", skill: "pr-remediate", project_id: "asp-cloud" });
    expect(out).toEqual({ agent_slug: "ren", skill: "pr-remediate", project_id: "asp-cloud", reason: undefined });
  });

  it("rejects a missing or blank required field rather than defaulting it", () => {
    expect(parseDispatchRequest({ project_id: "asp-cloud" })).toEqual({ error: "skill is required (non-empty string)" });
    expect(parseDispatchRequest({ skill: "  ", project_id: "asp-cloud" })).toEqual({ error: "skill is required (non-empty string)" });
    expect(parseDispatchRequest({ skill: "s", project_id: "p", agent_slug: "" })).toEqual({ error: "agent_slug, when given, must be a non-empty string" });
    expect(parseDispatchRequest("nope")).toEqual({ error: "body must be a JSON object" });
  });

  it("caps the free-text reason (it is logged, never parsed)", () => {
    const out = parseDispatchRequest({ agent_slug: "ren", skill: "s", project_id: "p", reason: "x".repeat(900) });
    expect("reason" in out && out.reason?.length).toBe(512);
  });
});

describe("resolveDispatchTarget", () => {
  const req = { agent_slug: "ren", skill: "pr-remediate", project_id: "asp-cloud" };

  it("resolves the binding index for a declared (skill, project) pair", () => {
    const agent = agentRow([ccrBinding("issue-implement", "asp-cloud"), ccrBinding("pr-remediate", "asp-cloud")]);
    expect(resolveDispatchTarget(agent, req)).toMatchObject({ ok: true, binding_idx: 1 });
  });

  it("refuses when the skill is bound on a DIFFERENT project — dispatch never invents an execution (R-N4)", () => {
    const agent = agentRow([ccrBinding("pr-remediate", "agent-workforce")]);
    const out = resolveDispatchTarget(agent, req);
    expect(out.ok).toBe(false);
    expect(out).toMatchObject({ code: "binding_not_found" });
    // The refusal names what IS declared, so the operator can see the gap.
    expect((out as { detail: string }).detail).toContain("pr-remediate@agent-workforce");
  });

  it("refuses an unknown agent and a paused/archived one", () => {
    expect(resolveDispatchTarget(undefined, req)).toMatchObject({ code: "agent_not_found" });
    expect(resolveDispatchTarget(agentRow([ccrBinding("pr-remediate", "asp-cloud")], { paused: true }), req)).toMatchObject({ code: "agent_inactive" });
    expect(resolveDispatchTarget(agentRow([ccrBinding("pr-remediate", "asp-cloud")], { archived: true }), req)).toMatchObject({ code: "agent_inactive" });
  });

  it("refuses a binding the orchestrator does not own (only the CCR-by-api path is dispatchable)", () => {
    const agent = agentRow([
      { skill: "pr-remediate", executor: "gha", trigger: { scheduler: "gha" }, project_id: "asp-cloud" },
    ]);
    expect(resolveDispatchTarget(agent, req)).toMatchObject({ code: "binding_not_dispatchable" });
  });
});

describe("selectDispatchAgents", () => {
  it("finds the one active agent bound to (skill, project)", () => {
    const rows = [
      agentRow([ccrBinding("pr-autopilot", "asp-cloud")], { slug: "nadia" }),
      agentRow([ccrBinding("issue-implement", "asp-cloud"), ccrBinding("pr-remediate", "asp-cloud")], { slug: "ren" }),
    ];
    expect(selectDispatchAgents(rows, "pr-remediate", "asp-cloud")).toEqual([{ slug: "ren", binding_idx: 1 }]);
  });

  it("returns nobody when the cadence is wired for a DIFFERENT project — the #692/#693 failure, made visible", () => {
    const rows = [agentRow([ccrBinding("pr-remediate", "agent-workforce")], { slug: "ren" })];
    expect(selectDispatchAgents(rows, "pr-remediate", "asp-cloud")).toEqual([]);
  });

  it("skips paused/archived personas and non-dispatchable bindings", () => {
    const rows = [
      agentRow([ccrBinding("pr-remediate", "asp-cloud")], { slug: "ren", paused: true }),
      agentRow([ccrBinding("pr-remediate", "asp-cloud")], { slug: "old", archived: true }),
      agentRow([{ skill: "pr-remediate", executor: "gha", trigger: { scheduler: "gha" }, project_id: "asp-cloud" }], { slug: "gha-bound" }),
    ];
    expect(selectDispatchAgents(rows, "pr-remediate", "asp-cloud")).toEqual([]);
  });

  it("reports every match so an ambiguous wiring can be refused rather than guessed", () => {
    const rows = [
      agentRow([ccrBinding("pr-remediate", "asp-cloud")], { slug: "ren" }),
      agentRow([ccrBinding("pr-remediate", "asp-cloud")], { slug: "farah" }),
    ];
    expect(selectDispatchAgents(rows, "pr-remediate", "asp-cloud").map((o) => o.slug)).toEqual(["ren", "farah"]);
  });
});

describe("claimDispatchSlot", () => {
  it("writes the stamp under the agent partition, conditioned on the debounce window", async () => {
    useSend(() => Promise.resolve({}));
    const now = new Date("2026-08-11T10:00:00.000Z");
    const out = await claimDispatchSlot("ren", "pr-remediate", "asp-cloud", now);
    expect(out.claimed).toBe(true);
    const cmd = sendMock.mock.calls[0]![0] as {
      input: { Key: { pk: string; sk: string }; ConditionExpression: string; ExpressionAttributeValues: Record<string, string> };
    };
    expect(cmd.input.Key).toEqual({ pk: "AGENT#ren", sk: dispatchSlotSk("pr-remediate", "asp-cloud") });
    expect(cmd.input.ConditionExpression).toContain("last_dispatched_at < :cutoff");
    expect(cmd.input.ExpressionAttributeValues[":now"]).toBe(now.toISOString());
    expect(Date.parse(cmd.input.ExpressionAttributeValues[":cutoff"]!)).toBe(now.getTime() - DEFAULT_DEBOUNCE_SECONDS * 1000);
  });

  // The failure cases throw synchronously rather than returning a rejected
  // promise — same `try { await ddb.send(…) } catch` path, one less way for
  // the mock's recorded rejection to be reported as a spurious failure.
  it("reports a debounced claim (with the blocking stamp) instead of throwing", async () => {
    useSend(() => {
      throw Object.assign(new Error("conditional"), {
        name: "ConditionalCheckFailedException",
        Item: { last_dispatched_at: "2026-08-11T09:59:00.000Z" },
      });
    });
    const out = await claimDispatchSlot("ren", "pr-remediate", "asp-cloud");
    expect(out).toEqual({ claimed: false, last_dispatched_at: "2026-08-11T09:59:00.000Z" });
  });

  it("rethrows a real DDB failure — a broken rate-limiter must not read as 'go ahead'", async () => {
    useSend(() => {
      throw Object.assign(new Error("boom"), { name: "ProvisionedThroughputExceededException" });
    });
    await expect(claimDispatchSlot("ren", "pr-remediate", "asp-cloud")).rejects.toThrow("boom");
  });
});

// #685: the cron tick claims this same slot with the per-skill dedup window.
// A stateful stand-in for the conditional write lets the retry case be
// asserted end to end rather than by reading the expression.
const statefulSlot = () => {
  let stamp: string | undefined;
  return (cmd: unknown) => {
    const { UpdateExpression, ExpressionAttributeValues: v } = (cmd as {
      input: { UpdateExpression: string; ExpressionAttributeValues: Record<string, string> };
    }).input;
    const conditionError = () =>
      Object.assign(new Error("conditional"), { name: "ConditionalCheckFailedException", Item: stamp ? { last_dispatched_at: stamp } : undefined });
    if (UpdateExpression.startsWith("SET")) {
      if (stamp !== undefined && !(stamp < v[":cutoff"]!)) throw conditionError();
      stamp = v[":now"];
      return {};
    }
    if (stamp !== v[":claimed"]) throw conditionError();
    stamp = undefined;
    return {};
  };
};

describe("tick dedup via claimDispatchSlot (#685)", () => {
  const t0 = new Date("2026-10-06T04:11:00.000Z");
  const window30m = 30 * 60;

  it("rejects a retry of the same tick dispatched inside the window", async () => {
    useSend(statefulSlot());
    const first = await claimDispatchSlot("ren", "feed-post", "agent-workforce", t0, window30m);
    const retry = await claimDispatchSlot("ren", "feed-post", "agent-workforce", new Date(t0.getTime() + 60_000), window30m);
    expect(first).toEqual({ claimed: true, claimed_at: t0.toISOString() });
    expect(retry).toEqual({ claimed: false, last_dispatched_at: t0.toISOString() });
  });

  it("is keyed per skill, so an unrelated skill's dispatch does not suppress this one", async () => {
    // Two slots, two stamps: the any-skill key the old guard read would have
    // skipped the second.
    const slots = new Map<string, (cmd: unknown) => unknown>();
    useSend((cmd) => {
      const sk = (cmd as { input: { Key: { sk: string } } }).input.Key.sk;
      if (!slots.has(sk)) slots.set(sk, statefulSlot());
      return slots.get(sk)!(cmd);
    });
    expect((await claimDispatchSlot("ren", "article-level2", "p", t0, window30m)).claimed).toBe(true);
    expect((await claimDispatchSlot("ren", "feed-post", "p", t0, window30m)).claimed).toBe(true);
  });

  it("claims again once the window has elapsed (next cron match)", async () => {
    useSend(statefulSlot());
    await claimDispatchSlot("ren", "feed-post", "p", t0, window30m);
    const later = new Date(t0.getTime() + 31 * 60_000);
    expect((await claimDispatchSlot("ren", "feed-post", "p", later, window30m)).claimed).toBe(true);
  });

  it("a released slot (failed fire) lets the retry dispatch", async () => {
    useSend(statefulSlot());
    const c = await claimDispatchSlot("ren", "feed-post", "p", t0, window30m);
    expect(await releaseDispatchSlot("ren", "feed-post", "p", c.claimed_at!)).toBe(true);
    const retry = await claimDispatchSlot("ren", "feed-post", "p", new Date(t0.getTime() + 60_000), window30m);
    expect(retry.claimed).toBe(true);
  });

  it("never releases a later claim: the release is pinned to the caller's own stamp", async () => {
    useSend(statefulSlot());
    const mine = await claimDispatchSlot("ren", "feed-post", "p", t0, window30m);
    const later = new Date(t0.getTime() + 31 * 60_000);
    await claimDispatchSlot("ren", "feed-post", "p", later, window30m);
    expect(await releaseDispatchSlot("ren", "feed-post", "p", mine.claimed_at!)).toBe(false);
    expect((await claimDispatchSlot("ren", "feed-post", "p", later, window30m)).claimed).toBe(false);
  });
});

describe("isOrchestratorDispatchEvent", () => {
  it("recognises the explicit-fire envelope and nothing else", () => {
    expect(isOrchestratorDispatchEvent({ dispatch: { agent_slug: "ren", binding_idx: 0 } })).toBe(true);
    expect(isOrchestratorDispatchEvent({})).toBe(false);
    expect(isOrchestratorDispatchEvent({ dispatch: { agent_slug: "ren" } })).toBe(false);
    expect(isOrchestratorDispatchEvent({ dispatch: { agent_slug: "", binding_idx: 0 } })).toBe(false);
    expect(isOrchestratorDispatchEvent({ dispatch: { agent_slug: "ren", binding_idx: -1 } })).toBe(false);
    expect(isOrchestratorDispatchEvent({ dispatch: { agent_slug: "ren", binding_idx: "0" } })).toBe(false);
  });
});
