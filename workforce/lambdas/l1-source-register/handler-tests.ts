import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the shared secret + notion helpers so the handler runs without AWS.
const getSecret = vi.fn();
const insertL1Source = vi.fn();
const findL1SourceByUrl = vi.fn();
const listL1Sources = vi.fn();

vi.mock("../shared/secrets.js", () => ({ getSecret }));
vi.mock("../shared/notion.js", () => ({ insertL1Source, findL1SourceByUrl, listL1Sources }));

const { handler } = await import("./handler.js");

const TOKEN = "s3cr3t-token";

function evt(body: unknown, auth?: string) {
  return {
    headers: auth ? { authorization: auth } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  getSecret.mockImplementation(async (name: string) => {
    if (name === "wf/api/l1-source-write-token") return { token: TOKEN };
    if (name === "wf/notion") return { apiKey: "notion-key", databaseId: "unified" };
    throw new Error(`unexpected secret ${name}`);
  });
  findL1SourceByUrl.mockResolvedValue(null);
  insertL1Source.mockResolvedValue({ pageId: "p1", url: "https://notion.so/p1" });
  listL1Sources.mockResolvedValue([{ id: "a", sourceUrl: "https://x.com/a" }]);
});

function getEvt(auth?: string) {
  return {
    headers: auth ? { authorization: auth } : {},
    requestContext: { http: { method: "GET" } },
  } as never;
}

describe("wf-l1-source-register handler", () => {
  it("rejects a missing bearer token (401)", async () => {
    const res = await handler(evt({ url: "https://x.com/a" }));
    expect(res.statusCode).toBe(401);
    expect(insertL1Source).not.toHaveBeenCalled();
  });

  it("rejects a wrong bearer token (401)", async () => {
    const res = await handler(evt({ url: "https://x.com/a" }, "Bearer nope"));
    expect(res.statusCode).toBe(401);
  });

  it("rejects a missing url (400)", async () => {
    const res = await handler(evt({ title: "t" }, `Bearer ${TOKEN}`));
    expect(res.statusCode).toBe(400);
  });

  it("rejects a non-http url (400)", async () => {
    const res = await handler(evt({ url: "ftp://x" }, `Bearer ${TOKEN}`));
    expect(res.statusCode).toBe(400);
  });

  it("creates an L1 row for a fresh url (201, no LLM)", async () => {
    const res = await handler(
      evt({ url: "https://x.com/a", title: "Hi", category: "B" }, `Bearer ${TOKEN}`),
    );
    expect(res.statusCode).toBe(201);
    expect(insertL1Source).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://x.com/a", title: "Hi", category: "B" }),
    );
    expect(JSON.parse(res.body as string)).toMatchObject({ ok: true, deduped: false });
  });

  it("is idempotent — returns the existing row for a duplicate url (200)", async () => {
    findL1SourceByUrl.mockResolvedValue({ pageId: "old", url: "https://notion.so/old" });
    const res = await handler(evt({ url: "https://x.com/a" }, `Bearer ${TOKEN}`));
    expect(res.statusCode).toBe(200);
    expect(insertL1Source).not.toHaveBeenCalled();
    expect(JSON.parse(res.body as string)).toMatchObject({ deduped: true, pageId: "old" });
  });

  it("GET /l1/sources lists recent rows (200)", async () => {
    const res = await handler(getEvt(`Bearer ${TOKEN}`));
    expect(res.statusCode).toBe(200);
    expect(listL1Sources).toHaveBeenCalled();
    expect(insertL1Source).not.toHaveBeenCalled();
    expect(JSON.parse(res.body as string)).toMatchObject({ ok: true, data: [{ id: "a" }] });
  });

  it("GET without a token is rejected (401)", async () => {
    const res = await handler(getEvt());
    expect(res.statusCode).toBe(401);
    expect(listL1Sources).not.toHaveBeenCalled();
  });
});
