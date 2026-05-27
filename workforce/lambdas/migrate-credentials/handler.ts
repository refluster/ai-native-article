// wf-migrate-credentials Lambda handler.
//
// One-shot, operator-invoked. Copies each legacy bare-path credential
// (`wf/{legacy_name}`) into the post-Epic-010 type-keyed path under the
// `_default` pseudo-project (`wf/projects/_default/{credential_type}`).
//
// The `_default` choice was the operator decision on Open Q4 (PR #119
// follow-up): all bare keys go uniformly to `_default`; future per-
// project splits (e.g. Notion under PROJECT#editorial vs workforce-self)
// are a separate follow-up so the migration itself stays trivially
// idempotent and the trust-boundary roll-out is decoupled from the
// integration-multiplication question.
//
// Idempotency: each destination key creation is gated on
// `CreateSecret` succeeding OR throwing `ResourceExistsException`
// (caught + counted as `already_migrated`). Re-running the Lambda is
// always safe and observable — the per-run counts tell the operator
// whether a fresh source key showed up since the previous invocation.
//
// W-4 (fail-loud) preserved: any error other than ResourceExists or
// ResourceNotFound on the source surfaces. The result struct holds an
// `errors[]` for partial-failure observability but the Lambda's exit
// status is success — the operator inspects the metrics + log for the
// per-pair outcome.
//
// Naming map: the legacy bare paths predate the Story 2 credential-type
// registry, so the mapping is explicit (NOT a 1:1 string rewrite). E.g.
// the legacy path `wf/notion` carries what the registry now calls
// `notion.integration_token`. Discord bot tokens have no legacy bare
// path (the existing `wf/discord-*` keys are webhooks, a different
// credential type) — they're omitted from the map entirely; operator
// provisions them directly under `wf/projects/_default/discord.bot_token`
// when first needed.

import {
  CreateSecretCommand,
  GetSecretValueCommand,
  ResourceExistsException,
  ResourceNotFoundException,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import {
  CloudWatchClient,
  PutMetricDataCommand,
} from "@aws-sdk/client-cloudwatch";

const STAGE = process.env.STAGE ?? "dev";
const sm = new SecretsManagerClient({});
const cw = new CloudWatchClient({});

/**
 * Legacy-bare-path → canonical-credential-type map. The MIGRATION SCOPE
 * is exactly this set: anything outside the map is left alone (e.g.
 * `wf/discord-pulse-{stage}` webhook secrets are not credential-bag
 * citizens and stay where they are). To extend the migration, add the
 * pair here AND extend the SAM template's secretsmanager Resource list.
 */
const LEGACY_TO_TYPED: ReadonlyArray<{ legacy: string; typed: string }> = [
  { legacy: "wf/anthropic", typed: "anthropic.api_key" },
  { legacy: "wf/github", typed: "github.token" },
  { legacy: "wf/notion", typed: "notion.integration_token" },
];

const DEFAULT_PROJECT = "_default";

export interface MigrationResult {
  scanned: number;
  migrated: number;
  already_migrated: number;
  source_missing: number;
  errors: Array<{ legacy: string; message: string }>;
}

export async function handler(): Promise<MigrationResult> {
  const result: MigrationResult = {
    scanned: 0,
    migrated: 0,
    already_migrated: 0,
    source_missing: 0,
    errors: [],
  };

  for (const pair of LEGACY_TO_TYPED) {
    result.scanned++;
    const destName = `wf/projects/${DEFAULT_PROJECT}/${pair.typed}`;
    try {
      const sourceValue = await fetchSourceString(pair.legacy);
      if (sourceValue === null) {
        // Operator never provisioned this bare key — nothing to copy.
        // Not an error; the destination just stays unprovisioned and
        // any future getCredential() for the type fails loud, which
        // is the correct W-4 behaviour.
        result.source_missing++;
        console.warn(
          JSON.stringify({
            event: "migrate_credential_source_missing",
            legacy: pair.legacy,
            typed: pair.typed,
          }),
        );
        continue;
      }
      const created = await createIfAbsent(destName, sourceValue);
      if (created) {
        result.migrated++;
        console.log(
          JSON.stringify({
            event: "migrate_credential_copied",
            legacy: pair.legacy,
            destination: destName,
          }),
        );
      } else {
        result.already_migrated++;
        console.log(
          JSON.stringify({
            event: "migrate_credential_already_present",
            legacy: pair.legacy,
            destination: destName,
          }),
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push({ legacy: pair.legacy, message });
      console.error(
        JSON.stringify({
          event: "migrate_credential_error",
          legacy: pair.legacy,
          destination: destName,
          message,
        }),
      );
    }
  }

  await emitMetrics(result);
  console.log(JSON.stringify({ event: "migrate_credentials_complete", result }));
  return result;
}

async function fetchSourceString(legacyName: string): Promise<string | null> {
  try {
    const res = await sm.send(new GetSecretValueCommand({ SecretId: legacyName }));
    if (!res.SecretString) {
      // Binary secrets aren't supported by the runtime path either;
      // surface as an error rather than a silent skip so the operator
      // notices the format gap and corrects it.
      throw new Error(`source secret "${legacyName}" has no SecretString`);
    }
    return res.SecretString;
  } catch (err) {
    if (err instanceof ResourceNotFoundException) return null;
    throw err;
  }
}

/** Returns true when a new destination secret was created, false when one
 *  already existed (idempotent re-run). */
async function createIfAbsent(name: string, secretString: string): Promise<boolean> {
  try {
    await sm.send(
      new CreateSecretCommand({
        Name: name,
        SecretString: secretString,
        Description: "Epic-010 Story 2-B migration: copied from legacy bare path.",
      }),
    );
    return true;
  } catch (err) {
    if (err instanceof ResourceExistsException) {
      // Destination already provisioned — by a prior run of this
      // Lambda OR by operator (e.g. they pre-seeded a different value
      // under the typed path). In either case we do NOT overwrite —
      // the destination is the post-migration source of truth.
      return false;
    }
    throw err;
  }
}

async function emitMetrics(result: MigrationResult): Promise<void> {
  try {
    await cw.send(
      new PutMetricDataCommand({
        Namespace: "Workforce/Credentials",
        MetricData: [
          {
            MetricName: "WfCredentialsMigrated",
            Value: result.migrated,
            Unit: "Count",
            Dimensions: [{ Name: "Stage", Value: STAGE }],
          },
          {
            MetricName: "WfCredentialsAlreadyMigrated",
            Value: result.already_migrated,
            Unit: "Count",
            Dimensions: [{ Name: "Stage", Value: STAGE }],
          },
          {
            MetricName: "WfCredentialsSourceMissing",
            Value: result.source_missing,
            Unit: "Count",
            Dimensions: [{ Name: "Stage", Value: STAGE }],
          },
          {
            MetricName: "WfCredentialsMigrationErrors",
            Value: result.errors.length,
            Unit: "Count",
            Dimensions: [{ Name: "Stage", Value: STAGE }],
          },
        ],
      }),
    );
  } catch (err) {
    // Best-effort: never fail the migration on metric emission.
    console.warn(
      JSON.stringify({
        event: "migrate_credentials_metric_emit_failed",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}
