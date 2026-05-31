// Unit tests for workforce/lambdas/shared/credential-injector.ts.
//
// Covers Story 2-A (#91) acceptance criteria at the helper layer + the
// cycle-1 review findings from Dario + Ren:
//   - declared keys resolve to their fetched value
//   - undeclared key access throws (W-2 trust boundary enforcement)
//   - empty `requires` produces an empty sealed bag
//   - JS plumbing access (Symbol, then, toString, JSON.stringify, …)
//     passes through
//   - bag is sealed: mutation + deletion throw
//   - the runtime allowlist re-check fires when meta.json drifts
//   - cross-invocation isolation (no shared closure leak)            [B3]
//   - getCredential rejection propagates up                          [B2]
//   - skillName label is woven into "undeclared" throws              [B7]
//   - variant keys (`type@name`) resolve and seal                   [Q2-ii]
//   - variant pattern + empty-variant rejection at runtime          [Q2-ii]
//   - cold-start collision assertion fires when PLUMBING ∩ TYPES ≠ ∅ [A3/B8]
//
// The end-to-end "injector wired into agent-runner" tests belong in
// Story 2-B (the wire-up PR).

import { beforeEach, describe, expect, it, vi } from "vitest";

// Type-only imports — erased at runtime; sit outside the `vi.mock` →
// `await import` ordering below.
import type { ProjectId } from "./project.js";
import type { NotionSecret, GithubSecret } from "./secrets.js";

// Hold the per-test mock impl in a module-scoped ref. The `vi.mock`
// factory below closes over it; tests overwrite per case.
const getCredentialMock = vi.fn();

// Full stub of project.js: the SUT consumes only `getCredential` as a
// value (ProjectId is type-only). `importOriginal` is avoided because
// it pulls in ddb.js, which throws on the missing TABLE_NAME env at
// module load.
//
// Per cycle-1 review (Ren B6): if a future SUT change starts importing
// another runtime symbol from `./project.js`, the full-stub will
// silently return `undefined` for it. Mitigation today is the
// `TypeError: x is not a function` that the test suite would surface
// at the first call site; a stricter guard (re-stub by named-export
// inspection) is out-of-scope for 2-A.
vi.mock("./project.js", () => ({
  getCredential: getCredentialMock,
}));

// Import the SUT AFTER the mock is registered so the bound reference
// inside credential-injector.ts captures the mocked function.
const {
  injectCredentials,
  CREDENTIAL_TYPES,
  isCredentialType,
  parseCredentialKey,
} = await import("./credential-injector.js");

const PROJECT: ProjectId = "workforce-meta" as ProjectId;

beforeEach(() => {
  getCredentialMock.mockReset();
});

describe("CREDENTIAL_TYPES allowlist", () => {
  it("contains the Story 2 base set plus Story 4's voyage.api_key and discord.webhook_url", () => {
    // Story 4 (#93) added `voyage.api_key` for the EXEC-row embedding-
    // write path. The CCR-foundation PR adds `discord.webhook_url` so
    // `discord-heartbeat` (CCR-routed sibling of discord-ping) reads
    // its webhook URL from the project credential bag instead of an
    // env var. All 5 mirror points (see credential-injector.ts file
    // header) were touched in the same PR; this assertion is the
    // visible canary that catches drift if a future mirror sync is
    // forgotten.
    expect([...CREDENTIAL_TYPES].sort()).toEqual([
      "anthropic.api_key",
      "discord.bot_token",
      "discord.webhook_url",
      "github.token",
      "notion.integration_token",
      "voyage.api_key",
    ]);
  });

  it("isCredentialType narrows on members and rejects non-members", () => {
    expect(isCredentialType("notion.integration_token")).toBe(true);
    expect(isCredentialType("anthropic.api_key")).toBe(true);
    expect(isCredentialType("notion")).toBe(false);
    expect(isCredentialType("")).toBe(false);
    expect(isCredentialType("notion.api_key")).toBe(false); // close-but-wrong
  });

  it("cold-start collision invariant: CREDENTIAL_TYPES ∩ PLUMBING_PROPS = ∅", () => {
    // PLUMBING_PROPS is not exported, but the module already enforces
    // this invariant at load time — if the assertion would fire, the
    // SUT import above would have thrown and the suite would not be
    // running. So this test is a documenting-the-invariant assertion:
    // we cross-check the known-collision-prone names manually.
    const knownPlumbing = [
      "then", "catch", "finally", "constructor", "prototype",
      "__proto__", "toString", "toJSON", "valueOf", "length",
      "name", "asymmetricMatch",
    ];
    for (const name of knownPlumbing) {
      expect(CREDENTIAL_TYPES.has(name as never)).toBe(false);
    }
  });
});

