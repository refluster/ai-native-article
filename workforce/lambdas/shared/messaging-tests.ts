// Unit tests for shared/messaging.ts (Epic-013 Story 1, #248).
//
// The DDB layer and S3 are mocked so the tests exercise the read-helper
// logic (inbox ordering/filtering, thread assembly, body resolution)
// without AWS. Mocks are declared before the SUT is imported (vitest
// hoist-safe `await import` ordering, matching handler-tests.ts).

import { describe, it, expect, beforeEach, vi } from "vitest";

process.env.BUCKET_NAME = "wf-bucket-test";

type AnyRow = Record<string, unknown> & { pk: string; sk: string };

const rows = new Map<string, AnyRow>();
const key = (pk: string, sk: string) => `${pk}|${sk}`;

// In-memory S3: key -> body string.
const s3objects = new Map<string, string>();

vi.mock("./ddb.js", () => ({
  getItem: vi.fn(async (pk: string, sk: string) => rows.get(key(pk, sk))),
  queryBySkPrefix: vi.fn(async (pk: string, skPrefix: string, _limit?: number) =>
    Array.from(rows.values())
      .filter((r) => r.pk === pk && typeof r.sk === "string" && r.sk.startsWith(skPrefix))
      // ascending by sk — mirrors DynamoDB default ScanIndexForward=true
      .sort((a, b) => (a.sk < b.sk ? -1 : a.sk > b.sk ? 1 : 0)),
  ),
  queryByGsiPaged: vi.fn(
    async (
      _indexName: string,
      partitionKey: string,
      query: { limit?: number; scanIndexForward?: boolean; cursor?: string } = {},
    ) => {
      let items = Array.from(rows.values()).filter((r) => r.gsi4pk === partitionKey);
      items = items.sort((a, b) => {
        const av = String(a.gsi4sk);
        const bv = String(b.gsi4sk);
        return av < bv ? -1 : av > bv ? 1 : 0;
      });
      if (query.scanIndexForward === false) items = items.reverse();
      return { items: items.slice(0, query.limit ?? 100), cursor: undefined };
    },
  ),
}));

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    async send(cmd: { input: { Key: string } }) {
      const body = s3objects.get(cmd.input.Key);
      if (body === undefined) return { Body: undefined };
      return { Body: { transformToString: async () => body } };
    }
  },
  GetObjectCommand: class {
    input: { Key: string };
    constructor(input: { Key: string }) {
      this.input = input;
    }
  },
}));

const {
  listInbox,
  getThreadDetail,
  toThreadSummaryView,
  threadPk,
  messageIdFromSk,
  inboxGsiPk,
  MESSAGING_OPERATOR_ID,
} = await import("./messaging.js");

function partRow(over: Partial<AnyRow> & { thread_id: string; last_message_at: string }): AnyRow {
  const slug = (over.participant as string) ?? MESSAGING_OPERATOR_ID;
  const base: Partial<AnyRow> = {
    unread: 0,
    participants: ["maya"],
    group: false,
    starred: false,
    last_message_from: "maya",
    last_message_preview: "hi",
  };
  return {
    ...base,
    ...over,
    // Computed keys depend on slug / thread_id from `over`; set last so the
    // spread can't overwrite them.
    pk: `THREAD#${over.thread_id}`,
    sk: `PART#${slug}`,
    participant: slug,
    gsi4pk: `INBOX#${slug}`,
    gsi4sk: over.last_message_at,
  } as AnyRow;
}

beforeEach(() => {
  rows.clear();
  s3objects.clear();
});

describe("key + id helpers", () => {
  it("builds the thread partition key", () => {
    expect(threadPk("01ABC")).toBe("THREAD#01ABC");
  });
  it("strips the MSG# prefix", () => {
    expect(messageIdFromSk("MSG#01XYZ")).toBe("01XYZ");
  });
  it("builds the inbox GSI partition key", () => {
    expect(inboxGsiPk("nadia")).toBe("INBOX#nadia");
  });
});

describe("toThreadSummaryView", () => {
  it("maps a PART row to the inbox summary shape", () => {
    const row = partRow({
      thread_id: "t1",
      last_message_at: "2026-06-02T09:24:00Z",
      unread: 2,
      starred: true,
      participants: ["elena", "aoi"],
      group: true,
      group_label: "Elena + reports",
      last_message_from: "aoi",
      last_message_preview: "Agree. I'll update the infra doc.",
    });
    const view = toThreadSummaryView(row as never);
    expect(view).toEqual({
      thread_id: "t1",
      participants: ["elena", "aoi"],
      group: true,
      group_label: "Elena + reports",
      starred: true,
      unread: 2,
      last_message: {
        from: "aoi",
        at: "2026-06-02T09:24:00Z",
        preview: "Agree. I'll update the infra doc.",
      },
    });
  });
});

