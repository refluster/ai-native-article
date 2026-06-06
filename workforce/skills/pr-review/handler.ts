// Deterministic handler for the pr-review skill (Phase 7 PR3b).
// See ./SKILL.md for the contract; ../../docs/routines/pr-review.md for
// the persona-agnostic routine spec.
//
// Applies the invoking persona's lens (from binding_config) to a target-
// repo PR and posts a single COMMENT-event review (W-5 — never APPROVE,
// never REQUEST_CHANGES). Verdict synthesis (the 🟢/🟡/🔴 leg) lives in
// pr-route's verdict mode, not here.
//
// Trust boundary:
//   - Project resolved at the runner seam (event.project_id →
//     ctx.project_id). pr-review on `self/{slug}` rejects.
//   - Credentials sealed bag: only ["github.token"] readable per
//     meta.json:requires.
//   - PR-URL (owner, repo) cross-checked against PROJECT#{id}/META.
//
// Failure modes (all loud, per W-4):
//   - malformed pr_url
//   - missing `args.pr_url`
//   - project_id is `self/*`
//   - (owner, repo) mismatch vs project META
//   - GitHub REST 4xx/5xx
//   - LLM non-JSON output
//   - Anthropic stop_reason=max_tokens (already loud in shared/llm-anthropic.ts)
//
// Inline-comment posting (per the routine spec's `add_comment_to_
// pending_review` pattern) is OUT OF SCOPE for v1. The handler posts
// the summary review only; inline findings are serialized into the
// summary body as a structured list. Inline posting requires file:line
// validation against the diff which adds material complexity; it lands
// when there's evidence the summary-only shape isn't enough.

import { complete } from "../../lambdas/shared/llm-anthropic.js";
import { asProjectId, getProject } from "../../lambdas/shared/project.js";
import type {
  DeterministicResult,
  RunnerContext,
} from "../../lambdas/shared/skill-types.js";

