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

// Phase 3: delivered = ANY status:ok execution, artifact_ref no longer required
// (so an artefact-less engagement such as a pr-review counts as delivered).
const okExec = (project_id: string) => ({ project_id, status: "ok" });

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
    f.agent_slug === "ren" ? [okExec("editorial")] : [],
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
  // ── Epic-021 §B.1 idle sweep — the IO seam ─────────────────────────────────
  //
  // The nine detector tests in shared/performance-tests.ts cover the pure
  // layer against a hand-built commons set. These cover `idleSignalFor` /
  // `upsertIdle`, which is where every cycle-1 defect actually lived (dario D3
  // / mateo M3): the window filter, the live-binding derivation, the real
  // COMMONS_SKILLS binding, and the row a digest will read next PR.
  //
  // Note: shared/skill-registry-generated.js is deliberately NOT mocked, so
  // these run against the real commons set (feed-post + daily-research).

  const idleRow = () =>
    putItem.mock.calls
      .map((c) => c[0] as {
        pk: string; sk: string; cohort: number; commons_skills: string[];
        probe_truncated: string[]; window: { days: number };
        idle: Array<{ slug: string; pending: string; bound_skills: string[] }>;
      })
      .find((row) => row.pk === "PERF#workforce" && row.sk === "IDLE");

  it("writes a PERF#workforce/IDLE row with the shape the digest will read", async () => {
    const res = await handler();
    const row = idleRow();
    expect(row).toBeDefined();
    expect(row!.window.days).toBe(30);
    expect(row!.cohort).toBe(3);
    expect(row!.commons_skills).toEqual(["daily-research", "feed-post"]);
    expect(row!.probe_truncated).toEqual([]);
    expect(res.idle).toBe(row!.idle.length);
  });

  it("does not flag a persona whose non-commons row is inside the window", async () => {
    listExecutions.mockImplementation(async (f: { agent_slug: string }) =>
      f.agent_slug === "ren"
        ? [{ project_id: "editorial", status: "ok", skill_name: "x", started_at: new Date().toISOString() }]
        : [],
    );
    await handler();
    expect(idleRow()!.idle.map((r) => r.slug)).not.toContain("ren");
  });

  it("still flags a persona whose entire window is commons output", async () => {
    listExecutions.mockImplementation(async (f: { agent_slug: string }) =>
      f.agent_slug === "ren"
        ? [{ project_id: "editorial", status: "ok", skill_name: "feed-post", started_at: new Date().toISOString() }]
        : [],
    );
    await handler();
    expect(idleRow()!.idle.find((r) => r.slug === "ren")).toMatchObject({ pending: "output" });
  });

  // dario D1 — the inversion this PR's cycle-1 shipped: pausing does not touch
  // bindings[], so a paused persona kept a load-bearing binding and was charged
  // `output` for silence the operator's own gate produced.
  it("attributes a PAUSED persona to the enable gate, never to the persona", async () => {
    scanAllPrefix.mockImplementation(async (pkPrefix: string) =>
      pkPrefix === "AGENT#"
        ? [{ ...META[0], paused: true }, META[1], META[2]]
        : [{ project_id: "editorial", status: "active" }],
    );
    listExecutions.mockResolvedValue([]);
    await handler();
    expect(idleRow()!.idle.find((r) => r.slug === "ren")).toMatchObject({
      pending: "enable",
      bound_skills: ["x"],
    });
  });

  it("excludes an ARCHIVED persona from the idle cohort entirely", async () => {
    scanAllPrefix.mockImplementation(async (pkPrefix: string) =>
      pkPrefix === "AGENT#"
        ? [{ ...META[0], archived: true }, META[1], META[2]]
        : [{ project_id: "editorial", status: "active" }],
    );
    listExecutions.mockResolvedValue([]);
    const res = await handler();
    const row = idleRow()!;
    expect(row.idle.map((r) => r.slug)).not.toContain("ren");
    expect(row.cohort).toBe(2); // swept cohort, not head-count
    expect(res.agents).toBe(3); // ...but LIFECYCLE still counts every persona
  });

  // dario D2 / mateo M1 — the probe must be window-scoped, and a saturated
  // page must be recorded rather than read as a clean "found nothing".
  it("scopes the idle probe to the window and marks a saturated page", async () => {
    const inWindow = new Date().toISOString();
    listExecutions.mockImplementation(async (f: { agent_slug: string; from?: string }) => {
      // The all-time "has ever delivered" probe passes no `from`; the idle
      // probe must pass one.
      if (f.agent_slug !== "ren") return [];
      if (!f.from) return [{ project_id: "editorial", status: "ok", skill_name: "x" }];
      // A full page of commons rows: saturated, so absence is not proven.
      return Array.from({ length: 100 }, () => ({
        project_id: "editorial",
        status: "ok",
        skill_name: "feed-post",
        started_at: inWindow,
      }));
    });
    await handler();
    expect(idleRow()!.probe_truncated).toEqual(["ren"]);
  });

  it("filters the idle probe by status itself rather than trusting the post-filter", async () => {
    const inWindow = new Date().toISOString();
    listExecutions.mockImplementation(async (f: { agent_slug: string; from?: string }) =>
      f.agent_slug === "ren" && f.from
        ? [{ project_id: "editorial", status: "throw", skill_name: "x", started_at: inWindow }]
        : [],
    );
    await handler();
    // A throwing non-commons run is not a deliverable — ren stays flagged.
    expect(idleRow()!.idle.map((r) => r.slug)).toContain("ren");
  });
});
