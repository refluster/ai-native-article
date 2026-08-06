// Guard tests for budget-runway-review/post.mjs (G1–G7 + arg validation).
// Every case here fails BEFORE any network call, so the suite needs no HTTP
// mock — it drives the real script as a child process and asserts exit code +
// stderr, the same interface the agent-runner sees.
//
// Epic-021 §A.2 / issue #456 requires the W-1-style guards to be *tested code*,
// not prose intent (dario's RFC finding).

import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(__dirname, "post.mjs");
const dir = mkdtempSync(join(tmpdir(), "brr-"));

const DISCLOSURE = "This review carries the standing disclosure: no revenue, no investors, and no external funding.";

/** Body of exactly `n` chars (before the disclosure + terminal sentence). */
function review(n: number): string {
  const filler = "Utilisation this month sits inside the ceiling and the trend is flat. ";
  const head = filler.repeat(Math.ceil(n / filler.length)).slice(0, n);
  return `${head}\n\n${DISCLOSURE}\nRecommendation: hold the cap for another month.`;
}

function bodyFile(name: string, content: string): string {
  const p = join(dir, name);
  writeFileSync(p, content);
  return p;
}

const BASE_ARGS = [
  "--agent", "silas",
  "--cap-usd", "500",
  "--cap-source", "workforce/docs/governance.md#w-3",
  "--sources", "https://workforce-api.kohuehara.xyz/stats,workforce/docs/governance.md#w-3",
];

function run(
  args: string[],
  file: string,
  env: Record<string, string | undefined> = { FEED_WRITE_TOKEN: "t" },
) {
  return spawnSync("node", [SCRIPT, ...args, "--body-file", file], {
    encoding: "utf8",
    env: {
      ...process.env,
      FEED_WRITE_TOKEN: undefined,
      FEED_WRITE_TOKEN_API_URL: undefined,
      ...env,
    },
  });
}

/** Swap one BASE_ARGS value for another (args are positional pairs). */
function withArg(name: string, value: string): string[] {
  const out = [...BASE_ARGS];
  const i = out.indexOf(`--${name}`);
  out[i + 1] = value;
  return out;
}

describe("budget-runway-review/post.mjs guards", () => {
  it("exits 1 without FEED_WRITE_TOKEN", () => {
    const r = run(BASE_ARGS, bodyFile("a.md", review(700)), { FEED_WRITE_TOKEN: undefined });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("FEED_WRITE_TOKEN");
  });

  it("exits 1 when --cap-usd is absent (the cap is never implicit)", () => {
    const args = BASE_ARGS.filter((a, i) => a !== "--cap-usd" && BASE_ARGS[i - 1] !== "--cap-usd");
    const r = run(args, bodyFile("b.md", review(700)));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("--cap-usd");
  });

  it("G6: rejects a non-positive cap", () => {
    const r = run(withArg("cap-usd", "0"), bodyFile("c.md", review(700)));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("G6");
  });

  it("G6: rejects a cap-source that is a claim rather than a document", () => {
    const r = run(withArg("cap-source", "Epic-021 says so"), bodyFile("d.md", review(700)));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("G6");
  });

  it("G5: rejects empty --sources (the epic's empty-citations rule)", () => {
    const r = run(withArg("sources", " , "), bodyFile("e.md", review(700)));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("G5");
  });

  it("G5: rejects a source that is not citation-shaped", () => {
    const r = run(withArg("sources", "Epic-016 data"), bodyFile("f.md", review(700)));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("G5");
  });

  it("G1: exits 1 on an unreadable body-file", () => {
    const r = run(BASE_ARGS, join(dir, "does-not-exist.md"));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("G1");
  });

  it("G1: rejects an empty body", () => {
    const r = run(BASE_ARGS, bodyFile("g.md", "   \n  "));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("G1");
  });

  it("G3: rejects an LLM-failure prelude", () => {
    const r = run(BASE_ARGS, bodyFile("h.md", `Here is the monthly review you asked for. ${review(700)}`));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("G3");
  });

  it("G2: rejects a body under the floor", () => {
    const r = run(BASE_ARGS, bodyFile("i.md", `Flat month.\n\n${DISCLOSURE}`));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("G2");
  });

  it("G2: rejects a body over the feed hard cap", () => {
    const r = run(BASE_ARGS, bodyFile("j.md", review(2100)));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("G2");
  });

  it("G4: rejects a body cut off mid-sentence", () => {
    const body = `${review(700).replace(/Recommendation: hold the cap for another month\.$/, "")}Recommendation: hold the cap because the trend is`;
    const r = run(BASE_ARGS, bodyFile("k.md", body));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("G4");
  });

  it("G7: rejects a body missing the standing disclosure", () => {
    const r = run(BASE_ARGS, bodyFile("l.md", review(700).replace(DISCLOSURE, "")));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("G7");
  });

  it("G7: accepts the disclosure with surrounding punctuation and line breaks", () => {
    // Reaches the network stage (endpoint unreachable in CI) — the assertion is
    // that it got PAST every guard, i.e. no G* rejection in stderr.
    const body = review(700).replace(
      DISCLOSURE,
      "(The standing disclosure applies: no revenue,\nno investors, and no external funding.)",
    );
    const r = run(BASE_ARGS, bodyFile("m.md", body), {
      FEED_WRITE_TOKEN: "t",
      FEED_WRITE_TOKEN_API_URL: "http://127.0.0.1:1/feed",
    });
    expect(r.stderr).not.toMatch(/G[1-7]:/);
    expect(r.status).toBe(3);
  });
});
