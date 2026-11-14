// autopilot-session.mjs — pure helpers for the session-run pr-autopilot lane
// (docs/adr/adr-0009-session-run-autopilot-lane.md; governance.md §4.4).
//
// Two consumers:
//   - scripts/claude/post-pr-create.mjs   (PostToolUse hook: which PR was just opened?)
//   - scripts/claude/autopilot-merge.mjs  (merge gate: token + reviewers parsing)
//
// No I/O here, so every branch is unit-tested in autopilot-session.test.mjs.

export const REPO = "refluster/ai-native-article";
export const MIN_REVIEWERS = 3;

// `gh pr create` anywhere in a (possibly compound) shell command.
const GH_PR_CREATE = /(?:^|[\n;&|(]|\$\()\s*gh\s+pr\s+create\b/;
const MCP_CREATE_PR = "mcp__github__create_pull_request";

function prUrlRe(repo) {
  const esc = repo.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  return new RegExp(`https://github\\.com/${esc}/pull/(\\d+)`, "i");
}

function stringify(v) {
  if (typeof v === "string") return v;
  try { return JSON.stringify(v ?? ""); } catch { return String(v ?? ""); }
}

/**
 * The PR number a PostToolUse payload just created in `repo`, or null.
 * Covers both creation paths: the `gh` CLI (Bash) and the GitHub MCP tool
 * that cloud sessions use (the `gh` CLI there is search-only).
 */
export function prFromHookPayload(payload, repo = REPO) {
  if (!payload || typeof payload !== "object") return null;
  const tool = payload.tool_name;
  const input = payload.tool_input ?? {};
  if (tool === "Bash") {
    if (typeof input.command !== "string" || !GH_PR_CREATE.test(input.command)) return null;
  } else if (tool === MCP_CREATE_PR) {
    const target = `${input.owner ?? ""}/${input.repo ?? ""}`.toLowerCase();
    if (target !== repo.toLowerCase()) return null;
  } else {
    return null;
  }
  const m = prUrlRe(repo).exec(stringify(payload.tool_response));
  return m ? Number(m[1]) : null;
}

/** The hook's stdout for a just-opened PR (Claude Code hook JSON contract). */
export function hookOutput(pr) {
  const context =
    `PR #${pr} was opened. Run the project skill \`pr-autopilot-session\` on it now (Skill tool), ` +
    "unless the user has said not to for this PR. Follow it to a terminal state: merged through " +
    "`node scripts/claude/autopilot-merge.mjs`, or labelled autopilot:needs-human. " +
    "Report one status line per state change, not the reviewers' comment bodies.";
  return {
    systemMessage: `pr-autopilot: running the session-run lane on #${pr}`,
    hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: context },
  };
}

/** Distinct, lower-cased reviewer slugs from a comma-separated list. */
export function parseReviewers(csv) {
  return [...new Set(String(csv ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean))].sort();
}

/** The PAT from a `wf/projects/{id}/github.token` SecretString (`{"token": "..."}`). */
export function tokenFromSecretString(secretString) {
  let parsed;
  try { parsed = JSON.parse(String(secretString ?? "")); } catch { return null; }
  return typeof parsed?.token === "string" && parsed.token ? parsed.token : null;
}
