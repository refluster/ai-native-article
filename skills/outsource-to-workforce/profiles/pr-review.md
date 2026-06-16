# Profile: pr-review

A task profile is **data** — it tells the foundation workflow how to handle one
task type. Adding a new task type means adding a `profiles/<name>.md` like this
one, NOT writing a new skill.

## Triggers
A GitHub PR to be reviewed (and optionally fixed). Phrases: "PRレビューを依頼",
"このPRをレビューして外注", "outsource this PR review", "route PR #N to reviewers".
Default profile when the `target` is a PR.

## Inputs
- `project_id` (e.g. `asp-cloud`) — also the GitHub repo's workforce project.
- `target` — PR number or URL.

## Lens → persona map (step #2)
Mirrors `nadia`/`pr-autopilot` `config.nomination_rules`, plus the SRE lens.

| Lens | Persona | Nominate when the diff surface has… |
|---|---|---|
| Engineering | `ren` | implementation, tests, API contracts, error handling |
| Architecture / Governance | `dario` | infra, data-model, cost, governance/ADR, migration |
| QA / SRE | `farah` | SLI/SLO, error budgets, measurability, alarming, data quality |
| Design | `aoi` | UX, IA, visual, copy, accessibility |

**Surface scan:** read the diff (`gh pr diff <n>`); a lens with **no** surface
in the diff is **skipped, not nominated for completeness** — say why in the
routing comment (e.g. "design — no UX surface — skipped"). If a nominated
persona is `paused`/`archived` (check the roster), fall back to that lens's
skill owner or skip with a note.

## Deliverable (step #3) — GitHub PR comments
Post, in order, as comments on the PR:
1. **Routing/pickup comment** (once; dedup against any `pr-autopilot` comment <7d).
   Header `🧭 Agent-workforce routing — pickup & nomination`. Include the
   diff-surface→lens table with skip reasons, and state it is operator-
   orchestrated, comment-only.
2. **One review comment per nominated lens.** Header `🔧/🏛️/🔬/🎨 Review —
   <lens> (`<persona>`)`. Real, specific findings tied to `file:line`, each
   tagged `[id · severity]` (e.g. `R1 [nit · robustness]`, `D1 [change-requested]`,
   `F1 [important · 定点観測]`). Write in that persona's voice/priorities (see
   their `about`/`jd` via `GET /agents/{slug}`), but the findings must be true.
3. **One operator-response comment per lens.** Header `↳ Operator response to
   `<persona>``. For each finding: `accepted, fixed in <sha>` / `accepted,
   deferred` / `accepted, recorded` — and **apply the agreed fixes as a
   commit** (then cite the sha). Defer anything out of scope, say why.

## Engagement (step #4)
One per agent that did work, via `scripts/register_engagement.py`:

| agent | `--skill-name` | `--skill-version` |
|---|---|---|
| nadia (routing) | `pr-autopilot` | auto (`GET /skills/pr-autopilot`, e.g. 0.2.0) |
| ren / dario / farah / aoi (review) | `pr-review` | auto (e.g. 0.1.0) |

- `--project-id <project>`, `--status ok`, `--started-at/--ended-at` = real work
  window, `--summary` = a faithful 1-paragraph account of that lens's findings +
  how each was handled (fixed/deferred), with the PR ref.
- `--dedup-key "PR #<n>"` so a re-run doesn't silently double-register; only pass
  `--allow-duplicate` when the user explicitly asks to re-post (e.g. to backfill
  a summary).

## Worked example — asp-cloud PR #507 (first real run)
Standardized SLI-1/SLI-2 numerator/denominator. Routing by nadia →
`ren` (R1 silent-row-skip → surface skipped count; fixed +test), `dario`
(D1 "ratified"→"proposed"; D2 ADR §5 cross-ref → recorded), `farah` (F1 rolling
vs Sunday-anchored window; F2 orphaned-pending alarm; F3 "valid record" filter).
Operator responses applied fixes in `b2f9c25`; design lens skipped (no UX
surface). Four engagements registered against `asp-cloud`.
