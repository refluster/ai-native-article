#!/usr/bin/env node
// PostToolUse hook: start the session-run pr-autopilot lane on a PR this
// session just opened (docs/adr/adr-0009-session-run-autopilot-lane.md).
//
// Fires on `gh pr create` (Bash) and on the GitHub MCP create_pull_request
// tool. It only prints an instruction for the session; it makes no network
// call and never blocks: exit 0 always.
import { hookOutput, prFromHookPayload } from "../lib/autopilot-session.mjs";

let raw = "";
for await (const chunk of process.stdin) raw += chunk;
try {
  const pr = prFromHookPayload(JSON.parse(raw));
  if (pr) process.stdout.write(JSON.stringify(hookOutput(pr)));
} catch {
  // malformed payload: stay silent
}
process.exit(0);
