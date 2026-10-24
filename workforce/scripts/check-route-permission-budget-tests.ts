// Unit tests for the Lambda resource-policy route budget (ML-042,
// check-route-permission-budget.mjs). The walker and the predicates are pure;
// the last block runs them over the real template.

// @ts-nocheck — the script under test is dependency-free ESM, not TS.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  GRANDFATHERED_ROUTE_CEILINGS,
  MAX_HTTP_ROUTES_PER_FUNCTION,
  countHttpApiRoutes,
  overBudget,
  staleCeilings,
} from "./check-route-permission-budget.mjs";

const fn = (name: string, events: string[], extra = "") =>
  [
    `  ${name}:`,
    "    Type: AWS::Serverless::Function",
    "    Properties:",
    `      FunctionName: !Sub wf-${name.toLowerCase()}-\${Stage}`,
    extra,
    ...(events.length ? ["      Events:"] : []),
    ...events,
    "      Tags:",
    "        workforce: !Ref Stage",
  ]
    .filter(Boolean)
    .join("\n");

const httpEvent = (name: string, path: string, method = "GET", auth = false) =>
  [
    `        ${name}:`,
    "          Type: HttpApi",
    "          Properties:",
    "            ApiId: !Ref WfAgentsHttpApi",
    `            Path: ${path}`,
    `            Method: ${method}`,
    ...(auth ? ["            Auth:", "              Authorizer: AWS_IAM"] : []),
  ].join("\n");

const scheduleEvent = (name: string) =>
  [`        ${name}:`, "          Type: Schedule", "          Properties:", "            Schedule: rate(1 day)"].join("\n");

const template = (...resources: string[]) =>
  ["AWSTemplateFormatVersion: '2010-09-09'", "Globals:", "  Function:", "    Timeout: 300", "Resources:", ...resources, "Outputs:", "  X:", "    Value: y"].join("\n");

describe("countHttpApiRoutes", () => {
  it("counts HttpApi events per function and ignores other event types", () => {
    const t = template(
      fn("WfA", [httpEvent("ListA", "/a"), httpEvent("PatchA", "/a/{id}", "PATCH", true), scheduleEvent("Tick")]),
      fn("WfB", [httpEvent("GetB", "/b")]),
      fn("WfC", [scheduleEvent("Nightly")]),
    );
    const { counts, unattributed, raw } = countHttpApiRoutes(t);
    expect(Object.fromEntries(counts)).toEqual({ WfA: 2, WfB: 1, WfC: 0 });
    expect(unattributed).toBe(0);
    expect(raw).toBe(3);
  });

  it("counts quoted HttpApi scalars (Type: \"HttpApi\" / 'HttpApi') like the bare form — never a silent undercount", () => {
    const t = template(
      fn("WfA", [httpEvent("ListA", "/a"), httpEvent("GetB", "/b")]),
    ).replace('Type: HttpApi', 'Type: "HttpApi"').replace(/Type: HttpApi(?![\s\S]*Type: HttpApi)/, "Type: 'HttpApi'");
    const { counts, unattributed, raw } = countHttpApiRoutes(t);
    expect(Object.fromEntries(counts)).toEqual({ WfA: 2 });
    expect(unattributed).toBe(0);
    expect(raw).toBe(2);
  });

  it("ignores comment lines that mention Type: HttpApi", () => {
    const t = template(fn("WfA", ["        # Type: HttpApi (commented out)", httpEvent("ListA", "/a")]));
    const { counts, unattributed } = countHttpApiRoutes(t);
    expect(counts.get("WfA")).toBe(1);
    expect(unattributed).toBe(0);
  });

  it("does not attribute an HttpApi event to a non-function resource", () => {
    const t = template(
      ["  WfApi:", "    Type: AWS::Serverless::HttpApi", "    Properties:", "      Events:", httpEvent("Odd", "/x")].join("\n"),
    );
    const { counts, unattributed } = countHttpApiRoutes(t);
    expect(counts.size).toBe(0);
    expect(unattributed).toBe(1);
  });

  it("reports an event at an unexpected indentation as unattributed (fail loud)", () => {
    const t = template(fn("WfA", ["        ListA:", "           Type: HttpApi"]));
    expect(countHttpApiRoutes(t).unattributed).toBe(1);
  });
});

describe("overBudget / staleCeilings", () => {
  const many = (n: number) => new Map([["WfBig", n], ["WfSmall", 3]]);

  it("passes at the default ceiling and fails one over", () => {
    expect(overBudget(many(MAX_HTTP_ROUTES_PER_FUNCTION), MAX_HTTP_ROUTES_PER_FUNCTION, {})).toEqual([]);
    expect(overBudget(many(MAX_HTTP_ROUTES_PER_FUNCTION + 1), MAX_HTTP_ROUTES_PER_FUNCTION, {})).toEqual([
      ["WfBig", MAX_HTTP_ROUTES_PER_FUNCTION + 1, MAX_HTTP_ROUTES_PER_FUNCTION],
    ]);
  });

  it("holds a grandfathered function at its own ceiling, not above", () => {
    const g = { WfBig: 51 };
    expect(overBudget(many(51), 48, g)).toEqual([]);
    expect(overBudget(many(52), 48, g)).toEqual([["WfBig", 52, 51]]);
  });

  it("flags a ratchet entry whose function shrank, vanished, or fell to the default", () => {
    expect(staleCeilings(many(51), 48, { WfBig: 51 })).toEqual([]);
    expect(staleCeilings(many(50), 48, { WfBig: 51 })[0]).toMatch(/lower the ceiling to 50/);
    expect(staleCeilings(many(40), 48, { WfBig: 51 })[0]).toMatch(/lower the ceiling to 48 \(or delete the entry\)/);
    expect(staleCeilings(many(51), 48, { WfGone: 60 })[0]).toMatch(/no such function/);
    expect(staleCeilings(many(40), 48, { WfBig: 48 })[0]).toMatch(/delete the entry/);
  });
});

describe("the real SAM template", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const text = readFileSync(join(here, "..", "infra", "sam", "template.yaml"), "utf8");
  const { counts, unattributed, raw } = countHttpApiRoutes(text);

  it("attributes every HttpApi event to a function", () => {
    expect(unattributed).toBe(0);
    expect([...counts.values()].reduce((a, n) => a + n, 0)).toBe(raw);
  });

  it("keeps every function within its ceiling and the ratchet current", () => {
    expect(overBudget(counts)).toEqual([]);
    expect(staleCeilings(counts)).toEqual([]);
  });

  it("serves the Rooms family from its own function, not agents-api", () => {
    expect(counts.get("WfRoomsApiFunction")).toBe(6);
    expect(counts.get("WfAgentsApiFunction")).toBeLessThanOrEqual(GRANDFATHERED_ROUTE_CEILINGS.WfAgentsApiFunction);
  });
});
