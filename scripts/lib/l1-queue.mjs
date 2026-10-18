// l1-queue.mjs — which uncovered L1 rows the L1→L2 picker may try this fire,
// and in what order. Pure (no I/O) so the ordering rule is testable; the
// picker (workforce/skills/article-level2/pick-l1-source.mjs) owns the Notion
// reads and writes.
//
// Every row carries one counter, `L2 Attempts`, bumped on two events:
//
//   * a fetch that could not ground an article (source-fetch.mjs said no), and
//   * a hand-out: the picker returned the row to a fire. If that fire
//     publishes, the row becomes covered and leaves the queue, so the bump is
//     moot. If it does not — the cadence judged the body too thin and skipped,
//     or the publish failed — the row is still uncovered at the next fire with
//     a higher count.
//
// The second event is what ML-018 was missing one layer up. A fetch-groundable
// body can still be editorially empty (an X post that is one headline plus
// reply chatter; a wire item inside 40k chars of page chrome). The cadence
// rightly declines it, but that judgement wrote nothing back, so the next fire
// re-picked the identical row — 9 of 10 L2 fires between 2026-10-14 and 10-18
// produced nothing while 11 groundable rows waited behind it.
//
// Ordering is fewest-attempts-first, then oldest-first. A row that was just
// declined or just failed therefore drops behind every untried row instead of
// being retried at the head of the queue, and no single row can stall it.
//
// Blocking is not forever. A row that reaches maxAttempts cools down and gets
// one more try per cooldown, up to retryCycles extra tries. Most "dead" rows
// were dead only for an hour (r.jina.ai's per-domain anonymous-access block),
// and the old permanent block evicted rows that are fetchable today.

/** @typedef {{attempts: number, lastAttempt: string | null, created: string}} QueueRow */

/**
 * @template {QueueRow} T
 * @param {T[]} rows uncovered, non-skipped L1 rows
 * @param {{now: number, maxAttempts: number, retryCycles: number, cooldownMs: number}} opts
 * @returns {{eligible: T[], cooling: T[], retired: T[]}}
 */
export function planQueue(rows, { now, maxAttempts, retryCycles, cooldownMs }) {
  const eligible = [];
  const cooling = [];
  const retired = [];
  for (const row of rows) {
    const attempts = row.attempts ?? 0;
    if (attempts < maxAttempts) {
      eligible.push(row);
    } else if (attempts >= maxAttempts + retryCycles) {
      retired.push(row);
    } else {
      const last = row.lastAttempt ? Date.parse(row.lastAttempt) : NaN;
      // No timestamp on a blocked row means it predates the column — let it in.
      if (!Number.isFinite(last) || now - last >= cooldownMs) eligible.push(row);
      else cooling.push(row);
    }
  }
  eligible.sort(
    (a, b) => (a.attempts ?? 0) - (b.attempts ?? 0) || (a.created ?? "").localeCompare(b.created ?? ""),
  );
  return { eligible, cooling, retired };
}
