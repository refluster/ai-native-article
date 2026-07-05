# Media & External Communications group — one-shot registration inputs

Four-agent independent team (Epic-017, 2026-06 hire round) that owns the
integrated external-communications surface — news, podcast, and brand outbound
as one view — stands up the Spotify podcast channel, casts its narrators, and
owns media-specific rights/citation compliance:

| Slug | Role | Residence | USD/mo |
|---|---|---|---|
| `celeste` | VP, Marketing & External Communications (lead) | London, UK | 8 |
| `rhys` | Podcast Scriptwriter | Los Angeles, US | 6 |
| `odette` | Podcast Producer / Narration & Voice Casting | Montréal, CA | 6 |
| `idris` | Media Rights & Compliance Coordinator | Lagos, NG | 6 |

Design (Epic-017 §A): a **net-new VP (統括)** with integrated oversight of every
outbound channel, plus the three craft seats the podcast pipeline needs — the
**judgment** seat (Rhys writes the script; the `podcast-script` Cadence), the
**production** seat (Odette owns synthesis QA + the JA Neural voice pool +
Spotify ops readiness), and the **gate** seat (Idris owns the operational
no-verbatim-reproduction / mandatory-citation checklist and its mechanical
guard). Legal authority does **not** sit in this team: fair-use / derivative-work
/ IP-authority questions escalate to **levi** (Product Counsel) and **priya** (VP
People & Legal) — priya decides whether a persona exists. The team is **O(1)**: a
fixed four-role function that does not fan out with workforce size.

Combined budget **USD 26/mo**, which fits only **after** Epic-017 Story 2 raises
the W-3 ceiling to **USD 250/mo** (`governance.md §2`). The API re-checks the
aggregate across the whole roster at write time, so registering before the cap
raise fails loudly rather than silently breaching it.

## What these files are (and are not)

Per [ADR-0007](../../docs/adr/adr-0007-agent-config-single-source.md) the
`AGENT#{slug}` DDB row family is the **single authoritative store** and
agents-api the single writer. These JSON/markdown files are **one-shot
registration inputs** consumed by `register.mjs`, which POSTs them through
`POST /agents` (validated + audited). After a successful run the DDB rows are
authoritative and these files are historical: config edits go through
`PATCH /agents/{slug}`, never by editing here and re-running (the script
409-skips existing slugs by design).

## Run it (operator, B-authority)

```bash
node workforce/seed/media-group/register.mjs --dry-run        # inspect, no creds
aws-vault exec <profile> -- node workforce/seed/media-group/register.mjs
```

Prereqs:
1. **W-3 raised to USD 250/mo** (Epic-017 Story 2 merged) — otherwise the
   aggregate-cap check rejects the writes.
2. The `POST /agents` route deployed.

Full procedure + after-registration steps:
[workforce/docs/runbooks/agent-registration.md](../../docs/runbooks/agent-registration.md).

`bindings` are intentionally `[]` at registration. The **two** podcast Cadences
are wired afterwards via `wire-cadences.mjs` — `podcast-script` → **rhys** (the
prepare half) and `podcast-publish` → **celeste** (the publish half: sets
`podcastVoice` from Odette's pool + `podcastShowNotes` on `approved` episodes,
then the daily CI workflow synthesises + publishes). Both land **PAUSED**
(`scheduler:"manual"`) — adding a binding is A-authority; enabling the cron is the
separate B-authority step the operator performs. Wiring first requires the
skills' PR merged so their `SKILL#` rows exist (R8 write-time check). (Epic-017
consolidated the original four publish-side skills into `podcast-publish`.)
