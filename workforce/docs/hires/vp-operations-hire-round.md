# VP, Operations & Reliability — hire round

- **Operator request**: 2026-07-23 — port the "Accountable Attention
  Observation" pattern from a sibling organisation (mononaware) into this
  repo: never let an automated monitoring workflow's failure end at a chat
  notification — always resolve it into a persistent, owner-named record a
  real person can be held to. Implement it as a workforce Cadence (fired by
  CCR via `wf-orchestrator-tick`, not a GitHub Actions workflow), under the
  existing `agent-workforce` project, and hire a new **VP Operation** to own
  it — do not copy the source pattern's code, names, or thresholds verbatim;
  redesign for this org's actual ownership and notification structure.
- **Status**: Proposal. Registration bundle staged
  (`workforce/seed/vp-operations/`), draft PR (ships together with the
  `ops-accountability-watch` Cadence and
  `chat-notification-policy.md`). **No W-3 cap raise required** — see §5.

This is the org's first **operations-and-reliability** hire — every prior VP
seat (Finance, Marketing, Policy, Research, Engineering Excellence,
Agent Workforce Platform) owns a *domain*; this one owns a *discipline* that
cuts across every domain: does an automated process that fails actually
produce a human decision, or does it just produce a chat message everyone
scrolls past? That cross-cutting shape — and the risk of it becoming a
second, competing "attention" seat next to Camille's existing Chief-of-Staff
ledger — is the load-bearing design question this round has to answer
cleanly (§2).

## §1. Why this needed a new seat, not an existing one

The candidate alternatives, and why each falls short:

- **Dario (VP, Engineering Excellence)** owns the code/CI surface, but this
  mandate is explicitly repo-wide — it watches the article publish pipeline
  and the podcast pipeline exactly as much as workforce CI. Folding it into
  Dario would either narrow the mandate to "engineering only" (defeating the
  point) or hand an engineering VP a cross-domain notification-policy seat
  that isn't really his lane.
