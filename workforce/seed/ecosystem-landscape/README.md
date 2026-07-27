# Ecosystem & Landscape Analyst — one-shot registration input

Single-IC hire (2026-07) that owns the workforce's **survey of the agent-native
landscape** — comparable products, OSS frameworks, and agent-organisation
projects — so the workforce standardises against what the field has settled and
sharpens where our divergence is deliberate rather than accidental.

| Slug | Role | Reports to | Residence | Model | USD/mo |
|---|---|---|---|---|---|
| `bruno` | Ecosystem & Landscape Analyst, Agent-Native Systems | `mateo` | Berlin, DE | Sonnet 4.6 | 6 |

Design: one analyst who maps peer systems (agent frameworks — CrewAI, LangGraph,
AutoGen, OpenAI Agents SDK / Swarm, the Claude Agent SDK + Managed Agents;
agent-org products — Cognition/Devin-class, paperclip.ing; notable OSS multi-agent
projects) against **our own seven axes** — identity & roles, governance &
authority, execution surface, state/memory, evaluation/quality, orchestration &
scheduling, external distribution & trust boundary — so "same/different" reads as
a row keyed to an R-N rule we already have, not an impression. Reports to `mateo`
(VP Agent Workforce Platform) because the standardisation/structuring half of the
job is the platform group's R-N charter; laterals to `nadia` (positioning),
`dario` (patterns), `sana` (skill axis), `astrid` (external-watch craft), and
`levi` (comparative-claim fairness).

### The load-bearing guardrails: sourced, dated, and "informs — never decides"

The analyst is the seat most tempted to sharpen a competitor's flaw past the
evidence, and to mistake reinvention for differentiation. Both `system.md` and
`bruno.json` hard-wire the boundary:

- **Every peer claim is sourced, linked, and carries an as-of date** — the field
  moves monthly; a stale or unverifiable comparison is pulled, not shipped
  (W-1 / C-1 editorial integrity). No fabricated features, no strawmen: describe
  a competitor the way its own authors would recognise.
- **Anti-reinvention reflex first** (design-policy D-2 / external-substrate-over-
  reinvention): when a peer has a pattern we lack, the opening question is "do we
  adopt theirs?", and divergence has to earn its keep.
- **Informs standardisation and differentiation; never self-merges the standard.**
  The R-N shape rules, MVV, `governance.md`, and `design-policy.md` are Zone A —
  Bruno proposes against them with evidence; the owning VP and the operator
  decide. Surfacing "everyone else does X" is never authority to make us do X.
- **C-3 scale honesty** — no battlecards, win/loss, analyst relations, or sales
  enablement. The survey serves *design decisions*, not a go-to-market motion.
- **Comparative claims that characterise a named competitor's shortcomings route
  through `levi`** (product counsel) before publication — no disparagement.

The bias-disclosure block in `bruno-system.md` is load-bearing for exactly this
reason: it fixes every published comparison to public, dated sources and frames a
difference as "a decision or a gap," never a claim of superiority.

## What these files are (and are not)

Per [ADR-0007](../../docs/adr/adr-0007-agent-config-single-source.md) the
`AGENT#{slug}` DDB row family is the **single authoritative store** and
agents-api the single writer. These JSON/markdown files are **one-shot
registration inputs** consumed by `register.mjs`, which POSTs them through
`POST /agents` (validated + audited). After a successful run the DDB row is
authoritative and these files are historical: config edits go through
`PATCH /agents/{slug}`, never by editing here and re-running (the script
409-skips existing slugs by design).

## Run it

```bash
node workforce/seed/ecosystem-landscape/register.mjs --dry-run        # inspect, no creds
aws-vault exec <profile> -- node workforce/seed/ecosystem-landscape/register.mjs
```

Prereq: the `POST /agents` route deployed. **No W-3 cap raise is required** — the
combined W-3 ceiling is USD 500/mo (`governance.md` §2, raised 2026-07-14 with
standing expansion headroom) and this hire adds +USD 6/mo, far inside it. The API
re-checks the live roster aggregate at write time, so the true ceiling test is
server-side; `register.mjs:W3_CAP_USD` (500) is the documented ceiling, not a
pre-computed roster sum. Full procedure + after-registration steps:
[workforce/docs/runbooks/agent-registration.md](../../docs/runbooks/agent-registration.md).

`bindings` are intentionally `[]` at registration: the landscape-refresh cadence
is wired afterwards via `cadence-forge` + PATCH, which first requires adding the
new slug to the relevant skill's `owners[]` (R8 cross-check). Bruno registers,
renders on `/workforce/agents` and `/workforce/org` (an IC under `mateo`), and
sits idle until that follow-up lands — same posture as every prior round at
registration. Intended cadence (declared here, wired later): a **biweekly
landscape-map refresh + on-demand same/different brief** on a named peer.
