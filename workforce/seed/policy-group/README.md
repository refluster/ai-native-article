# Policy & Regulatory Affairs group — one-shot registration inputs

Five-agent group (2026-06 hire round) that researches and reports on energy/climate
policy and regulation, and drafts public-consultation comment letters for the
operator to file:

| Slug | Role | Residence | USD/mo |
|---|---|---|---|
| `tessa` | VP, Policy & Government Affairs (lead) | Washington, DC, US | 7 |
| `grace` | Grid Policy Analyst, US | Washington, DC, US | 5 |
| `ishaan` | Grid Policy Analyst, India | New Delhi, IN | 5 |
| `astrid` | Director, Standards & Disclosure Watch | Brussels, BE | 5 |
| `mei` | Director, Carbon Markets Research | Singapore, SG | 5 |

Design: **two country analysts (US / India, locally resident) × two function
analysts (frameworks / markets) × one synthesizing lead.** Ishaan covers the
Delhi central-regulatory layer and explicitly defers DISCOM-side ground truth
to `vikram` (Lucknow); Astrid owns the accounting/disclosure frameworks and
Mei the pricing mechanisms, with the boundary stated in both personas.
"Lobbying" is implemented as the only form available at C-3 single-operator
scale: consultation-window tracking + comment-letter drafts routed to the
operator, who alone files (the personas hard-refuse outreach).

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
node workforce/seed/policy-group/register.mjs --dry-run        # inspect, no creds
aws-vault exec <profile> -- node workforce/seed/policy-group/register.mjs
```

Prereq: the `POST /agents` route must be deployed (the data-plane deploy that
ships with this PR's merge). Full procedure + after-registration steps:
[workforce/docs/runbooks/agent-registration.md](../../docs/runbooks/agent-registration.md).

Budget context at authoring time: roster total was USD 129/mo effective; this
group adds 27 → 156, inside the W-3 cap (160). The API re-checks the aggregate
at write time, so a roster that grew in the meantime fails loudly instead of
silently breaching the cap.

`bindings` are intentionally `[]` at registration: cadences (weekly watch
notes, the monthly brief) are wired afterwards via `cadence-forge` + PATCH,
which first requires adding the new slugs to the relevant skills' `owners[]`
(R8 cross-check).
