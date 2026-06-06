// external-pr.ts — Phase 7 PR6 scaffold for R-N9 mechanical enforcement.
//
// Opens a Pull Request against an external project's target repo when
// an llm-prose skill produces a `deliverable.type === "external-pr"`
// output. The mechanical R-N9 gate ("external git surface is PR-only,
// never direct commit") is the `DeliverableType` enum itself
// (workforce/lambdas/shared/skill.ts) — `external-commit` deliberately
// doesn't exist, so a skill CANNOT declare "I will push directly to
// the external repo's default branch". That schema-level gate is the
// load-bearing R-N9 enforcement; THIS file is the execution surface
// that turns the declaration into an actual PR open.
//
// Scope of PR6 (this commit):
// ---------------------------
//
//   - Interface defined: `openExternalPr(input)` signature, input
//     shape, return shape (PR URL + PR number + branch name).
//   - `NotImplementedError` thrown at runtime if a skill actually
//     declares `external-pr` and the runner dispatches here. The
//     intent: land the SCHEMA gate now (preventing future `external-
//     commit` skills from being authored), wire the EXECUTION when a
//     real consumer arrives.
//
// What a follow-up PR needs to add
// --------------------------------
//
// The git-data REST sequence — five sequential GitHub REST calls to
// land a single PR programmatically:
//
//   1. GET /repos/{owner}/{repo} — read default_branch.
//   2. GET /repos/{owner}/{repo}/git/refs/heads/{default_branch} — get
//      the SHA of the default branch's tip.
//   3. POST /repos/{owner}/{repo}/git/blobs — upload the body as a
//      blob; returns blob SHA.
//   4. POST /repos/{owner}/{repo}/git/trees — create a tree referencing
//      the blob at the deliverable's intended path. Tree SHA returned.
//   5. POST /repos/{owner}/{repo}/git/commits — create a commit from
//      the tree, parented on the default-branch tip SHA.
//   6. POST /repos/{owner}/{repo}/git/refs — create the branch ref
//      `refs/heads/workforce/{agent_slug}/{run_id}`, pointing at the
//      new commit.
//   7. POST /repos/{owner}/{repo}/pulls — open the PR from the new
//      branch to the default branch. The PR body cites (agent, skill,
//      run_id).
//
// Branch namespace `workforce/{agent_slug}/{run_id}` is the contract
// per the ROADMAP PR6 entry — external maintainers can install
// branch-protection rules that exclude this namespace from their CI
// gates without affecting their own branches.
//
// Auth: per-project `github.token` PAT, scoped to `Pull requests:write`
// + `Contents:write` on the workforce-prefixed branch namespace only.
// The runner injects the credential via the sealed bag (Story 2-A);
// this file accepts it as a function argument so the trust boundary
// stays at the runner seam.

import type { GithubSecret } from "./secrets.js";

/**
 * Open a PR against the external project's target repo. Inputs:
 *
 *   project_id   resolved Epic-010 project id; used downstream to read
 *                PROJECT#{id}/META.github (owner/repo) at execution
 *                time. The caller (agent-runner) has already validated
 *                membership.
 *   agent_slug   author attribution — surfaces in the PR body.
 *   skill_name   what the skill is; surfaces in the PR body.
 *   run_id       audit handle; combined with agent_slug to form the
 *                branch name `workforce/{agent_slug}/{run_id}` so the
 *                PR ↔ ledger row mapping is deterministic from either
 *                side.
 *   path         destination path inside the external repo (e.g.
 *                `docs/research/2026-06-06-market-summary.md`). The
 *                skill author declares this on the skill's deliverable
 *                metadata; runtime substitution lives in the future
 *                wiring step.
 *   body         deliverable bytes (UTF-8 markdown today; binary blobs
 *                accepted via Uint8Array overload — future scope).
 *   github       the per-project PAT, injected by the runner from the
 *                sealed credential bag.
 *
 * Returns: `{pr_url, pr_number, branch_name}` for the audit row.
 */
export interface OpenExternalPrInput {
  project_id: string;
  agent_slug: string;
  skill_name: string;
  run_id: string;
  path: string;
  body: string;
  github: GithubSecret;
}

export interface OpenExternalPrResult {
  /** Full https://github.com/owner/repo/pull/N URL. */
  pr_url: string;
  /** Numeric PR number. */
  pr_number: number;
  /** `workforce/{agent_slug}/{run_id}` — the branch name we created. */
  branch_name: string;
}

/** Thrown when a skill declares `external-pr` but the helper isn't
 *  wired yet. Phase 7 PR6 lands the schema gate + scaffold; the git-
 *  data REST sequence is a follow-up when a real consumer arrives.
 *  Surfaces as W-4 fail-loud — better than a silent no-op. */
export class ExternalPrNotImplementedError extends Error {
  constructor(input: OpenExternalPrInput) {
    super(
      `external-pr deliverable execution is not yet wired (Phase 7 PR6 scaffold). ` +
        `Caller: agent=${input.agent_slug}, skill=${input.skill_name}, project=${input.project_id}, ` +
        `run_id=${input.run_id}. The R-N9 schema gate is enforced (no external-commit type exists); ` +
        `the helper that actually opens the PR via GitHub's git-data REST API lands in a follow-up.`,
    );
    this.name = "ExternalPrNotImplementedError";
  }
}

export async function openExternalPr(
  input: OpenExternalPrInput,
): Promise<OpenExternalPrResult> {
  // Scaffold: throw rather than silently no-op. Skills that declare
  // external-pr today will fail-loud at runtime, which is the correct
  // signal that the wiring is incomplete — better than producing an
  // engagement record that references a PR that doesn't exist.
  throw new ExternalPrNotImplementedError(input);
}

// --- branch-name helper (testable + reused by the future wiring) ---------

/**
 * Compute the branch name a workforce agent will push to in an
 * external repo. Pinned to `workforce/{agent_slug}/{run_id}` so the
 * external maintainer's branch-protection rules can scope cleanly
 * with a single `workforce/*` prefix match.
 *
 * Exported separately so future wiring + tests can verify the
 * exact-string contract without exercising the full REST sequence.
 */
export function externalPrBranchName(
  agent_slug: string,
  run_id: string,
): string {
  return `workforce/${agent_slug}/${run_id}`;
}
