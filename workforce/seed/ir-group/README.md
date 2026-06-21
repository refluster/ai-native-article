# IR Reporting & Visit-Coordination pod — one-shot registration inputs

Two-agent **expansion of the existing IR function** (2026-06 hire round) that
adds reporting *throughput* and *visit-coordination* craft under Corinne, the
incumbent IR Manager — all as drafts and plans the **operator alone** acts on:

| Slug | Role | Reports to | Residence | Model | USD/mo |
|---|---|---|---|---|---|
| `marisol` | Investor & Sponsor Reporting Associate | `corinne` | Mexico City, MX | Sonnet 4.6 | 5 |
| `yara` | Investor Relations Visit & Events Coordinator | `corinne` | Dubai, AE | Sonnet 4.6 | 5 |

Design: **one report-craft IC × one visit-craft IC, both reporting to Corinne**,
who steps up as the synthesising lead of the IR pod under Silas (VP Finance).
Corinne owns the cadence and the message; Marisol inherits both for the recurring
sponsor/investor report; Yara inherits both for the visit run-of-show and
briefing pack — so the pod never speaks with two voices or two sets of numbers.
This is the one-voice property of the finance group extended **recursively** one
level down. Silas's span is unchanged at 2; Corinne gains span 2.

### The load-bearing guardrail: draft / stage, never act

These two roles are the IR lane's most action-tempted seats — the associate who
"just sends the monthly to the sponsor," the coordinator who "just emails the
investor to lock the date." **Both hard-refuse outreach.** This is the only form
sponsor reporting and visit-coordination can take at **C-3 single-operator
scale**, and it is the direct analogue of how `corinne` drafts-not-sends and
`delphine` maps-the-path-but-never-makes-contact:

- No persona sends a report, confirms a date, extends an invitation, or hosts a
  day. Marisol stages the report; Yara stages the visit; the operator alone acts.
- No persona claims the platform has sponsors, investors, a report being sent, or
  a visit being hosted — **it has none.** Public output is *craft
  thought-leadership* ("how to write a sponsor stewardship report," "how to run
  an investor site visit"), never a report on, or a plan for, a real event.
- No persona fabricates figures. Every number is the operator's real cost data or
  **explicitly labelled illustrative**, and every figure on a report or a visit
  reconciles to Silas's single model. (W-1 / C-1 editorial integrity.)
- Disclosure questions ("is this safe to show, and to whom") route to `levi`
  (product counsel) and the operator — never adjudicated in-lane.

The bias-disclosure blocks in both `*-system.md` files are unusually load-bearing
for exactly this reason and are parallel-structured to Corinne's.

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
node workforce/seed/ir-group/register.mjs --dry-run        # inspect, no creds
aws-vault exec <profile> -- node workforce/seed/ir-group/register.mjs
```

Prereq: only that the `POST /agents` route is deployed. **No governance edit is
a prerequisite** — unlike the finance group, this round needs no W-3 cap raise:
roster total was USD 174/mo effective (after the finance group); this pod adds
10 → **184**, inside the **standing** W-3 cap (190). The API re-checks the roster
aggregate at write time, so if anything has pushed the roster past 190 since this
was authored the registration fails loud at 184+ against 190 instead of silently
breaching it. Full procedure + after-registration steps:
[workforce/docs/runbooks/agent-registration.md](../../docs/runbooks/agent-registration.md).

`bindings` are intentionally `[]` at registration: cadences (the recurring
reporting-draft, the on-demand visit-prep) are wired afterwards via
`cadence-forge` + PATCH. Since [adr-0012](../../docs/adr/adr-0012-decouple-binding-from-ownership.md)
binding is no longer gated on `owners[]`, so no skill-ownership amendment is
needed first. The personas register, render on the directory (both row-2 ICs
under Corinne), and sit idle until those follow-ups land — same posture as the
finance group at registration.

Full rationale, panel discussion, and the C-3 boundary on 視察コーディネーション:
[docs/hires/ir-reporting-and-visits-hire-round.md](../../docs/hires/ir-reporting-and-visits-hire-round.md).
