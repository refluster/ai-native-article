// Tests for the scoped podcast verdict (issue #673 item 2). Pure, no network.
import { test } from "node:test";
import assert from "node:assert/strict";

import { FRONTS, STATES, defaultFrontStates, countScope, scopedVerdict, renderTrailer } from "./rights-scope.mjs";

test("today's code counts exactly one front (4) and shows front 1 as LLM-judged only", () => {
  const s = defaultFrontStates({ citationsChecked: 3 });
  assert.deepEqual(countScope(s), { machine: 1, llm: 1 });
  const v = scopedVerdict("PASS\nno verbatim reproduction", s);
  assert.match(v.split("\n")[0], /^PASS \(scope: 1 of 7 fronts machine-examined; 1 more LLM-judged only\)/);
  assert.match(v, /every URL resolved 3\/3/);
});

test("a bare PASS is impossible for any verdict text", () => {
  const s = defaultFrontStates();
  for (const input of ["PASS", "pass", "PASS: fine", "PASS - fine", "", "   ", undefined, "FLAG: copied para 2"]) {
    const first = scopedVerdict(input, s).split("\n")[0];
    assert.match(first, /\d of 7/, `first line carries N of 7 for ${JSON.stringify(input)}`);
    assert.doesNotMatch(first, /^PASS\s*$/i);
  }
});

test("an empty verdict does not read as a pass", () => {
  const first = scopedVerdict("", defaultFrontStates()).split("\n")[0];
  assert.match(first, /^NO LLM VERDICT SUPPLIED/);
  assert.doesNotMatch(first, /^PASS/);
});

test("N equals the count of machine/machine-partial fronts for every combination of states", () => {
  const total = STATES.length ** FRONTS.length;
  for (let i = 0; i < total; i++) {
    const states = {};
    let n = i;
    let machine = 0;
    let llm = 0;
    for (const f of FRONTS) {
      const st = STATES[n % STATES.length];
      n = Math.floor(n / STATES.length);
      states[f.id] = { state: st };
      if (st === "machine" || st === "machine-partial") machine++;
      if (st === "llm-judged") llm++;
    }
    assert.deepEqual(countScope(states), { machine, llm });
    assert.ok(scopedVerdict("PASS", states).startsWith(`PASS (scope: ${machine} of 7 fronts machine-examined; ${llm} more LLM-judged only)`));
  }
});

test("a missing or unknown front state throws instead of overstating scope", () => {
  const s = defaultFrontStates();
  delete s[6];
  assert.throws(() => countScope(s), /front 6/);
  const t = defaultFrontStates();
  t[2] = { state: "mostly-fine" };
  assert.throws(() => scopedVerdict("PASS", t), /front 2/);
});

test("the trailer lists all seven fronts", () => {
  const lines = renderTrailer(defaultFrontStates()).split("\n");
  assert.equal(lines.length, 7);
  assert.match(lines[1], /NOT examined/);
});
