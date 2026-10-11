// Unit tests for shared/streak.ts (#664 slice 2): the repeat-failure counter
// and its ledger replay. The DDB client is replaced by a small in-memory table
// that honours the three command shapes the module sends.
import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.TABLE_NAME = "wf-table-test";

type Item = Record<string, unknown>;
const table = new Map<string, Item>();
const k = (pk: string, sk: string) => `${pk}|${sk}`;
let failNext: Error | undefined;

class Cmd {
  constructor(public input: Record<string, any>) {}
}
vi.mock("@aws-sdk/client-dynamodb", () => ({ DynamoDBClient: class {} }));
vi.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: {
    from: () => ({
      send: async (cmd: Cmd & { _t: string }) => {
        if (failNext) {
          const e = failNext;
          failNext = undefined;
          throw e;
        }
        const i = cmd.input;
        if (cmd._t === "update") {
          const key = k(i.Key.pk, i.Key.sk);
          const cur = table.get(key);
          if (cur && cur.last_exec_ulid === i.ExpressionAttributeValues[":ulid"]) {
            const e = new Error("conditional");
            e.name = "ConditionalCheckFailedException";
            throw e;
          }
          const v = i.ExpressionAttributeValues;
          const next: Item = {
            ...i.Key,
            count: ((cur?.count as number) ?? 0) + 1,
            first_at: cur?.first_at ?? v[":at"],
            last_at: v[":at"],
            last_exec_ulid: v[":ulid"],
            agent_slug: v[":agent"],
            skill_name: v[":skill"],
            reason_code: v[":reason"],
          };
          table.set(key, next);
          return { Attributes: { count: next.count } };
        }
        if (cmd._t === "get") return { Item: table.get(k(i.Key.pk, i.Key.sk)) };
        if (cmd._t === "query") {
          const items = [...table.values()].filter((r) => r.pk === i.ExpressionAttributeValues[":pk"]);
          return { Items: items.map((r) => ({ pk: r.pk, sk: r.sk })) };
        }
        if (cmd._t === "delete") {
          table.delete(k(i.Key.pk, i.Key.sk));
          return {};
        }
        throw new Error(`unexpected command ${cmd._t}`);
      },
    }),
  },
  UpdateCommand: class extends Cmd { _t = "update"; },
  GetCommand: class extends Cmd { _t = "get"; },
  QueryCommand: class extends Cmd { _t = "query"; },
  DeleteCommand: class extends Cmd { _t = "delete"; },
}));

const { recordStreakEvent, replayStreaks, streakPk, streakSk } = await import("./streak.js");

let n = 0;
const ev = (over: Record<string, unknown> = {}) => ({
  agent_slug: "ren",
  skill_name: "issue-implement",
  status: "throw",
  reason_code: "identity" as const,
  exec_ulid: `U${++n}`,
  started_at: `2026-10-0${(n % 9) + 1}T00:00:00Z`,
  ...over,
});

beforeEach(() => {
  table.clear();
  failNext = undefined;
});

describe("recordStreakEvent", () => {
  it("counts consecutive throws of one reason: 1, 2, 3", async () => {
    expect(await recordStreakEvent(ev())).toBe(1);
    expect(await recordStreakEvent(ev())).toBe(2);
    expect(await recordStreakEvent(ev())).toBe(3);
    expect(table.get(`${streakPk("ren", "issue-implement")}|${streakSk("identity")}`)?.count).toBe(3);
  });

  it("a missing reason_code counts as 'other'", async () => {
    expect(await recordStreakEvent(ev({ reason_code: undefined }))).toBe(1);
    expect(table.has(`${streakPk("ren", "issue-implement")}|${streakSk("other")}`)).toBe(true);
  });

  it("a different reason starts its own streak and does not clear the old one", async () => {
    await recordStreakEvent(ev());
    await recordStreakEvent(ev());
    expect(await recordStreakEvent(ev({ reason_code: "egress" }))).toBe(1);
    expect(table.get(`${streakPk("ren", "issue-implement")}|${streakSk("identity")}`)?.count).toBe(2);
  });

  it("skipped neither increments nor resets", async () => {
    await recordStreakEvent(ev());
    expect(await recordStreakEvent(ev({ status: "skipped", reason_code: undefined }))).toBeUndefined();
    expect(table.get(`${streakPk("ren", "issue-implement")}|${streakSk("identity")}`)?.count).toBe(1);
  });

  it("ok deletes every streak of that (agent, skill) and no other cadence's", async () => {
    await recordStreakEvent(ev());
    await recordStreakEvent(ev({ reason_code: "egress" }));
    await recordStreakEvent(ev({ skill_name: "pr-remediate" }));
    expect(await recordStreakEvent(ev({ status: "ok", reason_code: undefined }))).toBeUndefined();
    expect([...table.keys()]).toEqual([`${streakPk("ren", "pr-remediate")}|${streakSk("identity")}`]);
  });

  it("a retry with the same exec_ulid does not count twice", async () => {
    const e = ev();
    expect(await recordStreakEvent(e)).toBe(1);
    expect(await recordStreakEvent(e)).toBe(1);
  });

  it("propagates a store error (the caller decides how loud to be)", async () => {
    failNext = new Error("ddb down");
    await expect(recordStreakEvent(ev())).rejects.toThrow("ddb down");
  });
});

describe("replayStreaks", () => {
  const row = (status: string, at: string, reason?: any, skill = "s") => ({
    agent_slug: "a", skill_name: skill, status, reason_code: reason, started_at: at, exec_ulid: `E${at}`,
  });

  it("rebuilds exactly what the live counter would hold, regardless of input order", () => {
    const rows = [
      row("throw", "2026-10-05", "auth"),
      row("ok", "2026-10-03"),
      row("throw", "2026-10-01", "auth"),
      row("throw", "2026-10-04", "auth"),
      row("skipped", "2026-10-06"),
      row("throw", "2026-10-07", "egress"),
    ];
    const out = replayStreaks(rows);
    expect(out.map((s) => [s.reason_code, s.count, s.first_at, s.last_at]).sort()).toEqual([
      ["auth", 2, "2026-10-04", "2026-10-05"],
      ["egress", 1, "2026-10-07", "2026-10-07"],
    ]);
  });

  it("returns nothing when the latest run of a cadence was ok", () => {
    expect(replayStreaks([row("throw", "2026-10-01", "auth"), row("ok", "2026-10-02")])).toEqual([]);
  });

  it("keeps cadences apart", () => {
    const out = replayStreaks([row("throw", "2026-10-01", "auth", "x"), row("throw", "2026-10-02", "auth", "y")]);
    expect(out).toHaveLength(2);
  });
});
