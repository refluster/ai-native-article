---
name: pr-route
description: Workforce skill that routes a target-repo PR to 1-3 reviewer personas under the invoking agent's lens (today Nadia's PdM lens). Reads the PR + linked Story, applies the invoker's `binding_config.nomination_rules` to decide reviewers, and posts a single routing comment to the PR. Lambda-resident; project-scoped credentials per Epic-010 §5. Verdict mode (the second leg of the pr-route contract documented in workforce/docs/routines/pr-route.md) lands in Phase 7 PR3b.
---

# pr-route

Lambda-resident implementation of the routing leg of the persona-agnostic [pr-route routine spec](../../docs/routines/pr-route.md). The full skill contract (modes, mode-decision logic, comment shapes) lives in that doc; this folder is the **deterministic-executor handler** that the workforce agent-runner dispatches on a binding firing.

## Bundle layout

```
workforce/skills/pr-route/
  SKILL.md      ← this file (Anthropic Agent Skills frontmatter compatible)
  meta.json     ← executor: deterministic, requires: ["github.token"]
  handler.ts    ← dispatchPrRoute(ctx) — auto-registered into skill-registry-generated.ts
```

## What the runner does

When an agent binding `{skill: "pr-route", executor: "lambda", trigger: {scheduler: "manual" | "external"}}` fires, the runner:

1. Resolves `project_id` from `RunnerEvent.project_id` (defaults to `self/{agent}` — pr-route on `self` rejects in the handler with a "needs explicit external project" error).
2. Resolves credentials for `requires: ["github.token"]` from `wf/projects/{project_id}/github.token` via the sealed credential bag (Epic-010 §5 + Story 2-A).
3. Forwards `RunnerEvent.args` (e.g. `{pr_url: "https://github.com/.../pull/42"}`) into `RunnerContext.args`.
4. Forwards `agent.json:bindings[i].config` (lens-specific `nomination_rules`, `cycle_cap`, `sign_off_persona`) into `RunnerContext.binding_config`.
5. Calls `dispatchPrRoute(ctx)` (this folder's handler.ts).

The handler then:

1. Parses `pr_url` → `(owner, repo, pr_number)`. Throws on malformed URL (W-4 fail loud).
2. Cross-checks `(owner, repo)` against `PROJECT#{project_id}/META.github` — mismatch throws (operator mis-attributed the PR to the wrong project).
3. Fetches the PR + diff + existing comments via GitHub REST using `ctx.credentials.github.token`.
4. Composes an LLM prompt:
   - System = persona system.md + `binding_config.nomination_rules` + `binding_config.cycle_cap` + the lens summary.
   - User = PR title + body + diff (truncated to the model's budget) + existing routing-comment count (for cycle detection — cycle 1 initially in PR3a; cycle N+1 detection in PR3b).
5. Calls `complete()` with a structured-output JSON expectation.
6. Parses the JSON → `{summary, reviewers: [{persona, lens, rationale}], skipped: [...], skip_rationale}`.
7. POSTs the routing comment via GitHub REST `POST /repos/{owner}/{repo}/issues/{pr}/comments` using the same `github.token`.
8. Returns a `DeterministicResult` with `tokens_in / tokens_out / cost_usd` populated (the runner writes them to the RUN row + the next pre-flight budget check).

Per [governance §4 R-N9](../../docs/governance.md#4-r-n-design-rules-basic-design-simplicity) (external git surface is PR-only): this skill only **comments** on PRs — it never opens / merges / pushes. W-5 inheritance — agents never gate merges.

## Invocation

Today (PR3a):
```bash
aws lambda invoke --function-name wf-agent-runner-prod \
  --payload '{"agent":"nadia","binding_idx":1,"project_id":"asp-cloud","args":{"pr_url":"https://github.com/PSVL/asp-cloud/pull/42"}}' \
  out.json
```

Tomorrow (Phase 7 PR5): the `wf-webhook-{stage}` API GW endpoint receives the target repo's `pull_request.opened` webhook, reverse-maps `(owner, repo) → project_id`, enqueues the invocation, and async-invokes the runner with the same payload shape.

## What this skill does NOT do (yet)

- **Verdict mode.** The second leg of the pr-route contract — read each reviewer's review against cycle-1 findings, compute 🟢/🟡/🔴 — lands in Phase 7 PR3b alongside the pr-review skill.
- **Cycle counting beyond cycle 1.** PR3a posts a cycle-1 routing comment unconditionally. PR3b adds the comment-history scan that increments the counter on revise pushes.
- **Verbose Story / Epic context.** The handler does fetch the linked Story body (`closes #N` parse) but doesn't follow the Story → parent Epic chain. PR3b adds full Story+Epic grounding.

Related: [pr-review.md](../../docs/routines/pr-review.md), [pr-route.md](../../docs/routines/pr-route.md), [dev-process.md](../../docs/runbooks/dev-process.md).