const PR_URL = /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)(?:[/?#]|$)/;
const GH_API = "https://api.github.com";
const REVIEWER_MODEL = "anthropic:claude-sonnet-4-6";
const MAX_OUTPUT_TOKENS = 3072; // Reviews can run longer than route comments.
const MAX_DIFF_CHARS = 48_000;

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

interface ReviewOutput {
  summary: string;
  inline_findings: Array<{
    finding_id: string;
    lens_section: string;
    file?: string;
    line?: number;
    body: string;
  }>;
  sign_off: string;
}

interface ChecklistSection {
  section: string;
  items: string[];
}

interface BindingConfig {
  lens_name?: string;
  lens_summary?: string;
  values?: string[];
  checklist_sections?: ChecklistSection[];
  bias_disclosure_template?: string;
  sign_off_suffix?: string;
}

// --- entry point ----------------------------------------------------------

export async function dispatchPrReview(
  ctx: RunnerContext,
): Promise<DeterministicResult> {
  // 1. Argument + trust-boundary validation.
  const args = ctx.args as { pr_url?: unknown };
  if (typeof args.pr_url !== "string" || args.pr_url.length === 0) {
    throw new Error("pr-review requires args.pr_url (string)");
  }
  if (ctx.project_id.startsWith("self/")) {
    throw new Error(
      `pr-review requires an explicit external project; refusing to review on self project "${ctx.project_id}"`,
    );
  }

  const parsed = parsePrUrl(args.pr_url);
  await assertProjectGithubMatches(ctx.project_id, parsed);

  // 2. Fetch PR + diff + existing comments. The sealed credential bag
  //    throws if the skill's meta.requires[] didn't declare github.token.
  const token = ctx.credentials["github.token"].token;
  const pr = await fetchPr(token, parsed);
  const diff = await fetchPrDiff(token, parsed);
  const existingComments = await fetchPrComments(token, parsed);
  const myPriorReviews = countPriorReviews(existingComments, ctx.slug);
  const cycle = myPriorReviews + 1;

  // 3. Compose the LLM prompt. Lens overlay = binding_config.
  const cfg = ctx.binding_config as BindingConfig;
  const personaSystemMd = await loadPersonaSystemMd(ctx.slug);
  const system = composeSystemPrompt(ctx.slug, personaSystemMd, cfg, cycle);
  const user = composeUserPrompt(pr, diff, existingComments);

  // 4. Call Anthropic; expect JSON output.
  const llm = await complete({
    model: REVIEWER_MODEL,
    system,
    user,
    maxTokens: MAX_OUTPUT_TOKENS,
    temperature: 0.3,
  });
  const review = parseReviewOutput(llm.text);

  // 5. Post the review (event=COMMENT only, W-5).
  const reviewBody = formatReviewBody(review, cycle, cfg, ctx.slug);
  const postedStatus = await postPrReview(token, parsed, reviewBody);

  // 6. S3-bound artefact + RunnerResult.
  const artefact = {
    invocation: {
      project_id: ctx.project_id,
      pr_url: args.pr_url,
      cycle,
      lens_name: cfg.lens_name,
    },
    review,
    posted_review: { status: postedStatus },
    cost: {
      tokens_in: llm.tokens_in,
      tokens_out: llm.tokens_out,
      cost_usd: llm.cost_usd,
    },
  };

  return {
    output: JSON.stringify(artefact, null, 2),
    outputExt: "json",
    summary: summarise(review, cycle, cfg, ctx.slug),
    side_effect: { kind: "github.pr_review", status: postedStatus },
    tokens_in: llm.tokens_in,
    tokens_out: llm.tokens_out,
    cost_usd: llm.cost_usd,
  };
}

// --- parsing + validation -------------------------------------------------

export function parsePrUrl(raw: string): ParsedPrUrl {
  const m = PR_URL.exec(raw.trim());
  if (!m) {
    throw new Error(`pr-review: pr_url "${raw}" does not match GitHub PR URL pattern`);
  }
  return { owner: m[1]!, repo: m[2]!, pr_number: Number(m[3]) };
}

async function assertProjectGithubMatches(
  projectId: string,
  parsed: ParsedPrUrl,
): Promise<void> {
  type ProjectMeta = {
    github_owner?: string | null;
    github_repo?: string | null;
  };
  const project = (await getProject(asProjectId(projectId))) as ProjectMeta | undefined;
  if (!project) {
    throw new Error(
      `pr-review: PROJECT#${projectId}/META not seeded; run workforce:projects:seed`,
    );
  }
  const { github_owner, github_repo } = project;
  if (!github_owner || !github_repo) {
    throw new Error(
      `pr-review: project "${projectId}" has no github.{owner,repo} declared in project.json`,
    );
  }
  if (github_owner !== parsed.owner || github_repo !== parsed.repo) {
    throw new Error(
      `pr-review: pr_url (${parsed.owner}/${parsed.repo}) does not match project "${projectId}" github (${github_owner}/${github_repo})`,
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
    ? diff.slice(0, MAX_DIFF_CHARS) +
        `\n\n... [diff truncated at ${MAX_DIFF_CHARS} chars] ...\n`
    : diff;
}

async function fetchPrComments(token: string, p: ParsedPrUrl): Promise<Comment[]> {
  return ghGet<Comment[]>(
    token,
    `/repos/${p.owner}/${p.repo}/issues/${p.pr_number}/comments?per_page=100`,
  );
}

/**
 * Post the persona's review as `event: "COMMENT"`. Per W-5 (governance §2),
 * agents NEVER APPROVE or REQUEST_CHANGES — only comment. The merge gate
 * is operator-only.
 */
async function postPrReview(
  token: string,
  p: ParsedPrUrl,
  body: string,
): Promise<number> {
  const res = await fetch(
    `${GH_API}/repos/${p.owner}/${p.repo}/pulls/${p.pr_number}/reviews`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "kohuehara-workforce",
      },
      body: JSON.stringify({ body, event: "COMMENT" }),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `GitHub POST review → ${res.status}: ${text.slice(0, 300)}`,
    );
  }
  return res.status;
}

/**
 * Heuristic for prior reviews by this persona. The review body opens
 * with `**{PersonaName} review (cycle N, lens: ...)**`. PR3b detail:
 * the count drives the cycle number stamped on the next review and
 * lets the verdict-mode synthesis (pr-route, follow-up) tell cycle-1
 * findings apart from cycle-2 follow-ups.
 */
export function countPriorReviews(
  comments: Comment[],
  agentSlug: string,
): number {
  const personaName = agentSlug.charAt(0).toUpperCase() + agentSlug.slice(1);
  const pattern = new RegExp(
    `^\\*\\*${personaName} review \\(cycle \\d+,`,
    "m",
  );
  return comments.filter((c) => pattern.test(c.body)).length;
}

// --- persona + prompt -----------------------------------------------------

async function loadPersonaSystemMd(slug: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const here = dirname(fileURLToPath(import.meta.url));
  try {
    return await readFile(join(here, "agents", slug, "system.md"), "utf8");
  } catch (err) {
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return `(${slug}'s persona system.md not bundled at runtime — reviewing from binding_config alone)`;
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
  const lensName = cfg.lens_name ?? "(unspecified lens)";
  const lensSummary = cfg.lens_summary ?? "";
  const sections = cfg.checklist_sections ?? [];
  const values = cfg.values ?? [];

  return [
    personaSystemMd,
    "",
    "---",
    "",
    `## Active skill: pr-review (lens: ${lensName}, cycle ${cycle})`,
    "",
    `Lens summary: ${lensSummary}`,
    "",
    "### Values you apply",
    "",
    values.length > 0 ? values.map((v) => `- ${v}`).join("\n") : "_(none declared)_",
    "",
    "### Checklist sections",
    "",
    sections
      .map((s) => {
        const items = s.items.map((it) => `  - ${it}`).join("\n");
        return `**${s.section}**\n${items}`;
      })
      .join("\n\n"),
    "",
    "### Output contract",
    "",
    "Return ONLY a JSON object — no prose around it, no fenced code block. Shape:",
    "```",
    '{',
    '  "summary": "1-paragraph verdict signal — what passed, what didn\'t. Open with 🟢/🟡 indicator (your lens reading, not the cross-reviewer verdict).",',
    '  "inline_findings": [',
    '    { "finding_id": "<section-letter><integer>, e.g. A1", "lens_section": "<section-letter>, e.g. A", "file": "<optional file path>", "line": <optional integer>, "body": "1-3 sentences, cite the section name, suggest a concrete fix" }',
    '  ],',
    '  "sign_off": "1-sentence summary suitable as the review\'s closing line"',
    '}',
    "```",
    "",
    "Constraints:",
    `- ${personaName}'s voice throughout (per the system.md above).`,
    "- Silence on a checklist item means \"looks good\" — only post findings for real issues.",
    `- Cycle ${cycle} ${cycle === 1 ? "is the initial review — surface ALL findings" : "is a follow-up — scope to cycle-1 findings; do NOT raise new issues unless genuinely critical (mark with [NEW] in finding_id)"}.`,
    "- Per W-5: NEVER recommend approving or blocking the PR. Findings only.",
    "- Findings include a section letter (A, B, C, ...) matching the checklist sections above; finding_id is `<section><integer>` (A1, A2, B1, ...).",
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
    "Produce the review JSON now.",
  ].join("\n");
}

// --- output parsing + comment formatting ----------------------------------

export function parseReviewOutput(raw: string): ReviewOutput {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      `pr-review: LLM output was not valid JSON: ${(err as Error).message} — first 200 chars: ${cleaned.slice(0, 200)}`,
    );
  }
  const o = parsed as Partial<ReviewOutput>;
  if (typeof o.summary !== "string" || !Array.isArray(o.inline_findings)) {
    throw new Error(
      `pr-review: LLM JSON missing required fields {summary, inline_findings}; got ${JSON.stringify(parsed).slice(0, 200)}`,
    );
  }
  return {
    summary: o.summary,
    inline_findings: o.inline_findings.filter(
      (f): f is ReviewOutput["inline_findings"][number] =>
        typeof f?.finding_id === "string" &&
        typeof f?.lens_section === "string" &&
        typeof f?.body === "string",
    ),
    sign_off: typeof o.sign_off === "string" ? o.sign_off : "",
  };
}

export function formatReviewBody(
  review: ReviewOutput,
  cycle: number,
  cfg: BindingConfig,
  slug: string,
): string {
  const personaName = slug.charAt(0).toUpperCase() + slug.slice(1);
  const lensName = cfg.lens_name ?? "(unspecified lens)";
  const sectionMap = new Map<string, typeof review.inline_findings>();
  for (const f of review.inline_findings) {
    const arr = sectionMap.get(f.lens_section) ?? [];
    arr.push(f);
    sectionMap.set(f.lens_section, arr);
  }
  const findingsBlocks: string[] = [];
  // Stable section order.
  const sections = [...sectionMap.keys()].sort();
  for (const section of sections) {
    const items = sectionMap.get(section)!.map((f) => {
      const loc = f.file
        ? f.line
          ? ` (\`${f.file}:${f.line}\`)`
          : ` (\`${f.file}\`)`
        : "";
      return `- **${f.finding_id}**${loc} — ${f.body}`;
    });
    findingsBlocks.push(`### Section ${section}\n\n${items.join("\n")}`);
  }
  const findings = findingsBlocks.length > 0
    ? findingsBlocks.join("\n\n")
    : "_No findings._";
  const biasDisclosure = cfg.bias_disclosure_template ?? "";
  const sign_off = review.sign_off || `— ${personaName} (LLM persona via Lambda; lens: ${lensName}; see workforce/docs/routines/pr-review.md)`;

  return [
    `**${personaName} review (cycle ${cycle}, lens: ${lensName})**`,
    "",
    review.summary,
    "",
    "## Findings",
    "",
    findings,
    "",
    `${sign_off}`,
    "",
    biasDisclosure ? `> ${biasDisclosure}` : "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function summarise(
  review: ReviewOutput,
  cycle: number,
  cfg: BindingConfig,
  slug: string,
): string {
  const personaName = slug.charAt(0).toUpperCase() + slug.slice(1);
  const lensName = cfg.lens_name ?? "(unspecified)";
  const n = review.inline_findings.length;
  return `${personaName} cycle ${cycle} lens=${lensName}: ${n} finding${n === 1 ? "" : "s"}`;
}
