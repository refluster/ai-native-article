---
name: outsource-to-workforce
description: >-
  Reproducibly outsource a unit of work to the external agent-workforce
  (workforce-api.kohuehara.xyz) via a 4-step flow: define the work → pick fitting
  agents → assign & execute → register engagements (track-record). Use this
  whenever the user wants to hand work to the agent workforce or its agents —
  triggers include "outsource", "エージェントに外注", "ワークフォースに投げて",
  "PRレビューを依頼", "route this PR to reviewer agents", "register an engagement",
  or naming a workforce agent (nadia/ren/dario/farah/aoi/…) for a task. Trigger
  even if the user doesn't say "outsource" but clearly wants workforce agents to
  review/handle something or wants their engagement/track-record recorded. New
  task types are added as profiles, not new skills — so reach for this for any
  workforce outsourcing, not only PR review.
---

# Outsource to Agent Workforce

A reproducible, operator-side workflow for handing a unit of work to the external
agent-workforce and recording each agent's track-record. One **foundation**
workflow, parameterized by a **profile** (the task type). Ships with the
`pr-review` profile; add new task types by adding `profiles/<name>.md`, never a
new skill.

## Execution model — be honest about this (read first)

This is **operator-orchestrated**, not autonomous delegation. Today the workforce
has only `nadia`/`pr-autopilot` bound as an executable PR skill, and it is
**comment-only routing** — no `pr-review`/verdict/fix executor is bound yet. So
**you (the operator/Claude) generate the per-lens reviews and post them**; the
agents do not autonomously run. Reflect this truthfully:
- routing/review comments say they are operator-orchestrated;
- engagement `summary` describes the real work (the API forces
  `execution_surface=client` regardless).

Never imply an agent ran by itself. When real `pr-review` executors get bound,
revisit step #3 to dispatch them instead of simulating.

## Governance (inviolable — L0)

- **C-3 never self-merge.** You may open/route/review/fix and hand off, but never
  `gh pr merge`. The merge is the human's act.
- **C-4 no decrypted-secret reads without approval.** The Bearer token is
  provisioned by the operator into `.env`; read it from there, **never** run
  `aws secretsmanager get-secret-value` yourself without explicit approval, and
  **never print a token value**.
- Outward writes (PR comments, engagement POSTs) are in-scope for the requested
  task. Anything beyond the asked scope: confirm first.

## Inputs

- **project_id** — the client project / workforce project (e.g. `asp-cloud`).
- **target** — the work item (a PR number/URL for `pr-review`).
- **profile** — task type; inferred when obvious (a PR → `pr-review`).

If the matching profile doesn't exist yet, say so and offer to add one (it's a
data file, ~1 screen — see `profiles/pr-review.md` as the template).

## The 4 steps

### 1 · Define the work + expected deliverables
State plainly: what is being outsourced, the scope split (the lenses/dimensions),
and the Definition of Done (per-lens verdict + findings tied to `file:line`, any
required fixes, and a clear merge/hold recommendation for the human). Keep it to
a short spec — this is the contract the engagement summaries will be checked
against.

### 2 · Pick fitting agent(s)
- Pull the **live roster** (`GET /agents`, paginate via `cursor`; fetch
  `GET /agents/{slug}` directly for agents in non-default streams, e.g. `dario`).
  Helper snippet in `references/workforce-api.md`.
- Apply the profile's **lens → persona map** and **scan the target surface**
  (e.g. `gh pr diff`): a lens with no surface is **skipped, not nominated for
  completeness** — and say why.
- Respect roster state: if a persona is `paused`/`archived` (or chronic
  `last_run_status: throw`), fall back to that lens's skill owner or skip with a
  note. Don't pick an agent that can't do the lens.

### 3 · Assign & execute (operator-orchestrated)
Follow the profile's **deliverable** section. For `pr-review` that is, in order:
a routing/pickup comment (dedup against any `pr-autopilot` comment <7d), one review
comment per nominated lens (real findings in that persona's voice), and one
operator-response comment per lens (`accepted, fixed in <sha>` / `deferred` /
`recorded`) — **applying the agreed fixes as a commit**. The reviews must be
genuine critique of the actual diff, not flattery.

### 4 · Register engagements (track-record)
For each agent that did work, run the bundled script (it encodes the token read,
`skill_version` auto-fill, dedup guard, and 401 hinting — and never prints the
token):

```bash
python3 scripts/register_engagement.py \
  --slug ren --project-id asp-cloud --skill-name pr-review \
  --started-at 2026-06-13T16:34:00Z --ended-at 2026-06-13T16:48:00Z \
  --status ok --dedup-key "PR #507" \
  --summary "PR #507 engineering-lens review: … R1 fixed in b2f9c25; R2/R3 deferred. Verdict: approve."
```

Mechanics that bite (full detail in `references/workforce-api.md`): `skill_version`
is **required**; top-level `summary` is the deliverable text; records are
**append-only** (a re-post duplicates — the `--dedup-key` guard prevents silent
dupes; only `--allow-duplicate` on explicit instruction). A `401` means the
**wrong token** (engagement vs feed — each is scoped to one path), not a bad
payload.

## Profiles (how to extend)

`profiles/<name>.md` defines, for one task type: triggers, inputs, the
lens→persona map + surface-scan rule, the deliverable (where/what to post), and
the engagement `skill_name` per role. **To support a new kind of work (research,
design review, doc audit, …), add a profile file — do not add a skill.** The
foundation steps above stay identical. Start from `profiles/pr-review.md`.

## Reference
- `references/workforce-api.md` — endpoints, auth/token scoping, engagement field
  mechanics, roster snippet, and the `nadia`/`pr-autopilot` relationship. Read it
  before step #2 or #4 if any detail is unclear.

## Worked example
asp-cloud **PR #507** (SLI-1/SLI-2 standardization): nadia routing →
ren / dario / farah lens reviews → operator responses + fix commit `b2f9c25` →
4 engagements registered against `asp-cloud`. The design lens was skipped (no UX
surface). See `profiles/pr-review.md` for the blow-by-blow.
