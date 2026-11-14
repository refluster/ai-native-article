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

import { gateExitFor, greenVerdictAfter, headPinnedPanel, killSwitchArmed } from "./autopilot-session.mjs";

test("Bash: a compound command listing other PRs is ambiguous → null; a lone URL line wins", () => {
  const amb = { tool_name: "Bash", tool_input: { command: "gh pr create -f; gh pr list" },
    tool_response: { stdout: "https://github.com/refluster/ai-native-article/pull/900\nhttps://github.com/refluster/ai-native-article/pull/12\n" } };
  assert.equal(prFromHookPayload(amb), null);
  const embedded = { tool_name: "Bash", tool_input: { command: "gh pr create -f" },
    tool_response: { stdout: `see ${URL} for details\n${URL.replace("1234", "77")}\n` } };
  assert.equal(prFromHookPayload(embedded), 77);
});

test("MCP: the structured html_url wins over URLs mentioned in the body", () => {
  const p = { tool_name: "mcp__github__create_pull_request", tool_input: { owner: "refluster", repo: "ai-native-article" },
    tool_response: [{ type: "text", text: JSON.stringify({ body: `follows ${URL.replace("1234", "5")}`, html_url: URL }) }] };
  assert.equal(prFromHookPayload(p), 1234);
});

const HEAD = "abcdef1234567890abcdef1234567890abcdef12";
const review = (slug, emoji, sha, at, marker = emoji === "🟢") => ({
  created_at: at,
  body: `${emoji} **${slug} — x lens, cycle 2 @ ${sha}.**\n- ok${marker ? `\n<!-- autopilot:review:${slug}:green -->` : ""}`,
});

test("head-pinned panel: all latest reviews green on the head → ok", () => {
  const c = ["ren", "dario", "farah"].map((s) => review(s, "🟢", HEAD.slice(0, 7), "2026-11-14T10:00:00Z"));
  assert.equal(headPinnedPanel(c, ["ren", "dario", "farah"], HEAD).ok, true);
});

test("head-pinned panel: a green from an older commit or an older cycle does not count", () => {
  const c = [
    review("ren", "🟢", "1111111", "2026-11-14T09:00:00Z"),
    review("dario", "🟢", HEAD.slice(0, 7), "2026-11-14T09:00:00Z"),
    review("dario", "🔴", HEAD.slice(0, 7), "2026-11-14T10:00:00Z"),
  ];
  const v = headPinnedPanel(c, ["ren", "dario", "farah"], HEAD);
  assert.equal(v.ok, false);
  assert.match(v.why, /ren: reviewed 1111111/);
  assert.match(v.why, /dario: latest review is 🔴/);
  assert.match(v.why, /farah: no head-pinned review/);
});

test("head-pinned panel: a green heading without the marker fails; unknown head fails", () => {
  assert.equal(headPinnedPanel([review("ren", "🟢", HEAD, "t", false)], ["ren"], HEAD).ok, false);
  assert.equal(headPinnedPanel([], ["ren"], "").ok, false);
});

test("kill-switch: armed only for the orchestrator-owned live binding shape", () => {
  const live = { skill: "pr-autopilot", project_id: "agent-workforce", executor: "claude-code-routine",
    trigger: { cron: "cron(23 0,6,12,18 ? * * *)", scheduler: "external", invoked_by: "api" } };
  assert.equal(killSwitchArmed({ bindings: [live] }).ok, true);
  assert.equal(killSwitchArmed({ bindings: [live], paused: true }).ok, false);
  assert.equal(killSwitchArmed({ bindings: [live], archived: true }).ok, false);
  // the documented operator pause (runbooks/bindings.md)
  assert.equal(killSwitchArmed({ bindings: [{ ...live, trigger: { ...live.trigger, scheduler: "manual" } }] }).ok, false);
  assert.equal(killSwitchArmed({ bindings: [{ ...live, trigger: { ...live.trigger, invoked_by: undefined } }] }).ok, false);
  assert.equal(killSwitchArmed({ bindings: [{ ...live, trigger: { ...live.trigger, cron: "" } }] }).ok, false);
  assert.equal(killSwitchArmed({ bindings: [{ ...live, project_id: "asp-cloud" }] }).ok, false);
  assert.equal(killSwitchArmed(null).ok, false);
});

test("head-pinned panel: a heading quoted later in another comment does not count", () => {
  const quoted = { created_at: "2026-11-14T11:00:00Z",
    body: `**Nadia — summary.**\n🔴 **ren — x lens, cycle 2 @ ${HEAD.slice(0, 7)}.**` };
  const c = [review("ren", "🟢", HEAD.slice(0, 7), "2026-11-14T10:00:00Z"), quoted];
  assert.equal(headPinnedPanel(c, ["ren"], HEAD).ok, true);
});

test("green verdict must exist and follow the newest review", () => {
  const v = (at, emoji = "🟢", marker = true) => ({ created_at: at,
    body: `**Nadia — verdict, cycle 2 of ≤ 7. ${emoji} unanimous-green.**\n${marker ? "<!-- autopilot:panel:isolated -->" : ""}` });
  const since = Date.parse("2026-11-14T10:00:00Z");
  assert.equal(greenVerdictAfter([v("2026-11-14T10:05:00Z")], since), true);
  assert.equal(greenVerdictAfter([v("2026-11-14T09:00:00Z")], since), false);
  assert.equal(greenVerdictAfter([v("2026-11-14T10:05:00Z", "🔴")], since), false);
  assert.equal(greenVerdictAfter([v("2026-11-14T10:05:00Z", "🟢", false)], since), false);
});

test("gate exit mapping: only an engine refusal is 2", () => {
  assert.equal(gateExitFor(0, true), 0);
  assert.equal(gateExitFor(0, false), 1);
  assert.equal(gateExitFor(2, false), 2);
  assert.equal(gateExitFor(1, false), 1);
  assert.equal(gateExitFor(3, false), 1);
  assert.equal(gateExitFor(null, false), 1);
});
