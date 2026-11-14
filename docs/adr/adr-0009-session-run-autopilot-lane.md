# ADR-0009 — Session-run autopilot lane; the merge rule lives in one place

- **Status**: Proposed
- **Date**: 2026-11-14
- **Deciders**: operator (direction 2026-11-14: "port the asp-cloud session lane; subtract obsolete rules first"), Claude Code session (draft)

## Context

A PR opened by a Claude Code session waits for the workforce `pr-autopilot`
cron tick (nadia × `agent-workforce`, `cron(23 0,6,12,18 ? * * *)`: up to 6 h)
before anyone reviews it. `PSVL/asp-cloud` removed that wait on 2026-11-13
(its `docs/adr_autopilot_pr_merge.md` §0.5): the session that opens a PR runs
the same lane on it at once and merges only through a gate that hands the
decision to the same fail-closed engine, `pr-merge.mjs`.

Porting it here runs into our own text, not into a missing mechanism. The
record since 2026-09-01 (GitHub search, 2026-11-14):

| | PRs |
|---|---|
| merged | 170 |
| routed by the lane (`cycle 1 of`) | 121 |
| merged by the engine (`Autopilot merge` comment) | 94 |
| merged by the operator after `autopilot:needs-human` | 60 — of which `l0l1-path` 27, `merge-engine-refusal` 12, `author-stale` 6, `not-mergeable` 2 |

So agents already merge most PRs here, through one engine, under
[governance.md §4.4](../governance.md#44-autopilot-pr-merge--workforce-r-n10-delegation--l0l1-off-limits).
But four other texts still say an agent never merges, or restate a different
merge bar:

1. `governance.md` §8.1 B — "Merging any PR, including the agent's own. Agent never self-merges."
2. `AGENTS.md` Zone B — "one human review *unless* the diff is smaller than 30 lines".
   Nothing enforces it (no branch protection, approvals are never read), and
   §4.4 merged 94 Zone B PRs without it.
3. `CLAUDE.md` action authority — "merging any PR yourself" is B, plus a
   paragraph restating §4.4.
4. `.claude/skills/outsource-to-workforce` — "C-3 never self-merge … the merge
   is the human's act". C-3 is the single-operator-scale invariant; the label
   is wrong as well as the rule.

None of these copies has ever stopped a merge the engine would have made; they
only make the session lane look illegal and make every reader reconcile five
texts.

## Decision

**Subtract first.**

- **R1.** §8.1 B "Merging any PR … Agent never self-merges" is removed. §8.1
  now points to §4.4: a merge that satisfies §4.4 through its engine is A; any
  other merge is B.
- **R2.** The AGENTS.md Zone B "one human review unless < 30 lines" bar is
  removed; Zone B merges per §4.4.
- **R3.** CLAUDE.md's restatement is reduced to one pointer to §4.4.
- **R4.** The outsource-to-workforce "C-3 never self-merge" line becomes a
  pointer to §4.4; its secret-read rule names the one standing exception below.

**Add only what the removals need.**

- **A1. The session-run lane.** A Claude Code session that opens a PR on this
  repo runs the `pr-autopilot` lane on it immediately: the project skill
  `.claude/skills/pr-autopilot-session`, started by the PostToolUse hook
  `scripts/claude/post-pr-create.mjs` (fires on `gh pr create` and on the
  GitHub MCP `create_pull_request`). Reviewers are isolated (one subagent per
  persona, ≥ 3). The cron lane skips a PR the session already routed (its
  `**Nadia — cycle N of` dedup), so one PR is driven by one lane.
- **A2. One merge gate.** `scripts/claude/autopilot-merge.mjs` is the only
  path by which a session merges. It runs `pr-merge.mjs` taken from
  `origin/main` (never from the PR branch), which re-verifies §4.4 against the
  live PR and refuses fail-closed. Direct merge tools
  (`mcp__github__merge_pull_request`, auto-merge, `gh pr merge`) are denied in
  `.claude/settings.json`.
- **A3. Credential.** The gate reads the workforce's project PAT
  (`wf/projects/agent-workforce/github.token`, the secret the cron lane is
  already injected with) from AWS Secrets Manager, passes it to the engine by
  environment only, and never prints it. This is a standing operator approval
  for that one secret and that one use.

**Unchanged.** The §4.4 predicate and its L0/L1 block, `autopilot:off`, the
cycle cap, R-13's terminal-state sweep, and workforce R-N10 (the session uses
the same engine and the same identity, so "one merge implementation" still holds).

Net: **4 removals, 3 additions**, and the merge rule now has one text (§4.4)
and one executor (`pr-merge.mjs`).

## Alternatives considered

- **Review in the session, leave the merge to the cron.** Keeps every old
  text, but the PR still waits up to 6 h for a merge the engine would make
  anyway, and the four contradictory copies stay.
- **Copy asp-cloud verbatim.** Its hook matches only `gh pr create`; in this
  repo's cloud sessions PRs are opened through the GitHub MCP, so it would
  never fire. Its gate reads the token from a local `gh` login that cloud
  sessions do not have.
- **Tighten the L0/L1 block to cover all of Zone A** (it lacks DESIGN.md,
  GROWTH.md, `tailwind.config.ts`, `site.ts`, `index.css`, CODEOWNERS and
  `quality.ts`). A real gap, but it adds holds, so it gets its own decision
  rather than riding on this one.

## Consequences

- A non-L0/L1 PR opened from a session can be merged within one CI run instead
  of up to 6 h later. L0/L1 PRs still end at the operator.
- Sessions need AWS read access to that one secret. Where they lack it the gate
  exits 1 with a one-line reason, and the cron lane picks the PR up as before.
- The engine's GitHub identity check (`CLAUDE_CODE_REMOTE`) applies, so session
  merges are attributed to the same workforce account as cron merges.

## Related

- [governance.md §4.4](../governance.md#44-autopilot-pr-merge--workforce-r-n10-delegation--l0l1-off-limits), §8.1
- workforce [governance.md R-N10](../../workforce/docs/governance.md), [adr-0011](../../workforce/docs/adr/adr-0011-own-repo-autopilot-merge.md)
- `PSVL/asp-cloud` `docs/adr_autopilot_pr_merge.md` §0.5 (the origin of the session-run lane)
