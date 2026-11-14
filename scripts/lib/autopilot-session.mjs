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

function prUrlRe(repo, flags = "i") {
  const esc = repo.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  return new RegExp(`https://github\\.com/${esc}/pull/(\\d+)`, flags);
}

function stringify(v) {
  if (typeof v === "string") return v;
  try { return JSON.stringify(v ?? ""); } catch { return String(v ?? ""); }
}

// MCP results arrive as [{type:"text", text:"<json>"}] or as the object itself.
function mcpObjects(resp) {
  const out = [];
  const visit = (v) => {
    if (typeof v === "string") { try { visit(JSON.parse(v)); } catch { /* not json */ } return; }
    if (Array.isArray(v)) { v.forEach(visit); return; }
    if (v && typeof v === "object") { out.push(v); if (typeof v.text === "string") visit(v.text); }
  };
  visit(resp);
  return out;
}

/**
 * The PR number a PostToolUse payload just created in `repo`, or null.
 * Covers both creation paths: the `gh` CLI (Bash) and the GitHub MCP tool
 * that cloud sessions use (the `gh` CLI there is search-only).
 *   - MCP: the structured `html_url` / `url` field of the result.
 *   - Bash: the line of stdout that is exactly a PR URL (what `gh pr create`
 *     prints), never a URL embedded in other output (`gh pr list`, …).
 */
export function prFromHookPayload(payload, repo = REPO) {
  if (!payload || typeof payload !== "object") return null;
  const tool = payload.tool_name;
  const input = payload.tool_input ?? {};
  const exact = new RegExp(`^${prUrlRe(repo).source}/?$`, "i");
  if (tool === "Bash") {
    if (typeof input.command !== "string" || !GH_PR_CREATE.test(input.command)) return null;
    const resp = payload.tool_response;
    const stdout = typeof resp === "object" && resp ? String(resp.stdout ?? "") : stringify(resp);
    const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter((l) => exact.test(l));
    if (lines.length !== 1) return null; // none, or ambiguous
    return Number(exact.exec(lines[0])[1]);
  }
  if (tool === MCP_CREATE_PR) {
    const target = `${input.owner ?? ""}/${input.repo ?? ""}`.toLowerCase();
    if (target !== repo.toLowerCase()) return null;
    for (const o of mcpObjects(payload.tool_response)) {
      for (const k of ["html_url", "url"]) {
        const m = typeof o[k] === "string" ? exact.exec(o[k].trim()) : null;
        if (m) return Number(m[1]);
      }
    }
    return null;
  }
  return null;
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

/**
 * Head-pinned panel check (PR #886 cycle 1, ren). The engine counts a
 * reviewer's green marker anywhere on the PR, so a marker from an earlier
 * cycle — or from before a later push — would still count. The gate therefore
 * requires, per reviewer, that the reviewer's LATEST review comment
 * (`🟢|🔴 **<slug> — … cycle N @ <sha>.**`) is 🟢, carries the marker, and
 * names the PR's current head commit.
 */
export function headPinnedPanel(comments, reviewers, headSha) {
  const head = String(headSha ?? "").toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(head)) return { ok: false, why: "head commit unknown" };
  const bad = [];
  let newestReviewAt = 0;
  for (const slug of reviewers) {
    const esc = slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`^(🟢|🔴) \\*\\*${esc} — [^\\n]*?cycle \\d+ @ ([0-9a-f]{7,40})\\.\\*\\*`, "iu"); // first line only
    let latest = null;
    for (const c of comments ?? []) {
      const m = re.exec(String(c?.body ?? ""));
      if (!m) continue;
      const at = Date.parse(c?.created_at ?? "") || 0;
      if (!latest || at >= latest.at) latest = { at, emoji: m[1], sha: m[2].toLowerCase(), body: String(c.body) };
    }
    if (latest) newestReviewAt = Math.max(newestReviewAt, latest.at);
    if (!latest) bad.push(`${slug}: no head-pinned review`);
    else if (latest.emoji !== "🟢") bad.push(`${slug}: latest review is 🔴`);
    else if (!latest.body.includes(`<!-- autopilot:review:${slug}:green -->`)) bad.push(`${slug}: latest review lacks the green marker`);
    else if (!head.startsWith(latest.sha)) bad.push(`${slug}: reviewed ${latest.sha.slice(0, 7)}, head is ${head.slice(0, 7)}`);
  }
  if (bad.length) return { ok: false, why: bad.join("; ") };
  return { ok: true, why: `head ${head.slice(0, 7)} reviewed green by ${reviewers.join(", ")}`, newestReviewAt };
}

