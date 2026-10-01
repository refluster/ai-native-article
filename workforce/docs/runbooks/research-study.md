# Runbook — Running a research study from a client brief

**Trigger:** the operator receives a 調査仕様書 / RFP (or decides to answer one
in-house instead of outsourcing it to a research firm) and wants the workforce
to produce the report.

**Procedure owner:** `beatriz` (VP Research) — skill
[`workforce/skills/research-study/`](../../skills/research-study/SKILL.md).
Execution today is session-driven (operator-invoked, `claude-code-routine`,
no cron), the same shape as `legal-amendment-review-committee`.

## Before you start

1. The target project must exist under `workforce/projects/<id>/project.json`
   with a `github.token` in `wf/projects/<id>/github.token` (see
   [`external-project-onboarding.md`](external-project-onboarding.md)). Study #1
   used `conference` (`refluster/conference`, draft-only — the operator alone
   sends anything to a client).
2. The target repo must carry the research conventions the skill writes
   against: `.claude/skills/research-report/` (templates, checker),
   `scripts/new-research.sh`, `scripts/make-figures.mjs`,
   `scripts/build-html.mjs`, a `research/` directory. `refluster/conference`
   is the reference layout.
3. Budget: the skill is `cost_class: large`. A twelve-stage study with six
   fact-pack sub-agents and a ten-seat panel is on the order of a few million
   tokens; it fits W-3 as an occasional study, not as a daily cadence.

## Steps

1. **Scaffold** in the target repo: `./scripts/new-research.sh YYYYMM <slug> "<title>" "<client>"`.
2. **Invoke** the skill in a Claude Code session on the target repo with the
   brief text: "research/YYYYMM-<slug> の調査を research-report skill で進めて".
   The session reads the workforce skill body (`GET /skills/research-study`)
   for the stage/gate/seat contract and the repo skill for mechanics.
3. **Gates.** After S3, S6 and S9 run the repo checker; after S9 run
   `node workforce/skills/research-study/publish-study.mjs … --dry-run` from
   this repo to rehearse the publish-time guards.
4. **Publish.** Real run of `publish-study.mjs` with the project's
   `github.token` → branch + draft PR with `autopilot:off`. Or, in an operator
   session with git access, commit and open the draft PR directly; the
   script's guards still run in `--dry-run`.
5. **Engagements.** One `research-study` engagement per seated persona
   (`log-workforce-engagements` / `outsource-to-workforce` step 4), summaries
   stating the operator-orchestrated execution.
6. **Retro.** `retro.md` in the study lists ≥3 lessons and the template/gate
   each changes. Lessons that change *this* skill's body are a Rule-11 PR
   (one skill body per PR, `meta.json:version` bumped).

## When it goes wrong

| Symptom | Likely cause | Do |
|---|---|---|
| `publish-study.mjs` exit 2 on G7 | citations not resolved, or register rows missing | back to S3/S6; never lower `--min-sources` to pass |
| exit 2 on G8 | a hypothesis has no verdict line in the report | add the 付録 A row; if it cannot be judged, mark 未検証 with the reason |
| panel keeps changing load-bearing claims after two rounds | the brief or the sources are the problem | `ESCALATED`: hand back with the gate and blocker |
| a 一次 source 403s from the session | remote-session allowlist | grade the secondary as 二次/低, record the 403 in the register 備考 and the 限界 chapter |
| engagement POST exit 3 | no `WF_ENGAGEMENT_WRITE_TOKEN` in the session | list pending rows in `retro.md` §2; the operator registers them |

## Related

- ADR-0005 (single execution model), ADR-0017/0018 (skill lifecycle, version-gated sync), R-N9 (external git is PR-only), R-N11 (a future split into chained cadences needs `QUEUES` rows).
- `regulatory-situation-report` and `weekly-project-report` for the sibling report cadences and their publish scripts.
