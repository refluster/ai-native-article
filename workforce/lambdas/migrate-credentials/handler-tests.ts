// Unit tests for workforce/lambdas/migrate-credentials/handler.ts.
//
// Covers the Story 2-B (#91) acceptance criteria for the migration
// Lambda:
//   - Idempotent: re-running after a successful migration is a clean
//     no-op (`already_migrated`) — destination is never overwritten
//   - Counts migrated / already_migrated / source_missing / errors
//     separately so the operator can graph each
//   - Source missing is NOT an error (the operator may have never
//     provisioned that bare key) — counted + logged + continue
//   - Non-NotFound source errors surface in `errors[]` (W-4)
//   - Emits the four Workforce/Credentials metrics
//
// Secrets Manager is mocked at the SDK module boundary so we can drive
// CreateSecret + GetSecretValue from a per-test in-memory store.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.STAGE = "test";

// In-memory Secrets Manager: SecretId → SecretString.
const secrets = new Map<string, string>();

// CloudWatch capture.
type MetricBatch = {
  Namespace: string;
  MetricData: Array<{ MetricName: string; Value: number }>;
};
const metricBatches: MetricBatch[] = [];

// Per-test override queues for surfacing non-NotFound errors.
const getFailureQueue: Array<{ id: string; err: Error }> = [];
const createFailureQueue: Array<{ id: string; err: Error }> = [];

class FakeResourceNotFoundException extends Error {
  override name = "ResourceNotFoundException";
  constructor() {
    super("not found");
  }
}
class FakeResourceExistsException extends Error {
  override name = "ResourceExistsException";
  constructor() {
    super("already exists");
  }
}

vi.mock("@aws-sdk/client-secrets-manager", () => ({
  SecretsManagerClient: class {
    async send(cmd: { _kind: string; input: Record<string, unknown> }) {
      if (cmd._kind === "get") {
        const id = cmd.input.SecretId as string;
        const fail = getFailureQueue.find((f) => f.id === id);
        if (fail) {
          getFailureQueue.splice(getFailureQueue.indexOf(fail), 1);
          throw fail.err;
        }
        const v = secrets.get(id);
        if (v === undefined) throw new FakeResourceNotFoundException();
        return { SecretString: v };
      }
      if (cmd._kind === "create") {
        const id = cmd.input.Name as string;
        const value = cmd.input.SecretString as string;
        const fail = createFailureQueue.find((f) => f.id === id);
        if (fail) {
          createFailureQueue.splice(createFailureQueue.indexOf(fail), 1);
          throw fail.err;
        }
        if (secrets.has(id)) throw new FakeResourceExistsException();
        secrets.set(id, value);
        return {};
      }
      throw new Error(`unexpected command kind ${cmd._kind}`);
    }
  },
  GetSecretValueCommand: class {
    _kind = "get";
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  },
  CreateSecretCommand: class {
    _kind = "create";
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  },
  ResourceExistsException: FakeResourceExistsException,
  ResourceNotFoundException: FakeResourceNotFoundException,
}));

vi.mock("@aws-sdk/client-cloudwatch", () => ({
  CloudWatchClient: class {
    async send(cmd: { input: MetricBatch }) {
      metricBatches.push(cmd.input);
    }
  },
  PutMetricDataCommand: class {
    input: MetricBatch;
    constructor(input: MetricBatch) {
      this.input = input;
    }
  },
}));

const { handler } = await import("./handler.js");

const LEGACY = ["wf/anthropic", "wf/github", "wf/notion"] as const;
const TYPED_DEFAULTS = [
  "wf/projects/_default/anthropic.api_key",
  "wf/projects/_default/github.token",
  "wf/projects/_default/notion.integration_token",
] as const;

