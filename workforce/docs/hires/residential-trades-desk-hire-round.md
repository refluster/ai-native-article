# 2026-11 — US Residential Trades Desk hire round

- **Operator request** (2026-11-16, in a Claude Code session on `refluster/workflow-foundry`): run the client-facing agent track of the `workflow-foundry` project on the workforce as far as public data allows — *"maximise what can run on public data, minimise case data, and operate it on the workforce as far as possible; start with about ten steady-state jobs, such as incentive research; if new positions are needed, run the hiring process."*
- **Two decisions the operator made in the same message**, recorded here because they shape every seat:
  1. **No client case data on the workforce.** The workforce handles public information only; case data stays in the client's own environment.
  2. **Monitoring runs as workforce CCR cadences**, not as a detached cron: detection may be deterministic, but judging what a change means needs an LLM.
- **Status**: registration bundle staged at [`workforce/seed/residential-trades-desk/`](../../seed/residential-trades-desk/README.md). Nothing is registered or wired by this PR.
- **Authorship**: assembled in a Claude Code session at the operator's request. See §11 — there was no persona panel.

---

## §1. Policy applied

- **C-3 single-operator scale.** One desk lead and seven analysts under an existing VP. No new VP, no pod, no new management layer above the lead.
- **W-2 / W-5.** The seed bundle is one-shot registration input per [ADR-0007](../adr/adr-0007-agent-config-single-source.md); DDB becomes authoritative on registration and later edits go through `PATCH /agents/{slug}`, one persona per write.
- **W-3.** The live roster stood at **USD 423/mo across 69 agents** (`GET /agents`, 2026-11-16). This round adds **+USD 49/mo → 472/mo**, 59% of the USD 800 ceiling. **No cap raise, no Zone A edit to `governance.md`.**
- **W-1 / W-4.** The desk's integrity risk is specific: a stale availability status or a collapsed legal stage read as current fact by someone quoting a job. Each seat's discipline against it (as-of date, stage label, last-read date) is in `identity.guardrails`, not only in prose.
- **Public repository.** This repository and the feed are public. No seat's prompt names a client, and every seat is barred from holding or reasoning from client data.

## §2. What the desk is for

`workflow-foundry` builds workflow automation for small residential trade contractors, starting in California. Its automation rests on rule ledgers — which incentive is open and for whom, what a home-improvement contract must contain and since when, what each city asks for to issue a permit. Those ledgers were built from one-off surveys. They go stale silently: an incentive tranche fills, a bill is chaptered, a city migrates its portal.

The desk replaces the one-off survey with a standing read. Each analyst owns one public frontier and reports changes daily through the existing `daily-research` Cadence. The contractor is the expert in the trade; the desk's job is to stay current on the published record so that expert does not have to.

## §3. Structure review

**Q1: new seats or existing ones?** → **New.** No current seat's beat covers California contractor law, city permitting, residential incentives or trade software. `grace` reads federal and state *grid* regulation; `levi`'s counsel lane is privacy and AI regulation (India DPDP, EU AI Act) and the proposal-prep profile already records that convening him on CSLB matters would be a fabricated voice; `rohan` and `jay` do the analogous work for India. `daily-research` reads its scope from the persona prompt, so a new frontier is a new persona, not a config flag.

**Q2: how many?** → **Seven frontiers + one lead.** The split follows where the *sources* differ, because a daily loop that must read two unrelated source families camps on one of them:

| Frontier | Why it is its own seat |
|---|---|
| State & federal incentives | Rules set statewide; handbook- and dashboard-driven; budget status moves without notice |
| Utility & regional incentives | Set per service territory; dozens of utility, municipal and air-district pages |
| Contractor law | Legislature + licensing board; stage discipline is the whole job |
| Local permitting | One building department at a time; handouts and fee schedules |
| Codes & air-quality rules | Rulemaking files and compliance dates by equipment class |
| Products & supply | Manufacturer documents, certification lists, recalls |
| Trade software & automation | Vendor docs, APIs, terms — the surface the project builds next to |

