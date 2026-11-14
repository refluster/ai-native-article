import { test } from "node:test";
import assert from "node:assert/strict";
import { hookOutput, parseReviewers, prFromHookPayload, tokenFromSecretString } from "./autopilot-session.mjs";

const URL = "https://github.com/refluster/ai-native-article/pull/1234";

test("gh pr create via Bash yields the PR number", () => {
  const p = { tool_name: "Bash", tool_input: { command: "gh pr create --draft --title x" }, tool_response: { stdout: `${URL}\n` } };
  assert.equal(prFromHookPayload(p), 1234);
});

test("compound Bash command still matches", () => {
  const p = { tool_name: "Bash", tool_input: { command: "git push -u origin b && gh pr create -f" }, tool_response: { stdout: URL } };
  assert.equal(prFromHookPayload(p), 1234);
});

test("other Bash commands are ignored even if they print a PR URL", () => {
  const p = { tool_name: "Bash", tool_input: { command: "gh pr view 1234" }, tool_response: { stdout: URL } };
  assert.equal(prFromHookPayload(p), null);
});

test("GitHub MCP create_pull_request on this repo yields the PR number", () => {
  const p = {
    tool_name: "mcp__github__create_pull_request",
    tool_input: { owner: "refluster", repo: "ai-native-article", title: "t" },
    tool_response: [{ type: "text", text: JSON.stringify({ number: 1234, html_url: URL }) }],
  };
  assert.equal(prFromHookPayload(p), 1234);
});

test("MCP create on another repo is ignored", () => {
  const p = {
    tool_name: "mcp__github__create_pull_request",
    tool_input: { owner: "PSVL", repo: "asp-cloud" },
    tool_response: "https://github.com/PSVL/asp-cloud/pull/9",
  };
  assert.equal(prFromHookPayload(p), null);
});

test("failed create (no URL) and junk payloads are ignored", () => {
  assert.equal(prFromHookPayload({ tool_name: "Bash", tool_input: { command: "gh pr create" }, tool_response: { stdout: "", stderr: "error" } }), null);
  assert.equal(prFromHookPayload(null), null);
  assert.equal(prFromHookPayload({ tool_name: "Edit" }), null);
});

test("hook output names the PR and the skill", () => {
  const o = hookOutput(7);
  assert.equal(o.hookSpecificOutput.hookEventName, "PostToolUse");
  assert.match(o.hookSpecificOutput.additionalContext, /PR #7/);
  assert.match(o.hookSpecificOutput.additionalContext, /pr-autopilot-session/);
});

test("reviewers are deduped, trimmed, lower-cased", () => {
  assert.deepEqual(parseReviewers(" Ren,dario,ren,,farah "), ["dario", "farah", "ren"]);
  assert.deepEqual(parseReviewers(undefined), []);
});

test("token parsing from the Secrets Manager shape", () => {
  assert.equal(tokenFromSecretString('{"token":"abc"}'), "abc");
  assert.equal(tokenFromSecretString('{"token":""}'), null);
  assert.equal(tokenFromSecretString("not json"), null);
  assert.equal(tokenFromSecretString('{"other":1}'), null);
});