/**
 * Workforce R-N10 clause 3 (per-binding kill-switch), read from agents-api
 * `GET /agents/nadia`. "Armed" means exactly what makes the cron lane fire:
 * the agent is neither paused nor archived, and its pr-autopilot binding for
 * this repo's project is orchestrator-owned (`isOrchestratorOwnedCcr` in
 * workforce/lambdas/shared/agent.ts: executor claude-code-routine, trigger
 * scheduler `external` + invoked_by `api`) with a cron. The operator's
 * documented pause — `trigger.scheduler = "manual"` (runbooks/bindings.md) —
 * or removing the binding therefore stops both lanes. Anything else,
 * including an unreadable response, is "off" (fail closed).
 */
export function killSwitchArmed(agent, { skill = "pr-autopilot", project = "agent-workforce" } = {}) {
  if (!agent || typeof agent !== "object") return { ok: false, why: "agents-api returned no agent" };
  if (agent.paused) return { ok: false, why: "routing agent is paused" };
  if (agent.archived) return { ok: false, why: "routing agent is archived" };
  const b = (agent.bindings ?? []).find((x) => x?.skill === skill && x?.project_id === project);
  if (!b) return { ok: false, why: `no ${skill} × ${project} binding` };
  const owned = b.executor === "claude-code-routine" && b.trigger?.scheduler === "external" && b.trigger?.invoked_by === "api";
  if (!owned || !b.trigger?.cron) {
    return { ok: false, why: `${skill} × ${project} binding is not orchestrator-fired (scheduler=${b.trigger?.scheduler ?? "?"})` };
  }
  return { ok: true, why: "binding armed" };
}

/**
 * The verdict step ran on the current panel: a `**Nadia — verdict, … 🟢 …**`
 * comment carrying `<!-- autopilot:panel:isolated -->`, posted no earlier
 * than the newest of the reviewers' latest reviews.
 */
export function greenVerdictAfter(comments, sinceMs) {
  let latest = null;
  for (const c of comments ?? []) {
    const body = String(c?.body ?? "");
    if (!/^\*\*Nadia — verdict, cycle \d+ of/u.test(body)) continue;
    const at = Date.parse(c?.created_at ?? "") || 0;
    if (!latest || at >= latest.at) latest = { at, body };
  }
  if (!latest) return false;
  const firstLine = latest.body.split("\n")[0];
  return firstLine.includes("🟢") && latest.body.includes("<!-- autopilot:panel:isolated -->") && latest.at >= sinceMs;
}

/** Any reviewer — listed in --reviewers or not — whose latest head-pinned
 *  review on the current head is 🔴. A seated reviewer left off the list
 *  must still be able to block. */
export function redOnHead(comments, headSha) {
  const head = String(headSha ?? "").toLowerCase();
  const latest = new Map();
  for (const c of comments ?? []) {
    const m = /^(🟢|🔴) \*\*([\w-]+) — [^\n]*?cycle \d+ @ ([0-9a-f]{7,40})\.\*\*/u.exec(String(c?.body ?? ""));
    if (!m || !head.startsWith(m[3].toLowerCase())) continue;
    const at = Date.parse(c?.created_at ?? "") || 0;
    const prev = latest.get(m[2].toLowerCase());
    if (!prev || at >= prev.at) latest.set(m[2].toLowerCase(), { at, emoji: m[1] });
  }
  return [...latest].filter(([, v]) => v.emoji === "🔴").map(([slug]) => slug).sort();
}

/** Map the engine's exit status to the gate's: only a real refusal (2) is 2. */
export function gateExitFor(engineStatus, merged) {
  if (engineStatus === 0 && merged) return 0;
  if (engineStatus === 2) return 2;
  return 1;
}