Two candidate seats were **not** opened: a separate bill-tracker (folded into contractor law — same sources) and a consumer-behaviour seat (folded into the lead's market-structure beat).

**Q3: who does the lead report to?** → **`beatriz`** (VP, Research). The desk is a research function; the project's owner `nadia` is a lateral, so product priority and research method negotiate across an org edge instead of inside one line. The India desk reports to `tessa` because its beat is policy; this desk's is broader than policy.

**Conclusion: 8 new seats, 1 existing parent, no new VP, no cap raise, no mutation to any existing persona.**

## §4. The hires

| Slug | Role | Reports to | Residence | Model | Budget |
|---|---|---|---|---|---|
| `naomi` | Research Lead, US Residential Trades Desk | `beatriz` | Long Beach, CA, US | `anthropic:claude-sonnet-4-6` | USD 7/mo |
| `valeria` | State & Federal Residential Incentives Analyst | `naomi` | Sacramento, CA, US | same | USD 6/mo |
| `soledad` | Utility & Regional Incentives Analyst, Southern California | `naomi` | Anaheim, CA, US | same | USD 6/mo |
| `desmond` | California Contractor Law & Consumer Protection Analyst | `naomi` | Sacramento, CA, US | same | USD 6/mo |
| `leilani` | Local Permitting Analyst, Southern California | `naomi` | Irvine, CA, US | same | USD 6/mo |
| `ezra` | Building Codes & Air-Quality Standards Analyst | `naomi` | Diamond Bar, CA, US | same | USD 6/mo |
| `hector` | Water Heating & HVAC Products and Supply Analyst | `naomi` | Atlanta, GA, US | same | USD 6/mo |
| `quinn` | Field-Service Software & Automation Analyst | `naomi` | Austin, TX, US | same | USD 6/mo |

Residences follow the sources: the Legislature, the licensing board and the state energy agencies are in Sacramento; Anaheim runs its own municipal utility; Irvine sits in the middle of the first permitting territory; the South Coast air district's headquarters is in Diamond Bar.

**Lane boundaries that are written into both sides' prompts** (the pairs most likely to collide):

- `valeria` ↔ `soledad` — who sets the rule (statewide/federal vs. local). A statewide program delivered through a utility is co-flagged.
- `leilani` ↔ `ezra` — what the code says vs. what a building counter asks for. A local amendment's text is `ezra`'s; its application is `leilani`'s.
- `quinn` ↔ `bruno` — the trade's own software vs. general agent frameworks.
- `desmond` ↔ `levi` — explicitly *not* a shared lane; `desmond` does not borrow counsel authority.

## §5. The steady-state jobs this round starts

The operator asked for about ten. Eight start on registration; five more are named with the one thing each is waiting on.

| # | Job | Seat | Cadence | Rhythm | Ready |
|---|---|---|---|---|---|
| 1 | State & federal incentive status watch | `valeria` | `daily-research` | daily | on registration |
| 2 | Utility & regional incentive watch by territory | `soledad` | `daily-research` | daily | on registration |
| 3 | Contractor-law and bill-stage watch | `desmond` | `daily-research` | daily | on registration |
| 4 | City permitting watch, one jurisdiction at a time | `leilani` | `daily-research` | daily | on registration |
| 5 | Code-cycle and air-quality compliance-date watch | `ezra` | `daily-research` | daily | on registration |
| 6 | Product, recall and supply watch | `hector` | `daily-research` | daily | on registration |
| 7 | Trade-software and automation watch | `quinn` | `daily-research` | daily | on registration |
| 8 | Market-structure beat + seam reads across 1–7 | `naomi` | `daily-research` | daily | on registration |
| 9 | Ledger watch: run the project's deterministic source-diff, judge each change, post it | `valeria` / `leilani` | new Cadence (`cadence-forge`) | daily / weekly | needs the skill PR merged + deployed |
| 10 | Desk situation report for the project sponsor | `naomi` | `weekly-project-report` @ `workflow-foundry` | weekly | needs `github.token` on the project |
| 11 | PR review-to-merge on the project repo | `nadia` | `pr-autopilot` @ `workflow-foundry` | 6-hourly | needs `github.token` (project issue #65) |
| 12 | Issue routing and backlog hygiene on the project repo | `nadia` | `issue-triage`, `backlog-reconcile` | daily | needs `github.token` + `workforce.dispatch_token` |
| 13 | Turn desk findings into ledger PRs | `ren` | `issue-execute` @ `workflow-foundry` | daily | needs 11–12 |

`feed-post` is wired alongside `daily-research` because that is the org standard for every seat; it is not counted as a job.

**How findings reach the project before the token exists.** `GET /agents/{slug}/posts` is public. The project repo can pull the desk's posts and check its ledgers against them without any credential on the workforce side. That bridge is the project's work, not this round's.

**Why job 10 is not `regulatory-situation-report`.** That skill skips whenever a `kind: "situation"` row already falls inside its window in `reports/manifest.json`; bound on `agent-workforce` it would collide with `tessa`'s quarterly report. The clean home is the project's own repo, hence the token.

## §6. Cost (the W-3 question)

+USD 49/mo planned budget, 423 → 472 of 800. Fires: 8 seats × 2 daily `small` cadences. Per-agent figures are advisory ([ADR-0037](../adr/adr-0037-advisory-per-agent-budget.md)); the aggregate is enforced at the write boundary, so the true test is server-side at registration.

## §7. Registration and cadence activation

1. `register.mjs` — `naomi` first, then her seven reports. All register with `bindings: []`.
2. `workforce/scripts/wire-daily-cadences-all-agents.mjs --only=naomi,valeria,soledad,desmond,leilani,ezra,hector,quinn` — binds `daily-research` and `feed-post` at `agent-workforce`, enabled, on globally unique minutes.

Unlike earlier rounds, cadence wiring is **not deferred**: the operator's message is the cost greenlight for the daily cadences ("start with about ten steady-state jobs"), the same shape as the all-agents roll-out direction. Both steps still need operator credentials and remain B-authority writes; this PR performs neither.

## §8. People-ops check

- **Naming (R-N7)**: all eight match `^[a-z]+$`; checked against the live 69-slug roster — no collision. Near-reads considered and judged distinct: `naomi`/`noor`, `hector`/`haruto`, `leilani`/`linnea`, `ezra`/`elena`, `desmond`/`delphine`. A candidate `wren` was dropped because it contains `ren`.
- **Org edges**: `naomi` → `beatriz`; seven → `naomi`. No cycles; every lateral names an existing slug or a same-round seat. No seat lists its own manager as a lateral.
- **S19**: every `system_prompt` header title equals the `role` field (checked by script against all eight files).
- **Bench gaps named, not hidden**: no second permitting seat for Los Angeles / Inland Empire / San Diego (one analyst widens outward in a stated order); no seat for other states; no verifier inside the desk — `rafael`'s weekly red-team and `nikhil`'s verification lane are the outside check.

## §9. What's NOT in this round (and why)

- **A new skill.** Jobs 1–8 use `daily-research` unchanged. The ledger-watch Cadence (job 9) is its own PR, scaffolded with `cadence-forge`.
- **Any credential.** `workflow-foundry` has no `github.token`; issuing one is the operator's step and gates jobs 10–13.
- **Any mutation to an existing persona**, including reciprocal laterals on `beatriz`, `nadia`, `bruno` and others.
- **Any client data path.** By the operator's decision there is none, and the seats are written to refuse one.
- **A W-3 cap change.**

## §10. Acceptance criteria (for operator PR review)

- `workforce/seed/residential-trades-desk/{slug}.json` + `{slug}-system.md` exist for all eight; `register.mjs --dry-run` lists role, residence, model, budget and `reports_to`, each `system_prompt` under 8 KB (ceiling 32 KB), combined budget USD 49/mo.
- `validate-naming.mjs` passes.
- `governance.md` is unchanged. No skill, Lambda, SAM or workflow file is touched.
- The three shared guardrails appear in **both** `system.md` and `identity.guardrails` for every seat.
- No file in the bundle names a client.

## §11. Open questions for the operator

1. **Eight seats vs. fewer.** If the desk should start smaller, `quinn` (software) and `hector` (products) are the two whose findings do not feed a rule ledger today; dropping either is deleting two files and one slug in `register.mjs`.
2. **`streams`.** All eight carry `["internal","client"]` — no `editorial`, so no byline on `kohuehara.xyz`. Adding it later is one PATCH per seat.
3. **Language.** `daily-research` posts in the feed's working language. If the project's Japanese-speaking readers should get Japanese posts, that is a line in each persona prompt (eight W-5 writes) or a translation step on the project side.

## §12. Bias disclosure for this memo

> This round record was assembled in a Claude Code session at the operator's request, not by a hiring persona. **There was no panel** — no people-ops review, no consultation transcript — and this memo does not stage one. The §8 check is a checklist actually run (naming lint, edge resolution, roster collision check against the live API, header/role match). The eight seats do not exist as running personas at the time of writing; their lanes and voices are designed, not observed, and their real output will diverge from what is imagined here. Source lists in the prompts name where each analyst should look; they are not claims about what those sources currently say.
