---
name: pr-autopilot
description: Drive every open PR in the bound project's repo to one of exactly two terminal states — MERGED (unanimous-green ≥3-reviewer consensus, no L0/L1 surface, via the fail-closed pr-merge.mjs engine) or ESCALATED to a human with the `autopilot:needs-human` label. Routes each PR to a ≥3-persona reviewer panel, posts every review + the synthesised verdict as PR comments, merges when the R-N10 predicate holds (drafts included), and hands off with the label when it doesn't. A deterministic sweep (pr-autopilot-sweep.mjs) escalates anything that stalls, so no PR is ever left in neither state. Runs as a CCR task (ADR-0005), fired on cron or a pull_request event (adr-0013); github.token via the binding's project linkage.
---

# pr-autopilot

**The two-outcome contract.** Every PR this cadence touches ends in exactly one
of two terminal states:

1. **MERGED** — the R-N10 predicate held and `pr-merge.mjs` merged it.
2. **ESCALATED** — a hand-off comment carrying the hidden marker
   `<!-- autopilot:needs-human -->` was posted via `pr-autopilot-post.mjs
   --needs-human`, which stamps the `autopilot:needs-human` label.

A run that leaves a PR in neither state is a bug, not a finished run. The
deterministic sweep (Step 6) enforces the contract mechanically even when a
run stalls. The one legitimate *interim* state is 🟡 (an open review cycle
awaiting the author's revision) — and it is bounded: a 🟡 PR untouched past the
sweep's stale threshold is escalated.

You are the routing persona (today Nadia's PdM lens). This runs as a **CCR
task** fired by `wf-orchestrator-tick` on the binding's cron, or — when the
binding declares a `github_event` trigger (adr-0013) — on a `pull_request`
event. The cadence is trigger-agnostic and idempotent: you **discover** which
PRs need work; already-routed PRs are skipped.

Your task context supplies:

- `agent_slug` — you (the routing persona).
- `project_id` — the bound project; its `workforce/projects/{project_id}/project.json`
  declares the GitHub repo.
- `credentials['github.token'].token` — the project-scoped PAT. Export as
  `GITHUB_TOKEN` for every script below.
- `binding_config` — your lens overlay: `nomination_rules`, `cycle_cap`,
  `skip_list_default`, `skip_list_rationale`, `sign_off_persona`.

**Scope: every open PR** — draft and non-draft, human- and bot-authored
(Dependabot) — routes through the same review → consensus → merge path
(adr-0010; drafts are merge-eligible per adr-0014). The reviewer-lens contract
in Step 4 is part of this skill (the former standalone `pr-review` skill was
retired and folded in; `dependabot-triage`'s no-review lane likewise).

## Step 1 — discover candidates (deterministic, read-only)

```sh
GITHUB_TOKEN="<credentials['github.token'].token>" \
  node workforce/skills/pr-autopilot/pr-autopilot-scan.mjs \
    --project "<project_id>" --persona "<agent_slug>" \
    --max 5 --since-days 7 --out /tmp/pr-autopilot-candidates.json
```

The scan lists every open PR updated within the window, skips PRs you already
routed, caps at `--max`, and writes each candidate (title, body, diff,
comments, `draft`/`is_bot` flags) to `--out`. **0 candidates → skip Steps 2–5,
but still run the Step 6 sweep.**

## Step 2 — route each candidate (your judgment)

For each candidate, apply your `binding_config.nomination_rules` to the diff +
body:

- Nominate **at least 3** reviewer personas (never 1 or 2 — the merge engine
  fails closed below `MIN_REVIEWERS=3`). Seat the lenses with the most real
  surface first, then fill to 3 with your standing broad lenses (product,
  engineering-excellence, platform). If you honestly cannot seat 3 distinct
  lenses, the PR is not autopilot-eligible: hand it off per Step 5 with
  `--needs-human`, stating why.
- Each nomination's `rationale` cites the PR surface (file paths / topics).
- List in `skipped` only personas you considered and rejected.
- **Epic PRs carry a VP-class reviewer.** When the diff touches the Epic /
  design-record path (for `agent-workforce`: `workforce/docs/epics/**`),
  nominate the product lens **plus** at least one VP-class persona, still
  seating the full ≥3 panel.

Write the routing comment for PR `<number>` to `/tmp/route-body-<number>.md`
using **exactly** this template (the opening line is the marker the scanner
and the cycle-cap counter read):

```md
**<PersonaName> — cycle 1 of ≤ <cycle_cap>.**

<one-paragraph PR summary>

Reviewers nominated (≥ 3):

- **`wf:<persona>`** — <rationale citing the PR surface>
- **`wf:<persona>`** — <rationale citing the PR surface>
- **`wf:<persona>`** — <rationale citing the PR surface>

Skipping `wf:<persona>` — <one short clause>.

**Cycle 1 of ≤ <cycle_cap>.** Reviewers post via `event=COMMENT` (never
approve / never request-changes per W-5). Author revises in a single commit
per cycle; the verdict comment synthesises.

— <PersonaName> (CCR persona; see workforce/skills/pr-autopilot/SKILL.md)
```

`<PersonaName>` is your `agent_slug` capitalised. Omit "Skipping …" if empty.

**Never `@`-mention a persona (ML-012).** Workforce persona slugs are **not**
GitHub accounts — a raw `@<slug>` in any posted body notifies whichever real
GitHub user owns that name (a routing comment's `@yuki` pinged the unrelated
github.com/yuki, operator report 2026-07-04). The canonical agent-reference
format everywhere you post — nominations, skip lines, review bodies, verdict
comments — is `wf:<slug>` wrapped in backticks (e.g. `wf:yuki`). This is
enforced mechanically: `pr-autopilot-post.mjs` refuses (exit 1) any body
containing a raw `@`-mention outside backticks/code fences, so wrap literal
`@…` tokens you must quote (scoped npm packages, decorators, emails in prose)
in backticks too.

## Step 3 — post each routing comment (deterministic)

```sh
GITHUB_TOKEN="…" node workforce/skills/pr-autopilot/pr-autopilot-post.mjs \
  --project "<project_id>" --pr <number> --body-file /tmp/route-body-<number>.md
```

`pr-autopilot-post.mjs` is comment+label-only — it has no code path that
approves, merges, or pushes (R-N9 / W-5). It also refuses a body carrying a
raw GitHub `@`-mention (ML-012): agents are `wf:<slug>`, never `@<slug>`.

## Step 4 — obtain each nominated review (drive the cycle; do not stall)

For **each** persona you nominated, apply that persona's review lens inline
and post it as that persona — a COMMENT review (`event=COMMENT`, never
approve / request-changes per W-5). Do not wait on any external dispatch.

**Reviewer-lens contract (per nominated persona):**

- **The lens** = that persona's voice + skill-judgment config (`lens_name`,
  `values`, `checklist_sections`, `escalation_triggers`,
  `bias_disclosure_template` on their `AGENT#{slug}` record). Scan the diff in
  that lens only; post only real findings (or an explicit "no findings from
  this lens").
- **Inline findings** lead with a finding-ID (`A1`), name the checklist
  section, cite `file:line`, suggest the fix concretely. Cycle-2+ comments
  cite the cycle-1 finding-ID or flag `[NEW]`.
- **Summary body**: verdict signal (🟢/🟡/🔴 from this lens) →
  section-by-section notes → sign-off
  `— {persona} (LLM persona; lens: {lens_name}; manual route via pr-autopilot)`
  → a mandatory bias-disclosure paragraph (it is an LLM persona; what it DID /
  did NOT do).
- **Green sign-off marker (machine-checkable).** A non-blocking lens (no 🔴)
  **must embed the exact hidden marker** `<!-- autopilot:review:{slug}:green -->`.
  This is the only signal the merge engine accepts as that reviewer's green
  vote. A blocking reviewer omits it. No marker ⇒ not green ⇒ no merge.
- **Escalation instead of review**: if the PR matches the persona's
  `escalation_triggers`, post a single comment naming the trigger — as a
  hand-off per Step 5 (`--needs-human` + the hidden marker), not a checklist
  run.

## Step 5 — verdict by reviewer consensus → terminal action

Synthesise the reviewers' **collective** verdict (never your solo call):

- **🟢 unanimous-green** — every nominated reviewer non-blocking.
- **🟡** — one or more reviewers left an open blocking finding; the author is
  expected to revise; next tick re-routes (cycle += 1).
- **🔴** — any reviewer's veto, cycle > `cycle_cap`, or a scope question you
  cannot decide.

Write a verdict comment that names each reviewer's load-bearing finding and
the aggregated colour, then take the terminal action:

| Verdict | Condition | Action |
|---|---|---|
| 🟢 | no L0/L1 path + R-N10 delegation + predicate holds | **merge** via `pr-merge.mjs` (below) |
| 🟢 | touches the target's L0/L1 paths | hand off `--needs-human --reviewed` |
| 🟢 | no R-N10 delegation for this repo | hand off `--needs-human --reviewed` |
| 🟡 | author revision pending | verdict comment only (no label); the Step 6 sweep bounds this state |
| 🔴 / non-consensus / can't seat 3 / unreadable governance | any | hand off `--needs-human` (no `--reviewed`) |

**Every hand-off goes through `pr-autopilot-post.mjs`** — never a raw API
call, `gh`, or an MCP comment tool (those drop the label; ML-009). Compose the
verdict **into** this template so the markers are present by construction:

```md
**<PersonaName> — verdict, cycle <n> of ≤ <cycle_cap>. <🟢 escalate / 🔴 / hand-off>.**

<one-paragraph synthesis: each reviewer's load-bearing finding, the aggregated colour>

**Handing to the operator — <reason>.** Not merging. <If a DRAFT: "Still a draft — mark ready, then merge.">

— <PersonaName> (CCR persona; see workforce/skills/pr-autopilot/SKILL.md)

<!-- autopilot:needs-human -->
<!-- autopilot:reviewed -->   ⟵ keep this SECOND marker line ONLY on a 🟢 merge-ready hand-off; delete it on a 🔴 / non-consensus hand-off.
```

```sh
GITHUB_TOKEN="…" node workforce/skills/pr-autopilot/pr-autopilot-post.mjs \
  --project "<project_id>" --pr <number> --body-file /tmp/verdict-<number>.md \
  --needs-human [--reviewed]
```

`autopilot:reviewed` marks "reviewed to 🟢, merge-ready, held only by the
human gate" — the operator's merge-click queue
(`is:open label:autopilot:reviewed`). Never stamp it on a non-green hand-off.

### The merge leg (R-N10; one shared engine)

Emit a merge **only** when all hold: 🟢 unanimous-green; the bound project's
target repo carries an **R-N10 delegation** in its own statute; the PR touches
**no L0/L1 path** declared between the `<!-- autopilot:l0l1-paths -->` markers
of the target's `docs/governance.md`; checks green; mergeable (state `clean`
or `draft` — a green draft is flipped Ready for Review then merged); no
`CHANGES_REQUESTED`. The workforce's own repo (`refluster/ai-native-article`)
is a normal delegated target (adr-0011) — **authorship is not a hold**: a
green, non-L0/L1 PR merges regardless of who opened it; the panel is the
author≠merger separation (FU-028).

Build the decisions payload (schema in the script header) with `reviewers[]` =
the ≥3 nominated personas whose green markers you verified, then:

```sh
TOKEN="…" node workforce/skills/pr-autopilot/pr-merge.mjs \
  --repo "<owner>/<repo>" --decisions /tmp/pr-merge-decisions.json
```

`pr-merge.mjs` re-verifies the full predicate server-side and **fails
closed** — an unreadable/markerless target governance doc, a missing green
marker, a sub-3 panel, an `autopilot:off` label, or cycle > 7 all refuse the
merge. A mis-judged 🟢 cannot cause a bad merge.

**A refusal is a hand-off, not a no-op.** If `pr-merge.mjs` exits `2` (any
decision refused server-side or a GitHub write rejected), do not retry blindly
and do not stop: post the verdict for the affected PR again via
`pr-autopilot-post.mjs --needs-human`, quoting the engine's refusal reason.
The run still ends in one of the two terminal states.

## Step 6 — terminal-state sweep (deterministic; run every fire)

```sh
GITHUB_TOKEN="…" node workforce/skills/pr-autopilot/pr-autopilot-sweep.mjs \
  --project "<project_id>" --apply
```

The sweep enforces the two-outcome contract mechanically. It escalates (label
+ hand-off comment) any open PR that is in **neither** terminal state:

- **unlabelled-handoff** — a hand-off marker exists but the label was dropped
  (a session-driven escalation that bypassed the stamper; ML-009).
- **stale-routed** — routed, but no terminal state after `--stale-hours`
  (default 48) without an update — a stalled run or an abandoned 🟡.
- **never-routed** — never picked up and now older than the scan's discovery
  window (default 7 days), so the cadence would never see it again.

PRs labelled `autopilot:off` (maintainer pause) or already labelled
`autopilot:needs-human` are never touched. Run it even when Step 1 found 0
candidates — the sweep is how the contract survives runs that die mid-cycle.

## Scope (this skill)

- **Drive the whole cycle**: route → review → verdict → **merge or escalate**.
  Stopping at a routing comment or a bare 🟢 verdict is an incomplete run.
- **The verdict is the panel's consensus** (≥3 distinct reviewers; the engine
  fails closed below 3).
- **Merge is bounded to non-L0/L1 + consensus + delegation** (R-N10). A PR on
  the target's governance L0/L1 always escalates to a human. No push or
  PR-open under any path.
- **The sweep is part of every fire.** No PR is left in neither state.

Related: [agent-runner.md](../../docs/routines/agent-runner.md) (the generic
CCR routine this runs under — this SKILL.md is the authoritative contract),
R-N10 in [workforce governance](../../docs/governance.md) + adr-0010/0011/0013/0014/0015
(the merge predicate's decision trail), [dev-process.md](../../docs/runbooks/dev-process.md).
