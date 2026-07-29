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

The scan lists every open PR updated within the window, caps at `--max`, and
writes each candidate (title, body, diff, comments, `draft`/`is_bot` flags) to
`--out`. **0 candidates → skip Steps 2–5, but still run the Step 6 sweep.**

A PR you already routed comes back **only when its head commit is newer than
your last routing comment** — i.e. the author pushed the revision a 🟡 verdict
asked for (Step 5). Each candidate carries the `cycle` to route it at: `1` for
a first pass, `N+1` for a re-route. Open your Step-2 comment with that number,
and apply your `binding_config.cycle_cap` to it — the scan only enforces the
W-4 hard cap (`--cycle-cap`, default 7), which is a process-breakdown line, not
a retry budget.

## Step 2 — route each candidate (your judgment)

For each candidate, apply your `binding_config.nomination_rules` to the diff +
body:

- Nominate **at least 3** reviewer personas (never 1 or 2 — the merge engine
  fails closed below `MIN_REVIEWERS=3`). Seat the lenses with the most real
  surface first, then fill to 3 with your standing broad lenses (product,
  engineering-excellence, platform). If you honestly cannot seat 3 distinct
  lenses, the PR is not autopilot-eligible: hand it off per Step 5 with
  `--needs-human --reason cannot-seat-panel`, stating why.
- **Nomination load cap (Epic-019 Story 2b — fairness + W-3).** A persona may
  hold at most **`NOMINATION_SEAT_CAP` (5)** concurrent open lens-review
  seats. The scan output carries `open_seat_counts` (one seat per open,
  non-terminal PR whose routing comment nominates that `wf:<slug>`) and
  `capped_personas`; run your candidate list through
  `applyNominationCap(candidates, open_seat_counts)` (exported from
  `pr-autopilot-scan.mjs`) and nominate only from its `eligible` remainder —
  a capped persona is replaced by another eligible lens, never squeezed in.
  If the cap leaves fewer than 3 seatable lenses, the PR is not routable this
  tick: hand it off per Step 5 with `--needs-human --reason
  cannot-seat-panel`, naming the capped personas.
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

**Run each nominated lens as its own read-only subagent, in parallel** — one
subagent per persona — then post each returned review as that persona: a
COMMENT review (`event=COMMENT`, never approve / request-changes per W-5). Do
not wait on any external dispatch. (`backlog-reconcile` fans out audit
subagents on this same CCR path, so this is a proven capability, not a
hypothesis.)

