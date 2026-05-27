// Unit tests for workforce/lambdas/shared/credential-injector.ts.
//
// Covers Story 2-A (#91) acceptance criteria at the helper layer:
//   - declared types resolve to their fetched value
//   - undeclared type access throws (W-2 trust boundary enforcement)
//   - empty `requires` produces an empty sealed bag
//   - JS plumbing access (Symbol, then, toString, JSON.stringify, …) passes through
//   - bag is sealed: mutation + deletion throw
//   - the runtime allowlist re-check fires when meta.json drifts
//   - the bag's narrow TS type matches the runtime declared set
//
// The end-to-end "injector wired into agent-runner" tests belong in
// Story 2-B (the wire-up PR).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Type-only import — does not trigger module evaluation, so it sits
// outside the `vi.mock` → `await import` ordering below.
import type { ProjectId } from "./project.js";
import type { NotionSecret, GithubSecret } from "./secrets.js";

// Hold the per-test mock impl in a module-scoped ref. The `vi.mock`
// factory below closes over it; tests overwrite for their case.
const getCredentialMock = vi.fn();

// Full stub of project.js: only `getCredential` is consumed as a value
// by the SUT (ProjectId is a type-only import, erased at runtime).
// `importOriginal` is avoided here because it pulls in ddb.js, which
// throws on the missing TABLE_NAME env at module load.
vi.mock("./project.js", () => ({
  getCredential: getCredentialMock,
}));

// Import the SUT AFTER the mock is registered so the bound reference
// inside credential-injector.ts captures the mocked function.
const { injectCredentials, CREDENTIAL_TYPES, isCredentialType } =
  await import("./credential-injector.js");

const PROJECT: ProjectId = "workforce-meta" as ProjectId;

beforeEach(() => {
  getCredentialMock.mockReset();
});

describe("CREDENTIAL_TYPES allowlist", () => {
  it("contains the four canonical types in Story 2 issue scope", () => {
    expect([...CREDENTIAL_TYPES].sort()).toEqual([
      "anthropic.api_key",
      "discord.bot_token",
      "github.token",
      "notion.integration_token",
    ]);
  });

  it("isCredentialType narrows on members and rejects non-members", () => {
    expect(isCredentialType("notion.integration_token")).toBe(true);
    expect(isCredentialType("anthropic.api_key")).toBe(true);
    expect(isCredentialType("notion")).toBe(false);
    expect(isCredentialType("")).toBe(false);
    expect(isCredentialType("notion.api_key")).toBe(false); // close-but-wrong
  });
});

describe("injectCredentials — resolution", () => {
  it("resolves each declared type via getCredential and returns it on the bag", async () => {
    const notionVal: NotionSecret = { apiKey: "n-test", databaseId: "db-test" };
    const githubVal: GithubSecret = { token: "ghp_test" };
    getCredentialMock.mockImplementation(async (_pid, type) => {
      if (type === "notion.integration_token") return notionVal;
      if (type === "github.token") return githubVal;
      throw new Error(`unexpected type ${type}`);
    });

    const bag = await injectCredentials(
      ["notion.integration_token", "github.token"] as const,
      PROJECT,
    );

    expect(bag["notion.integration_token"]).toEqual(notionVal);
    expect(bag["github.token"]).toEqual(githubVal);
  });

  it("calls getCredential once per declared type with the active projectId", async () => {
    getCredentialMock.mockResolvedValue({ apiKey: "x" });
    await injectCredentials(["anthropic.api_key"] as const, PROJECT);
    expect(getCredentialMock).toHaveBeenCalledTimes(1);
    expect(getCredentialMock).toHaveBeenCalledWith(PROJECT, "anthropic.api_key");
  });

  it("returns an empty sealed bag for an empty requires[]", async () => {
    const bag = await injectCredentials([] as const, PROJECT);
    expect(Object.keys(bag)).toEqual([]);
    expect(getCredentialMock).not.toHaveBeenCalled();
  });

  it("resolves declared types in parallel (Promise.all, not sequential await)", async () => {
    // Lightweight ordering check — pass-fail not timing-dependent.
    const order: string[] = [];
    getCredentialMock.mockImplementation(async (_pid, type) => {
      order.push(`start:${type}`);
      await new Promise((r) => setTimeout(r, 0));
      order.push(`end:${type}`);
      return { token: type };
    });
    await injectCredentials(["github.token", "discord.bot_token"] as const, PROJECT);
    // If sequential: order would be [start:github, end:github, start:discord, end:discord].
    // Parallel allows interleaving — assert both starts precede any end.
    expect(order.indexOf("start:github.token")).toBeLessThan(order.indexOf("end:github.token"));
    expect(order.indexOf("start:discord.bot_token")).toBeLessThan(order.indexOf("end:discord.bot_token"));
    const lastStart = Math.max(
      order.indexOf("start:github.token"),
      order.indexOf("start:discord.bot_token"),
    );
    const firstEnd = Math.min(
      order.indexOf("end:github.token"),
      order.indexOf("end:discord.bot_token"),
    );
    expect(lastStart).toBeLessThan(firstEnd);
  });
});

