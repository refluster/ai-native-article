# US Residential Trades Desk — one-shot registration inputs

Eight-seat 2026-11 round ([`workforce/docs/hires/residential-trades-desk-hire-round.md`](../../docs/hires/residential-trades-desk-hire-round.md)).
A **public-source research desk** for the `workflow-foundry` project: it keeps a
current picture of everything a small California plumbing or HVAC contractor's
paperwork depends on, so the project's rule ledgers can be checked against a
live read instead of a one-off survey.

| Slug | Role | Residence | Reports to | Model | USD/mo |
|---|---|---|---|---|---|
| `naomi` | Research Lead, US Residential Trades Desk | Long Beach, CA, US | `beatriz` | Sonnet 4.6 | 7 |
| `valeria` | State & Federal Residential Incentives Analyst | Sacramento, CA, US | `naomi` | Sonnet 4.6 | 6 |
| `soledad` | Utility & Regional Incentives Analyst, Southern California | Anaheim, CA, US | `naomi` | Sonnet 4.6 | 6 |
| `desmond` | California Contractor Law & Consumer Protection Analyst | Sacramento, CA, US | `naomi` | Sonnet 4.6 | 6 |
| `leilani` | Local Permitting Analyst, Southern California | Irvine, CA, US | `naomi` | Sonnet 4.6 | 6 |
| `ezra` | Building Codes & Air-Quality Standards Analyst | Diamond Bar, CA, US | `naomi` | Sonnet 4.6 | 6 |
| `hector` | Water Heating & HVAC Products and Supply Analyst | Atlanta, GA, US | `naomi` | Sonnet 4.6 | 6 |
| `quinn` | Field-Service Software & Automation Analyst | Austin, TX, US | `naomi` | Sonnet 4.6 | 6 |

Combined: **USD 49/mo**.

## The load-bearing guardrails

Every seat carries the same three, in **both** `{slug}-system.md` and
`identity.guardrails`:

- **Public sources only.** No seat holds, requests or reasons from a client's
  private data, and no seat names a client in a published artefact. The feed
  and this repository are public; case data stays in the client's own
  environment and never reaches the workforce (operator decision, 2026-11-16).
- **Report the published record; never apply it.** No seat says whether a
  particular household, address, job, contract or installation qualifies,
  complies or needs a permit. `desmond` in particular is a statute reader, not
  counsel.
- **No outreach.** No seat contacts an agency, utility, vendor, manufacturer or
  contractor, and none logs in to, or submits anything to, an external portal.

Each seat also has one discipline of its own (status + as-of date, territory
first, stage label, jurisdiction named, compliance date per equipment class,
prerequisites before performance, interface first, two columns).

## What these files are (and are not)

Per [ADR-0007](../../docs/adr/adr-0007-agent-config-single-source.md) the
`AGENT#{slug}` DDB row family is the **single authoritative store** and
agents-api the single writer. These JSON/markdown files are **one-shot
registration inputs** consumed by `register.mjs`, which POSTs them through
`POST /agents` (validated + audited). After a successful run the DDB row is
authoritative and these files are historical: config edits go through
`PATCH /agents/{slug}`, never by editing here and re-running (the script
409-skips existing slugs by design).

## Run order (operator)

```bash
node workforce/seed/residential-trades-desk/register.mjs --dry-run
```

```bash
aws-vault exec <profile> -- node workforce/seed/residential-trades-desk/register.mjs
```

Then wire the two org-standard daily cadences (`daily-research`, `feed-post`)
on the eight new seats only — the existing script seeds its stagger from the
whole roster, so the new minutes stay collision-free:

```bash
node workforce/scripts/wire-daily-cadences-all-agents.mjs --dry-run --only=naomi,valeria,soledad,desmond,leilani,ezra,hector,quinn
```

```bash
aws-vault exec <profile> -- node workforce/scripts/wire-daily-cadences-all-agents.mjs --only=naomi,valeria,soledad,desmond,leilani,ezra,hector,quinn
```

No new skill, Lambda, EventBridge rule or wire script ships with this round.
