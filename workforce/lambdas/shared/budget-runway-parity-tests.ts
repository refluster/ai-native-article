// Parity fixture: the TypeScript runway counter (what the agents-api write
// boundary enforces) and the plain-JS mirror (what the in-repo audit script
// runs) must agree on every cron shape the roster actually uses. The two
// cannot share a module — scripts cannot import TypeScript — so this is the
// contract that keeps them one counter, the same way effectiveSchedule is
// mirrored into the console with a parity fixture (agent-tests.ts).

import { describe, expect, it } from "vitest";
import { RUNWAY_WINDOW_END, RUNWAY_WINDOW_START } from "./budget-runway.js";
import { countFires as countFiresRaw } from "./cron-match.js";
// @ts-expect-error — plain .mjs mirror, no type declarations by design.
import { countFires as countFiresMjs, RUNWAY_WINDOW_END as END_MJS, RUNWAY_WINDOW_START as START_MJS } from "../../scripts/lib/budget-runway.mjs";

// Every distinct cron shape on the live roster as of 2026-09-14, plus the
// edge forms the matcher documents.
const ROSTER_CRONS = [
  "cron(30 1 ? * * *)", // daily
  "cron(23 0,6,12,18 ? * * *)", // hour list
  "cron(45 1/6 ? * * *)", // step from base
  "cron(0 0/6 ? * * *)", // step from 0
  "cron(30 3/6 ? * * *)",
  "cron(29 6,18 ? * * *)",
  "cron(20 0/2 ? * * *)", // 12/day
  "cron(17 1 ? * TUE *)", // weekday name
  "cron(9 1 3 * ? *)", // fixed day-of-month
  "cron(23 10 7,21 * ? *)", // two days a month
  "cron(30 0 ? * MON *)",
  "cron(0 4 * * ? *)", // '*' day-of-month
  "cron(15 9-17 ? * MON-FRI *)", // range + weekday range
];

describe("budget-runway parity — TS vs .mjs", () => {
  it("the mirror uses the same reference window", () => {
    expect(START_MJS.getTime()).toBe(RUNWAY_WINDOW_START.getTime());
    expect(END_MJS.getTime()).toBe(RUNWAY_WINDOW_END.getTime());
  });

  it.each(ROSTER_CRONS)("counts %s identically", (cron) => {
    const ts = countFiresRaw(cron, RUNWAY_WINDOW_START, RUNWAY_WINDOW_END);
    const mjs = countFiresMjs(cron, START_MJS, END_MJS);
    expect(mjs).toBe(ts);
    expect(ts).toBeGreaterThan(0);
  });
});
