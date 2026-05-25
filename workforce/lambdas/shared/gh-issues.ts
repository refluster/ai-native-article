// GitHub REST API wrapper for issue-level operations used by Maya's
// pdm-decompose skill. Separate from the existing github.ts (which holds
// Ren's workflow_dispatch + PR-list paths) so the two consumers can
// evolve independently.
//
// Auth: wf/github (PAT or GitHub App installation token) — same secret
// as github.ts. All calls go through fetch — no octokit dependency, to
// keep the Lambda bundle thin.

import { getSecret, type GithubSecret } from "./secrets.js";

const GITHUB_API = "https://api.github.com";

export interface GithubIssue {
  number: number;
  node_id: string;
  title: string;
  body: string | null;
  state: "open" | "closed";
  html_url: string;
  user: { login: string };
  labels: Array<{ name: string }>;
  pull_request?: unknown; // present when the issue is actually a PR
}

export interface GithubComment {
  id: number;
  node_id: string;
  body: string;
  html_url: string;
  user: { login: string };
  created_at: string;
}

export interface Reaction {
  id: number;
  content: "+1" | "-1" | "laugh" | "confused" | "heart" | "hooray" | "rocket" | "eyes";
  user: { login: string };
}

async function ghFetch<T>(
  path: string,
  init?: { method?: string; body?: unknown; accept?: string },
): Promise<T> {
  const { token } = await getSecret<GithubSecret>("wf/github");
  const res = await fetch(`${GITHUB_API}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      authorization: `Bearer ${token}`,
      accept: init?.accept ?? "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "wf-pdm-decompose",
      ...(init?.body ? { "content-type": "application/json" } : {}),
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`github ${init?.method ?? "GET"} ${path} → ${res.status}: ${text.slice(0, 500)}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** List open issues in a repo. PRs are filtered out (we only want issues). */
export async function listOpenIssues(
  owner: string,
  repo: string,
  perPage = 100,
): Promise<GithubIssue[]> {
  const all: GithubIssue[] = [];
  let page = 1;
  // Paginate up to 5 pages (500 issues) — plenty for v1.
  for (let i = 0; i < 5; i++) {
    const items = await ghFetch<GithubIssue[]>(
      `/repos/${owner}/${repo}/issues?state=open&per_page=${perPage}&page=${page}`,
    );
    if (items.length === 0) break;
    all.push(...items.filter((it) => !it.pull_request));
    if (items.length < perPage) break;
    page++;
  }
  return all;
}

export async function getIssue(owner: string, repo: string, number: number): Promise<GithubIssue> {
  return ghFetch<GithubIssue>(`/repos/${owner}/${repo}/issues/${number}`);
}

export async function listIssueComments(
  owner: string,
  repo: string,
  number: number,
): Promise<GithubComment[]> {
  return ghFetch<GithubComment[]>(`/repos/${owner}/${repo}/issues/${number}/comments?per_page=100`);
}

export async function createIssueComment(
  owner: string,
  repo: string,
  number: number,
  body: string,
): Promise<GithubComment> {
  return ghFetch<GithubComment>(`/repos/${owner}/${repo}/issues/${number}/comments`, {
    method: "POST",
    body: { body },
  });
}

export async function listReactionsForComment(
  owner: string,
  repo: string,
  commentId: number,
): Promise<Reaction[]> {
  return ghFetch<Reaction[]>(
    `/repos/${owner}/${repo}/issues/comments/${commentId}/reactions?per_page=100`,
    { accept: "application/vnd.github.squirrel-girl-preview+json" },
  );
}

export interface CreateIssueInput {
  title: string;
  body: string;
  labels?: string[];
}

export async function createIssue(
  owner: string,
  repo: string,
  input: CreateIssueInput,
): Promise<GithubIssue> {
  return ghFetch<GithubIssue>(`/repos/${owner}/${repo}/issues`, {
    method: "POST",
    body: input,
  });
}

/** Add an issue as a sub-issue of another. Uses the newer REST endpoint. */
export async function addSubIssue(
  owner: string,
  repo: string,
  parentNumber: number,
  childIssueId: number,
): Promise<void> {
  await ghFetch<void>(`/repos/${owner}/${repo}/issues/${parentNumber}/sub_issues`, {
    method: "POST",
    body: { sub_issue_id: childIssueId },
  });
}

/** List sub-issues of a parent. Returns empty array when the parent has none. */
export async function listSubIssues(
  owner: string,
  repo: string,
  parentNumber: number,
): Promise<GithubIssue[]> {
  return ghFetch<GithubIssue[]>(
    `/repos/${owner}/${repo}/issues/${parentNumber}/sub_issues?per_page=100`,
  );
}
