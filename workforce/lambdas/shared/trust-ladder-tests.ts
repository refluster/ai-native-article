// Tests for shared/trust-ladder.ts (Epic-023 Story 1, #462; ADR-0036).
// Each test names the failure it exists to catch.
import { describe, expect, it } from "vitest";
import { replayTrust, TRUST_PARAMS, type IncidentEvent, type ReviewEvent } from "./trust-ladder.js";

const managers: Record<string, string[]> = { ren: ["maya"], zed: ["maya"], a: ["x"], b: ["y"], c: ["z"], d: ["w"], e: ["v"], f: ["u"], g: ["t"], h: ["s"] };
const reportsTo = (s: string) => managers[s] ?? [];

let n = 0;
function review(author: string, over: Partial<ReviewEvent> = {}): ReviewEvent {
  n += 1;
  const id = `R${String(n).padStart(4, "0")}`;
  return { id, at: new Date(Date.UTC(2026, 9, 1) + n * 60_000).toISOString(), pr_url: `https://x/pr/${n}`, pr_author: author, verdict: "approve", shadow: true, ...over };
}
const authorsCycle = ["a", "b", "c", "d", "e", "f", "g", "h"];
const many = (count: number, over: Partial<ReviewEvent> = {}) =>
  Array.from({ length: count }, (_, i) => review(authorsCycle[i % authorsCycle.length]!, over));
const run = (reviews: ReviewEvent[], incidents: IncidentEvent[] = []) => replayTrust({ slug: "ren", reviews, incidents, reportsTo });

describe("promotion bars (ADR-0036 §1)", () => {
  it("a new persona is T0 with nothing computed", () => {
    expect(run([])).toMatchObject({ tier: "T0", counted_reviews: [] });
  });
  it("promotes T0 to T1 on the 8th diverse review, not the 7th", () => {
    expect(run(many(7)).tier).toBe("T0");
    expect(run(many(TRUST_PARAMS.promoteT1Reviews)).tier).toBe("T1");
  });
  it("promotes T1 to T2 only on 20 non-shadow participations across 6+ authors", () => {
    const toT1 = many(8);
    expect(run([...toT1, ...many(19, { shadow: false })]).tier).toBe("T1");
    expect(run([...toT1, ...many(20, { shadow: false })]).tier).toBe("T2");
  });
  it("shadow reviews do not count toward T2 (catches counting shadow after promotion)", () => {
    expect(run([...many(8), ...many(30, { shadow: true })]).tier).toBe("T1");
  });
});

describe("reciprocity and diversity (ADR-0036 §2)", () => {
  it("a same-manager author never advances the tally, but the review is still recorded", () => {
    const rs = Array.from({ length: 10 }, () => review("zed"));
    const r = run(rs);
    expect(r.tier).toBe("T0");
    expect(r.counted_reviews).toHaveLength(0);
    expect(Object.keys(r.review_counted)).toHaveLength(10);
    expect(Object.values(r.review_counted).every((v) => v === false)).toBe(true);
  });
  it("one friendly author cannot promote alone: cap is 3 of 8", () => {
    const rs = Array.from({ length: 50 }, () => review("a"));
    const r = run(rs);
    expect(r.tier).toBe("T0");
    expect(r.counted_reviews).toHaveLength(3);
  });
  it("needs 3 distinct authors even when the cap allows 8 reviews", () => {
    const rs = [...Array(3).fill("a"), ...Array(3).fill("b"), ...Array(10).fill("a")].map((x) => review(x));
    expect(run(rs).tier).toBe("T0");
    expect(run([...rs, review("c"), review("c")]).tier).toBe("T1");
  });
});

describe("demotion (ADR-0036 §4)", () => {
  const incident = (over: Partial<IncidentEvent> = {}): IncidentEvent => ({
    id: "I0001", at: "2026-10-02T00:00:00Z", attributed_personas: ["ren"], contest_status: "none", ...over,
  });
  const t2 = () => [...many(8), ...many(20, { shadow: false })];
  it("drops exactly one tier and clears the tally", () => {
    const r = run(t2(), [incident({ at: "2026-12-01T00:00:00Z" })]);
    expect(r.tier).toBe("T1");
    expect(r.counted_reviews).toHaveLength(0);
    expect(r.last_incident_ref).toBe("I0001");
  });
  it("an incident attributing someone else, or overturned on contest, changes nothing", () => {
    const base = t2();
    expect(run(base, [incident({ at: "2026-12-01T00:00:00Z", attributed_personas: ["zed"] })]).tier).toBe("T2");
    expect(run(base, [incident({ at: "2026-12-01T00:00:00Z", contest_status: "overturned" })]).tier).toBe("T2");
    expect(run(base, [incident({ at: "2026-12-01T00:00:00Z", contest_status: "contested" })]).tier).toBe("T1");
  });
  it("re-earns the next rung with no partial credit", () => {
    const first = many(8);
    const afterIncident = many(7, { shadow: true }).map((r, i) => ({ ...r, at: `2026-12-0${i + 1}T00:00:00Z` }));
    const inc = incident({ at: "2026-11-30T00:00:00Z" });
    // T1 -> demoted to T0 -> 7 reviews is below the bar again.
    expect(run([...first, ...afterIncident], [inc]).tier).toBe("T0");
  });
  it("an incident at T0 stays T0 and still resets the tally", () => {
    const r = run([...many(5)], [incident({ at: "2026-12-01T00:00:00Z" })]);
    expect(r).toMatchObject({ tier: "T0", counted_reviews: [] });
  });
});

describe("determinism (the cold-start seeder)", () => {
  it("is independent of input order and of repeated replay", () => {
    const rs = [...many(8), ...many(25, { shadow: false })];
    const inc: IncidentEvent[] = [{ id: "I0009", at: "2026-12-01T00:00:00Z", attributed_personas: ["ren"], contest_status: "upheld" }];
    const forward = run(rs, inc);
    const shuffled = run([...rs].reverse(), inc);
    expect(shuffled).toEqual(forward);
    expect(run(rs, inc)).toEqual(forward);
  });
  it("breaks timestamp ties by id", () => {
    const at = "2026-10-01T00:00:00Z";
    const a = review("a", { at, id: "A" });
    const b = review("b", { at, id: "B" });
    expect(run([b, a]).computed_from_review_seq).toBe("B");
  });
});
