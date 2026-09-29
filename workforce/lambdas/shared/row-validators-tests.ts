// Unit tests for row-validators.ts.
//
// Covers: the three `isWellFormed*` guards (happy-path + each missing
// canonical attribute), and `emitMalformedRow` (structured log + metric
// shape for all three RowType values, plus metric-emit failure swallow).

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentMetaRow } from "./agent.js";
import type { ProjectMetaRow } from "./project.js";
import type { SkillMetaRow } from "./skill-row.js";

type MetricBatch = {
  Namespace: string;
  MetricData: Array<{
    MetricName: string;
    Value: number;
    Unit: string;
    Dimensions: Array<{ Name: string; Value: string }>;
  }>;
};

const metricBatches: MetricBatch[] = [];
const mockCw = {
  send: vi.fn(async (cmd: { input: MetricBatch }) => {
    metricBatches.push(cmd.input);
  }),
};

vi.mock("@aws-sdk/client-cloudwatch", () => ({
  CloudWatchClient: class {},
  PutMetricDataCommand: class {
    input: MetricBatch;
    constructor(input: MetricBatch) { this.input = input; }
  },
}));

const {
  isWellFormedProjectMeta,
  isWellFormedAgentMeta,
  isWellFormedSkillMeta,
  emitMalformedRow,
} = await import("./row-validators.js");

// ── Helpers ───────────────────────────────────────────────────────────────

function makeProject(overrides: Partial<ProjectMetaRow> = {}): Partial<ProjectMetaRow> {
  return {
    pk: "PROJECT#test",
    sk: "META",
    project_id: "test",
    status: "active",
    owner_agent: "aoi",
    created_at: "2026-01-01",
    ...overrides,
  };
}

function makeAgent(overrides: Partial<AgentMetaRow> = {}): Partial<AgentMetaRow> {
  return {
    pk: "AGENT#aoi",
    sk: "META",
    slug: "aoi" as AgentMetaRow["slug"],
    first_name: "Aoi",
    last_name: "Tanaka",
    role: "Designer",
    created_at: "2026-01-01",
    ...overrides,
  } as Partial<AgentMetaRow>;
}

function makeSkill(overrides: Partial<SkillMetaRow> = {}): Partial<SkillMetaRow> {
  return {
    pk: "SKILL#design-note",
    sk: "META",
    name: "design-note",
    version: "1.0.0",
    status: "active",
    created_at: "2026-01-01",
    ...overrides,
  } as Partial<SkillMetaRow>;
}

// ── isWellFormedProjectMeta ───────────────────────────────────────────────

describe("isWellFormedProjectMeta", () => {
  it("returns true for a well-formed row", () => {
    expect(isWellFormedProjectMeta(makeProject() as Partial<ProjectMetaRow>)).toBe(true);
  });

  it("rejects missing project_id", () => {
    const { project_id: _, ...row } = makeProject() as { project_id: string } & Partial<ProjectMetaRow>;
    expect(isWellFormedProjectMeta(row)).toBe(false);
  });

  it("rejects empty project_id", () => {
    expect(isWellFormedProjectMeta(makeProject({ project_id: "" }))).toBe(false);
  });

  it("rejects missing status", () => {
    const { status: _, ...row } = makeProject() as { status: string } & Partial<ProjectMetaRow>;
    expect(isWellFormedProjectMeta(row)).toBe(false);
  });

  it("rejects missing owner_agent", () => {
    const { owner_agent: _, ...row } = makeProject() as { owner_agent: string } & Partial<ProjectMetaRow>;
    expect(isWellFormedProjectMeta(row)).toBe(false);
  });

  it("rejects missing created_at", () => {
    const { created_at: _, ...row } = makeProject() as { created_at: string } & Partial<ProjectMetaRow>;
    expect(isWellFormedProjectMeta(row)).toBe(false);
  });
});

// ── isWellFormedAgentMeta ─────────────────────────────────────────────────

