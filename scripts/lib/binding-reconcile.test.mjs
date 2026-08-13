import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcileBinding, stableExcludingBoundAt } from "./binding-reconcile.mjs";

const matchBySkill = (skill) => (b) => b.skill === skill && b.project_id === "agent-workforce";
const fixedNow = () => "2026-08-13T00:00:00.000Z";

const desired = {
  skill: "monthly-report",
  executor: "claude-code-routine",
  project_id: "agent-workforce",
  trigger: { scheduler: "external", invoked_by: "api", cron: "cron(9 1 2 * ? *)" },
};

test("new binding: appends and stamps bound_at=now", () => {
  const { bindings, verb, changed } = reconcileBinding([], desired, matchBySkill("monthly-report"), fixedNow);
  assert.equal(verb, "bound");
  assert.equal(changed, true);
  assert.equal(bindings.length, 1);
  assert.equal(bindings[0].bound_at, "2026-08-13T00:00:00.000Z");
  // desired itself is never mutated
  assert.equal("bound_at" in desired, false);
});

test("unchanged existing binding: true no-op, bound_at untouched, original array returned", () => {
  const existing = { ...desired, bound_at: "2026-07-01T00:00:00.000Z" };
  const currentBindings = [existing];
  const { bindings, verb, changed } = reconcileBinding(currentBindings, desired, matchBySkill("monthly-report"), fixedNow);
  assert.equal(verb, "no-op");
  assert.equal(changed, false);
  assert.equal(bindings, currentBindings); // same reference — a true no-op, nothing rebuilt
  assert.equal(bindings[0].bound_at, "2026-07-01T00:00:00.000Z");
});

test("re-running an already-current script never re-stamps bound_at (the bug this module exists to prevent)", () => {
  // Simulates calling reconcileBinding twice in a row with the SAME desired
  // literal, as a wire-*.mjs script re-run would.
  const first = reconcileBinding([], desired, matchBySkill("monthly-report"), fixedNow);
  const laterNow = () => "2026-09-01T00:00:00.000Z";
  const second = reconcileBinding(first.bindings, desired, matchBySkill("monthly-report"), laterNow);
  assert.equal(second.verb, "no-op");
  assert.equal(second.bindings[0].bound_at, "2026-08-13T00:00:00.000Z");
});

test("drifted binding (config changed): replaces in place, carries bound_at forward", () => {
  const existing = { ...desired, config: { old: true }, bound_at: "2026-07-01T00:00:00.000Z" };
  const changedDesired = { ...desired, config: { old: false } };
  const { bindings, verb, changed } = reconcileBinding([existing], changedDesired, matchBySkill("monthly-report"), fixedNow);
  assert.equal(verb, "updated (in-place, binding_idx preserved)");
  assert.equal(changed, true);
  assert.equal(bindings[0].bound_at, "2026-07-01T00:00:00.000Z");
  assert.deepEqual(bindings[0].config, { old: false });
});

test("drifted binding with no pre-existing bound_at (pre-#574 binding): stays absent, never invented", () => {
  const existing = { ...desired, config: { old: true } }; // no bound_at
  const changedDesired = { ...desired, config: { old: false } };
  const { bindings } = reconcileBinding([existing], changedDesired, matchBySkill("monthly-report"), fixedNow);
  assert.equal("bound_at" in bindings[0], false);
});

test("binding_idx preserved: other bindings in the array are untouched and keep their position", () => {
  const other = { skill: "feed-post", project_id: "agent-workforce" };
  const existing = { ...desired, config: { old: true }, bound_at: "2026-07-01T00:00:00.000Z" };
  const { bindings } = reconcileBinding([other, existing], { ...desired, config: { old: false } }, matchBySkill("monthly-report"), fixedNow);
  assert.equal(bindings.length, 2);
  assert.equal(bindings[0], other);
  assert.equal(bindings[1].config.old, false);
});

test("throws loudly if the caller sets bound_at on `desired` (C-4: fail loud, not silently overridden)", () => {
  assert.throws(() => reconcileBinding([], { ...desired, bound_at: "x" }, matchBySkill("monthly-report"), fixedNow));
});

test("stableExcludingBoundAt: key order doesn't matter, bound_at is invisible", () => {
  const a = { skill: "x", bound_at: "2026-01-01T00:00:00Z", trigger: { scheduler: "external", cron: "c" } };
  const b = { trigger: { cron: "c", scheduler: "external" }, bound_at: "2026-06-01T00:00:00Z", skill: "x" };
  assert.equal(stableExcludingBoundAt(a), stableExcludingBoundAt(b));
});
