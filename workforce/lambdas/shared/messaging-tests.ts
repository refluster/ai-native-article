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
  putItem: vi.fn(async (row: AnyRow) => {
    rows.set(key(row.pk, row.sk), row);
  }),
  updateOperational: vi.fn(async (pk: string, sk: string, patch: Record<string, unknown>) => {
    const existing = rows.get(key(pk, sk)) ?? ({ pk, sk } as AnyRow);
    const merged = { ...existing, ...patch } as AnyRow;
    rows.set(key(pk, sk), merged);
    return merged;
  }),
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
    async send(cmd: { input: { Key: string; Body?: string } }) {
      // PutObjectCommand carries a Body; GetObjectCommand does not.
      if (cmd.input.Body !== undefined) {
        s3objects.set(cmd.input.Key, cmd.input.Body);
        return {};
      }
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
  PutObjectCommand: class {
    input: { Key: string; Body: string };
    constructor(input: { Key: string; Body: string }) {
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
  createThread,
  sendMessage,
  markThreadRead,
  setThreadStar,
  MESSAGING_OPERATOR_ID,
} = await import("./messaging.js");

// Deterministic id generator for write-path tests.
function seqUlid(): () => string {
  let n = 0;
  return () => `ULID${String(n++).padStart(4, "0")}`;
}
const fixedNow = () => new Date("2026-06-06T00:00:00.000Z");

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

describe("createThread", () => {
  it("writes META + first MSG + a PART row per participant", async () => {
    const { thread_id } = await createThread({
      participants: ["nadia"],
      body: "Can you do a pass on the older Stories?",
      newUlid: seqUlid(),
      now: fixedNow,
    });
    expect(thread_id).toBe("ULID0000");
    const meta = rows.get(key("THREAD#ULID0000", "META"))!;
    expect(meta.participants).toEqual(["nadia"]);
    expect(meta.group).toBe(false);
    expect(meta.created_by).toBe("operator");
    expect(rows.get(key("THREAD#ULID0000", "MSG#ULID0001"))!.from).toBe("operator");
    // operator PART read; recipient PART has one unread
    expect(rows.get(key("THREAD#ULID0000", "PART#operator"))!.unread).toBe(0);
    expect(rows.get(key("THREAD#ULID0000", "PART#nadia"))!.unread).toBe(1);
    // GSI4 projection present for inbox query
    expect(rows.get(key("THREAD#ULID0000", "PART#operator"))!.gsi4pk).toBe("INBOX#operator");
  });

  it("derives group=true for multiple talents and carries the label", async () => {
    await createThread({
      participants: ["elena", "aoi"],
      group_label: "Elena + reports",
      body: "Settling the secrets-by-basename question here.",
      newUlid: seqUlid(),
      now: fixedNow,
    });
    const meta = rows.get(key("THREAD#ULID0000", "META"))!;
    expect(meta.group).toBe(true);
    expect(meta.group_label).toBe("Elena + reports");
    // operator + 2 talents = 3 PART rows
    const parts = Array.from(rows.values()).filter((r) => String(r.sk).startsWith("PART#"));
    expect(parts).toHaveLength(3);
  });

  it("stores a long body in S3 and keeps a ≤320-char preview inline", async () => {
    const longBody = "z".repeat(900);
    await createThread({ participants: ["nadia"], body: longBody, newUlid: seqUlid(), now: fixedNow });
    const msg = rows.get(key("THREAD#ULID0000", "MSG#ULID0001"))!;
    expect((msg.body_preview as string).length).toBe(320);
    expect(msg.body_ref).toBe("messages/ULID0000/ULID0001.md");
    expect(s3objects.get("messages/ULID0000/ULID0001.md")).toBe(longBody);
  });

  it("throws on an empty body (W-4)", async () => {
    await expect(
      createThread({ participants: ["nadia"], body: "   ", newUlid: seqUlid(), now: fixedNow }),
    ).rejects.toThrow(/empty_body/);
  });
});

describe("sendMessage", () => {
  async function seedThread() {
    await createThread({
      participants: ["nadia"],
      body: "first",
      newUlid: (() => {
        let n = 0;
        return () => `SEED${n++}`;
      })(),
      now: () => new Date("2026-06-01T00:00:00.000Z"),
    });
  }

  it("appends a MSG, bumps META, and increments recipient unread", async () => {
    await seedThread();
    // operator reads, then nadia replies (Story-3-style talent message)
    await markThreadRead("SEED0", "operator");
    await sendMessage({
      thread_id: "SEED0",
      from: "nadia",
      body: "On it.",
      newUlid: seqUlid(),
      now: fixedNow,
    });
    const meta = rows.get(key("THREAD#SEED0", "META"))!;
    expect(meta.last_message_at).toBe("2026-06-06T00:00:00.000Z");
    // operator (recipient of nadia's message) now has unread; nadia (author) is 0
    expect(rows.get(key("THREAD#SEED0", "PART#operator"))!.unread).toBe(1);
    expect(rows.get(key("THREAD#SEED0", "PART#nadia"))!.unread).toBe(0);
    // denormalised summary fanned out
    expect(rows.get(key("THREAD#SEED0", "PART#operator"))!.last_message_from).toBe("nadia");
    expect(rows.get(key("THREAD#SEED0", "PART#operator"))!.last_message_preview).toBe("On it.");
  });

  it("throws when the thread has no META (W-4)", async () => {
    await expect(
      sendMessage({ thread_id: "ghost", from: "operator", body: "hello", newUlid: seqUlid(), now: fixedNow }),
    ).rejects.toThrow(/no thread META/);
  });
});

describe("markThreadRead / setThreadStar", () => {
  it("clears unread on read", async () => {
    await createThread({ participants: ["nadia"], body: "hi", newUlid: seqUlid(), now: fixedNow });
    // simulate nadia having an unread (recipient)
    expect(rows.get(key("THREAD#ULID0000", "PART#nadia"))!.unread).toBe(1);
    await markThreadRead("ULID0000", "nadia");
    expect(rows.get(key("THREAD#ULID0000", "PART#nadia"))!.unread).toBe(0);
  });

  it("mirrors the star onto META and the operator PART row", async () => {
    await createThread({ participants: ["nadia"], body: "hi", newUlid: seqUlid(), now: fixedNow });
    await setThreadStar("ULID0000", true);
    expect(rows.get(key("THREAD#ULID0000", "META"))!.starred).toBe(true);
    expect(rows.get(key("THREAD#ULID0000", "PART#operator"))!.starred).toBe(true);
  });
});
