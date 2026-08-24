#!/usr/bin/env node
// cleanup-legacy-credential-keys.mjs — Epic-010 criterion (a) closeout (#571).
//
// #91 (Epic-010 Story 2) scoped the bare `wf/{type}` Secrets Manager keys'
// removal out explicitly: "Closeout: remove bare wf/{type} keys when
// WfLegacyCredentialReads == 0 for >= 1 week (separate follow-up PR)." That
// follow-up was never filed — `migrate-credentials/handler.ts` only ever
// COPIES the bare key forward (Story 2-B), it never deletes the source.
// #571 is that follow-up; this is it.
//
// Standalone (raw AWS SDK + the operator's own AWS creds, mirroring
// backfill-performance-lifecycle.mjs) rather than a new standing Lambda:
// this is a rare, consequential, operator-run action, and provisioning a
// permanently-deployed Lambda with secretsmanager:DeleteSecret IAM
// permission for a one-time cleanup is a bigger blast radius than the
// task needs (smallest reversible step).
//
// Safety: this script REFUSES to delete anything unless the CloudWatch
// Workforce/Credentials.WfLegacyCredentialReads metric (Reason=fallback_bare
// — shared/project.ts:getCredential's tier-3 fallback, emitted only when
// something actually reads a bare `wf/{type}` key) sums to zero over the
// trailing `--window-days` (default 7, matching #91's "for >= 1 week"
// wording). A metric-read failure (IAM/network/throttle) is fail-loud (W-4)
// — it blocks deletion, it never silently proceeds as if the window were
// clean. Deletion goes through Secrets Manager's default ~30-day recovery
// window (no ForceDeleteWithoutRecovery), so a mistaken run is still
// reversible. Defaults to --dry-run-shaped output on stderr either way —
// pass neither `--dry-run` nor omit it silently: the flag genuinely gates
// whether DeleteSecret is called, see `main()`.
//
// Usage:
//   node workforce/scripts/cleanup-legacy-credential-keys.mjs \
//     [--stage prod] [--window-days 7] [--dry-run]
// (run from workforce/lambdas/ so @aws-sdk resolves, or with NODE_PATH set.)

// ── pure logic (unit-tested) ─────────────────────────────────────────────

/** Legacy-bare-path list. Mirrors migrate-credentials/handler.ts's
 *  LEGACY_TO_TYPED map's `legacy` column (kept in sync manually — both are
 *  Epic-010 Story 2 artefacts; the typed destination names aren't needed
 *  here since this script only ever reads/deletes the bare source). */
export const LEGACY_BARE_KEYS = ["wf/anthropic", "wf/github", "wf/notion"];

/** Decide whether it's safe to delete, given the trailing-window sum of
 *  fallback_bare reads. Zero (including "no datapoints", which CloudWatch
 *  reports identically to "zero occurrences") is the ONLY safe value — any
 *  positive count, or an inability to determine the sum (NaN/non-number),
 *  blocks deletion. Never guess safe. */
export function isSafeToDelete(bareReadSum) {
  if (typeof bareReadSum !== "number" || Number.isNaN(bareReadSum)) return false;
  return bareReadSum === 0;
}

/** Sum a CloudWatch GetMetricStatistics response's Datapoints[].Sum,
 *  treating an empty/absent Datapoints array as 0 (no submitted values in
 *  the window == no occurrences, since the metric is only ever put on an
 *  actual legacy read — see shared/project.ts:emitLegacyCredentialRead). */
export function sumDatapoints(datapoints) {
  return (datapoints ?? []).reduce((acc, d) => acc + (d?.Sum ?? 0), 0);
}

// ── CLI / IO ───────────────────────────────────────────────────────────────

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
}

async function main() {
  const STAGE = arg("stage", process.env.STAGE || "prod");
  const WINDOW_DAYS = Number(arg("window-days", 7));
  const DRY = process.argv.includes("--dry-run");

  // @aws-sdk lives in workforce/lambdas/node_modules; resolve it from there
  // so this script runs from any cwd (mirrors backfill-performance-lifecycle.mjs).
  const { createRequire } = await import("node:module");
  const { pathToFileURL, fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const lambdasReq = createRequire(
    join(dirname(fileURLToPath(import.meta.url)), "..", "lambdas", "package.json"),
  );
  const importLambdaDep = (spec) => import(pathToFileURL(lambdasReq.resolve(spec)).href);
  const { CloudWatchClient, GetMetricStatisticsCommand } =
    await importLambdaDep("@aws-sdk/client-cloudwatch");
  const { SecretsManagerClient, GetSecretValueCommand, DeleteSecretCommand, ResourceNotFoundException } =
    await importLambdaDep("@aws-sdk/client-secrets-manager");

  const cw = new CloudWatchClient({});
  const sm = new SecretsManagerClient({});

  const end = new Date();
  const start = new Date(end.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const stat = await cw.send(
    new GetMetricStatisticsCommand({
      Namespace: "Workforce/Credentials",
      MetricName: "WfLegacyCredentialReads",
      Dimensions: [
        { Name: "Stage", Value: STAGE },
        { Name: "Reason", Value: "fallback_bare" },
      ],
      StartTime: start,
      EndTime: end,
      Period: WINDOW_DAYS * 24 * 60 * 60,
      Statistics: ["Sum"],
    }),
  );
  const sum = sumDatapoints(stat.Datapoints);

  console.error(
    `WfLegacyCredentialReads(Reason=fallback_bare, Stage=${STAGE}) trailing ${WINDOW_DAYS}d sum = ${sum} ` +
      `(${(stat.Datapoints ?? []).length} datapoint(s))`,
  );

  if (!isSafeToDelete(sum)) {
    console.error(
      `REFUSING to delete — bare-path reads occurred within the trailing ${WINDOW_DAYS}-day window ` +
        `(or the sum could not be determined). Re-run once the metric has read 0 for >= 1 week ` +
        `(Epic-010 criterion (a) / #91's closeout condition).`,
    );
    process.exitCode = 1;
    return;
  }

  console.error(`Safe to delete — 0 bare-path reads over the trailing ${WINDOW_DAYS} days.`);

  for (const legacyId of LEGACY_BARE_KEYS) {
    try {
      await sm.send(new GetSecretValueCommand({ SecretId: legacyId }));
    } catch (err) {
      const isNotFound =
        err instanceof ResourceNotFoundException || err?.name === "ResourceNotFoundException";
      if (isNotFound) {
        console.error(`${legacyId} — already absent, skipping.`);
        continue;
      }
      throw err;
    }
    if (DRY) {
      console.error(`[dry-run] would delete ${legacyId} (Secrets Manager default ~30-day recovery window)`);
      continue;
    }
    await sm.send(new DeleteSecretCommand({ SecretId: legacyId }));
    console.error(`deleted ${legacyId} (recoverable for Secrets Manager's default window)`);
  }

  console.error(`${DRY ? "[dry-run] " : ""}done.`);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