describe("isWellFormedAgentMeta", () => {
  it("returns true for a well-formed row", () => {
    expect(isWellFormedAgentMeta(makeAgent())).toBe(true);
  });

  it("rejects missing slug", () => {
    const { slug: _, ...row } = makeAgent() as { slug: string } & Partial<AgentMetaRow>;
    expect(isWellFormedAgentMeta(row)).toBe(false);
  });

  it("rejects empty slug", () => {
    expect(isWellFormedAgentMeta(makeAgent({ slug: "" as AgentMetaRow["slug"] }))).toBe(false);
  });

  it("rejects missing first_name", () => {
    const { first_name: _, ...row } = makeAgent() as { first_name: string } & Partial<AgentMetaRow>;
    expect(isWellFormedAgentMeta(row)).toBe(false);
  });

  it("rejects missing last_name", () => {
    const { last_name: _, ...row } = makeAgent() as { last_name: string } & Partial<AgentMetaRow>;
    expect(isWellFormedAgentMeta(row)).toBe(false);
  });

  it("rejects missing role", () => {
    const { role: _, ...row } = makeAgent() as { role: string } & Partial<AgentMetaRow>;
    expect(isWellFormedAgentMeta(row)).toBe(false);
  });

  it("rejects missing created_at", () => {
    const { created_at: _, ...row } = makeAgent() as { created_at: string } & Partial<AgentMetaRow>;
    expect(isWellFormedAgentMeta(row)).toBe(false);
  });
});

// ── isWellFormedSkillMeta ─────────────────────────────────────────────────

describe("isWellFormedSkillMeta", () => {
  it("returns true for a well-formed row", () => {
    expect(isWellFormedSkillMeta(makeSkill())).toBe(true);
  });

  it("rejects missing name", () => {
    const { name: _, ...row } = makeSkill() as { name: string } & Partial<SkillMetaRow>;
    expect(isWellFormedSkillMeta(row)).toBe(false);
  });

  it("rejects empty name", () => {
    expect(isWellFormedSkillMeta(makeSkill({ name: "" }))).toBe(false);
  });

  it("rejects missing version", () => {
    const { version: _, ...row } = makeSkill() as { version: string } & Partial<SkillMetaRow>;
    expect(isWellFormedSkillMeta(row)).toBe(false);
  });

  it("rejects missing status", () => {
    const { status: _, ...row } = makeSkill() as { status: string } & Partial<SkillMetaRow>;
    expect(isWellFormedSkillMeta(row)).toBe(false);
  });

  it("rejects missing created_at", () => {
    const { created_at: _, ...row } = makeSkill() as { created_at: string } & Partial<SkillMetaRow>;
    expect(isWellFormedSkillMeta(row)).toBe(false);
  });
});

// ── emitMalformedRow ──────────────────────────────────────────────────────

describe("emitMalformedRow", () => {
  beforeEach(() => {
    metricBatches.length = 0;
    mockCw.send.mockClear();
  });

  it("emits structured warn with row_type=project", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    emitMalformedRow({ pk: "PROJECT#bad" }, "project", mockCw as any, "test");
    expect(warnSpy).toHaveBeenCalledOnce();
    const logged = JSON.parse(warnSpy.mock.calls[0][0] as string) as Record<string, unknown>;
    expect(logged.event).toBe("agents_api_malformed_row");
    expect(logged.row_type).toBe("project");
    expect(logged.pk).toBe("PROJECT#bad");
    warnSpy.mockRestore();
  });

  it("emits WfMalformedRow metric with Stage + RowType dimensions for agent", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    emitMalformedRow({ pk: "AGENT#bad" }, "agent", mockCw as any, "prod");
    await vi.waitFor(() => expect(metricBatches.length).toBeGreaterThan(0));
    const batch = metricBatches[0];
    expect(batch.Namespace).toBe("Workforce/AgentsApi");
    const metric = batch.MetricData[0];
    expect(metric.MetricName).toBe("WfMalformedRow");
    expect(metric.Dimensions).toContainEqual({ Name: "Stage", Value: "prod" });
    expect(metric.Dimensions).toContainEqual({ Name: "RowType", Value: "agent" });
    vi.restoreAllMocks();
  });

  it("emits WfMalformedRow metric with RowType=skill", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    emitMalformedRow({ pk: "SKILL#bad" }, "skill", mockCw as any, "dev");
    await vi.waitFor(() => expect(metricBatches.length).toBeGreaterThan(0));
    const metric = metricBatches[0].MetricData[0];
    expect(metric.Dimensions).toContainEqual({ Name: "RowType", Value: "skill" });
    vi.restoreAllMocks();
  });

  it("falls back to <missing-pk> when pk absent", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    emitMalformedRow({}, "project", mockCw as any, "dev");
    const logged = JSON.parse(warnSpy.mock.calls[0][0] as string) as Record<string, unknown>;
    expect(logged.pk).toBe("<missing-pk>");
    warnSpy.mockRestore();
  });

  it("swallows metric-emit errors without throwing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const failingCw = {
      send: vi.fn().mockRejectedValue(new Error("network error")),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(async () => {
      emitMalformedRow({ pk: "PROJECT#x" }, "project", failingCw as any, "dev");
      await new Promise((r) => setTimeout(r, 10));
    }).not.toThrow();
    vi.restoreAllMocks();
  });
});
