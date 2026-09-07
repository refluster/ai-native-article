# workforce/docs — index

Everything under `workforce/**` is governed by [governance.md](governance.md). This index says what each file or directory *is* so you open the right one. Zone (per [governance.md §3](governance.md)) decides who merges: **A** = human, **B** = agent + CI.

## Statute (L1 — cite in the PR body, R-11)

| File | Subject | Zone |
|---|---|---|
| [governance.md](governance.md) | W-1…W-5 invariants, zone table, R-N1…R-N10 shape rules, action authority | A |
| [architecture.md](architecture.md) | v1 system shape — read its status banner; the ADRs below override it | A |
| [data-model.md](data-model.md) | DynamoDB single-table layout, S3 key families, GSIs | A |
| [naming.md](naming.md) | Naming convention enforced by `validate-naming.mjs` (R-N7) | A |
| [mvv.md](mvv.md) · [north-star/](north-star/README.md) | Mission / vision / values corpus injected into every persona fire | A |
| [adr/](adr/README.md) | 30 Architecture Decision Records, append-only; the most load-bearing are 0005 (CCR execution), 0007/0008 (config in DDB), 0010/0011 (autopilot merge), 0017–0021 (skill lifecycle, memory), 0027 (project tools) | A |

## Operations (L3 — agents edit freely)

| Directory | Contents |
|---|---|
| [runbooks/](runbooks/) | One trigger → one procedure: agent registration, bindings, CCR bootstrap, engineer PR timeout, podcast pipeline, region migration, … |
| [routines/](routines/) | Contracts for the Claude Code Remote routines (`agent-runner`, `workforce-builder`, review routines, the legal committee). The claude.ai routine prompt is a one-line pointer to the file here. |
| [pr-escalation-reasons.md](pr-escalation-reasons.md) | The escalation taxonomy `pr-autopilot` emits (prose twin of `escalation-reasons.mjs`) |

## Planning and records

| File / directory | Contents |
|---|---|
| [epics/](epics/) | Epic plans; `epics/README.md` is the running status ledger |
| [follow-ups.md](follow-ups.md) | FU-NNN registry of deferred items (read by `check-governance-registries.mjs`) |
| [hires/](hires/) | Hire-round documents — each W-3 cap raise cites one of these |
| [team/](team/) | Platform charter and experience/skill metrics |
| [landscape/](landscape/) | External comparisons and market research |
| [design/](design/) | Console design notes (`feed-ui-v1.md`, `research-surface.md` — the public article reader under `/research`) and static reference mockups (`refs/`) |
| [agent-workflow-overview.md](agent-workflow-overview.md) | Plain-language (Japanese) overview of who does what, for non-technical readers |

Related, outside this directory: [../ROADMAP.md](../ROADMAP.md) (milestones), [../DESIGN.md](../DESIGN.md) (console design tokens), [../README.md](../README.md) (infra, deploy, adding a skill), [../skills/](../skills/) (the skill bundles themselves), [../lambdas/README.md](../lambdas/README.md).
