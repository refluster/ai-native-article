// Unit tests for wf-config-digest (ADR-0007 §5 weekly review + §7 export).
//
// Pins: window filtering of AUDIT items, grouped markdown rendering
// (including legible digested system_prompt diffs), the quiet-week shape
// (no issue, export still runs), the fail-loud delivery contract, and
// org-graph validation (FU-022: cycle + dangling edge detection).

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentMetaRow } from "../shared/agent.js";

process.env.STAGE = "test";
process.env.TABLE_ARN = "arn:aws:dynamodb:us-west-2:123456789012:table/wf-table-test";
process.env.BUCKET_NAME = "wf-bucket-test";

const exportCalls: unknown[] = [];
vi.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: class {
    async send(cmd: { input: unknown }) {
      exportCalls.push(cmd.input);
      return { ExportDescription: { ExportArn: "arn:aws:dynamodb:...:export/01EXPORT" } };
    }
  },
  ExportTableToPointInTimeCommand: class {
    constructor(public input: unknown) {}
  },
}));

interface AnyRow {
  pk: string;
  sk: string;
  [k: string]: unknown;
}
const rows: AnyRow[] = [];

vi.mock("../shared/ddb.js", () => ({
  scanPrefix: vi.fn(async (pkPrefix: string, sk: string, limit: number) => ({
    items: rows.filter((r) => r.pk.startsWith(pkPrefix) && r.sk === sk).slice(0, limit),
    cursor: undefined,
  })),
  queryBySkPrefix: vi.fn(async (pk: string, skPrefix: string, limit: number) =>
    rows.filter((r) => r.pk === pk && r.sk.startsWith(skPrefix)).slice(0, limit),
  ),
  putItem: vi.fn(),
  queryBySkPrefixPaged: vi.fn(),
}));

const createIssue = vi.fn();
vi.mock("../shared/github.js", () => ({
  createIssue: (...args: unknown[]) => createIssue(...args),
}));

const { handler, checkOrgGraph } = await import("./handler.js");

const NOW = Date.now();
const daysAgo = (d: number) => new Date(NOW - d * 24 * 60 * 60 * 1000).toISOString();

function seedAgent(slug: string): void {
  rows.push({ pk: `AGENT#${slug}`, sk: "META", slug, archived: false });
}

function seedSkill(name: string): void {
  rows.push({ pk: `SKILL#${name}`, sk: "META", name, status: "active" });
}

function seedSkillAudit(
  name: string,
  at: string,
  changes: Array<{ field: string; before: unknown; after: unknown }>,
): void {
  rows.push({
    pk: `SKILL#${name}`,
    sk: `AUDIT#${at}#abcd1234`,
    name,
    at,
    actor: "arn:aws:iam::123456789012:user/operator",
    source: "agents-api",
    kind: "config",
    changes,
  });
}

function seedAudit(
  slug: string,
  at: string,
  changes: Array<{ field: string; before: unknown; after: unknown }>,
  kind = "identity",
): void {
  rows.push({
    pk: `AGENT#${slug}`,
    sk: `AUDIT#${at}#abcd1234`,
    slug,
    at,
    actor: "arn:aws:iam::123456789012:user/operator",
    source: "agents-api",
    kind,
    changes,
  });
}

beforeEach(() => {
  rows.length = 0;
  exportCalls.length = 0;
  createIssue.mockReset();
  createIssue.mockResolvedValue({ number: 42, url: "https://github.com/x/y/issues/42" });
});

