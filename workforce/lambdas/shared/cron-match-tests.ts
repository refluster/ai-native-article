// Tests for cron-match.ts. Run with `npm test` from workforce/lambdas/.
//
// Filename uses the `-tests.ts` suffix (not vitest's default `.test.ts`)
// to satisfy the R-N7 naming linter — see vitest.config.mjs for the
// rationale.

import { describe, expect, it } from "vitest";
import { matchesNow } from "./cron-match.js";

// Helper: build a UTC Date from a "YYYY-MM-DDTHH:mm:ssZ" literal so the
// test reads like the wall-clock time we care about, not a struct.
function utc(iso: string): Date {
  return new Date(iso);
}

describe("matchesNow — past-window semantics", () => {
  describe("the discord-ping regression case", () => {
    // The bug fixed in claude/lucid-feynman-cron-match-past-window:
    // Yuki's `cron(0 0/6 * * ? *)` fires at UTC 00/06/12/18:00. The
    // orchestrator tick fires every 30 min. With the old future-window
    // implementation, the tick at 12:25 looked at [12:25, 12:55) which
    // doesn't contain the 12:00 fire, and the next tick at 12:55 looked
    // at [12:55, 13:25) — even further past. The cron was silently
    // missed forever.
    const cron = "cron(0 0/6 * * ? *)";

    it("tick at 12:25:45 catches the 12:00 fire (past window)", () => {
      expect(matchesNow(cron, utc("2026-05-27T12:25:45Z"), { windowMinutes: 30 })).toBe(true);
    });

    it("tick at 12:55:45 does NOT re-catch the 12:00 fire (it's outside the new window)", () => {
      // (12:55:45 - 30 min, 12:55:45] = (12:25:45, 12:55:45]. 12:00:00
      // is not in this range, so the next tick doesn't double-fire.
      expect(matchesNow(cron, utc("2026-05-27T12:55:45Z"), { windowMinutes: 30 })).toBe(false);
    });

    it("tick at 13:25:45 also does not see the 12:00 fire", () => {
      expect(matchesNow(cron, utc("2026-05-27T13:25:45Z"), { windowMinutes: 30 })).toBe(false);
    });

    it("tick at 18:25:45 catches the 18:00 fire (next 0/6 boundary)", () => {
      expect(matchesNow(cron, utc("2026-05-27T18:25:45Z"), { windowMinutes: 30 })).toBe(true);
    });
  });

  describe("window boundary semantics", () => {
    const cron = "cron(0 12 * * ? *)"; // fires at 12:00 UTC daily

    it("tick exactly at the fire minute catches it", () => {
      expect(matchesNow(cron, utc("2026-05-27T12:00:00Z"), { windowMinutes: 30 })).toBe(true);
    });

    it("tick one minute after the fire catches it", () => {
      expect(matchesNow(cron, utc("2026-05-27T12:01:00Z"), { windowMinutes: 30 })).toBe(true);
    });

    it("tick 29 minutes after the fire still catches it", () => {
      expect(matchesNow(cron, utc("2026-05-27T12:29:30Z"), { windowMinutes: 30 })).toBe(true);
    });

    it("tick 30+ minutes after the fire does not catch it", () => {
      // i goes 0..29 so windowMinutes=30 covers minutes 12:30, 12:29,
      // ..., 12:01. The 12:00 fire is at i=30, just outside the loop.
      expect(matchesNow(cron, utc("2026-05-27T12:30:00Z"), { windowMinutes: 30 })).toBe(false);
    });

    it("tick before the fire does not catch it", () => {
      // Past-window: a tick at 11:30 cannot see the future 12:00 fire.
      expect(matchesNow(cron, utc("2026-05-27T11:30:00Z"), { windowMinutes: 30 })).toBe(false);
    });
  });

  describe("non-matching cron fields", () => {
    it("hour mismatch: cron at 12 vs tick at 13:25 doesn't match", () => {
      expect(matchesNow("cron(0 12 * * ? *)", utc("2026-05-27T13:25:00Z"), { windowMinutes: 30 })).toBe(false);
    });

    it("minute mismatch: cron at 0/5 vs tick at 12:13 catches the 12:10 fire", () => {
      // 12:13 - 30min = 11:43. Window covers 12:13, 12:12, ..., 11:44.
      // 12:10 (matches 0/5) is at i=3 from 12:13. ✓
      expect(matchesNow("cron(0/5 * * * ? *)", utc("2026-05-27T12:13:00Z"), { windowMinutes: 30 })).toBe(true);
    });
  });

  describe("DoW / DoM exclusivity (EventBridge spec)", () => {
    it("weekday-only cron fires on weekdays", () => {
      // 2026-05-27 is a Wednesday. cron(0 9 ? * MON-FRI *) at 09:00 UTC.
      expect(matchesNow("cron(0 9 ? * MON-FRI *)", utc("2026-05-27T09:25:00Z"), { windowMinutes: 30 })).toBe(true);
    });

    it("weekday-only cron does NOT fire on weekends", () => {
      // 2026-05-30 is a Saturday.
      expect(matchesNow("cron(0 9 ? * MON-FRI *)", utc("2026-05-30T09:25:00Z"), { windowMinutes: 30 })).toBe(false);
    });
  });

  describe("invalid input", () => {
    it("throws on missing cron() wrapper", () => {
      expect(() => matchesNow("0 12 * * ? *", new Date(), { windowMinutes: 30 })).toThrow();
    });

    it("throws on wrong field count", () => {
      expect(() => matchesNow("cron(0 12 * * ?)", new Date(), { windowMinutes: 30 })).toThrow();
    });
  });
});
