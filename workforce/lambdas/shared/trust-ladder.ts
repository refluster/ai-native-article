// Trust-ladder replay (Epic-023 Story 1, issue #462; thresholds: ADR-0036).
//
// A PURE, deterministic function: ordered REVIEW# / INCIDENT# rows in, one
// (persona, domain) tier out. No DDB, no clock, no GitHub. Because the tier
// cache (`AGENT#{slug}/TRUST#{domain}`) is a rebuildable cache (data-model.md,
// R-N2), this function IS the cache's source of truth: the determinism test
// is also the cold-start seeder (Epic-023 acceptance criteria) — nobody
// hand-assigns a tier, unreplayable history starts T0.
//
// Not in this module (later slices of #462): GitHub → REVIEW# ingestion, the
// DDB writer for TRUST# rows, the profile render. Nothing here is wired into
// pr-autopilot; enforcement stays inert (ADR-0036 "rules before mechanism").

export type Tier = "T0" | "T1" | "T2";
export type ReviewVerdict = "approve" | "changes-requested" | "comment";
export type ContestStatus = "none" | "contested" | "upheld" | "overturned";

/** ADR-0036 §1–§2 — Zone A constants; change only by a superseding ADR. */
export const TRUST_PARAMS = {
  /** T0 → T1: lens reviews (shadow included) needed. */
  promoteT1Reviews: 8,
  /** T0 → T1: distinct PR authors those reviews must span. */
  promoteT1Authors: 3,
  /** T1 → T2: consensus participations needed. */
  promoteT2Reviews: 20,
  /** T1 → T2: distinct PR authors those reviews must span. */
  promoteT2Authors: 6,
  /** No single PR author may exceed this share of a counted set. */
  maxAuthorShare: 0.4,
} as const;

export interface ReviewEvent {
  /** ULID of the `REVIEW#` row — the total-order tiebreaker. */
  id: string;
  /** ISO timestamp (`ingested_at`, or the review's own time when known). */
  at: string;
  pr_url: string;
  pr_author: string;
  verdict: ReviewVerdict;
  /** T0 shadow-inclusion: posted and recorded, never counted toward consensus. */
  shadow: boolean;
}

export interface IncidentEvent {
  /** ULID of the `INCIDENT#` row. */
  id: string;
  /** `classification_at` — when the demotion takes effect. */
  at: string;
  /** Every green-lighting reviewer the demotion drops one tier (ADR-0036 §4). */
  attributed_personas: string[];
  contest_status: ContestStatus;
}

export interface CountedReview {
  review_ref: string;
  pr_author: string;
  at: string;
}

export interface TrustResult {
  tier: Tier;
  /** Promotion tally toward the CURRENT tier's next bar (empty at T2). */
  counted_reviews: CountedReview[];
  last_incident_ref?: string;
  /** Last REVIEW# id folded in, so a resumable job need not rescan. */
  computed_from_review_seq?: string;
  /** Per-review `counted` flag, for the REVIEW# row attribute. */
  review_counted: Record<string, boolean>;
}

export interface ReplayInput {
  slug: string;
  reviews: ReviewEvent[];
  incidents: IncidentEvent[];
  /** `reports_to` of an agent slug (agent record field). Unknown → [] (and then never counts). */
  reportsTo: (slug: string) => readonly string[];
}

type Timeline =
  | { kind: "review"; at: string; id: string; ev: ReviewEvent }
  | { kind: "incident"; at: string; id: string; ev: IncidentEvent };

/** `true` when reviewer and PR author share at least one manager (ADR-0036 §2). */
export function sharesManager(reviewer: readonly string[], author: readonly string[]): boolean {
  if (reviewer.length === 0 || author.length === 0) return false;
  const a = new Set(author);
  return reviewer.some((m) => a.has(m));
}

function barFor(tier: Tier): { reviews: number; authors: number } | null {
  if (tier === "T0") return { reviews: TRUST_PARAMS.promoteT1Reviews, authors: TRUST_PARAMS.promoteT1Authors };
  if (tier === "T1") return { reviews: TRUST_PARAMS.promoteT2Reviews, authors: TRUST_PARAMS.promoteT2Authors };
  return null;
}

