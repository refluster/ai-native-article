// CLI entry for the feed-health sweep. Invoked by
// `workforce/scripts/feed-health.mjs` which shells out to `tsx` so this
// file runs without a build step.
//
// See ./SKILL.md "Exit codes (CLI)" for the contract.

import {
  runFeedHealth,
  SweepEnvelopeExceededError,
} from "./handler.js";

async function main(): Promise<number> {
  try {
    const result = await runFeedHealth();
    const stage = process.env.STAGE ?? "dev";
    if (result.violations.length === 0) {
      console.log(
        `feed-health: OK — stage=${stage}, ${result.rowsScanned} row(s) swept, 0 violations`,
      );
      return 0;
    }
    console.error(
      `feed-health: FAIL — stage=${stage}, ${result.rowsScanned} row(s) swept, ` +
        `${result.violations.length} violation(s):`,
    );
    for (const v of result.violations) {
      console.error(
        `  [${v.check}] AGENT#${v.agent_slug}/POST#${v.post_id} — ${v.detail}`,
      );
    }
    return 1;
  } catch (err) {
    if (err instanceof SweepEnvelopeExceededError) {
      console.error(`feed-health: ENVELOPE — ${err.message}`);
      return 2;
    }
    console.error(
      `feed-health: ERROR — ${err instanceof Error ? err.stack ?? err.message : String(err)}`,
    );
    return 11;
  }
}

main().then((code) => process.exit(code));