- **Camille (Chief of Staff, `attention-ledger`)** already ranks the
  operator's open decisions weekly. But her ledger *consumes* existing open
  items — PRs, escalations, config-digest rows. It has no mandate to *go
  looking* for automation that's silently stopped working, and folding
  detection into her weekly cadence would mean anomalies sit unrouted for
  up to six days between her Monday fires. The two are complementary, not
  substitutable (see the new Cadence's SKILL.md, "What this Cadence is not").
- **A standalone Lambda** (the `wf-audit` shape) was considered and rejected
  for the same reason `wf-audit` itself is workforce-only: this pattern's
  scope is explicitly the whole repo (article + podcast + workforce), and a
  Lambda has no natural "which persona's judgment frames today's one
  sentence of context" hook the way a Cadence does.

None of the existing seats can absorb this without either narrowing its
cross-cutting scope or overloading an unrelated mandate. A new, focused VP
seat — reporting to Maya like every other VP, with no direct reports yet —
is the cleanest shape.

## §2. The hire

| Slug | Role | Reports to | Residence | Model | USD/mo |
|---|---|---|---|---|---|
| `petra` | VP, Operations & Reliability | `maya` | Copenhagen, DK | Sonnet 4.6 | 8 |

Full JD, identity, and guardrails: `workforce/seed/vp-operations/petra.json`
+ `petra-system.md`. In one paragraph: Petra owns the standing rule for when
an automated process may notify a human via chat
(`workforce/docs/runbooks/chat-notification-policy.md`) and the first
Cadence that enforces it (`ops-accountability-watch`) — a daily sweep of
this repo's GitHub Actions run history plus
`docs/memory-lint-backlog.md`'s own 6-month "watching" staleness rule,
mechanically routed to a real named owner per finding, opened/updated as a
GitHub Issue (never a duplicate), surfaced as exactly one aggregate Discord
notification per fire. She routes; she never adjudicates a finding herself
— see her `system.md` guardrails.

**No direct reports.** Unlike the finance-group shape (one lead absorbing
two ICs), this round ships a single deliverable narrow enough that a second
layer would be premature — same call the ecosystem-landscape and
workforce-marketing single-IC rounds made. If the reliability mandate grows
past what one Cadence + one policy doc can hold, that's a future round's
question, not this one's.

## §3. Why "redesign, don't port verbatim"

The source pattern (mononaware's) is described only at the level of *why*
(silent-failure prevention, assignment-theater prevention, observation-mode
ramp, mechanical owner routing) and *what* (a scheduled job, a payload
script, an idempotent issue ledger, an aggregate notification, tests) — not
as code to copy. Concretely, every mechanism below was re-derived from this
repo's actual state, not transplanted:

- **Execution surface**: a GitHub Actions workflow in the source pattern
  becomes a CCR-fired Cadence here (ADR-0005 — every scheduled workforce
  execution is a CCR task; a bespoke GHA workflow would have been a
  R-N1/R-N4 violation, and the request explicitly asked for this shape).
- **Owner registry**: the source pattern implies some existing ownership
  map to route against. This repo has none as an accountability registry
  (`docs/governance-mechanisms.md` names that gap explicitly) — so owner
  routing here is grounded in real, already-on-record domain ownership
  (persona roles from `docs/hires/*.md`, not an invented org chart), and the
  GitHub Issue itself — not a new registry file — is the persistent record,
  per this repo's own stated convention ("new scheduled automation's output
  goes to a GitHub issue or a PR, never a direct push to main").
- **Notification channel**: Discord, because that's the only chat channel
  this repo actually has wired (`discord-heartbeat`, `discord-digest`), via
  the `agent-workforce` project's `discord.webhook_url` credential — not a
  Slack/Teams integration that doesn't exist here.
- **The "other freshness signal"**: rather than invent a fictional registry,
  the second signal is `docs/memory-lint-backlog.md`'s own stated promotion
  rule (≥ 6 months in `watching` without revision) — a real, already-written
  threshold this repo committed to, now actually checked.
- **Thresholds and colours**: the 180-day staleness window, the owner-routing
  table, and the notification colour scheme are new, chosen for this repo
  (see `owner-routing.mjs` / `signals.mjs` / `payload.mjs` headers) — none
  of them are copied from the source implementation, which this session
  never had sight of beyond the requester's English/Japanese description of
  intent.

## §4. Files in this round

- `workforce/seed/vp-operations/{petra.json, petra-system.md, register.mjs, wire-cadence.mjs, README.md}` — the registration bundle (staged; not executed by this PR — see the README).
- `workforce/skills/ops-accountability-watch/` — the Cadence: `SKILL.md`, `meta.json`, `owner-routing.mjs`, `signals.mjs`, `payload.mjs`, `collect.mjs`, `sync-issues.mjs`, `notify.mjs`, and their `*-tests.ts` suites.
- `workforce/docs/runbooks/chat-notification-policy.md` — new L3 runbook (no prior chat-notification policy existed in this repo).
- `docs/issue-labeling.md` — the new `owner:` marker-label axis this Cadence's Issues carry (deliberately not mirrored into `.github/labels.json`, since it's open-ended per-slug rather than a static enumeration — see the doc's §4.2 note).
- This memo.

## §5. Cost impact

Current W-3 ceiling: **USD 500/mo** (`governance.md` §2, raised 2026-07-14
with standing expansion headroom on operator direction). Petra adds
**+USD 8/mo**. Every prior round since the 2026-07-14 raise (ecosystem-
landscape +6, workforce-marketing +6, the nine-hire org-benchmark round)
has landed comfortably inside this ceiling with room left; this hire is no
different in kind. **This PR raises no ceiling and edits no L0/L1 doc.** The
agents-api re-checks the live roster aggregate at write time — `register.mjs:
W3_CAP_USD` (500) is the documented ceiling, not a pre-computed roster sum
(the git bundle can't read the authoritative DDB total — W-2).

## §6. Rollout posture

Per `governance.md` §5, adding a new skill's first version is **A**
(autonomous). The binding itself lands **enabled** (not paused) at
`config.mode: "observation"` — a live cron, but one whose notification
posture is deliberately louder-than-steady-state for the introduction
period, per `chat-notification-policy.md` §5. Flipping `config.mode` to
`"steady"` after four consecutive clean weekly fires is a separate,
explicit operator action (not this round's).

Registering the persona (`POST /agents`) and wiring the binding
(`PATCH /agents/petra`) both require operator AWS credentials this session
does not hold — per every prior hire round's posture, this PR **stages** the
bundle; the operator runs `register.mjs` then `wire-cadence.mjs` after
merge + deploy.

## §7. Open questions for the operator

1. **Observation-mode exit threshold.** This round hardcodes "four
   consecutive clean weekly (Monday) fires" as the default exit condition
   (`chat-notification-policy.md` §5). If a shorter or longer proving period
   is preferred, that's a one-line change to the policy doc and the
   Cadence's binding note before merge.
2. **Owner-routing table completeness.** The initial table routes
   workforce-engineering workflows to `dario`, the article/content-insights
   pipeline to `elena`, the podcast pipeline to `odette`, and everything
   else (including the governance-registry signal) to `petra` herself. If a
   different owner is preferred for any of these, `owner-routing.mjs` is a
   small, reviewable diff.
3. **Second signal choice.** `docs/memory-lint-backlog.md` staleness was
   chosen over `docs/risk-acceptance-ledger.md` because the backlog's
   promotion rule states a clean, mechanically-parseable threshold (6
   months); the ledger's `Re-eval` column is free-text trigger conditions,
   not reliably machine-checkable. Worth revisiting if the ledger's format
   is tightened later.