describe("listInbox", () => {
  it("returns the operator's threads newest-first", async () => {
    rows.set(key("THREAD#a", "PART#operator"), partRow({ thread_id: "a", last_message_at: "2026-06-01T00:00:00Z" }));
    rows.set(key("THREAD#b", "PART#operator"), partRow({ thread_id: "b", last_message_at: "2026-06-03T00:00:00Z" }));
    rows.set(key("THREAD#c", "PART#operator"), partRow({ thread_id: "c", last_message_at: "2026-06-02T00:00:00Z" }));
    const page = await listInbox({ slug: MESSAGING_OPERATOR_ID, pageSize: 25 });
    expect(page.items.map((r) => r.thread_id)).toEqual(["b", "c", "a"]);
  });

  it("scopes to the requested participant's inbox", async () => {
    rows.set(key("THREAD#a", "PART#operator"), partRow({ thread_id: "a", last_message_at: "2026-06-01T00:00:00Z", participant: "operator" }));
    rows.set(key("THREAD#a", "PART#nadia"), partRow({ thread_id: "a", last_message_at: "2026-06-01T00:00:00Z", participant: "nadia" }));
    const page = await listInbox({ slug: "nadia", pageSize: 25 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.participant).toBe("nadia");
  });

  it("filters to unread when requested", async () => {
    rows.set(key("THREAD#a", "PART#operator"), partRow({ thread_id: "a", last_message_at: "2026-06-01T00:00:00Z", unread: 0 }));
    rows.set(key("THREAD#b", "PART#operator"), partRow({ thread_id: "b", last_message_at: "2026-06-02T00:00:00Z", unread: 3 }));
    const page = await listInbox({ slug: MESSAGING_OPERATOR_ID, pageSize: 25, filter: "unread" });
    expect(page.items.map((r) => r.thread_id)).toEqual(["b"]);
  });

  it("filters to starred when requested", async () => {
    rows.set(key("THREAD#a", "PART#operator"), partRow({ thread_id: "a", last_message_at: "2026-06-01T00:00:00Z", starred: false }));
    rows.set(key("THREAD#b", "PART#operator"), partRow({ thread_id: "b", last_message_at: "2026-06-02T00:00:00Z", starred: true }));
    const page = await listInbox({ slug: MESSAGING_OPERATOR_ID, pageSize: 25, filter: "starred" });
    expect(page.items.map((r) => r.thread_id)).toEqual(["b"]);
  });
});

describe("getThreadDetail", () => {
  function seedThread() {
    rows.set(key("THREAD#t1", "META"), {
      pk: "THREAD#t1",
      sk: "META",
      thread_id: "t1",
      participants: ["maya"],
      group: false,
      created_by: "operator",
      created_at: "2026-06-02T09:10:00Z",
      last_message_at: "2026-06-02T09:24:00Z",
      starred: true,
    });
    rows.set(key("THREAD#t1", "MSG#01A"), {
      pk: "THREAD#t1",
      sk: "MSG#01A",
      thread_id: "t1",
      from: "maya",
      at: "2026-06-02T09:10:00Z",
      body_preview: "Decomposed Epic-011 into eight Stories.",
    });
    rows.set(key("THREAD#t1", "MSG#01B"), {
      pk: "THREAD#t1",
      sk: "MSG#01B",
      thread_id: "t1",
      from: "operator",
      at: "2026-06-02T09:18:00Z",
      body_preview: "Agreed on Story 3 especially.",
    });
  }

  it("returns undefined when the thread has no META", async () => {
    expect(await getThreadDetail("missing")).toBeUndefined();
  });

  it("assembles messages oldest-first with inline bodies", async () => {
    seedThread();
    const detail = await getThreadDetail("t1");
    expect(detail).toBeDefined();
    expect(detail!.thread_id).toBe("t1");
    expect(detail!.starred).toBe(true);
    expect(detail!.messages.map((m) => m.message_id)).toEqual(["01A", "01B"]);
    expect(detail!.messages[0]!.body).toBe("Decomposed Epic-011 into eight Stories.");
    expect(detail!.messages[1]!.from).toBe("operator");
  });

  it("hydrates a long body from S3 when body_ref is set", async () => {
    seedThread();
    const longBody = "x".repeat(500);
    s3objects.set("messages/t1/01C.md", longBody);
    rows.set(key("THREAD#t1", "MSG#01C"), {
      pk: "THREAD#t1",
      sk: "MSG#01C",
      thread_id: "t1",
      from: "maya",
      at: "2026-06-02T09:24:00Z",
      body_preview: "x".repeat(320),
      body_ref: "messages/t1/01C.md",
    });
    const detail = await getThreadDetail("t1");
    const last = detail!.messages.at(-1)!;
    expect(last.message_id).toBe("01C");
    expect(last.body).toBe(longBody);
  });

  it("throws when a referenced S3 body does not resolve (W-4)", async () => {
    seedThread();
    rows.set(key("THREAD#t1", "MSG#01D"), {
      pk: "THREAD#t1",
      sk: "MSG#01D",
      thread_id: "t1",
      from: "maya",
      at: "2026-06-02T09:30:00Z",
      body_preview: "y".repeat(320),
      body_ref: "messages/t1/missing.md",
    });
    await expect(getThreadDetail("t1")).rejects.toThrow(/message body not found/);
  });
});
