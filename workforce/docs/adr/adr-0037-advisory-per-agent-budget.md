# ADR-0037 — The per-agent budget is advisory: it is measured and reported, and it never stops a fire

- **Status**: Accepted (operator direction 2026-09-14)
- **Date**: 2026-09-14
- **Deciders**: operator
- **Epics**: none — incident follow-up (ML-038); supersedes the *enforcement* half of the #661 fix, keeps its *measurement* half

## Context

Issue #661 found that W-3's per-agent monthly budget was declared but neither
measured nor enforced on the CCR execution path — every agent's month read
zero. Its fix (deployed 2026-09-09T19:39Z) did two things at once: the
orchestrator began charging a **modelled** cost per dispatched fire to
`BUDGET#{month}/AGENT#{slug}` (the measurement), and it began **refusing to
dispatch** once an agent's month would cross
`budget_monthly_usd_override ?? budget_monthly_usd_default` (the enforcement).

The per-agent figures it started enforcing had been set when the ledger never
moved. None had been sized against the bindings' cadence. So the agents doing
the most work were refused first, silently: `nadia` (the PR router, USD 75/mo
modelled against an USD 8 figure) from 09-11, `ren` (the author lane) from
09-13, `ingrid` (the article pipeline) from 09-09. Nine open PRs sat unrouted
for three days; the only trace was a CloudWatch WARN per tick. Eight of 58
agents outrun their figure at the live cadence; the roster's modelled burn is
USD 464/month against a W-3 ceiling of USD 600.

The first response (#730) kept the enforcement and tried to make the figures
honest: a write-time guard (`W3-runway`) refusing any bindings/budget write
whose cadence outruns the figure, a loud ledger row on the first refusal, and
a daily audit. The operator's ruling on reading it:

> そもそも予算の上限でキャップをかけないしくみにして。予算を超えないように止める
> ことより、成果を止めず出し続けること、だと後者の方がはるかに優先度が高い。

Output continuity is far more important than staying under a budget figure.
A mechanism that can switch the organisation off to protect a planning number
has its priorities inverted.

## Decision

1. **The per-agent budget never refuses work.** `budget_monthly_usd_default`
   and `_override` are planning figures. The orchestrator dispatches every
   due binding regardless of the month's position; `tools-api` runs every
   tool call regardless. No code path in the workforce declines an LLM call,
   a fire or a write because a per-agent figure would be crossed.
2. **The position is still measured, and said loudly.** The modelled ledger
   (#661) stays exactly as it is. A tick whose fire crosses the figure logs
   `budget-advisory-exceeded`; the first crossing of the month stamps
   `cap_reached_at` on the ledger row, and `GET /performance` names those
   agents in `budget.over_budget_agents`. The daily R-19 audit lists every
   agent over its advisory figure.
3. **The aggregate W-3 ceiling (USD 600/month) stays a ceiling — for
   planning and alarming, not for dispatch.** It is still enforced at the
   agents-api write boundary (`W3-cap`: the sum of per-agent figures may not
   exceed it) and by the CloudWatch billing alarm on the deployment as a
   whole. R-19 fails only when the roster's *modelled burn* exceeds it — the
   one number that means "we are spending more than we planned to as an
   organisation" — never on a per-agent overrun.
4. **`W3-runway` (a write-time refusal) is withdrawn.** A figure that does
   not stop anything must not stop a binding from being wired either. The
   arithmetic (`budget-runway.ts`, `scripts/lib/budget-runway.mjs`) stays
   for the audit.

## Consequences

- An agent can spend past its figure for the rest of the month. That is the
  intended trade: the organisation keeps producing, and the operator sees who
  is over on `/performance` and in the daily audit, and right-sizes the figure
  (or thins a cadence) on their own schedule. FU-041 tracks the right-sizing.
- The org-level exposure is bounded the way it was before #661: by the
  billing alarm and by the roster's planned burn staying under the ceiling.
  If the modelled burn ever exceeds USD 600/month, R-19 turns red and the
  choice — thin cadences or raise the ceiling (Zone A) — is the operator's.
- `workforce/docs/governance.md` §2 W-3 no longer says "enforced at the LLM
  call site (throw on overrun)"; it says measured and reported per agent,
  ceiling-enforced at the write boundary and the billing alarm. The lockstep
  rule between `W3_BUDGET_CAP_USD` and the §2 figure is unchanged.
- Any future proposal to make a per-agent figure stop work again is a
  superseding ADR, not a config change: it must argue why a planning number
  should be able to switch off a pipeline, which is the question this
  incident answered.

## References

- [#661](https://github.com/refluster/ai-native-article/issues/661) — the measurement this keeps
- [#730](https://github.com/refluster/ai-native-article/pull/730) — the enforcement this withdraws (`W3-runway`, the refusal row)
- ML-038 in `docs/memory-lint-backlog.md`; FU-041 in `follow-ups.md`
- [ADR-0007](adr-0007-agent-config-single-source.md) — the write boundary where `W3-cap` still holds
