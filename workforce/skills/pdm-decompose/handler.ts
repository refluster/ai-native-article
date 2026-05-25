// Deterministic handler for the pdm-decompose skill.
// See ./SKILL.md for the contract + state machine.
//
// Output: JSON record of the per-epic scan, persisted to S3 as the
// RUN row's output payload.
// Side effects: GH issue comments + child-issue creates, gated by the
// state machine documented in SKILL.md.

import type { DeterministicResult, RunnerContext } from "../../lambdas/shared/skill-types.js";
import { complete } from "../../lambdas/shared/llm-anthropic.js";
import {
  addSubIssue,
  createIssue,
  createIssueComment,
  listIssueComments,
  listOpenIssues,
  listReactionsForComment,
  listSubIssues,
  type GithubComment,
  type GithubIssue,
} from "../../lambdas/shared/gh-issues.js";

// --- Configuration -------------------------------------------------------

const OWNER = process.env.PDM_GH_OWNER ?? "refluster";
const REPO = process.env.PDM_GH_REPO ?? "ai-native-article";
// Per-run upper bounds — guard against runaway loops + cost spikes.
const MAX_EPICS_PER_RUN = parseInt(process.env.PDM_MAX_EPICS ?? "5", 10);
const MAX_CHILDREN_PER_EPIC = parseInt(process.env.PDM_MAX_CHILDREN ?? "8", 10);
// Maya's model is hard-coded here (not read from agent.json) so the
// reasoning shape is part of the skill's versioned contract, not subject
// to per-agent overrides.
const REASONING_MODEL = "anthropic:claude-opus-4-7";
const REASONING_MAX_TOKENS = 4000;