describe("injectCredentials — seal (undeclared access throws)", () => {
  it("throws when reading a credential-type key not in requires[]", async () => {
    getCredentialMock.mockResolvedValue({ apiKey: "n-test", databaseId: "db" });
    const bag = await injectCredentials(["notion.integration_token"] as const, PROJECT);

    expect(() => (bag as Record<string, unknown>)["github.token"]).toThrow(
      /credential type "github\.token" not declared/,
    );
    expect(() => (bag as Record<string, unknown>)["anthropic.api_key"]).toThrow(
      /credential type "anthropic\.api_key" not declared/,
    );
  });

  it("throws on arbitrary unknown strings (defense-in-depth)", async () => {
    getCredentialMock.mockResolvedValue({});
    const bag = await injectCredentials([] as const, PROJECT);
    expect(() => (bag as Record<string, unknown>)["arbitrary"]).toThrow(
      /credential type "arbitrary" not declared/,
    );
    expect(() => (bag as Record<string, unknown>)["secret-key"]).toThrow(
      /credential type "secret-key" not declared/,
    );
  });

  it("rejects mutation attempts", async () => {
    getCredentialMock.mockResolvedValue({ token: "t" });
    const bag = await injectCredentials(["github.token"] as const, PROJECT);
    expect(() => {
      (bag as Record<string, unknown>)["github.token"] = { token: "evil" };
    }).toThrow(/sealed/);
    expect(() => {
      (bag as Record<string, unknown>)["new-key"] = "anything";
    }).toThrow(/sealed/);
  });

  it("rejects delete attempts", async () => {
    getCredentialMock.mockResolvedValue({ token: "t" });
    const bag = await injectCredentials(["github.token"] as const, PROJECT);
    expect(() => {
      delete (bag as Record<string, unknown>)["github.token"];
    }).toThrow(/sealed/);
  });
});

describe("injectCredentials — JS plumbing pass-through", () => {
  it("lets `await bag` work (Promise resolution checks `.then`)", async () => {
    getCredentialMock.mockResolvedValue({ token: "t" });
    const bag = await injectCredentials(["github.token"] as const, PROJECT);
    // If `then` threw, this Promise.resolve(bag) wrap would have thrown
    // already at the await-resolution machinery. The bag is not a
    // thenable, so awaiting it just yields the bag.
    const resolved = await Promise.resolve(bag);
    expect(resolved["github.token"]).toEqual({ token: "t" });
  });

  it("lets `JSON.stringify(bag)` work (no throw on toJSON / nested string keys)", async () => {
    getCredentialMock.mockResolvedValue({ token: "t" });
    const bag = await injectCredentials(["github.token"] as const, PROJECT);
    const serialised = JSON.stringify(bag);
    expect(serialised).toContain("github.token");
    expect(serialised).toContain("\"token\":\"t\"");
  });

  it("lets `String(bag)` work (toString pass-through)", async () => {
    getCredentialMock.mockResolvedValue({ token: "t" });
    const bag = await injectCredentials(["github.token"] as const, PROJECT);
    // Default object toString → "[object Object]"; the assertion is that
    // it doesn't throw, not the specific string.
    expect(() => String(bag)).not.toThrow();
  });

  it("lets `Object.keys(bag)` reflect only declared types", async () => {
    getCredentialMock.mockResolvedValue({ token: "t" });
    const bag = await injectCredentials(["github.token"] as const, PROJECT);
    expect(Object.keys(bag).sort()).toEqual(["github.token"]);
  });

  it("`'github.token' in bag` is true; `'anthropic.api_key' in bag` is false", async () => {
    getCredentialMock.mockResolvedValue({ token: "t" });
    const bag = await injectCredentials(["github.token"] as const, PROJECT);
    expect("github.token" in bag).toBe(true);
    expect("anthropic.api_key" in bag).toBe(false);
  });
});

describe("injectCredentials — defense-in-depth allowlist check", () => {
  it("throws BEFORE fetching when requires[] contains an unknown type", async () => {
    // Cast: simulating a meta.json that bypassed lint (e.g., schema drift).
    await expect(
      injectCredentials(
        ["pagerduty.token"] as unknown as ReadonlyArray<
          Parameters<typeof injectCredentials>[0][number]
        >,
        PROJECT,
      ),
    ).rejects.toThrow(/"pagerduty\.token" not in CREDENTIAL_TYPES allowlist/);
    expect(getCredentialMock).not.toHaveBeenCalled();
  });
});
