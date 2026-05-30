// Deterministic handler for the pr-route skill (Phase 7 PR3a).
// See ./SKILL.md for the contract; ../../docs/routines/pr-route.md for
// the persona-agnostic routine spec.
//
// Routes a target-repo PR to 1-3 reviewer personas under the invoking
// agent's lens, posts a single routing comment, returns LLM cost.
// Verdict mode (PR3b) is intentionally out of scope here — this is the
// "cycle 1 routing" leg only.
//
// Trust boundary:
//   - Project resolved at the runner seam (event.project_id →
//     ctx.project_id). pr-route on `self/{slug}` rejects: external
//     PR review only.
//   - Credentials sealed bag: only ["github.token"] readable per
//     meta.json:requires (enforced by Story 2-A credential-injector).
//   - PR-URL (owner, repo) is cross-checked against PROJECT#{id}/META
//     so the operator can't mis-attribute a PR to a different project
//     and accidentally exfiltrate the wrong PAT.
//
// Failure modes (all loud, per W-4):
//   - malformed pr_url
//   - missing `args.pr_url`
//   - project_id is `self/*`
//   - (owner, repo) mismatch vs project META
//   - GitHub REST 4xx/5xx
//   - LLM non-JSON output
//   - Anthropic stop_reason=max_tokens (already loud in shared/llm-anthropic.ts)

import { complete } from "../../lambdas/shared/llm-anthropic.js";
import { asProjectId, getProject } from "../../lambdas/shared/project.js";
import type {
  DeterministicResult,
  RunnerContext,
} from "../../lambdas/shared/skill-types.js";

