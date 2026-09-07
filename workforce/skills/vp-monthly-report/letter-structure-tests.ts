// Tests for the VP-letter structure guard (letter-structure.mjs) and for the
// post.mjs wrapper that enforces it before forwarding to the canonical writer.
//
// Same principle as budget-runway-review/post-tests.ts: a guard that exists
// only as SKILL.md prose is intent, not enforcement. Every case here runs
// before any network call, so no HTTP mock is needed — the wrapper cases drive
// the real script as a child process and assert exit code + stderr, the
// interface the agent-runner actually sees.

import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error — .mjs sibling module, checked by its own runtime contract.
import { checkLetterStructure } from "./letter-structure.mjs";

const SCRIPT = join(__dirname, "post.mjs");
const dir = mkdtempSync(join(tmpdir(), "vpmr-"));

const TRANSFER = `## 読者の組織にとっての含意\n\n${"この発見は、AIを一台も動かしていない組織にも同じ形で現れる。".repeat(16)}\n`;

const BOARD = [
  "## 仮説スコアボード",
  "",
  "- 前月の仮説1：支持 — 週次の締切を外した二件がいずれも人の承認待ちで止まっていた。",
  "- 前月の仮説2：反証 — 担当を増やした週ほど完了までの日数が伸びた。",
  "",
  "- 次の仮説1：手順書の粒度を粗くしたほうが完了までの日数は縮む（反証条件: 来月、粒度を粗くした業務で差し戻しが増えたら捨てる）",
  "- 次の仮説2：判断の説明を先に書くと合意までの往復が減る（反証条件: 来月、説明を先に書いた案件の往復回数が変わらなければ捨てる）",
].join("\n");

const letter = (...parts: string[]) => `# Software Talent Network 月次レポート 2026年9月 — 現場編\n\n${parts.join("\n\n")}\n`;
const GOOD = letter(TRANSFER, BOARD);

function bodyFile(name: string, content: string): string {
  const p = join(dir, name);
  writeFileSync(p, content);
  return p;
}

/** Run the wrapper without credentials: the structure guard must decide first. */
function run(body: string) {
  return spawnSync(process.execPath, [SCRIPT, "--agent", "dario", "--body-file", bodyFile(`${Math.random()}.md`, body)], {
    encoding: "utf8",
    env: { ...process.env, NOTION_API_KEY: "" },
  });
}

describe("checkLetterStructure", () => {
  it("accepts a letter carrying both required sections", () => {
    const { errors, prev, next, prevNone } = checkLetterStructure(GOOD);
    expect(errors).toEqual([]);
    expect(prevNone).toBe(false);
    expect(prev.map((p: { verdict: string }) => p.verdict)).toEqual(["支持", "反証"]);
    expect(next).toHaveLength(2);
    expect(next[0].refutation).toContain("差し戻し");
  });

  it("accepts 前月の仮説：なし for a lens' first letter", () => {
    const first = letter(TRANSFER, BOARD.replace(/- 前月の仮説[12].*\n?/g, "- 前月の仮説：なし（この編は今回が初回）\n"));
    expect(checkLetterStructure(first).errors).toEqual([]);
    expect(checkLetterStructure(first).prevNone).toBe(true);
  });

  it("rejects a missing transfer chapter", () => {
    const errors = checkLetterStructure(letter(BOARD)).errors;
    expect(errors.join()).toContain("読者の組織");
  });

  it("rejects a transfer chapter that is a heading with one sentence under it", () => {
    const stub = "## 読者の組織にとっての含意\n\n示唆はある。\n";
    expect(checkLetterStructure(letter(stub, BOARD)).errors.join()).toContain("< 400");
  });

  it("rejects a missing scoreboard", () => {
    expect(checkLetterStructure(letter(TRANSFER)).errors.join()).toContain("仮説スコアボード");
  });

  it("rejects a hypothesis with no refutation condition", () => {
    const vague = BOARD.replace(
      "- 次の仮説2：判断の説明を先に書くと合意までの往復が減る（反証条件: 来月、説明を先に書いた案件の往復回数が変わらなければ捨てる）",
      "- 次の仮説2：判断の説明を先に書くと合意までの往復が減ると考えている",
    );
    const errors = checkLetterStructure(letter(TRANSFER, vague)).errors;
    expect(errors.join()).toContain("does not parse");
  });

  it("rejects a refutation condition too short to be an observation", () => {
    const thin = BOARD.replace("（反証条件: 来月、粒度を粗くした業務で差し戻しが増えたら捨てる）", "（反証条件: たぶん）");
    expect(checkLetterStructure(letter(TRANSFER, thin)).errors.join()).toContain("反証条件");
  });

  it("rejects a scoreboard that scores nothing from last month", () => {
    const none = BOARD.replace(/- 前月の仮説[12].*\n/g, "");
    expect(checkLetterStructure(letter(TRANSFER, none)).errors.join()).toContain("scores no previous hypothesis");
  });

  it("rejects a verdict with no deciding observation", () => {
    const bare = BOARD.replace("支持 — 週次の締切を外した二件がいずれも人の承認待ちで止まっていた。", "支持 — そう思う");
    expect(checkLetterStructure(letter(TRANSFER, bare)).errors.join()).toContain("substantive reason");
  });

  it("rejects a todo list dressed as hypotheses (more than three)", () => {
    const many =
      BOARD +
      "\n- 次の仮説3：定例を隔週にすると意思決定は遅くならない（反証条件: 来月、隔週にした案件の決定日数が伸びたら捨てる）" +
      "\n- 次の仮説4：記録を先に書くと引き継ぎ時間が減る（反証条件: 来月、引き継ぎにかかる時間が変わらなければ捨てる）";
    expect(checkLetterStructure(letter(TRANSFER, many)).errors.join()).toContain("todo list");
  });

  it("rejects a single hypothesis (not a programme)", () => {
    const one = BOARD.replace(/- 次の仮説2：.*\n?/, "");
    expect(checkLetterStructure(letter(TRANSFER, one)).errors.join()).toContain("1 next-month hypotheses");
  });

  it("tolerates ASCII punctuation variants a writer may reach for", () => {
    const ascii = BOARD.replace("次の仮説1：", "次の仮説1: ").replace(
      "（反証条件: 来月、粒度を粗くした業務で差し戻しが増えたら捨てる）",
      "(反証条件: 来月、粒度を粗くした業務で差し戻しが増えたら捨てる)",
    );
    expect(checkLetterStructure(letter(TRANSFER, ascii)).errors).toEqual([]);
  });

  it("does not confuse a later same-level chapter for scoreboard content", () => {
    const trailing = `${BOARD}\n\n## あとがき\n\n- 次の仮説9：これは本文ではない（反証条件: これは数えられてはいけない）\n`;
    expect(checkLetterStructure(letter(TRANSFER, trailing)).next).toHaveLength(2);
  });
});

describe("post.mjs — the wrapper enforces the structure before forwarding", () => {
  it("exits 2 and names the missing section", () => {
    const res = run(letter(TRANSFER));
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("仮説スコアボード");
    // It must stop here — never reach the canonical writer's auth/W-1 messages.
    expect(res.stderr).not.toContain("NOTION_API_KEY");
  });

  it("passes a well-formed letter through to the canonical writer", () => {
    const res = run(GOOD);
    expect(res.stdout).toContain("structure OK");
    // No credential in env, so the canonical writer is the one that objects.
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("NOTION_API_KEY");
  });
});