function demote(t: Tier): Tier {
  return t === "T2" ? "T1" : "T0";
}

/**
 * Replay a persona's rows into a tier. Rules (ADR-0036):
 * - Reviews and incidents are merged into one timeline ordered by (at, id), so
 *   the result does not depend on input order.
 * - A review counts toward the tally of the tier's next bar only if the PR
 *   author shares no manager with the reviewer, both sides' managers are known,
 *   the PR is not the persona's own, the PR has not already counted once, AND
 *   adding it keeps any single
 *   author at or under `floor(maxAuthorShare × bar)` of the counted set.
 *   At T0 shadow reviews count (shadow-inclusion); at T1 only non-shadow
 *   consensus participations count. A failing review is recorded
 *   (`review_counted: false`), never dropped.
 * - Promotion fires the moment the tally meets both the review count and the
 *   distinct-author floor, and resets the tally for the next rung.
 * - An incident attributing this persona (and not `overturned`) drops one tier
 *   and clears the tally: no partial credit, no cool-down timer. T0 stays T0
 *   but the tally still resets (a T0 persona with an attributed incident must
 *   re-earn from zero). A `contested` incident stands until resolved.
 */
export function replayTrust(input: ReplayInput): TrustResult {
  const { slug, reviews, incidents, reportsTo } = input;
  const timeline: Timeline[] = [
    ...reviews.map((ev): Timeline => ({ kind: "review", at: ev.at, id: ev.id, ev })),
    ...incidents.map((ev): Timeline => ({ kind: "incident", at: ev.at, id: ev.id, ev })),
  ].sort((a, b) => {
    // Compare instants, not strings: "…:00Z" vs "…:00.250Z" must order by time.
    const dt = Date.parse(a.at) - Date.parse(b.at);
    if (dt !== 0 && !Number.isNaN(dt)) return dt < 0 ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0;
  });

  const myManagers = reportsTo(slug);
  const countedPrs = new Set<string>();
  let tier: Tier = "T0";
  let tally: CountedReview[] = [];
  let lastIncident: string | undefined;
  let lastReview: string | undefined;
  const reviewCounted: Record<string, boolean> = {};

  for (const row of timeline) {
    if (row.kind === "incident") {
      const ev = row.ev;
      if (!ev.attributed_personas.includes(slug) || ev.contest_status === "overturned") continue;
      tier = demote(tier);
      tally = [];
      lastIncident = ev.id;
      continue;
    }

    const ev = row.ev;
    lastReview = ev.id;
    const bar = barFor(tier);
    reviewCounted[ev.id] = false;
    if (!bar) continue; // T2: nothing left to promote to
    if (tier === "T1" && ev.shadow) continue; // only consensus participations toward T2
    if (ev.pr_author === slug) continue; // reviewing one's own PR is never independent
    const authorManagers = reportsTo(ev.pr_author);
    // Absence must not read as independence (W-4): unknown managers on either side do not count.
    if (myManagers.length === 0 || authorManagers.length === 0) continue;
    if (sharesManager(myManagers, authorManagers)) continue;
    if (countedPrs.has(ev.pr_url)) continue; // one counted review per PR, however many cycles/rows
    const cap = Math.floor(TRUST_PARAMS.maxAuthorShare * bar.reviews);
    if (tally.filter((c) => c.pr_author === ev.pr_author).length >= cap) continue;

    tally.push({ review_ref: ev.id, pr_author: ev.pr_author, at: ev.at });
    countedPrs.add(ev.pr_url);
    reviewCounted[ev.id] = true;

    if (tally.length >= bar.reviews && new Set(tally.map((c) => c.pr_author)).size >= bar.authors) {
      tier = tier === "T0" ? "T1" : "T2";
      tally = [];
    }
  }

  return {
    tier,
    counted_reviews: tally,
    ...(lastIncident ? { last_incident_ref: lastIncident } : {}),
    ...(lastReview ? { computed_from_review_seq: lastReview } : {}),
    review_counted: reviewCounted,
  };
}