describe("wf-config-digest", () => {
  it("compiles in-window mutations into a grouped issue and reports the export", async () => {
    seedAgent("sora");
    seedAgent("ren");
    seedAgent("maya"); // no mutations — must not appear
    seedAudit("sora", daysAgo(1), [
      { field: "model", before: "anthropic:claude-sonnet-4-6", after: "anthropic:claude-opus-4-8" },
    ]);
    seedAudit("sora", daysAgo(20), [{ field: "role", before: "Old", after: "Ancient" }]); // out of window
    seedAudit("ren", daysAgo(3), [{ field: "paused", before: false, after: true }], "operational");
    // ADR-0008: skill mutations land in the same digest under skill:{name}.
    seedSkill("grid-watch");
    seedSkill("feed-post"); // no mutations — must not appear
    seedSkillAudit("grid-watch", daysAgo(2), [
      { field: "version", before: "0.1.0", after: "0.2.0" },
    ]);

    const res = await handler();

    expect(res.status).toBe("delivered");
    expect(res.mutations).toBe(3);
    expect(res.agents_changed).toBe(2);
    expect(res.skills_changed).toBe(1);
    expect(res.issue_url).toBe("https://github.com/x/y/issues/42");
    expect(res.export_arn).toContain("export/01EXPORT");

    expect(createIssue).toHaveBeenCalledTimes(1);
    const input = createIssue.mock.calls[0]![0] as { title: string; body: string; labels: string[] };
    expect(input.title).toContain("Weekly config digest");
    expect(input.labels).toEqual(["project:workforce", "layer:L3", "type:ops"]);
    expect(input.body).toContain("## sora — 1 mutation(s)");
    expect(input.body).toContain("## ren — 1 mutation(s)");
    expect(input.body).not.toContain("## maya");
    expect(input.body).toContain("## skill:grid-watch — 1 mutation(s)");
    expect(input.body).not.toContain("## skill:feed-post");
    expect(input.body).not.toContain("Ancient"); // out-of-window change excluded
    expect(input.body).toContain("`anthropic:claude-sonnet-4-6` → `anthropic:claude-opus-4-8`");
    expect(input.body).toContain("actor `user/operator`");
  });

  it("renders digested long-string values legibly (system_prompt case)", async () => {
    seedAgent("sora");
    seedAudit("sora", daysAgo(2), [
      {
        field: "system_prompt",
        before: { truncated: true, length: 2100, sha256: "a".repeat(64), head: "You are Sora v1." },
        after: { truncated: true, length: 3300, sha256: "b".repeat(64), head: "You are Sora v2." },
      },
    ]);

    await handler();

    const body = (createIssue.mock.calls[0]![0] as { body: string }).body;
    expect(body).toContain("**system_prompt**");
    expect(body).toContain("3,300 chars");
    expect(body).toContain("You are Sora v2.");
    expect(body).toContain("`bbbbbbbbbbbb…`"); // sha prefix, not the full text
  });

  it("quiet week: no issue, export still runs, status=empty", async () => {
    seedAgent("sora");

    const res = await handler();

    expect(res.status).toBe("empty");
    expect(res.mutations).toBe(0);
    expect(createIssue).not.toHaveBeenCalled();
    expect(exportCalls).toHaveLength(1);
  });

  it("fail-loud: a delivery failure propagates (Errors alarm picks it up)", async () => {
    seedAgent("sora");
    seedAudit("sora", daysAgo(1), [{ field: "role", before: "A", after: "B" }]);
    createIssue.mockRejectedValueOnce(new Error("github create-issue 502"));

    await expect(handler()).rejects.toThrow("github create-issue 502");
  });

  it("fail-loud: a full audit page (possible window truncation) throws instead of delivering a partial digest", async () => {
    seedAgent("sora");
    for (let i = 0; i < 500; i++) {
      seedAudit("sora", daysAgo(1), [{ field: "role", before: `r${i}`, after: `r${i + 1}` }]);
    }
    await expect(handler()).rejects.toThrow(/cannot prove window completeness/);
    expect(createIssue).not.toHaveBeenCalled();
  });

  it("export parameters target the wf bucket exports/ prefix", async () => {
    seedAgent("sora");
    await handler();
    expect(exportCalls[0]).toMatchObject({
      TableArn: process.env.TABLE_ARN,
      S3Bucket: "wf-bucket-test",
      ExportFormat: "DYNAMODB_JSON",
    });
    expect((exportCalls[0] as { S3Prefix: string }).S3Prefix).toMatch(/^exports\/test\/\d{4}-\d{2}-\d{2}$/);
  });

  it("org_violations=0 on a clean roster (quiet week)", async () => {
    seedAgent("alice");
    rows.find((r) => r.pk === "AGENT#alice")!.reports_to = [];
    const res = await handler();
    expect(res.status).toBe("empty");
    expect(res.org_violations).toBe(0);
  });
});

// ── checkOrgGraph unit tests (FU-022) ────────────────────────────────────

function makeAgents(defs: Array<{ slug: string; reports_to?: string[]; lateral?: string[] }>): ReadonlyMap<string, AgentMetaRow> {
  const m = new Map<string, AgentMetaRow>();
  for (const d of defs) {
    m.set(d.slug, {
      pk: `AGENT#${d.slug}`,
      sk: "META",
      slug: d.slug,
      paused: false,
      archived: false,
      created_at: "2026-01-01T00:00:00.000Z",
      reports_to: d.reports_to ?? [],
      lateral: d.lateral ?? [],
    } as AgentMetaRow);
  }
  return m;
}

