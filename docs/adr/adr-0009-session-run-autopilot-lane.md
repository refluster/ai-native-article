# ADR-0009 — Session-run autopilot lane; the merge rule lives in one place

- **Status**: Proposed (Accepted when the operator merges the PR that adds it)
- **Date**: 2026-11-14
- **Deciders**: operator (direction 2026-11-14: "port the asp-cloud session lane; subtract obsolete rules first"), Claude Code session (draft), panel ren · dario · farah (PR #886)

## Context

A PR opened by a Claude Code session waits for the workforce `pr-autopilot`
cron tick (nadia × `agent-workforce`, `cron(23 0,6,12,18 ? * * *)`: up to 6 h)
before anyone reviews it. `PSVL/asp-cloud` removed that wait on 2026-11-13
(its `docs/adr_autopilot_pr_merge.md` §0.5): the session that opens a PR runs
the same lane on it at once and merges only through a gate that hands the
decision to the same fail-closed engine, `pr-merge.mjs`.

Porting it here runs into our own text, not into a missing mechanism. The
record since 2026-09-01, from `gh api -X GET search/issues` on 2026-11-14,
each query prefixed `repo:refluster/ai-native-article is:pr is:merged merged:>=2026-09-01`:

| Query suffix | PRs |
|---|---|
| *(none)* | 170 |
| `"cycle 1 of"` (routed by the lane) | 121 |
| `"Autopilot merge"` (merged by the engine) | 94 |
| `label:autopilot:needs-human` (merged after a hand-off) | 60 |
| … of which `label:autopilot:reason:l0l1-path` · `merge-engine-refusal` · `author-stale` · `not-mergeable` | 27 · 12 · 6 · 2 |

So agents already merge most PRs here, through one engine, under
[governance.md §4.4](../governance.md#44-autopilot-pr-merge--workforce-r-n10-delegation--l0l1-off-limits).
But four other texts still say an agent never merges, or restate a different
merge bar:

1. `governance.md` §8.1 B — "Merging any PR, including the agent's own. Agent never self-merges."
2. `AGENTS.md` Zone B — "one human review *unless* the diff is smaller than 30 lines".
   Nothing enforces it (no branch protection, approvals are never read), and
   §4.4 merged Zone B PRs without it.
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
  pointer to §4.4; its secret-read rule names the one exception below.

**Add only what the removals need.**

- **A1. The session-run lane.** A Claude Code session that opens a PR on this
  repo runs the `pr-autopilot` lane on it immediately: the project skill
  `.claude/skills/pr-autopilot-session`, started by the PostToolUse hook
  `scripts/claude/post-pr-create.mjs` (fires on `gh pr create` and on the
  GitHub MCP `create_pull_request`). It is the workforce `pr-autopilot` lane
  run under nadia's routing identity from a session; reviewers are isolated
  (one subagent per persona, ≥ 3).
- **A2. One merge gate.** `scripts/claude/autopilot-merge.mjs` is the only
  path by which a session merges. Gate and engine both run from `origin/main`
  (fetched into a throw-away repo), never from the PR branch. Before handing
  the decision to `pr-merge.mjs` the gate checks the two things the session
  lane needs and the engine does not:
  - **R-N10 clause 3**: the nadia × pr-autopilot × agent-workforce binding is
    armed (agents-api; paused, archived, missing or unreadable → refuse), so
    the workforce-side kill-switch stops both lanes;
  - **head-pinned panel**: each reviewer's latest review is 🟢 *on the current
    head commit*, so a push after a verdict always means a new cycle.
  After a merge it records the engagement (R-N10 clause 4) and stamps
  `autopilot:merged`.
- **A3. Credential.** The gate reads the workforce's project PAT
  (`wf/projects/agent-workforce/github.token`, the secret the cron lane is
  already injected with) from AWS Secrets Manager, passes it to its children
  by environment only, and never prints it. On merge of this ADR that read is
  a standing operator approval for that one secret and that one use; AGENTS.md
  rule 8 names it.

**Unchanged.** The §4.4 predicate and its L0/L1 block, `autopilot:off`, the
cycle cap, and R-13's terminal-state sweep. Workforce R-N10 is unchanged in
text: the session lane meets its clauses with the same engine (clauses 1–2),
the binding check above (clause 3), and the merge comment, squash body and
engagement (clause 4).

**The L0/L1 block grows by the lane's own control surface**
(`.claude/settings.json`, `scripts/claude/**`, `scripts/lib/autopilot-session.mjs`,
`.claude/skills/pr-autopilot-session/**`), so the lane can never merge a change
to its own gate — the same reason §4.4 sits inside `docs/governance.md`.

Net: **4 removals, 3 additions.** The merge rule has one text (§4.4) and one
executor (`pr-merge.mjs`).

## Alternatives considered

- **Review in the session, leave the merge to the cron.** Keeps every old
  text, but the PR still waits up to 6 h for a merge the engine would make
  anyway, and the four contradictory copies stay.
- **Copy asp-cloud verbatim.** Its hook matches only `gh pr create`; in this
  repo's cloud sessions PRs are opened through the GitHub MCP, so it would
  never fire. Its gate reads the token from a local `gh` login that cloud
  sessions do not have, and it does not pin reviews to the head commit.
- **Amend workforce R-N10 to name a second consumer.** Not needed: the gate
  meets every clause mechanically, so R-N10's text stays as it is.
- **Tighten the L0/L1 block to cover all of Zone A** (it lacks DESIGN.md,
  GROWTH.md, `tailwind.config.ts`, `site.ts`, `index.css`, CODEOWNERS and
  `quality.ts`; and `pr-merge.mjs` itself). A real gap, but it adds holds to
  files this ADR does not create, so it gets its own decision.

## Consequences

- A non-L0/L1 PR opened from a session can merge within one CI run instead of
  up to 6 h later. L0/L1 PRs still end at the operator. Drafts are
  merge-eligible (workforce adr-0014): `autopilot:off` at creation keeps a PR
  for human review.
- **Separation of duties is weaker than in the cron lane.** The author session
  routes, seats the panel and posts the reviewers' markers. What remains is
  isolation of each reviewer's context and the engine's mechanical
  re-verification; the head pin stops a post-verdict push from riding on an
  old green.
- **The deny list is a convention, not a control.** `.claude/settings.json`
  denies the MCP merge, auto-merge and `gh pr merge`, but a session holding the
  PAT could still call the REST merge endpoint. The control is the gate plus
  the skill text, and the audit trail: every lane merge carries the engine's
  comment.
- **When the gate cannot run** (exit 1: no AWS access, agents-api or GitHub
  unreachable) the cron does *not* pick the PR up — it is already routed. The
  skill therefore labels it `autopilot:needs-human` +
  `autopilot:reason:merge-engine-refusal`, so it ends at the operator at once
  rather than after R-13's 48 h sweep.
- **Measurement.** Session-lane merges carry "session-run lane" in the engine
  comment; cron merges do not. The weekly count of
  `"Autopilot merge" "session-run lane"` against `"Autopilot merge"` and the
  open-to-merge time of each shows whether the lane delivers the latency it
  claims. If it does not within four weeks, remove the lane (rule: subtract).

## Related

- [governance.md §4.4](../governance.md#44-autopilot-pr-merge--workforce-r-n10-delegation--l0l1-off-limits), §8.1; [AGENTS.md](../../AGENTS.md) Zone B, rule 8
- workforce [governance.md R-N10](../../workforce/docs/governance.md), [adr-0011](../../workforce/docs/adr/adr-0011-own-repo-autopilot-merge.md), [adr-0014](../../workforce/docs/adr/adr-0014-drafts-are-merge-eligible.md)
- `PSVL/asp-cloud` `docs/adr_autopilot_pr_merge.md` §0.5 (the origin of the session-run lane)