beforeEach(() => {
  secrets.clear();
  metricBatches.length = 0;
  getFailureQueue.length = 0;
  createFailureQueue.length = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("migrate-credentials handler", () => {
  it("copies every bare key to its typed _default path on a fresh run", async () => {
    for (const id of LEGACY) secrets.set(id, JSON.stringify({ token: `secret-${id}` }));

    const result = await handler();

    expect(result.scanned).toBe(3);
    expect(result.migrated).toBe(3);
    expect(result.already_migrated).toBe(0);
    expect(result.source_missing).toBe(0);
    expect(result.errors).toEqual([]);
    for (let i = 0; i < LEGACY.length; i++) {
      expect(secrets.get(TYPED_DEFAULTS[i]!)).toBe(secrets.get(LEGACY[i]!));
    }
  });

  it("is idempotent — second run reports already_migrated for every pair", async () => {
    for (const id of LEGACY) secrets.set(id, JSON.stringify({ token: `secret-${id}` }));
    await handler();
    metricBatches.length = 0;

    const result = await handler();
    expect(result.scanned).toBe(3);
    expect(result.migrated).toBe(0);
    expect(result.already_migrated).toBe(3);
    expect(result.source_missing).toBe(0);
    expect(result.errors).toEqual([]);
  });

  it("never overwrites an existing destination (operator-pre-seeded value survives)", async () => {
    secrets.set("wf/anthropic", "legacy-anthropic-value");
    // Operator pre-seeded a different value at the destination:
    secrets.set(TYPED_DEFAULTS[0]!, "operator-seed-value");

    const result = await handler();
    expect(result.already_migrated).toBeGreaterThanOrEqual(1);
    expect(secrets.get(TYPED_DEFAULTS[0]!)).toBe("operator-seed-value");
  });

  it("counts source_missing for bare keys the operator never provisioned (not an error)", async () => {
    // Only one of the three legacy keys exists. Others are NotFound.
    secrets.set("wf/notion", "notion-value");

    const result = await handler();
    expect(result.scanned).toBe(3);
    expect(result.migrated).toBe(1);
    expect(result.source_missing).toBe(2);
    expect(result.errors).toEqual([]);
    // Destinations for missing sources stay absent — getCredential() at
    // runtime will throw loudly, which is the correct W-4 behaviour.
    expect(secrets.has(TYPED_DEFAULTS[0]!)).toBe(false);
    expect(secrets.has(TYPED_DEFAULTS[1]!)).toBe(false);
    expect(secrets.get(TYPED_DEFAULTS[2]!)).toBe("notion-value");
  });

  it("non-NotFound source errors surface in errors[] (W-4)", async () => {
    secrets.set("wf/github", "gh");
    secrets.set("wf/notion", "n");
    getFailureQueue.push({
      id: "wf/anthropic",
      err: Object.assign(new Error("AccessDeniedException"), { name: "AccessDeniedException" }),
    });

    const result = await handler();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.legacy).toBe("wf/anthropic");
    expect(result.errors[0]!.message).toMatch(/AccessDenied/);
    // Other pairs still complete despite the partial failure.
    expect(result.migrated).toBe(2);
  });

  it("emits Workforce/Credentials metrics for the four outcome counters", async () => {
    secrets.set("wf/anthropic", "a");
    secrets.set("wf/notion", "n");
    // wf/github intentionally absent → source_missing

    await handler();
    expect(metricBatches).toHaveLength(1);
    const batch = metricBatches[0]!;
    expect(batch.Namespace).toBe("Workforce/Credentials");
    const names = batch.MetricData.map((m) => m.MetricName).sort();
    expect(names).toEqual([
      "WfCredentialsAlreadyMigrated",
      "WfCredentialsMigrated",
      "WfCredentialsMigrationErrors",
      "WfCredentialsSourceMissing",
    ]);
    const byName = new Map(batch.MetricData.map((m) => [m.MetricName, m.Value]));
    expect(byName.get("WfCredentialsMigrated")).toBe(2);
    expect(byName.get("WfCredentialsSourceMissing")).toBe(1);
    expect(byName.get("WfCredentialsAlreadyMigrated")).toBe(0);
    expect(byName.get("WfCredentialsMigrationErrors")).toBe(0);
  });

  it("surfaces non-Exists CreateSecret errors", async () => {
    secrets.set("wf/anthropic", "a");
    createFailureQueue.push({
      id: TYPED_DEFAULTS[0]!,
      err: Object.assign(new Error("InternalServiceError"), { name: "InternalServiceError" }),
    });

    const result = await handler();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.legacy).toBe("wf/anthropic");
    expect(result.errors[0]!.message).toMatch(/InternalServiceError/);
  });
});
