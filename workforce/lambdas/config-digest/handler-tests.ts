// Unit tests for wf-config-digest (ADR-0007 §5 weekly review + §7 export).
//
// Pins: window filtering of AUDIT items, grouped markdown rendering
// (including legible digested system_prompt diffs), the quiet-week shape
// (no issue, export still runs), and the fail-loud delivery contract.

import { beforeEach, describe, expect, it, vi } from "vitest";

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

const { handler } = await import("./handler.js");

const NOW = Date.now();
const daysAgo = (d: number) => new Date(NOW - d * 24 * 60 * 60 * 1000).toISOString();

function seedAgent(slug: string): void {
  rows.push({ pk: `AGENT#${slug}`, sk: "META", slug, archived: false });
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

    const res = await handler();

    expect(res.status).toBe("delivered");
    expect(res.mutations).toBe(2);
    expect(res.agents_changed).toBe(2);
    expect(res.issue_url).toBe("https://github.com/x/y/issues/42");
    expect(res.export_arn).toContain("export/01EXPORT");

    expect(createIssue).toHaveBeenCalledTimes(1);
    const input = createIssue.mock.calls[0]![0] as { title: string; body: string; labels: string[] };
    expect(input.title).toContain("Weekly agent-config digest");
    expect(input.labels).toEqual(["project:workforce", "layer:L3", "type:ops"]);
    expect(input.body).toContain("## sora — 1 mutation(s)");
    expect(input.body).toContain("## ren — 1 mutation(s)");
    expect(input.body).not.toContain("## maya");
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
});