const PR_URL = /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)(?:[/?#]|$)/;
const GH_API = "https://api.github.com";
const ROUTER_MODEL = "anthropic:claude-sonnet-4-6";
const MAX_OUTPUT_TOKENS = 2048;
const MAX_DIFF_CHARS = 48_000; // ~12K tokens; protects context budget

interface ParsedPrUrl {
  owner: string;
  repo: string;
  pr_number: number;
}

interface PullRequest {
  number: number;
  title: string;
  body: string | null;
  user: { login: string } | null;
  head: { ref: string; sha: string };
  base: { ref: string };
  draft: boolean;
  html_url: string;
}

interface Comment {
  user: { login: string } | null;
  body: string;
}

interface RouteOutput {
  summary: string;
  reviewers: Array<{ persona: string; lens: string; rationale: string }>;
  skipped: string[];
  skip_rationale: string;
}

interface NominationRule {
  lens: string;
  persona: string;
  trigger: string;
}

interface BindingConfig {
  cycle_cap?: number;
  nomination_rules?: NominationRule[];
  skip_list_default?: string[];
  skip_list_rationale?: string;
  sign_off_persona?: string;
}

// --- entry point ----------------------------------------------------------

export async function dispatchPrRoute(
  ctx: RunnerContext,
): Promise<DeterministicResult> {
  // 1. Argument + trust-boundary validation.
  const args = ctx.args as { pr_url?: unknown };
  if (typeof args.pr_url !== "string" || args.pr_url.length === 0) {
    throw new Error("pr-route requires args.pr_url (string)");
  }
  if (ctx.project_id.startsWith("self/")) {
    throw new Error(
      `pr-route requires an explicit external project; refusing to route on self project "${ctx.project_id}"`,
    );
  }

  const parsed = parsePrUrl(args.pr_url);
  await assertProjectGithubMatches(ctx.project_id, parsed);

  // 2. Fetch PR + comments via REST. github.token narrowed to required key
  //    (the bag's Proxy throws if the skill's meta.requires[] didn't declare it).
  const token = ctx.credentials["github.token"].token;
  const pr = await fetchPr(token, parsed);
  const diff = await fetchPrDiff(token, parsed);
  const existingComments = await fetchPrComments(token, parsed);
  const myPriorRouterComments = countPriorRouterComments(
    existingComments,
    ctx.slug,
  );
  // Cycle 1 in PR3a; PR3b refines by parsing prior router-comments + verdicts.
  const cycle = myPriorRouterComments + 1;

  // 3. Compose the LLM prompt. Lens overlay = binding_config.
  const cfg = ctx.binding_config as BindingConfig;
  const personaSystemMd = await loadPersonaSystemMd(ctx.slug);
  const system = composeSystemPrompt(ctx.slug, personaSystemMd, cfg, cycle);
  const user = composeUserPrompt(pr, diff, existingComments);

  // 4. Call Anthropic; expect JSON output.
  const llm = await complete({
    model: ROUTER_MODEL,
    system,
    user,
    maxTokens: MAX_OUTPUT_TOKENS,
    temperature: 0.3,
  });
  const route = parseRouteOutput(llm.text);

  // 5. Post the routing comment.
  const commentBody = formatRoutingComment(route, cycle, cfg, ctx.slug);
  const postedStatus = await postPrComment(token, parsed, commentBody);

  // 6. Build a S3-bound artefact + the RunnerResult.
  const artefact = {
    invocation: { project_id: ctx.project_id, pr_url: args.pr_url, cycle },
    route,
    posted_comment: { status: postedStatus },
    cost: {
      tokens_in: llm.tokens_in,
      tokens_out: llm.tokens_out,
      cost_usd: llm.cost_usd,
    },
  };

  return {
    output: JSON.stringify(artefact, null, 2),
    outputExt: "json",
    summary: summarise(route, cycle, cfg),
    side_effect: { kind: "github.pr_comment", status: postedStatus },
    tokens_in: llm.tokens_in,
    tokens_out: llm.tokens_out,
    cost_usd: llm.cost_usd,
  };
}

// --- parsing + validation -------------------------------------------------

export function parsePrUrl(raw: string): ParsedPrUrl {
  const m = PR_URL.exec(raw.trim());
  if (!m) {
    throw new Error(`pr-route: pr_url "${raw}" does not match GitHub PR URL pattern`);
  }
  return { owner: m[1]!, repo: m[2]!, pr_number: Number(m[3]) };
}

async function assertProjectGithubMatches(
  projectId: string,
  parsed: ParsedPrUrl,
): Promise<void> {
  // getProject reads PROJECT#{id}/META from DDB. We cross-check the
  // PR-URL-derived (owner, repo) against the project's declared GitHub
  // surface so the operator can't ask Nadia-on-asp-cloud to route a PR
  // on some-other-org/some-other-repo using asp-cloud's PAT.
  type ProjectMeta = {
    github_owner?: string | null;
    github_repo?: string | null;
  };
  const project = (await getProject(asProjectId(projectId))) as ProjectMeta | undefined;
  if (!project) {
    throw new Error(
      `pr-route: PROJECT#${projectId}/META not seeded; run workforce:projects:seed`,
    );
  }
  const { github_owner, github_repo } = project;
  if (!github_owner || !github_repo) {
    throw new Error(
      `pr-route: project "${projectId}" has no github.{owner,repo} declared in project.json`,
    );
  }
  if (github_owner !== parsed.owner || github_repo !== parsed.repo) {
    throw new Error(
      `pr-route: pr_url (${parsed.owner}/${parsed.repo}) does not match project "${projectId}" github (${github_owner}/${github_repo})`,
    );
  }
}

// --- GitHub REST ----------------------------------------------------------

async function ghGet<T>(token: string, path: string, accept?: string): Promise<T> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    accept: accept ?? "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "kohuehara-workforce",
  };
  const res = await fetch(`${GH_API}${path}`, { headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub GET ${path} → ${res.status}: ${body.slice(0, 300)}`);
  }
  if (accept?.includes("vnd.github.v3.diff")) {
    return (await res.text()) as unknown as T;
  }
  return (await res.json()) as T;
}

async function fetchPr(token: string, p: ParsedPrUrl): Promise<PullRequest> {
  return ghGet<PullRequest>(
    token,
    `/repos/${p.owner}/${p.repo}/pulls/${p.pr_number}`,
  );
}

async function fetchPrDiff(token: string, p: ParsedPrUrl): Promise<string> {
  const diff = await ghGet<string>(
    token,
    `/repos/${p.owner}/${p.repo}/pulls/${p.pr_number}`,
    "application/vnd.github.v3.diff",
  );
  return diff.length > MAX_DIFF_CHARS
    ? diff.slice(0, MAX_DIFF_CHARS) + `\n\n... [diff truncated at ${MAX_DIFF_CHARS} chars] ...\n`
    : diff;
}

async function fetchPrComments(token: string, p: ParsedPrUrl): Promise<Comment[]> {
  return ghGet<Comment[]>(
    token,
    `/repos/${p.owner}/${p.repo}/issues/${p.pr_number}/comments?per_page=100`,
  );
}

async function postPrComment(
  token: string,
  p: ParsedPrUrl,
  body: string,
): Promise<number> {
  const res = await fetch(
    `${GH_API}/repos/${p.owner}/${p.repo}/issues/${p.pr_number}/comments`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "kohuehara-workforce",
      },
      body: JSON.stringify({ body }),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `GitHub POST comment → ${res.status}: ${text.slice(0, 300)}`,
    );
  }
  return res.status;
}

export function countPriorRouterComments(
  comments: Comment[],
  agentSlug: string,
): number {
  // Heuristic for PR3a: a comment is a "prior router comment by this
  // agent" if the body opens with `**{PersonaName} — cycle {N} of ≤`
  // (the router-comment template format from pr-route.md). PR3b will
  // refine by parsing the cycle integer + verdict signal.
  const personaName = agentSlug.charAt(0).toUpperCase() + agentSlug.slice(1);
  const pattern = new RegExp(`^\\*\\*${personaName} — cycle \\d+ of `, "m");
  return comments.filter((c) => pattern.test(c.body)).length;
}

// --- persona + prompt -----------------------------------------------------

async function loadPersonaSystemMd(slug: string): Promise<string> {
  // The wf-agent-runner Makefile bundles workforce/agents/{slug}/system.md
  // alongside the runner handler.mjs. Skill handlers are pulled into the
  // same bundle via the import graph so the resolved import.meta.url is
  // the runner's location.
  const { readFile } = await import("node:fs/promises");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const here = dirname(fileURLToPath(import.meta.url));
  try {
    return await readFile(join(here, "agents", slug, "system.md"), "utf8");
  } catch (err) {
    // Defensive: in unit tests there is no bundled `agents/` dir. The
    // routing prompt degrades to lens-config-only — still produces a
    // valid (if less voice-rich) routing comment.
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return `(${slug}'s persona system.md not bundled at runtime — routing from binding_config alone)`;
    }
    throw err;
  }
}

function composeSystemPrompt(
  slug: string,
  personaSystemMd: string,
  cfg: BindingConfig,
  cycle: number,
): string {
  const personaName = slug.charAt(0).toUpperCase() + slug.slice(1);
  const cycleCap = cfg.cycle_cap ?? 7;
  const rules = cfg.nomination_rules ?? [];
  const skipDefault = cfg.skip_list_default ?? [];
  return [
    personaSystemMd,
    "",
    "---",
    "",
    `## Active skill: pr-route (routing mode, cycle ${cycle} of ≤ ${cycleCap})`,
    "",
    "You are routing a pull request to 1-3 reviewer personas under your lens.",
    "Apply the nomination_rules below to the PR diff and body, then return a JSON object.",
    "",
    "### Your nomination_rules",
    "",
    rules
      .map(
        (r) =>
          `- lens: \`${r.lens}\` → persona: \`${r.persona}\` — trigger: ${r.trigger}`,
      )
      .join("\n"),
    "",
    `### Default skip list (lenses with no surface on most PRs)`,
    "",
    skipDefault.length > 0
      ? skipDefault.map((s) => `- ${s}`).join("\n")
      : "_(none)_",
    "",
    "### Output contract",
    "",
    "Return ONLY a JSON object — no prose around it, no fenced code block.",
    "Shape:",
    "```",
    '{',
    '  "summary": "one paragraph PR summary",',
    '  "reviewers": [',
    '    { "persona": "<slug>", "lens": "<lens-name>", "rationale": "one-line citation of the PR surface that triggers this lens" }',
    '  ],',
    '  "skipped": ["<slug>", ...],',
    '  "skip_rationale": "one short clause why the skip-list applies"',
    '}',
    "```",
    "",
    "Constraints:",
    `- Nominate 1-3 reviewers. ${personaName} (you) MAY appear in reviewers[] if your nomination_rules self-include.`,
    "- skipped[] should list personas you considered and rejected; not every persona in the org.",
    "- rationale must cite the PR surface (file paths or topics), not just restate the trigger.",
  ].join("\n");
}

function composeUserPrompt(
  pr: PullRequest,
  diff: string,
  comments: Comment[],
): string {
  const commentSummary =
    comments.length === 0
      ? "_(no prior comments)_"
      : comments
          .map(
            (c) =>
              `- @${c.user?.login ?? "(unknown)"}: ${c.body.slice(0, 240).replace(/\n+/g, " ")}`,
          )
          .slice(0, 30)
          .join("\n");
  return [
    `# PR #${pr.number}: ${pr.title}`,
    "",
    `Author: @${pr.user?.login ?? "(unknown)"} · base: \`${pr.base.ref}\` · head: \`${pr.head.ref}\` · draft: ${pr.draft}`,
    `URL: ${pr.html_url}`,
    "",
    "## PR body",
    "",
    pr.body ?? "_(empty)_",
    "",
    "## Diff",
    "",
    "```diff",
    diff,
    "```",
    "",
    "## Existing PR comments",
    "",
    commentSummary,
    "",
    "Produce the routing JSON now.",
  ].join("\n");
}

// --- output parsing + comment formatting ----------------------------------

export function parseRouteOutput(raw: string): RouteOutput {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      `pr-route: LLM output was not valid JSON: ${(err as Error).message} — first 200 chars: ${cleaned.slice(0, 200)}`,
    );
  }
  const o = parsed as Partial<RouteOutput>;
  if (typeof o.summary !== "string" || !Array.isArray(o.reviewers)) {
    throw new Error(
      `pr-route: LLM JSON missing required fields {summary, reviewers}; got ${JSON.stringify(parsed).slice(0, 200)}`,
    );
  }
  return {
    summary: o.summary,
    reviewers: o.reviewers.filter(
      (r): r is RouteOutput["reviewers"][number] =>
        typeof r?.persona === "string" &&
        typeof r?.lens === "string" &&
        typeof r?.rationale === "string",
    ),
    skipped: Array.isArray(o.skipped) ? o.skipped.filter((s): s is string => typeof s === "string") : [],
    skip_rationale: typeof o.skip_rationale === "string" ? o.skip_rationale : "",
  };
}

