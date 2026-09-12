import { getProject, asProjectId } from "./project.js";
import type { GithubSecret } from "./secrets.js";

export interface OpenExternalPrInput {
  project_id: string;
  agent_slug: string;
  skill_name: string;
  run_id: string;
  /** Repo-relative file path to create/replace (e.g. "output/report.md"). */
  path: string;
  /** UTF-8 body content of the file. */
  body: string;
  /** Per-project GitHub PAT from the sealed credential bag. */
  github: GithubSecret;
}

export interface OpenExternalPrResult {
  pr_url: string;
  pr_number: number;
  branch_name: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const GH_API = "https://api.github.com";

function ghHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "content-type": "application/json",
    "user-agent": "wf-external-pr",
  };
}

async function throwGhError(step: string, res: Response): Promise<never> {
  const body = await res.text().catch(() => "<unreadable>");
  throw new Error(
    `external-pr ${step}: GitHub API ${res.status} — ${body.slice(0, 500)}`,
  );
}

function buildPrBody(input: OpenExternalPrInput): string {
  const branch = externalPrBranchName(input.agent_slug, input.run_id);
  return (
    `Opened by the **${input.agent_slug}** agent via the \`${input.skill_name}\` skill.\n\n` +
    `**Audit trail**\n\n| Field | Value |\n|---|---|\n` +
    `| agent | \`${input.agent_slug}\` |\n` +
    `| skill | \`${input.skill_name}\` |\n` +
    `| project | \`${input.project_id}\` |\n` +
    `| run_id | \`${input.run_id}\` |\n` +
    `| branch | \`${branch}\` |\n\n` +
    `> Opened programmatically by the workforce agent runner (R-N9). Not reviewed by a human author.`
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Opens an external PR on the project's GitHub repo via the git-data REST API
 * (8-step sequence: repo → ref → tip-commit → blob → tree → commit → branch → pull).
 *
 * R-N9: external git surface is PR-only; there is no `external-commit` deliverable type.
 * This helper is the sole write path for skills whose meta.json declares
 * `"deliverable": { "type": "external-pr" }`.
 *
 * Credentials come from the caller's sealed credential bag (`input.github`);
 * this function never reads Secrets Manager itself.
 */
export async function openExternalPr(
  input: OpenExternalPrInput,
): Promise<OpenExternalPrResult> {
  // 0. Resolve project → github_owner + github_repo from DynamoDB
  const project = await getProject(asProjectId(input.project_id));
  if (!project) {
    throw new Error(
      `external-pr: project "${input.project_id}" not found in DynamoDB`,
    );
  }
  const { github_owner: owner, github_repo: repo } = project;
  if (!owner || !repo) {
    throw new Error(
      `external-pr: project "${input.project_id}" is missing github_owner or github_repo. ` +
        `Set them via agents-api before using the external-pr deliverable type.`,
    );
  }

  const h = ghHeaders(input.github.token);
  const branch = externalPrBranchName(input.agent_slug, input.run_id);

  // Step 1: GET /repos/{owner}/{repo} → default_branch
  const repoRes = await fetch(`${GH_API}/repos/${owner}/${repo}`, {
    headers: h,
  });
  if (!repoRes.ok) await throwGhError("get-repo", repoRes);
  const { default_branch: defaultBranch } =
    (await repoRes.json()) as { default_branch: string };

  // Step 2: GET /repos/{owner}/{repo}/git/refs/heads/{default_branch} → tip commit SHA
  const refRes = await fetch(
    `${GH_API}/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(defaultBranch)}`,
    { headers: h },
  );
  if (!refRes.ok) await throwGhError("get-ref", refRes);
  const {
    object: { sha: tipSha },
  } = (await refRes.json()) as { object: { sha: string } };

  // Step 3: GET /repos/{owner}/{repo}/git/commits/{sha} → base tree SHA
  const tipCommitRes = await fetch(
    `${GH_API}/repos/${owner}/${repo}/git/commits/${tipSha}`,
    { headers: h },
  );
  if (!tipCommitRes.ok) await throwGhError("get-tip-commit", tipCommitRes);
  const {
    tree: { sha: baseTreeSha },
  } = (await tipCommitRes.json()) as { tree: { sha: string } };

  // Step 4: POST /repos/{owner}/{repo}/git/blobs → blob SHA
  const blobRes = await fetch(
    `${GH_API}/repos/${owner}/${repo}/git/blobs`,
    {
      method: "POST",
      headers: h,
      body: JSON.stringify({ content: input.body, encoding: "utf-8" }),
    },
  );
  if (!blobRes.ok) await throwGhError("create-blob", blobRes);
  const { sha: blobSha } = (await blobRes.json()) as { sha: string };

  // Step 5: POST /repos/{owner}/{repo}/git/trees → new tree SHA
  const treeRes = await fetch(
    `${GH_API}/repos/${owner}/${repo}/git/trees`,
    {
      method: "POST",
      headers: h,
      body: JSON.stringify({
        base_tree: baseTreeSha,
        tree: [
          {
            path: input.path,
            mode: "100644",
            type: "blob",
            sha: blobSha,
          },
        ],
      }),
    },
  );
  if (!treeRes.ok) await throwGhError("create-tree", treeRes);
  const { sha: newTreeSha } = (await treeRes.json()) as { sha: string };

  // Step 6: POST /repos/{owner}/{repo}/git/commits → new commit SHA
  const prBody = buildPrBody(input);
  const commitMessage =
    `${input.skill_name}: add ${input.path}\n\n` +
    `Agent: ${input.agent_slug} | Run: ${input.run_id} | Project: ${input.project_id}`;
  const newCommitRes = await fetch(
    `${GH_API}/repos/${owner}/${repo}/git/commits`,
    {
      method: "POST",
      headers: h,
      body: JSON.stringify({
        message: commitMessage,
        tree: newTreeSha,
        parents: [tipSha],
      }),
    },
  );
  if (!newCommitRes.ok) await throwGhError("create-commit", newCommitRes);
  const { sha: newCommitSha } = (await newCommitRes.json()) as {
    sha: string;
  };

  // Step 7: POST /repos/{owner}/{repo}/git/refs → create branch pointing at new commit
  const refCreateRes = await fetch(
    `${GH_API}/repos/${owner}/${repo}/git/refs`,
    {
      method: "POST",
      headers: h,
      body: JSON.stringify({
        ref: `refs/heads/${branch}`,
        sha: newCommitSha,
      }),
    },
  );
  if (!refCreateRes.ok) await throwGhError("create-branch-ref", refCreateRes);

  // Step 8: POST /repos/{owner}/{repo}/pulls → PR URL + number
  const prTitle = `[${input.agent_slug}/${input.skill_name}] ${input.path}`;
  const prRes = await fetch(
    `${GH_API}/repos/${owner}/${repo}/pulls`,
    {
      method: "POST",
      headers: h,
      body: JSON.stringify({
        title: prTitle,
        body: prBody,
        head: branch,
        base: defaultBranch,
        draft: true,
      }),
    },
  );
  if (!prRes.ok) await throwGhError("create-pr", prRes);
  const { number: prNumber, html_url: prUrl } = (await prRes.json()) as {
    number: number;
    html_url: string;
  };

  return { pr_url: prUrl, pr_number: prNumber, branch_name: branch };
}

/**
 * Deterministic branch name for an agent's CCR run on an external repo.
 * Pattern: `workforce/{agent_slug}/{run_id}`
 * Guaranteed to be unique per run (run_id is a UUID/ULID assigned by the orchestrator).
 */
export function externalPrBranchName(
  agent_slug: string,
  run_id: string,
): string {
  return `workforce/${agent_slug}/${run_id}`;
}
