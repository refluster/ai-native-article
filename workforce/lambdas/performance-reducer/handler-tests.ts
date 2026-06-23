// Unit tests for the Epic-016 Phase-2 performance reducer handler — the IO
// wiring around the (separately-tested) pure partition logic. The shared data-
// plane modules are mocked; shared/performance.js (pure) is exercised for real.

import { beforeEach, describe, expect, it, vi } from "vitest";

const scanAllPrefix = vi.fn();
const getItem = vi.fn();
const putItem = vi.fn();
const members = vi.fn();
const listExecutions = vi.fn();

vi.mock("../shared/ddb.js", () => ({ scanAllPrefix, getItem, putItem }));
vi.mock("../shared/project.js", () => ({
  members,
  listExecutions,
  projectPk: (id: string) => `PROJECT#${id}`,
}));
vi.mock("../shared/agent.js", () => ({
  agentPk: (slug: string) => `AGENT#${slug}`,
  // Triggerable iff a binding's scheduler is load-bearing (here: eventbridge).
  bindingCronIsLoadBearing: (b: { trigger?: { scheduler?: string } }) =>
    b.trigger?.scheduler === "eventbridge",
}));

const { handler } = await import("./handler.js");

// Three agents: delivered (ren), assigned (maya), registered (sana).
const META = [
  { slug: "ren", bindings: [{ skill: "x", executor: "lambda", trigger: { scheduler: "eventbridge" } }] },
  { slug: "maya", bindings: [{ skill: "y", executor: "lambda", trigger: { scheduler: "eventbridge" }, project_id: "editorial" }] },
  { slug: "sana", bindings: [{ skill: "z", executor: "cli", trigger: { scheduler: "manual" } }] },
];

const okExecWithArtifact = (project_id: string) => ({
  project_id,
  status: "ok",
  artifact_ref: { uri: "s3://b/k", content_hash: "h", content_type: "text/markdown", size_bytes: 1, summary: "s" },
});

beforeEach(() => {
  vi.clearAllMocks();
  getItem.mockResolvedValue(undefined); // no prior PERF# rows
  // AGENT# META scan first, PROJECT# META scan second.
  scanAllPrefix.mockImplementation(async (pkPrefix: string) =>
    pkPrefix === "AGENT#"
      ? META
      : [{ project_id: "editorial", status: "active" }, { project_id: "ghost", status: "archived" }],
  );
  // ren delivered (has ok+artifact), others none.
  listExecutions.mockImplementation(async (f: { agent_slug: string }) =>
    f.agent_slug === "ren" ? [okExecWithArtifact("editorial")] : [],
  );
  members.mockResolvedValue(["ren", "maya"]);
});

describe("performance-reducer handler", () => {
  it("partitions the workforce cohort by furthest state (head-count)", async () => {
    const res = await handler();
    expect(res.agents).toBe(3);
    expect(res.workforce).toEqual({ registered: 1, assigned: 1, delivered: 1 });
  });

  it("writes a PERF#workforce/LIFECYCLE roll-up with today's point", async () => {
    const today = new Date().toISOString().slice(0, 10);
    await handler();
    const wf = putItem.mock.calls
      .map((c) => c[0] as { pk: string; sk: string; points: Array<{ date: string }> })
      .find((row) => row.pk === "PERF#workforce" && row.sk === "LIFECYCLE");
    expect(wf).toBeDefined();
    expect(wf!.points.at(-1)!.date).toBe(today);
  });

  it("snapshots only active projects (sparse map)", async () => {
    const res = await handler();
    expect(res.projects).toBe(1); // editorial active; ghost archived → skipped
    const projRow = putItem.mock.calls
      .map((c) => c[0] as { pk: string })
      .find((row) => row.pk === "PERF#editorial");
    expect(projRow).toBeDefined();
  });

  it("classifies an agent delivered only when the artefact is in the project's partition", async () => {
    // ren delivered on editorial; in editorial's funnel ren=delivered, maya=assigned.
    await handler();
    const projRow = putItem.mock.calls
      .map((c) => c[0] as { pk: string; points: Array<{ registered: number; assigned: number; delivered: number }> })
      .find((row) => row.pk === "PERF#editorial");
    expect(projRow!.points.at(-1)).toMatchObject({ registered: 0, assigned: 1, delivered: 1 });
  });
});
