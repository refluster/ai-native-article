---
name: pr-review
description: Workforce skill that applies the invoking persona's lens to a target-repo PR and posts an inline + summary review (event=COMMENT only, per W-5). Persona-agnostic — Dario's architecture lens, Ren's engineering lens, Aoi's design lens, and Nadia's product lens all overlay the same generic handler via the binding's `config.checklist_sections`. Lambda-resident; project-scoped credentials per Epic-010 §5. Verdict synthesis (the 🟢/🟡/🔴 leg of the pr-autopilot contract) is in pr-autopilot's verdict mode, not here.
---

# pr-review

Lambda-resident implementation of the reviewer leg of the persona-agnostic [pr-review routine spec](../../docs/routines/pr-review.md). One generic handler, persona-specific lens via binding `config`. Sister skill to [pr-autopilot](../pr-autopilot/SKILL.md) — that one decides who reviews, this one IS the review.

## Bundle layout

```
workforce/skills/pr-review/
  SKILL.md      ← this file (Anthropic Agent Skills frontmatter compatible)
  meta.json     ← executor: deterministic, requires: ["github.token"]
  handler.ts    ← dispatchPrReview(ctx) — auto-registered into skill-registry-generated.ts
```

## What the runner does

When an agent binding `{skill: "pr-review", executor: "lambda", trigger: {scheduler: "manual" | "external"}}` fires, the runner:

1. Resolves `project_id` from `RunnerEvent.project_id` (defaults to `self/{agent}` — pr-review on `self` rejects in the handler).
2. Resolves credentials for `requires: ["github.token"]` from `wf/projects/{project_id}/github.token` via the sealed credential bag.
3. Forwards `RunnerEvent.args` (e.g. `{pr_url: "https://github.com/.../pull/42"}`) into `RunnerContext.args`.
4. Forwards `agent.json:bindings[i].config` (lens-specific `lens_name`, `values`, `checklist_sections`, `bias_disclosure_template`) into `RunnerContext.binding_config`.
5. Calls `dispatchPrReview(ctx)` (this folder's handler.ts).

The handler then:

1. Parses `pr_url` → `(owner, repo, pr_number)`. Throws on malformed URL (W-4).
2. Cross-checks `(owner, repo)` against `PROJECT#{project_id}/META.github` — mismatch throws.
3. Fetches the PR + diff + existing comments via GitHub REST using `ctx.credentials["github.token"]`.
4. Composes an LLM prompt:
   - System = persona system.md + `binding_config.values` + `binding_config.checklist_sections` + `binding_config.bias_disclosure_template`.
   - User = PR title + body + diff (truncated) + existing comments + cycle context.
5. Calls `complete()` (Anthropic Sonnet 4.6) with a structured-JSON output contract — `{summary, inline_findings: [{file, line?, finding_id, lens_section, body}], sign_off}`.
6. Parses the JSON.
7. POSTs:
   - Each inline finding via `POST /repos/{o}/{r}/pulls/{N}/comments` (inline review comment).
   - The summary as the review body via `POST /repos/{o}/{r}/pulls/{N}/reviews` with `event: "COMMENT"`.
8. Returns `DeterministicResult` with `tokens_in/tokens_out/cost_usd` populated.

## Per W-5 — agents never gate merges

The review event is hardcoded to `COMMENT` — never `APPROVE`, never `REQUEST_CHANGES`. The operator (or any human reviewer) holds the merge gate. Per `pr-review.md` routine spec.

## Per R-N9 — no side effects on the target repo's branches

The review surface is **comments only**. The handler never opens PRs, pushes commits, or creates branches on the target repo. R-N9 is upheld by construction here: there is no code path to commit, only to comment.

## Invocation

```bash
aws lambda invoke --function-name wf-agent-runner-prod \
  --payload '{"agent":"dario","binding_idx":N,"project_id":"asp-cloud","args":{"pr_url":"https://github.com/PSVL/asp-cloud/pull/42"}}' \
  out.json
```

Tomorrow (Phase 7 PR5 webhook surface), pr-autopilot's verdict mode invokes this skill per-reviewer-persona after the routing comment lands.

## What this skill does NOT do

- **Verdict synthesis.** The 🟢/🟡/🔴 cycle-2-verdict comment is pr-autopilot's responsibility (verdict mode — a separate path in pr-autopilot's handler). This skill produces the per-persona review only.
- **Cycle counter management.** Scoping to cycle-1 vs cycle-2+ findings is the routine spec's pr-review.md responsibility; the handler's cycle-detection lifts the count from existing review comments authored by this persona.
- **Cross-persona coordination.** Each pr-review invocation is one persona's lens applied independently. The routing layer (pr-autopilot) decides which lenses run.

Related: [pr-review.md](../../docs/routines/pr-review.md), [pr-autopilot SKILL.md](../pr-autopilot/SKILL.md) (sister skill — routing + verdict + merge live there; it has no per-skill routine doc).
