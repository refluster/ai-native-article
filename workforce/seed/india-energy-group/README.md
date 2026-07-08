# India Energy Market Research Desk — one-shot registration inputs

Seven-agent 2026-07 hire round supporting the India residential-energy business
thesis — translating the North-America/Japan distributed-energy structural shift
into an India-specific, evidence-backed proposal narrative (environment / customer
redefinition / new value / willingness-to-pay / scalability). This folder is the
**registration batch**; the seven agents are placed across **three org branches**
by the region/function rule below (the org tree is built from each agent's
`reports_to` edge, not from this folder).

**On the India Energy Market Desk** (region-based — India-focused, reports into `anjali`):

| Slug | Role | Residence | Reports to | USD/mo |
|---|---|---|---|---|
| `anjali` | Research Director, India Energy Market Desk (lead) | Mumbai, IN | `tessa` | 7 |
| `rohan` | DISCOM, Subsidy & Program-Economics Analyst | Gurugram, IN | `anjali` | 6 |
| `sneha` | Residential Consumer & Field-Evidence Analyst | Pune, IN | `anjali` | 6 |
| `sofia` | Market Strategy & Willingness-to-Pay Analyst | Copenhagen, DK | `anjali` | 6 |
| `jay` | India Solar & Contractor Ecosystem Analyst | Ahmedabad, IN | `anjali` | 6 |

**Placed by function** (cross-market — not India-dedicated, normalized into an existing org):

| Slug | Role | Residence | Reports to | USD/mo |
|---|---|---|---|---|
| `amara` | Power & Grid Systems Analyst (cross-market) | London, UK | `tessa` (Policy/Research) | 6 |
| `julian` | Private Capital & Blended-Finance Analyst | New York, NY, US | `silas` (Finance) | 6 |

Design principle (operator directive, 2026-07-08): **agents who are heavily
India-specialized are split by region** (the India desk under `anjali`); **everyone
else is normalized by function** and assigned into the existing org — `amara`'s
grid-systems lens is a cross-market research function under `tessa` (a peer to
`anjali`, deliberately *not* tucked into the India desk), and `julian`'s
capital-structuring is a finance function under `silas`. They serve the India
thesis through lateral edges, not through desk membership.

The whole round deliberately plugs into — and defers to — the existing roster
instead of duplicating it: `ishaan` (New Delhi) keeps the central-instrument read,
`vikram` (Lucknow) keeps DISCOM ground truth, `aanya` (Pune) keeps community
sentiment, `mei` (Singapore) keeps carbon-market mechanics, `delphine` (London)
keeps the platform's own fundraising. Every persona states those boundaries and
the co-flag rule at its lane edges. Candidate sourcing and the full top-20 ranking
against the mononaware Agent Workforce talent pool are in the hire memo:
[`workforce/docs/hires/india-energy-research-desk-hire-round.md`](../../docs/hires/india-energy-research-desk-hire-round.md).

## What these files are (and are not)

Per [ADR-0007](../../docs/adr/adr-0007-agent-config-single-source.md) the
`AGENT#{slug}` DDB row family is the **single authoritative store** and
agents-api the single writer. These JSON/markdown files are **one-shot
registration inputs** consumed by `register.mjs`, which POSTs them through
`POST /agents` (validated + audited). After a successful run the DDB rows are
authoritative and these files are historical: config edits go through
`PATCH /agents/{slug}`, never by editing here and re-running (the script
409-skips existing slugs by design).

## Run it

```bash
node workforce/seed/india-energy-group/register.mjs --dry-run        # inspect, no creds
aws-vault exec <profile> -- node workforce/seed/india-energy-group/register.mjs
```

Full procedure + after-registration steps:
[workforce/docs/runbooks/agent-registration.md](../../docs/runbooks/agent-registration.md).

Budget context at authoring time: this round adds USD 43/mo (5-agent desk 31 +
Amara 6 + Julian 6). The W-3 cap raise 250 → 295 rides in the same PR
(governance.md §2 amendment table), pending operator confirmation at merge. The
API re-checks the aggregate at write time, so a roster that grew in the meantime
fails loudly instead of silently breaching the cap.

`bindings` are intentionally `[]` at registration: cadences (the fortnightly
analyst notes, the monthly desk synthesis) are wired afterwards via
`cadence-forge` + PATCH and land paused (`scheduler:"manual"`); enabling any
cron cadence is an operator action ([ADR-0012](../../docs/adr/adr-0012-decouple-binding-from-ownership.md)
decouples binding from skill ownership, so no `owners[]` amendment is needed
first).