const PROPOSAL_MARKER = "<!-- pdm-decompose:proposal -->";
const EPIC_TITLE_RE = /^\[RFC-/;
const WORKSTREAMS_HEADING_RE = /^##\s+Workstreams\b/m;

// --- Skill-versioned reasoning contract ----------------------------------

const REASONING_SYSTEM_SUFFIX = `

# Active task: epic decomposition

You are decomposing an Epic into child GitHub issues. Read the parent
issue body's "## Workstreams" section carefully. Before proposing,
identify 2-3 concrete operator scenarios this epic must support and
walk through whether each child task makes them work. If a scenario
reveals a gap, expand the workstream list.

For each child, output:
- title: "[RFC-N Epic M] (role) — <=80-char deliverable"
- body: includes AC bullets + parent link + "Reviewer personas: ..."
- labels: ["wf:ready", "role:<role>", "epic:<N-M>", "reviewer:<persona>", ...]

Output ONLY a JSON object with these fields, no preamble:
{
  "scenarios_walked": ["operator scenario 1", "operator scenario 2", ...],
  "children": [
    {
      "title": "[RFC-N Epic M] (role) — deliverable",
      "body": "markdown body...",
      "labels": ["wf:ready", "role:engineering", "epic:N-M", "reviewer:dario"],
      "reviewer_personas": ["dario", "aoi"]
    }
  ]
}

Architecturally significant decisions (new managed service, > USD 10/mo
spend, R-N* implications): propose alternatives in the body and add the
label "coordination_required:dario". Do NOT silently decompose work that
should go through architecture review.
`;

// --- Public handler ------------------------------------------------------

interface ScanRecord {
  issue: number;
  title: string;
  state: "DECOMPOSED" | "AWAITING_OPERATOR" | "UNDECOMPOSED" | "APPROVED" | "SKIPPED";
  action?: string;
  comment_url?: string;
  error?: string;
}

interface ApprovedRecord {
  parent: number;
  children: Array<{ number: number; title: string }>;
}

interface ScanOutput {
  scanned: ScanRecord[];
  approved_decomposed: ApprovedRecord[];
  errors: string[];
}

export async function dispatchPdmDecompose(ctx: RunnerContext): Promise<DeterministicResult> {
  void ctx; // The handler does not currently use slug/startedAt — single-tenant repo.

  const output: ScanOutput = { scanned: [], approved_decomposed: [], errors: [] };

  let issues: GithubIssue[];
  try {
    issues = await listOpenIssues(OWNER, REPO);
  } catch (err) {
    throw new Error(
      `pdm-decompose: failed to list issues (${err instanceof Error ? err.message : String(err)})`,
    );
  }

  const epicCandidates = issues.filter(
    (it) => EPIC_TITLE_RE.test(it.title) && it.body && WORKSTREAMS_HEADING_RE.test(it.body),
  );

  let epicsHandled = 0;
  for (const epic of epicCandidates) {
    if (epicsHandled >= MAX_EPICS_PER_RUN) break;

    let state: ScanRecord["state"] = "UNDECOMPOSED";
    let action: string | undefined;
    let commentUrl: string | undefined;

    try {
      // 1. Already decomposed?
      const subIssues = await listSubIssues(OWNER, REPO, epic.number);
      if (subIssues.length > 0) {
        state = "DECOMPOSED";
        output.scanned.push({ issue: epic.number, title: epic.title, state });
        continue;
      }

      // 2. Proposal already posted?
      const comments = await listIssueComments(OWNER, REPO, epic.number);
      const proposal = findProposalComment(comments);

      if (proposal) {
        // Already proposed — check for 👍 approval
        const reactions = await listReactionsForComment(OWNER, REPO, proposal.id);
        const approved = reactions.some((r) => r.content === "+1");
        if (!approved) {
          state = "AWAITING_OPERATOR";
          output.scanned.push({
            issue: epic.number,
            title: epic.title,
            state,
            comment_url: proposal.html_url,
          });
          continue;
        }
        // APPROVED — materialise children from the proposal body
        const children = parseProposalChildren(proposal.body);
        const created = await materialiseChildren(epic, children);
        state = "APPROVED";
        action = `created ${created.length} children`;
        output.approved_decomposed.push({ parent: epic.number, children: created });
        output.scanned.push({
          issue: epic.number,
          title: epic.title,
          state,
          action,
          comment_url: proposal.html_url,
        });
        epicsHandled++;
        continue;
      }

      // 3. UNDECOMPOSED — propose
      const proposalText = await proposeForEpic(epic);
      const posted = await createIssueComment(
        OWNER,
        REPO,
        epic.number,
        wrapProposalMarker(proposalText),
      );
      state = "UNDECOMPOSED";
      action = "proposal_posted";
      commentUrl = posted.html_url;
      output.scanned.push({
        issue: epic.number,
        title: epic.title,
        state,
        action,
        comment_url: commentUrl,
      });
      epicsHandled++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      output.errors.push(`epic #${epic.number}: ${message}`);
      output.scanned.push({ issue: epic.number, title: epic.title, state, error: message });
    }
  }

  const summary = summarise(output);
  return {
    output: JSON.stringify(output, null, 2),
    outputExt: "json",
    summary,
  };
}

// --- Helpers -------------------------------------------------------------

function findProposalComment(comments: GithubComment[]): GithubComment | undefined {
  return comments.find((c) => c.body.includes(PROPOSAL_MARKER));
}

function wrapProposalMarker(text: string): string {
  return `${PROPOSAL_MARKER}\n\n${text}\n\n_To approve, react with 👍 on this comment. To revise, leave a reply with adjustments._`;
}

interface ChildSpec {
  title: string;
  body: string;
  labels: string[];
  reviewer_personas: string[];
}

interface ProposalPayload {
  scenarios_walked: string[];
  children: ChildSpec[];
}

function parseProposalChildren(commentBody: string): ChildSpec[] {
  // The proposal comment wraps the JSON in markdown — find the first JSON
  // block. We accept either a ```json fenced block or a bare JSON object.
  const fenceMatch = commentBody.match(/```json\s*\n([\s\S]*?)\n```/);
  const raw = fenceMatch ? fenceMatch[1] : extractFirstJsonObject(commentBody);
  if (!raw) {
    throw new Error("could not locate JSON payload in approved proposal comment");
  }
  let parsed: ProposalPayload;
  try {
    parsed = JSON.parse(raw) as ProposalPayload;
  } catch (err) {
    throw new Error(`proposal JSON parse failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!Array.isArray(parsed.children) || parsed.children.length === 0) {
    throw new Error("proposal has no children to materialise");
  }
  if (parsed.children.length > MAX_CHILDREN_PER_EPIC) {
    throw new Error(
      `proposal has ${parsed.children.length} children > cap ${MAX_CHILDREN_PER_EPIC} — split the epic first`,
    );
  }
  return parsed.children;
}

function extractFirstJsonObject(text: string): string | undefined {
  const start = text.indexOf("{");
  if (start === -1) return undefined;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return undefined;
}

async function materialiseChildren(
  parent: GithubIssue,
  children: ChildSpec[],
): Promise<Array<{ number: number; title: string }>> {
  const created: Array<{ number: number; title: string }> = [];
  for (const c of children) {
    const issue = await createIssue(OWNER, REPO, {
      title: c.title,
      body: appendParentLink(c.body, parent),
      labels: c.labels,
    });
    try {
      await addSubIssue(OWNER, REPO, parent.number, issue.number);
    } catch {
      // sub_issues API may not be enabled on the repo / on a non-billable plan;
      // the child issue still exists and the body links back to the parent.
    }
    created.push({ number: issue.number, title: issue.title });
  }
  return created;
}

function appendParentLink(body: string, parent: GithubIssue): string {
  const link = `\n\n---\n\nParent epic: ${parent.html_url} (#${parent.number}) — _${parent.title}_`;
  return body.includes(parent.html_url) ? body : `${body}${link}`;
}

async function proposeForEpic(epic: GithubIssue): Promise<string> {
  const workstreams = extractWorkstreams(epic.body ?? "");
  const user = [
    `## Parent epic`,
    `**#${epic.number}** — ${epic.title}`,
    epic.html_url,
    "",
    `## Workstreams section (verbatim)`,
    "",
    workstreams,
    "",
    `## Required output`,
    "",
    "Walk 2-3 operator scenarios, then return ONLY the JSON object as specified in the system prompt.",
  ].join("\n");

  // Maya's system.md is loaded by the agent-runner for llm-prose flows; for
  // deterministic skills we compose our own minimal system here (the
  // reasoning is skill-local, not Maya-persona-flavoured).
  const system = `You are Maya, the PdM. Decompose the epic below into child GitHub issues per the contract.${REASONING_SYSTEM_SUFFIX}`;

  const llm = await complete({
    model: REASONING_MODEL,
    system,
    user,
    maxTokens: REASONING_MAX_TOKENS,
  });

  // Wrap the LLM JSON output in a fenced code block + a human-readable
  // preface, so the proposal comment is both readable and machine-parseable.
  const preface = buildProposalPreface(llm.text);
  return `### Proposed decomposition\n\n${preface}\n\n\`\`\`json\n${cleanJsonForFence(llm.text)}\n\`\`\``;
}

function extractWorkstreams(body: string): string {
  const m = body.match(/##\s+Workstreams[\s\S]*?(?=\n##\s+|\n#\s+|$)/);
  return m ? m[0].trim() : body.slice(0, 4000);
}

function cleanJsonForFence(text: string): string {
  const json = extractFirstJsonObject(text) ?? text.trim();
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
}

function buildProposalPreface(text: string): string {
  const json = extractFirstJsonObject(text);
  if (!json) return "_(could not extract structured proposal — raw model output follows)_";
  try {
    const parsed = JSON.parse(json) as ProposalPayload;
    const scenarios = (parsed.scenarios_walked ?? [])
      .map((s, i) => `${i + 1}. ${s}`)
      .join("\n");
    const summary = (parsed.children ?? [])
      .map((c) => `- ${c.title} _(reviewers: ${c.reviewer_personas.join(", ")})_`)
      .join("\n");
    return `**Scenarios walked**:\n${scenarios || "_(none listed)_"}\n\n**Proposed children**:\n${summary || "_(none)_"}`;
  } catch {
    return "_(proposal JSON did not parse cleanly — see the raw block below)_";
  }
}

function summarise(o: ScanOutput): string {
  if (o.scanned.length === 0) return "no work: 0 epics matched";
  const byState: Record<string, number> = {};
  for (const r of o.scanned) byState[r.state] = (byState[r.state] ?? 0) + 1;
  const parts = Object.entries(byState).map(([s, n]) => `${s.toLowerCase()}=${n}`);
  if (o.approved_decomposed.length > 0) {
    const totalChildren = o.approved_decomposed.reduce((a, r) => a + r.children.length, 0);
    parts.push(`children_created=${totalChildren}`);
  }
  if (o.errors.length > 0) parts.push(`errors=${o.errors.length}`);
  return `pdm-decompose: ${parts.join(", ")}`;
}
