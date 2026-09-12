// Unit tests for shared/board.ts — the pure helpers (ADR-0034): password
// hashing + verification, the board-scoped HMAC token, nickname and
// mention parsing, the ULID lower bound, and the row → view projection.
// DDB / S3 are mocked wholesale; the query helpers are exercised through
// the agents-api boards module and the reply Lambda tests.

import { describe, expect, it, vi } from "vitest";

vi.mock("./ddb.js", () => ({
  ddb: { send: vi.fn() },
  getItem: vi.fn(),
  putItem: vi.fn(),
  updateOperational: vi.fn(),
}));
vi.mock("./task.js", () => ({ newUlid: () => "01TESTULID0000000000000000" }));
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    send() {
      return Promise.resolve({});
    }
  },
  GetObjectCommand: class {
    constructor(public input: unknown) {}
  },
  PutObjectCommand: class {
    constructor(public input: unknown) {}
  },
}));

import {
  hashBoardPassword,
  mintBoardToken,
  newPasswordSalt,
  normaliseNickname,
  parseMentions,
  toBoardPostView,
  ulidLowerBound,
  verifyBoardPassword,
  verifyBoardToken,
  type BoardMetaRow,
  type BoardPostRow,
} from "./board.js";

async function meta(password = "open-sesame"): Promise<BoardMetaRow> {
  const salt = newPasswordSalt();
  return {
    pk: "BOARD#demo",
    sk: "META",
    board_id: "demo",
    name: "Demo board",
    password_salt: salt,
    password_hash: await hashBoardPassword(password, salt),
    archived: false,
    created_at: "2026-09-12T00:00:00.000Z",
  };
}

describe("password", () => {
  it("verifies the right password and rejects the wrong one", async () => {
    const m = await meta("open-sesame");
    expect(await verifyBoardPassword(m, "open-sesame")).toBe(true);
    expect(await verifyBoardPassword(m, "open-sesam")).toBe(false);
    expect(await verifyBoardPassword(m, "")).toBe(false);
  });

  it("salts: the same password hashes differently under two salts", async () => {
    const a = await hashBoardPassword("pw", newPasswordSalt());
    const b = await hashBoardPassword("pw", newPasswordSalt());
    expect(a).not.toEqual(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("board token", () => {
  it("round-trips nickname + board and expires", async () => {
    const m = await meta();
    const now = Date.parse("2026-09-12T10:00:00Z");
    const token = mintBoardToken(m, "Hana", now, 1000);
    expect(verifyBoardToken(m, token, now + 500)).toEqual({
      board_id: "demo",
      nickname: "Hana",
      expires_at: new Date(now + 1000).toISOString(),
    });
    expect(verifyBoardToken(m, token, now + 1000)).toBeUndefined();
  });

  it("is bound to the board's password hash — a rotated password revokes it", async () => {
    const m = await meta("first");
    const token = mintBoardToken(m, "Hana");
    const rotated: BoardMetaRow = { ...m, password_hash: await hashBoardPassword("second", m.password_salt) };
    expect(verifyBoardToken(rotated, token)).toBeUndefined();
  });

  it("rejects a token minted for another board with the same hash", async () => {
    const m = await meta();
    const other: BoardMetaRow = { ...m, board_id: "other", pk: "BOARD#other" };
    const token = mintBoardToken(other, "Hana");
    expect(verifyBoardToken(m, token)).toBeUndefined();
  });

  it("rejects tampering and garbage", async () => {
    const m = await meta();
    const token = mintBoardToken(m, "Hana");
    const [payload, sig] = token.split(".");
    const forged = `${Buffer.from(JSON.stringify({ b: "demo", n: "Admin", exp: Date.now() + 1e9 })).toString("base64url")}.${sig}`;
    expect(verifyBoardToken(m, forged)).toBeUndefined();
    expect(verifyBoardToken(m, `${payload}.`)).toBeUndefined();
    expect(verifyBoardToken(m, "nonsense")).toBeUndefined();
    expect(verifyBoardToken(m, "")).toBeUndefined();
  });
});

describe("normaliseNickname", () => {
  it("trims, collapses whitespace, caps length, refuses @ and control chars", () => {
    expect(normaliseNickname("  Hana   Sato ")).toBe("Hana Sato");
    expect(normaliseNickname("上原")).toBe("上原");
    expect(normaliseNickname("")).toBeUndefined();
    expect(normaliseNickname("@maya")).toBeUndefined();
    expect(normaliseNickname("a".repeat(33))).toBeUndefined();
    expect(normaliseNickname("badname")).toBeUndefined();
    expect(normaliseNickname(42)).toBeUndefined();
  });
});

describe("parseMentions", () => {
  const known = new Set(["maya", "dario", "ren"]);

  it("finds roster slugs, lowercased, deduplicated, in order", () => {
    expect(parseMentions("@Maya and @dario, then @maya again", known)).toEqual(["maya", "dario"]);
  });

  it("ignores unknown slugs, e-mail-glued handles, and bare @", () => {
    expect(parseMentions("@nobody @ mail@maya.example @", known)).toEqual([]);
  });

  it("tolerates Japanese text glued after the slug", () => {
    expect(parseMentions("@mayaさん、これは@renに聞くべき？", known)).toEqual(["maya", "ren"]);
  });
});

describe("ulidLowerBound", () => {
  it("encodes the time prefix and zero-fills the random tail", () => {
    const lb = ulidLowerBound(Date.parse("2026-09-12T00:00:00Z"));
    expect(lb).toHaveLength(26);
    expect(lb.endsWith("0000000000000000")).toBe(true);
    // Monotone in time.
    expect(ulidLowerBound(1000) < ulidLowerBound(2000)).toBe(true);
    expect(ulidLowerBound(0)).toBe("0".repeat(26));
  });
});

describe("toBoardPostView", () => {
  it("projects the row and carries the reply quote fields", () => {
    const row: BoardPostRow = {
      pk: "BOARD#demo",
      sk: "POST#01B",
      post_id: "01B",
      board_id: "demo",
      author_kind: "agent",
      author: "maya",
      at: "2026-09-12T00:00:01.000Z",
      body_preview: "short",
      reply_to: "01A",
      reply_to_author: "Hana",
      reply_to_author_kind: "human",
      reply_to_preview: "the question",
      root_post_id: "01A",
      hop: 1,
      mentions: [],
      tokens_in: 1,
    };
    expect(toBoardPostView(row, "short")).toEqual({
      post_id: "01B",
      author_kind: "agent",
      author: "maya",
      at: "2026-09-12T00:00:01.000Z",
      body: "short",
      reply_to: "01A",
      reply_to_author: "Hana",
      reply_to_author_kind: "human",
      reply_to_preview: "the question",
      hop: 1,
      mentions: [],
    });
  });
});