**Why subagents and not inline (#512).** Producing every lens inline, in your
own context, means each reviewer sees the diff's justification, your routing
comment's framing, and every earlier reviewer's findings. Lenses that share a
context do not converge independently — N of them agreeing is **one conclusion
stated N times** — yet the verdict comment presents convergence as the
strongest signal it has, and the operator merges on it. Observed on #510: four
inline lenses found a real blocking defect but *all four accepted the author's
framing of the change*, and none questioned its premise. Shared context catches
implementation defects and suppresses premise questions.

**Context isolation is the whole point — give each subagent exactly:**

- the **unified diff** and the PR title/body;
- that persona's **lens config** (fetched fresh from `GET /agents/{slug}`);
- the **cycle number**, and on a re-route, that persona's *own* prior findings
  (so `[NEW]` vs "cites the cycle-1 finding-ID" still works).

**Withhold:** your routing comment, your summary of the PR, any other lens's
output, and any opinion of yours about the change. If a lens needs repo context
it reads the repo itself. **Never seed a subagent with another lens's finding
to "check"** — that manufactures the agreement the verdict then reports as
evidence.

**Honest limit, and do not oversell it in the verdict.** Separate contexts
remove *anchoring*, not *correlated priors*: the same base model across N
subagents shares blind spots, so a defect class the model systematically misses
is missed N times. Isolation raises convergence from "no evidence" to "real but
correlated evidence" — never to independence in the sense a human panel means.

**Fallback.** If subagents are unavailable in this runtime, run the lenses
inline as before, but say so in the verdict (Step 5) so the operator discounts
convergence correctly. Silent inline production is the failure this step exists
to prevent.

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
  hand-off per Step 5 (`--needs-human --reason persona-escalation-trigger` +
  the hidden markers), not a checklist run.

## Step 5 — verdict by reviewer consensus → terminal action

Synthesise the reviewers' **collective** verdict (never your solo call):

- **🟢 unanimous-green** — every nominated reviewer non-blocking.
- **🟡** — one or more reviewers left an open blocking finding; the author is
  expected to revise; next tick re-routes (cycle += 1).
- **🔴** — any reviewer's veto, cycle > `cycle_cap`, or a scope question you
  cannot decide.

**Declare the panel's provenance — and know what the declaration is worth.**
Every verdict body must carry exactly one of these markers, appended by
`pr-autopilot-post.mjs --panel isolated|inline` (which refuses a verdict post
carrying neither, the same treatment the escalation-reason code gets):

```
<!-- autopilot:panel:isolated -->   lenses ran as isolated subagents
<!-- autopilot:panel:inline -->     lenses ran inline, in the router's context
```

**The marker is self-attested and is NOT proof of independence.** The router
chooses the mode and writes the marker; nothing downstream can contradict it.
The check is that the claim is *present, explicit and machine-readable* — never
that it is true. Enforcing presence stops the mode from going unstated; it does
not stop it from being stated falsely, and no reader should treat it as if it
did (`wf:rafael` R1 on #513, which is the honest reading of what this buys).
Real enforcement — a provenance artefact emitted by whatever spawns the
lenses, not by the router's prose — is tracked separately and is not in force.

Given that, weigh convergence like this in the synthesis:

- **isolated** → two lenses landing on the same line is real evidence, but
  correlated: one base model, shared priors. Say "converged independently" only
  alongside that limit, never bare.
- **inline** → say plainly that they shared a context, so agreement is one
  conclusion stated N times, not N readings. Do not report it as convergence.

**Disclose an author↔router collapse.** If the session running this panel also
authored the PR, say so in the verdict's first paragraph and discount the whole
panel accordingly — it is the strongest discount available, and the reviews
should be read as one session's self-critique wearing N lenses.

**This disclosure does not change what may be merged.** The merge leg's rule is
unchanged and stands as written: *authorship is not a hold* — a green,
non-L0/L1 PR merges regardless of who opened it, because the panel **is** the
author≠merger separation (adr-0011 / FU-028). Whether a collapsed panel should
also suspend the merge leg is a real question and a genuine change to delegated
merge authority — an L1 decision that belongs in a superseding ADR, not in this
step (`wf:dario` D1/D2 on #513). Until such an ADR lands, disclose and proceed
under the existing predicate.

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

<panel-provenance sentence: isolated (real but correlated evidence) or inline (shared context — not convergence); plus an author↔router collapse disclosure if it applies. The marker below is what the post script enforces; this sentence is its prose.>

**Handing to the operator — <reason>.** Not merging. <If a DRAFT: "Still a draft — mark ready, then merge.">

— <PersonaName> (CCR persona; see workforce/skills/pr-autopilot/SKILL.md)

<!-- autopilot:needs-human -->
<!-- autopilot:reason:<code> -->   ⟵ REQUIRED on every hand-off: the escalation-reason code (see "Reason codes" below); `other` carries its mandatory free text inside the marker.
<!-- autopilot:reviewed -->   ⟵ keep this THIRD marker line ONLY on a 🟢 merge-ready hand-off; delete it on a 🔴 / non-consensus hand-off.
<!-- autopilot:panel:isolated -->   ⟵ REQUIRED on every VERDICT post (isolated | inline). Self-attested — presence is enforced, truth is not. Pass `--panel isolated|inline` and the script appends it.
```

```sh
GITHUB_TOKEN="…" node workforce/skills/pr-autopilot/pr-autopilot-post.mjs \
  --project "<project_id>" --pr <number> --body-file /tmp/verdict-<number>.md \
  --panel isolated|inline \
  --needs-human [--reviewed] [--reason <code> [--reason-text "…"]]
```

`autopilot:reviewed` marks "reviewed to 🟢, merge-ready, held only by the
human gate" — the operator's merge-click queue
(`is:open label:autopilot:reviewed`). Never stamp it on a non-green hand-off.

### Reason codes (Epic-019 escalation telemetry)

Every hand-off carries **why**, as an `autopilot:reason:<code>` label plus the
hidden `<!-- autopilot:reason:<code> -->` marker. The versioned taxonomy —
each code mapped 1:1 to its emission site — is
[workforce/docs/pr-escalation-reasons.md](../../docs/pr-escalation-reasons.md)
(v1). `pr-autopilot-post.mjs` refuses (exit 1) a `--needs-human` post with no
reason and throws on any code outside the taxonomy; `other` requires free text
(`--reason other --reason-text "…"`). Pick the code naming the failed clause:
`l0l1-path`, `no-r-n10-delegation`, `no-reviewer-consensus`,
`cycle-cap-exceeded`, `cannot-seat-panel` (Step 2),
`persona-escalation-trigger` (Step 4), `merge-engine-refusal` (Step 5 refusal
re-post — prefer the specific clause code the engine already stamped). The
post script also computes the verdict-time L0/L1 check itself and stamps
`autopilot:reason:l0l1-path` on any escalation touching the target's declared
set, fail-closed like the merge engine. These codes measure **wiring, never
reviewer performance**.

### Bounded flaky-check auto-rerun (Epic-019 Story 2c)

A `checks-failing` hand-off is not posted immediately: `pr-autopilot-post.mjs
--reason checks-failing` first attempts **one** bounded rerun via
`flaky-rerun.mjs`. The rerun fires **only** when EVERY failing check is on
the evidenced, unexpired allowlist (`flaky-checks.json` — validated by the
`workforce:skills` gate; each entry is `{check_name, evidence, expires}`, no
evergreen exemptions) **and** the PR has never been rerun before (the hidden
`<!-- autopilot:rerun:… -->` marker is the once-ever latch, posted *before*
the rerun triggers). A triggered rerun posts its audit comment (check names +
allowlist evidence) + the `autopilot:reran` label and **defers the
escalation** — the next tick re-verdicts on fresh checks; a rerun that still
fails escalates `checks-failing` normally, never retried. Editorial/deploy
gates (check names matching `/deploy|article|truncat|editorial/i` —
R-10/W-1 class) are **categorically rerun-ineligible**. A check that
repeatedly passes on rerun is racy, not flaky — `build-pr-metrics-github.mjs`
WARNs over threshold; evicting the entry + opening the issue is a
manual/sweep step. You never trigger a rerun by hand; the post script owns
the whole attempt.

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
`pr-autopilot-post.mjs --needs-human`, quoting the engine's refusal reason —
the engine has already stamped the refusal's `autopilot:reason:<code>` on the
PR; reuse that code (or `--reason merge-engine-refusal`) in the re-post.
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

**OP-009 (operator-only runtime wiring).** The event trigger this contract is
agnostic to — the CCR `agent-runner` routine's `pull_request`
(opened / ready_for_review / synchronize) trigger + the target-repo webhook —
is configured by the operator per
[follow-ups.md OP-009](../../docs/follow-ups.md) (design:
[adr-0013](../../docs/adr/adr-0013-event-driven-pr-autopilot.md)). Nothing in
this repo implements it; until it is wired, the cron fire is both the latency
floor and the backstop.

Related: [agent-runner.md](../../docs/routines/agent-runner.md) (the generic
CCR routine this runs under — this SKILL.md is the authoritative contract),
R-N10 in [workforce governance](../../docs/governance.md) + adr-0010/0011/0013/0014/0015
(the merge predicate's decision trail), [dev-process.md](../../docs/runbooks/dev-process.md).