export function formatRoutingComment(
  route: RouteOutput,
  cycle: number,
  cfg: BindingConfig,
  slug: string,
): string {
  const personaName = slug.charAt(0).toUpperCase() + slug.slice(1);
  const cycleCap = cfg.cycle_cap ?? 7;
  const reviewerLines = route.reviewers
    .map((r) => `- **@${r.persona}** — ${r.rationale}`)
    .join("\n");
  const skipNote =
    route.skipped.length > 0
      ? `\n\nSkipping ${route.skipped.map((s) => `@${s}`).join(", ")} — ${route.skip_rationale}.`
      : "";
  return [
    `**${personaName} — cycle ${cycle} of ≤ ${cycleCap}.**`,
    "",
    route.summary,
    "",
    "Reviewers nominated:",
    "",
    reviewerLines,
    skipNote,
    "",
    `**Cycle ${cycle} of ≤ ${cycleCap}.** Reviewers post inline + summary via \`pull_request_review_write event=COMMENT\` (never approve / never request-changes per W-5). Author revises in a single commit per cycle; verdict comment synthesises.`,
    "",
    `— ${personaName} (LLM persona via Lambda; see workforce/docs/routines/pr-route.md)`,
  ].join("\n");
}

function summarise(route: RouteOutput, cycle: number, cfg: BindingConfig): string {
  const cap = cfg.cycle_cap ?? 7;
  const names = route.reviewers.map((r) => r.persona).join(", ");
  return `cycle ${cycle}/${cap}: routed to ${names || "(no reviewers)"}`;
}