describe("checkOrgGraph", () => {
  it("returns empty on a clean roster", () => {
    const agents = makeAgents([
      { slug: "alice", reports_to: ["bob"] },
      { slug: "bob", reports_to: [] },
      { slug: "cara", reports_to: ["bob"], lateral: ["alice"] },
    ]);
    expect(checkOrgGraph(agents)).toEqual([]);
  });

  it("detects a dangling reports_to edge", () => {
    const agents = makeAgents([
      { slug: "alice", reports_to: ["ghost"] }, // ghost not in roster
    ]);
    const v = checkOrgGraph(agents);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ kind: "dangling", slug: "alice", field: "reports_to", edge: "ghost" });
  });

  it("detects a dangling lateral edge", () => {
    const agents = makeAgents([
      { slug: "alice", lateral: ["nobody"] },
    ]);
    const v = checkOrgGraph(agents);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ kind: "dangling", slug: "alice", field: "lateral", edge: "nobody" });
  });

  it("detects a two-node cycle in reports_to", () => {
    const agents = makeAgents([
      { slug: "alice", reports_to: ["bob"] },
      { slug: "bob", reports_to: ["alice"] },
    ]);
    const v = checkOrgGraph(agents);
    const cycles = v.filter((x) => x.kind === "cycle");
    expect(cycles.length).toBeGreaterThanOrEqual(1);
    const path = cycles[0]!.cycle_path!;
    expect(path[0]).toBe(path[path.length - 1]); // closed path
  });

  it("detects a three-node cycle in reports_to", () => {
    const agents = makeAgents([
      { slug: "a", reports_to: ["b"] },
      { slug: "b", reports_to: ["c"] },
      { slug: "c", reports_to: ["a"] },
    ]);
    const v = checkOrgGraph(agents);
    const cycles = v.filter((x) => x.kind === "cycle");
    expect(cycles.length).toBeGreaterThanOrEqual(1);
  });

  it("does NOT flag a cycle in lateral edges (bidirectional by design)", () => {
    const agents = makeAgents([
      { slug: "alice", lateral: ["bob"] },
      { slug: "bob", lateral: ["alice"] },
    ]);
    const v = checkOrgGraph(agents);
    expect(v.filter((x) => x.kind === "cycle")).toHaveLength(0);
  });

  it("reports both dangling and cycle in the same roster", () => {
    const agents = makeAgents([
      { slug: "alice", reports_to: ["bob"], lateral: ["ghost"] },
      { slug: "bob", reports_to: ["alice"] }, // alice ↔ bob cycle
    ]);
    const v = checkOrgGraph(agents);
    expect(v.some((x) => x.kind === "dangling" && x.edge === "ghost")).toBe(true);
    expect(v.some((x) => x.kind === "cycle")).toBe(true);
  });
});

describe("wf-config-digest — org-graph integration (FU-022)", () => {
  beforeEach(() => {
    rows.length = 0;
    exportCalls.length = 0;
    createIssue.mockReset();
    createIssue.mockResolvedValue({ number: 43, url: "https://github.com/x/y/issues/43" });
  });

  it("quiet week with dangling edge: creates issue even with zero mutations", async () => {
    rows.push({ pk: "AGENT#alice", sk: "META", slug: "alice", reports_to: ["ghost"], lateral: [], paused: false, archived: false, created_at: "2026-01-01T00:00:00.000Z" });

    const res = await handler();

    expect(res.status).toBe("delivered");
    expect(res.mutations).toBe(0);
    expect(res.org_violations).toBe(1);
    expect(createIssue).toHaveBeenCalledTimes(1);
    const { title, body } = createIssue.mock.calls[0]![0] as { title: string; body: string };
    expect(title).toContain("⚠️");
    expect(body).toContain("dangling");
    expect(body).toContain("alice.reports_to");
    expect(body).toContain("ghost");
  });

  it("mutations week with violations: title has ⚠️ and body has violations section before mutation sections", async () => {
    rows.push({ pk: "AGENT#alice", sk: "META", slug: "alice", reports_to: ["bob"], lateral: [], paused: false, archived: false, created_at: "2026-01-01T00:00:00.000Z" });
    // bob not in roster → dangling
    seedAudit("alice", daysAgo(1), [{ field: "paused", before: false, after: true }]);

    const res = await handler();

    expect(res.org_violations).toBe(1);
    const body = (createIssue.mock.calls[0]![0] as { body: string }).body;
    const violationsIdx = body.indexOf("## ⚠️ Org-graph violations");
    const mutationsIdx = body.indexOf("## alice —");
    expect(violationsIdx).toBeGreaterThan(-1);
    expect(mutationsIdx).toBeGreaterThan(-1);
    expect(violationsIdx).toBeLessThan(mutationsIdx); // violations section comes first
  });

  it("clean quiet week: no issue, org_violations=0", async () => {
    rows.push({ pk: "AGENT#alice", sk: "META", slug: "alice", reports_to: [], lateral: [], paused: false, archived: false, created_at: "2026-01-01T00:00:00.000Z" });

    const res = await handler();

    expect(res.status).toBe("empty");
    expect(res.org_violations).toBe(0);
    expect(createIssue).not.toHaveBeenCalled();
  });
});
