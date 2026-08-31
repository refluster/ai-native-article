// Negative tests for validate-tools.mjs.
//
// A validator nobody has seen fail is a validator nobody knows works.
// These run the real script against fixture trees written to a temp dir,
// so each rule is proven to reject what it claims to reject — the classes
// of mistake that would otherwise surface as a broken form or a model
// call with no prompt.

import { describe, expect, it, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const WORKFORCE_ROOT = join(SCRIPTS_DIR, "..");

const VALID = {
  tool_id: "demo-tool",
  display_name: "Demo Tool",
  summary: "Does a demonstrable thing.",
  version: "1.0.0",
  requires: ["azure.openai"],
  model: { max_tokens: 4000 },
  input: {
    type: "object",
    required: ["goal"],
    properties: { goal: { type: "string", title: "Goal" } },
  },
  output: { type: "object", properties: { answer: { type: "string" } } },
};

const PROMPT = "x".repeat(150);

const temps: string[] = [];
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

/**
 * Run the validator against a throwaway workforce tree whose only tool is
 * the supplied one. The script resolves its paths from its own location,
 * so the scripts dir is copied in alongside a synthetic tools/.
 */
function runValidator(
  tool: Record<string, unknown>,
  opts: { prompt?: string | null; dirName?: string } = {},
): { code: number; output: string } {
  const root = mkdtempSync(join(tmpdir(), "wf-tools-"));
  temps.push(root);
  cpSync(join(WORKFORCE_ROOT, "scripts"), join(root, "scripts"), { recursive: true });
  const dir = join(root, "tools", opts.dirName ?? String(tool.tool_id ?? "unnamed"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "tool.json"), JSON.stringify(tool, null, 2));
  if (opts.prompt !== null) writeFileSync(join(dir, "system.md"), opts.prompt ?? PROMPT);
  try {
    const output = execFileSync(
      process.execPath,
      [join(root, "scripts", "validate-tools.mjs")],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { code: 0, output };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

describe("validate-tools", () => {
  it("accepts a well-formed tool", () => {
    const { code } = runValidator(VALID);
    expect(code).toBe(0);
  });

  it("rejects a tool_id that does not match its directory", () => {
    // The directory is the route segment, so a mismatch means the tool is
    // unreachable at the URL the registry advertises.
    const { code, output } = runValidator(VALID, { dirName: "somewhere-else" });
    expect(code).toBe(1);
    expect(output).toContain("T4-id");
  });

  it("rejects a missing system.md", () => {
    const { code, output } = runValidator(VALID, { prompt: null });
    expect(code).toBe(1);
    expect(output).toContain("T1-files");
  });

  it("rejects a placeholder system.md", () => {
    const { code, output } = runValidator(VALID, { prompt: "TODO" });
    expect(code).toBe(1);
    expect(output).toContain("T2-prompt");
  });

  it("rejects a non-semver version", () => {
    const { code, output } = runValidator({ ...VALID, version: "1.0" });
    expect(code).toBe(1);
    expect(output).toContain("T6-version");
  });

  it("rejects an unknown credential type", () => {
    const { code, output } = runValidator({ ...VALID, requires: ["azure.openapi"] });
    expect(code).toBe(1);
    expect(output).toContain("T11-credential");
  });

  it("accepts a variant-suffixed credential type", () => {
    const { code } = runValidator({ ...VALID, requires: ["notion.integration_token@tools"] });
    expect(code).toBe(0);
  });

  it("rejects a max_tokens outside the allowed band", () => {
    expect(runValidator({ ...VALID, model: { max_tokens: 10 } }).output).toContain("T12-model");
    expect(runValidator({ ...VALID, model: { max_tokens: 99000 } }).output).toContain("T12-model");
  });

  it("rejects a required field that is not declared", () => {
    // The classic schema typo: the form marks a field the operator cannot
    // see, or the model is told to always return one nobody declared.
    const { code, output } = runValidator({
      ...VALID,
      input: { type: "object", required: ["goa1"], properties: { goal: { type: "string", title: "Goal" } } },
    });
    expect(code).toBe(1);
    expect(output).toContain("T8-required-unknown");
  });

  it("rejects an input field the console cannot draw", () => {
    const { code, output } = runValidator({
      ...VALID,
      input: { type: "object", properties: { rows: { type: "array", title: "Rows" } } },
    });
    expect(code).toBe(1);
    expect(output).toContain("T9-input-field");
  });

  it("rejects an input field with no title to use as its label", () => {
    const { code, output } = runValidator({
      ...VALID,
      input: { type: "object", properties: { goal: { type: "string" } } },
    });
    expect(code).toBe(1);
    expect(output).toContain("T10-input-label");
  });

  it("rejects a default that is not one of the enum values", () => {
    const { code, output } = runValidator({
      ...VALID,
      input: {
        type: "object",
        properties: { mode: { type: "string", title: "Mode", enum: ["a"], default: "b" } },
      },
    });
    expect(code).toBe(1);
    expect(output).toContain("T9-input-field");
  });

  it("rejects an output schema with no properties", () => {
    const { code, output } = runValidator({ ...VALID, output: { type: "object", properties: {} } });
    expect(code).toBe(1);
    expect(output).toContain("T7-schema-shape");
  });
});
