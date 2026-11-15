#!/usr/bin/env node
// PostToolUse hook: start the session-run pr-autopilot lane on a PR this
// session just opened (docs/adr/adr-0009-session-run-autopilot-lane.md).
//
// Fires on `gh pr create` (Bash) and on the GitHub MCP create_pull_request
// tool. It only prints an instruction for the session; it makes no network
// call and never blocks: exit 0 always.
import { hookOutput, isCadenceAuthored, isOperatorSession, prFromHookPayload } from "../lib/autopilot-session.mjs";

let raw = "";
for await (const chunk of process.stdin) raw += chunk;
try {
  const payload = JSON.parse(raw);
  // Scheduled routines / cadence runs never enter the lane (ADR-0009 scope).
  if (!isOperatorSession()) process.exit(0);
  const pr = prFromHookPayload(payload);
  if (pr) process.stdout.write(JSON.stringify(hookOutput(pr)));
  else if (!isCadenceAuthored(payload?.tool_input?.body) && (
    (payload?.tool_name === "mcp__github__create_pull_request" &&
      `${payload?.tool_input?.owner}/${payload?.tool_input?.repo}`.toLowerCase() === "refluster/ai-native-article") ||
    (payload?.tool_name === "Bash" && /\bgh\s+pr\s+create\b/.test(String(payload?.tool_input?.command ?? "")) &&
      /github\.com\/refluster\/ai-native-article\/pull\/\d+/i.test(JSON.stringify(payload?.tool_response ?? ""))))) {
    // A create on this repo whose PR number we could not read: say so, so a
    // result-shape change does not switch the lane off silently.
    // stdout JSON, not stderr: a 0-exit hook's stderr never reaches the model.
    process.stdout.write(JSON.stringify({
      systemMessage: "pr-autopilot: a PR was created but its number could not be read",
      hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext:
        "A PR on refluster/ai-native-article was just created, but the hook could not read its number. " +
        "If the user has not said otherwise, run the project skill `pr-autopilot-session` on it by number." },
    }));
  }
} catch {
  // malformed payload: stay silent
}
process.exit(0);
