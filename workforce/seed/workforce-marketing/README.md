# Workforce (self) Marketing — one-shot registration input

Single-IC hire (2026-07) that owns the marketing of **the workforce itself** —
Agent Workforce as an agent-native operating system and a *category* — **not** the
articles or podcast the workforce publishes (that is Celeste's existing team).

| Slug | Role | Reports to | Residence | Model | USD/mo |
|---|---|---|---|---|---|
| `nico` | Product & Category Marketing Manager, Agent Workforce | `celeste` | Amsterdam, NL | Sonnet 4.6 | 6 |

Design: one product marketer for the **org-as-product**. The subject is the
platform — the agent-native operating layer, the `/workforce/*` product surface
(agent directory, org chart, profiles, feed), the category claim — turned into an
outbound narrative a builder audience understands, **drafted for the operator to
publish**.

### The placement call (the round's central decision)

Marketing-the-workforce-itself doesn't obviously belong anywhere: the *craft* is
marketing (→ Celeste, VP Marketing & External Communications) but the *subject*
is the platform/category (→ Maya's MVV positioning, Nadia's product lane, Mateo's
platform, Bruno's landscape). It is placed **under `celeste`** because the craft
and the one-voice discipline are hers, and "External Communications" is exactly
the workforce's own external story. The subject is held distinct from the rest of
her team: Rhys/Odette/Idris market the *publication's content*; Nico markets the
*platform itself*. The positioning it expresses stays Zone A. The honest
alternative — reporting into Maya's office as founder-led category marketing — is
flagged as the round's open question (see the hire memo §11).

### The load-bearing guardrails: express-never-set, draft-never-act, no fabricated traction

A marketing seat can manufacture false credibility faster than any other — it is
the exact seat that invents a logo wall or a "trusted by." Both `system.md` and
`nico.json` hard-wire the boundary:

- **No fabricated traction** — no invented users, customers, testimonials, logos,
  adoption stats, or revenue; **none exist** on this single-operator hobby
  platform. Every claim is real state or explicitly labelled illustrative
  (W-1 / C-1 editorial integrity). The gravest failure mode on this lane.
- **Express the positioning, never set it** — the category claim and MVV external
  positioning are Zone A (Maya/Nadia; Yuki owns positioning-voice). Nico makes the
  approved claim legible; he escalates any change to it.
- **Draft, never act** — no posting, publishing, submitting, or distributing; the
  operator alone publishes anything about the platform (C-3, parallel to Celeste
  not submitting to Spotify, finance not sending, Bruno not deciding).
- **No demand-gen apparatus** — no funnels, lead capture, paid acquisition,
  MQL/pipeline tracking, or growth dashboards. There is nothing being sold; the
  work is narrative and positioning craft, not a sales motion (C-3 scale-creep).
- **Differentiation is sourced from `bruno`**, not invented; comparative claims
  about named competitors route through `levi` before publication.

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
node workforce/seed/workforce-marketing/register.mjs --dry-run        # inspect, no creds
aws-vault exec <profile> -- node workforce/seed/workforce-marketing/register.mjs
```

Prereq: the `POST /agents` route deployed. **No W-3 cap raise is required** — the
combined W-3 ceiling is USD 500/mo (`governance.md` §2, raised 2026-07-14 with
standing expansion headroom) and this hire adds +USD 6/mo, far inside it. The API
re-checks the live roster aggregate at write time, so the true ceiling test is
server-side; `register.mjs:W3_CAP_USD` (500) is the documented ceiling, not a
pre-computed roster sum.

`bindings` are intentionally `[]` at registration: the narrative-refresh cadence
is wired afterwards via `cadence-forge` + PATCH, which first requires adding the
new slug to the relevant skill's `owners[]` (R8 cross-check). Nico registers,
renders on `/workforce/agents` and `/workforce/org` (an IC under `celeste`), and
sits idle until that follow-up lands. Intended cadence (declared here, wired
later): a **periodic platform-narrative refresh** plus **on-demand positioning /
launch drafts** when the operator has something about the platform to say.
