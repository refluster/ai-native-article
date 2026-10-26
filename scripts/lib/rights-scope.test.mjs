// Tests for the scoped podcast verdict (issue #673 item 2). Pure, no network.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FRONTS,
  STATES,
  assembleFrontStates,
  citationFrontReport,
  llmFrontReport,
  countScope,
  scopedVerdict,
  renderTrailer,
  stripScopeClaim,
} from "./rights-scope.mjs";

const today = (citations = 3) => assembleFrontStates({ 1: llmFrontReport(), 4: citationFrontReport(citations) });

test("today's reports: no front fully machine-examined, front 4 partial, front 1 LLM-judged only", () => {
  const s = today();
  assert.deepEqual(countScope(s), { machine: 0, partial: 1, llm: 1 });
  const v = scopedVerdict("PASS\nno verbatim reproduction", s);
  assert.match(
    v.split("\n")[0],
    /^PASS \(scope: 0 of 7 fronts fully machine-examined; 1 partial \(presence only\); 1 more LLM-judged only\)/,
  );
  assert.match(v, /every URL resolved 3\/3/);
});

test("a check that did not report is not-examined (skipping a guard shrinks the scope)", () => {
  const s = assembleFrontStates({ 1: llmFrontReport() });
  assert.equal(s[4].state, "not-examined");
  assert.deepEqual(countScope(s), { machine: 0, partial: 0, llm: 1 });
  assert.deepEqual(countScope(assembleFrontStates()), { machine: 0, partial: 0, llm: 0 });
});

test("a bare PASS is impossible for any verdict text", () => {
  const s = today();
  for (const input of ["PASS", "pass", "PASS: fine", "PASS - fine", "", "   ", undefined, "FLAG: copied para 2"]) {
    const first = scopedVerdict(input, s).split("\n")[0];
    assert.match(first, /\d of 7/, `first line carries N of 7 for ${JSON.stringify(input)}`);
    assert.doesNotMatch(first, /^PASS\s*$/i);
  }
});

test("LLM-typed scope claims are replaced, never kept beside the code-rendered scope", () => {
  const s = today();
  for (const text of ["PASS all 7 fronts verified", "PASS 7 of 7 checked", "PASS\nAll seven fronts clean", "PASS\nfull scope covered"]) {
    const v = scopedVerdict(text, s);
    const llmPart = v.slice(0, v.lastIndexOf("\n\n"));
    assert.doesNotMatch(llmPart.replace(/\(scope: [^)]*\)/g, ""), /all (7|seven)|7 of 7|fronts verified|full scope/i);
    assert.match(v, /LLM-typed scope claim removed/);
  }
  assert.equal(stripScopeClaim("no verbatim reproduction found"), "no verbatim reproduction found");
});

test("a FLAG keeps its text even when it uses the words front or scope (cycle-2 A1/A3)", () => {
  const s = today();
  for (const text of ["FLAG: para 2 copies source verbatim, front page of Nikkei", "FLAG: front 1 copied para 2 verbatim\nsee scope note"]) {
    const v = scopedVerdict(text, s);
    assert.match(v.split("\n")[0], /^FLAG: /);
    assert.match(v, /copies source verbatim|copied para 2 verbatim/);
    assert.doesNotMatch(v, /scope claim removed/);
    assert.match(v.split("\n")[0], /\d of 7/);
  }
  assert.equal(stripScopeClaim("FLAG: all 7 fronts clean but para 3 copied"), "FLAG: [LLM-typed scope claim removed — scope is rendered by code below] clean but para 3 copied");
});

test("PASSED / 'pass.' first-line variants are treated as PASS", () => {
  const first = scopedVerdict("PASSED. no copying found", today()).split("\n")[0];
  assert.match(first, /^PASS \(scope: /);
  assert.doesNotMatch(first, /^PASS\s*$/);
});

test("an empty verdict does not read as a pass", () => {
  const first = scopedVerdict("", today()).split("\n")[0];
  assert.match(first, /^NO LLM VERDICT SUPPLIED/);
  assert.doesNotMatch(first, /^PASS/);
});

test("N counts only fully-machine fronts; partial and LLM are counted separately, for every state combination", () => {
  const total = STATES.length ** FRONTS.length;
  for (let i = 0; i < total; i++) {
    const states = {};
    let n = i;
    let machine = 0;
    let partial = 0;
    let llm = 0;
    for (const f of FRONTS) {
      const st = STATES[n % STATES.length];
      n = Math.floor(n / STATES.length);
      states[f.id] = { state: st };
      if (st === "machine") machine++;
      if (st === "machine-partial") partial++;
      if (st === "llm-judged") llm++;
    }
    assert.deepEqual(countScope(states), { machine, partial, llm });
    assert.ok(
      scopedVerdict("PASS", states).startsWith(
        `PASS (scope: ${machine} of 7 fronts fully machine-examined; ${partial} partial (presence only); ${llm} more LLM-judged only)`,
      ),
    );
  }
});

test("a unknown front state throws instead of overstating scope", () => {
  const t = today();
  t[2] = { state: "mostly-fine" };
  assert.throws(() => scopedVerdict("PASS", t), /front 2/);
  const u = today();
  delete u[6];
  assert.throws(() => countScope(u), /front 6/);
});

test("the trailer lists all seven fronts", () => {
  const lines = renderTrailer(today()).split("\n");
  assert.equal(lines.length, 7);
  assert.match(lines[1], /NOT examined/);
});
