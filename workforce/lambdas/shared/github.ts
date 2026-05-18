// GitHub REST API wrapper for Ren's R-N1 exception path.
//
// Two operations:
//   - dispatchEngineer(...)   POST /repos/{o}/{r}/actions/workflows/{w}/dispatches
//   - findRecentPRs(...)      GET  /repos/{o}/{r}/pulls?state=all  (client-side filter)
//
// Auth comes from wf/github (PAT or GitHub App installation token) in
// Secrets Manager. Both endpoints are rate-limited (5000/h for PAT); v1
// polling is ~12 calls/h per stage so headroom is huge.

import { getSecret, type GithubSecret } from "./secrets.js";

const GITHUB_API = "https://api.github.com";

export interface DispatchEngineerInput {
  owner: string;
  repo: string;
  /** Workflow filename or numeric id (e.g. "wf-engineer.yml"). */
  workflow: string;
  /** Ref to dispatch from (usually the default branch). */
  ref: string;
  /** workflow_dispatch.inputs. GitHub limits each value to 65,536 chars. */
  inputs: Record<string, string>;
}

export async function dispatchEngineer(input: DispatchEngineerInput): Promise<void> {
  const { token } = await getSecret<GithubSecret>("wf/github");
  const url = `${GITHUB_API}/repos/${input.owner}/${input.repo}/actions/workflows/${encodeURIComponent(input.workflow)}/dispatches`;
  const res = await fetch(url, {
    method: "POST",
    headers: ghHeaders(token),
    body: JSON.stringify({ ref: input.ref, inputs: input.inputs }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`github workflow_dispatch ${res.status}: ${body.slice(0, 500)}`);
  }
  // 204 No Content on success.
}

export interface PrSummary {
  number: number;
  url: string;
  branch: string;
  state: "open" | "closed";
  draft: boolean;
  created_at: string;
}

/**
 * List PRs whose head branch starts with `branchPrefix` and which were
 * created at or after `sinceIso`. Pulls one page (30 most recent) — v1
 * scale fits comfortably.
 */
export async function findRecentPRs(
  owner: string,
  repo: string,
  branchPrefix: string,
  sinceIso: string,
): Promise<PrSummary[]> {
  const { token } = await getSecret<GithubSecret>("wf/github");
  const url = `${GITHUB_API}/repos/${owner}/${repo}/pulls?state=all&sort=created&direction=desc&per_page=30`;
  const res = await fetch(url, { headers: ghHeaders(token) });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`github list-PRs ${res.status}: ${body.slice(0, 500)}`);
  }
  const data = (await res.json()) as Array<{
    number: number;
    html_url: string;
    head: { ref: string };
    state: "open" | "closed";
    draft: boolean;
    created_at: string;
  }>;
  const since = Date.parse(sinceIso);
  return data
    .filter((p) => p.head.ref.startsWith(branchPrefix))
    .filter((p) => Date.parse(p.created_at) >= since)
    .map((p) => ({
      number: p.number,
      url: p.html_url,
      branch: p.head.ref,
      state: p.state,
      draft: p.draft,
      created_at: p.created_at,
    }));
}

function ghHeaders(token: string): Record<string, string> {
  return {
    "authorization": `Bearer ${token}`,
    "accept": "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "content-type": "application/json",
    "user-agent": "wf-workforce-orchestrator",
  };
}