describe("parseCredentialKey", () => {
  it("parses a base-only key (no variant)", () => {
    expect(parseCredentialKey("notion.integration_token")).toEqual({
      baseType: "notion.integration_token",
      variant: null,
    });
  });

  it("parses a variant key (base + variant)", () => {
    expect(parseCredentialKey("notion.integration_token@editorial")).toEqual({
      baseType: "notion.integration_token",
      variant: "editorial",
    });
  });

  it("returns empty variant string (not null) when key ends in '@'", () => {
    expect(parseCredentialKey("notion.integration_token@")).toEqual({
      baseType: "notion.integration_token",
      variant: "",
    });
  });
});

describe("injectCredentials — resolution", () => {
  it("resolves each declared key via getCredential and returns it on the bag", async () => {
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

  it("calls getCredential once per declared key with the active projectId", async () => {
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

  it("resolves declared keys in parallel (Promise.all, not sequential)", async () => {
    const order: string[] = [];
    getCredentialMock.mockImplementation(async (_pid, type) => {
      order.push(`start:${type}`);
      await new Promise((r) => setTimeout(r, 0));
      order.push(`end:${type}`);
      return { token: type };
    });
    await injectCredentials(["github.token", "discord.bot_token"] as const, PROJECT);
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

  it("propagates getCredential rejection (Secrets Manager miss or network error) [B2]", async () => {
    getCredentialMock.mockRejectedValueOnce(
      new Error("ResourceNotFoundException: wf/projects/p/github.token"),
    );
    await expect(
      injectCredentials(["github.token"] as const, PROJECT),
    ).rejects.toThrow(/ResourceNotFoundException/);
  });

  it("returns independent bags for concurrent invocations (no shared closure leak) [B3]", async () => {
    getCredentialMock.mockImplementation(async (_pid, type) => ({
      token: `v-${type}`,
    }));
    const [a, b] = await Promise.all([
      injectCredentials(["github.token"] as const, PROJECT),
      injectCredentials(["discord.bot_token"] as const, PROJECT),
    ]);
    expect(a["github.token"]).toEqual({ token: "v-github.token" });
    expect(b["discord.bot_token"]).toEqual({ token: "v-discord.bot_token" });
    expect(() => (a as Record<string, unknown>)["discord.bot_token"]).toThrow(
      /not declared/,
    );
    expect(() => (b as Record<string, unknown>)["github.token"]).toThrow(
      /not declared/,
    );
  });
});

describe("injectCredentials — variants (Epic-010 §Q2)", () => {
  it("resolves a variant key and exposes it under the full type@name", async () => {
    const editorial: NotionSecret = { apiKey: "ed", databaseId: "db-ed" };
    getCredentialMock.mockImplementation(async (_pid, key) => {
      if (key === "notion.integration_token@editorial") return editorial;
      throw new Error(`unexpected ${key}`);
    });

    const bag = await injectCredentials(
      ["notion.integration_token@editorial"] as const,
      PROJECT,
    );

    expect(bag["notion.integration_token@editorial"]).toEqual(editorial);
    expect(getCredentialMock).toHaveBeenCalledWith(
      PROJECT,
      "notion.integration_token@editorial",
    );
  });

  it("supports base + variants of the same type side by side", async () => {
    const base: NotionSecret = { apiKey: "base", databaseId: "db-base" };
    const wiki: NotionSecret = { apiKey: "wiki", databaseId: "db-wiki" };
    const pub: NotionSecret = { apiKey: "pub", databaseId: "db-pub" };
    getCredentialMock.mockImplementation(async (_pid, key) => {
      if (key === "notion.integration_token") return base;
      if (key === "notion.integration_token@wiki") return wiki;
      if (key === "notion.integration_token@publish") return pub;
      throw new Error(`unexpected ${key}`);
    });

    const bag = await injectCredentials(
      [
        "notion.integration_token",
        "notion.integration_token@wiki",
        "notion.integration_token@publish",
      ] as const,
      PROJECT,
    );

    expect(bag["notion.integration_token"]).toEqual(base);
    expect(bag["notion.integration_token@wiki"]).toEqual(wiki);
    expect(bag["notion.integration_token@publish"]).toEqual(pub);
  });

  it("rejects an empty variant (`type@`) at runtime", async () => {
    await expect(
      injectCredentials(
        ["notion.integration_token@"] as unknown as Parameters<
          typeof injectCredentials
        >[0],
        PROJECT,
      ),
    ).rejects.toThrow(/empty variant/);
    expect(getCredentialMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed variant (uppercase / starts-with-digit)", async () => {
    await expect(
      injectCredentials(
        ["notion.integration_token@WIKI"] as unknown as Parameters<
          typeof injectCredentials
        >[0],
        PROJECT,
      ),
    ).rejects.toThrow(/variant "WIKI" must match/);

    await expect(
      injectCredentials(
        ["notion.integration_token@1wiki"] as unknown as Parameters<
          typeof injectCredentials
        >[0],
        PROJECT,
      ),
    ).rejects.toThrow(/variant "1wiki" must match/);
  });

  it("rejects a variant of an unknown base type", async () => {
    await expect(
      injectCredentials(
        ["pagerduty.token@oncall"] as unknown as Parameters<
          typeof injectCredentials
        >[0],
        PROJECT,
      ),
    ).rejects.toThrow(/base type "pagerduty\.token" not in CREDENTIAL_TYPES/);
    expect(getCredentialMock).not.toHaveBeenCalled();
  });
});

describe("injectCredentials — seal (undeclared access throws)", () => {
  it("throws when reading a credential key not in requires[]", async () => {
    getCredentialMock.mockResolvedValue({ apiKey: "n-test", databaseId: "db" });
    const bag = await injectCredentials(["notion.integration_token"] as const, PROJECT);

    expect(() => (bag as Record<string, unknown>)["github.token"]).toThrow(
      /credential key "github\.token" not declared/,
    );
    expect(() => (bag as Record<string, unknown>)["anthropic.api_key"]).toThrow(
      /credential key "anthropic\.api_key" not declared/,
    );
  });

  it("throws on arbitrary unknown strings (defense-in-depth)", async () => {
    getCredentialMock.mockResolvedValue({});
    const bag = await injectCredentials([] as const, PROJECT);
    expect(() => (bag as Record<string, unknown>)["arbitrary"]).toThrow(
      /credential key "arbitrary" not declared/,
    );
  });

  it("weaves skillName into undeclared-access throws (B7)", async () => {
    getCredentialMock.mockResolvedValue({ token: "t" });
    const bag = await injectCredentials(["github.token"] as const, PROJECT, {
      skillName: "editorial-publish",
    });
    expect(() => (bag as Record<string, unknown>)["notion.integration_token"]).toThrow(
      /skill="editorial-publish"/,
    );
  });

  it("falls back to <unknown> when no skillName provided (B7)", async () => {
    getCredentialMock.mockResolvedValue({ token: "t" });
    const bag = await injectCredentials(["github.token"] as const, PROJECT);
    expect(() => (bag as Record<string, unknown>)["notion.integration_token"]).toThrow(
      /skill="<unknown>"/,
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

  it("reports configurable: false in the property descriptor (B5)", async () => {
    getCredentialMock.mockResolvedValue({ token: "t" });
    const bag = await injectCredentials(["github.token"] as const, PROJECT);
    const desc = Object.getOwnPropertyDescriptor(bag, "github.token");
    expect(desc).toMatchObject({
      enumerable: true,
      configurable: false,
      writable: false,
    });
  });
});

describe("injectCredentials — JS plumbing pass-through", () => {
  it("lets `await bag` work (Promise resolution checks `.then`)", async () => {
    getCredentialMock.mockResolvedValue({ token: "t" });
    const bag = await injectCredentials(["github.token"] as const, PROJECT);
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
    expect(() => String(bag)).not.toThrow();
  });

  it("lets `Object.keys(bag)` reflect only declared keys", async () => {
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
  it("throws BEFORE fetching when requires[] contains an unknown base type", async () => {
    await expect(
      injectCredentials(
        ["pagerduty.token"] as unknown as Parameters<typeof injectCredentials>[0],
        PROJECT,
      ),
    ).rejects.toThrow(/"pagerduty\.token" base type "pagerduty\.token" not in CREDENTIAL_TYPES allowlist/);
    expect(getCredentialMock).not.toHaveBeenCalled();
  });
});
