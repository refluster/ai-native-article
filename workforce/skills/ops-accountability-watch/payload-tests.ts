// @ts-nocheck — the module under test (payload.mjs) is a dependency-free
// ESM script, not TS; vitest/esbuild imports it fine at runtime. Discovered
// by workforce/lambdas/vitest.config.mjs (`include: ["../skills/**/*-tests.ts"]`).
import { describe, it, expect } from "vitest";
import { buildIssueSpec, buildNotificationPayload, toDiscordWebhookBody, ISSUE_TITLE_PREFIX } from "./payload.mjs";

function finding(overrides) {
  return {
    kind: "ci-run",
    key: "ci-run:deploy-article-site.yml",
    label: "deploy-article-site.yml — failure",
    detailLines: ["Workflow: `deploy-article-site.yml`", "Conclusion: `failure` (run #42)"],
    sourceUrl: "https://example.test/run/42",
    owner: "elena",
    ownerReason: "article publish/content pipeline",
    project: "article",
    closeCondition: "Close when the next run succeeds.",
    ...overrides,
  };
}

describe("buildIssueSpec", () => {
  it("builds a title prefixed for idempotent title-search", () => {
    const spec = buildIssueSpec(finding());
    expect(spec.title).toBe(`${ISSUE_TITLE_PREFIX} deploy-article-site.yml — failure`);
  });

  it("always carries type:ops + layer:L3 + a project: label + an owner: label", () => {
    const spec = buildIssueSpec(finding());
    expect(spec.labels).toEqual(expect.arrayContaining(["type:ops", "layer:L3", "project:article", "owner:elena"]));
  });

  it("embeds the owner, the reason, and the close condition in the body", () => {
    const spec = buildIssueSpec(finding());
    expect(spec.body).toContain("`elena`");
    expect(spec.body).toContain("article publish/content pipeline");
    expect(spec.body).toContain("Close when the next run succeeds.");
  });

  it("throws rather than silently omitting a required field", () => {
    expect(() => buildIssueSpec(finding({ owner: undefined }))).toThrow(/owner/);
    expect(() => buildIssueSpec(finding({ closeCondition: undefined }))).toThrow(/closeCondition/);
  });
});

describe("buildNotificationPayload — exactly one aggregate payload per fire", () => {
  const now = new Date("2026-07-23T00:00:00Z");

  it("Awareness Only when there are zero follow-ups", () => {
    const payload = buildNotificationPayload([], { sweptSurfaces: ["ci.yml", "deploy-article-site.yml"], mode: "observation" }, now);
    expect(payload.mode).toBe("awareness-only");
    expect(payload.title).toMatch(/Awareness Only/);
    expect(payload.title).toMatch(/0 follow-ups/);
    expect(payload.description).toMatch(/ci\.yml, deploy-article-site\.yml/);
  });

  it("mentions the observation-mode exit condition only while in observation mode", () => {
    const observation = buildNotificationPayload([], { sweptSurfaces: [], mode: "observation" }, now);
    expect(observation.description).toMatch(/Observation mode/);
    const steady = buildNotificationPayload([], { sweptSurfaces: [], mode: "steady" }, now);
    expect(steady.description).toMatch(/Steady state/);
  });

  it("Repair Required when there is >= 1 follow-up, and links every issue rather than restating it", () => {
    const links = [
      { key: "ci-run:deploy-article-site.yml", url: "https://github.test/issues/1", action: "created", owner: "elena", title: "x" },
      { key: "backlog-stale:ML-003", url: "https://github.test/issues/2", action: "updated", owner: "petra", title: "y" },
    ];
    const payload = buildNotificationPayload(links, { sweptSurfaces: ["ci.yml"], mode: "observation" }, now);
    expect(payload.mode).toBe("repair-required");
    expect(payload.title).toMatch(/Repair Required/);
    expect(payload.title).toMatch(/2 follow-ups/);
    expect(payload.description).toContain("https://github.test/issues/1");
    expect(payload.description).toContain("https://github.test/issues/2");
  });

  it("never posts one message per finding — the payload is a single title/description pair regardless of finding count", () => {
    const manyLinks = Array.from({ length: 5 }, (_, i) => ({
      key: `k${i}`,
      url: `https://github.test/issues/${i}`,
      action: "created",
      owner: "petra",
      title: `finding ${i}`,
    }));
    const payload = buildNotificationPayload(manyLinks, { sweptSurfaces: [], mode: "steady" }, now);
    expect(typeof payload.title).toBe("string");
    expect(typeof payload.description).toBe("string");
  });
});

describe("toDiscordWebhookBody", () => {
  it("shapes the documented Discord webhook execute-endpoint body (username + embeds[])", () => {
    const payload = buildNotificationPayload([], { sweptSurfaces: [], mode: "steady" }, new Date("2026-07-23T00:00:00Z"));
    const body = toDiscordWebhookBody(payload);
    expect(body.username).toBe("ops-accountability-watch");
    expect(body.embeds).toHaveLength(1);
    expect(body.embeds[0]).toHaveProperty("title");
    expect(body.embeds[0]).toHaveProperty("description");
    expect(body.embeds[0]).toHaveProperty("color");
  });
});
