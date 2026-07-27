# VP, Operations & Reliability — one-shot registration input

Single-VP hire (2026-07) that owns the workforce's **automation
accountability discipline** — making sure a scheduled/automated process that
fails silently is a contradiction in terms, by pairing every notification
with a persistent, owned, closeable record instead of a chat ping nobody
follows up on.

| Slug | Role | Reports to | Residence | Model | USD/mo |
|---|---|---|---|---|---|
| `petra` | VP, Operations & Reliability | `maya` | Copenhagen, DK | Sonnet 4.6 | 8 |

Full rationale, panel framing, and cost analysis:
[workforce/docs/hires/vp-operations-hire-round.md](../../docs/hires/vp-operations-hire-round.md).

Design: one VP, no direct reports at registration, whose first deliverable
(shipped in the same PR as this bundle) is the
[`ops-accountability-watch`](../../skills/ops-accountability-watch/SKILL.md)
Cadence and the
[chat-notification-policy.md](../../docs/runbooks/chat-notification-policy.md)
it enforces. Reports to `maya` (every existing VP does); laterals to `dario`
(the engineering surface her Cadence watches), `elena` (the article publish
pipeline it also watches), `camille` (Chief of Staff — the adjacent,
distinct attention-ledger), `tomas` (org-metrics-pulse), and `mateo` (the
platform R-N shape rules her mechanisms live inside).

## What these files are (and are not)

Per [ADR-0007](../../docs/adr/adr-0007-agent-config-single-source.md) the
`AGENT#{slug}` DDB row family is the **single authoritative store** and
agents-api the single writer. These JSON/markdown files are **one-shot
registration inputs** consumed by `register.mjs`, which POSTs them through
`POST /agents` (validated + audited). After a successful run the DDB row is
authoritative and these files are historical: config edits go through
`PATCH /agents/petra`, never by editing here and re-running (the script
409-skips existing slugs by design).

## Run it

```bash
node workforce/seed/vp-operations/register.mjs --dry-run        # inspect, no creds
aws-vault exec <profile> -- node workforce/seed/vp-operations/register.mjs

# after the skill-folder PR is merged + deployed:
node workforce/seed/vp-operations/wire-cadence.mjs --dry-run
aws-vault exec <profile> -- node workforce/seed/vp-operations/wire-cadence.mjs
```

Prereq: the `POST /agents` route deployed. **No W-3 cap raise is required**
— the combined W-3 ceiling is USD 500/mo (`governance.md` §2, raised
2026-07-14 with standing expansion headroom) and this hire adds +USD 8/mo,
far inside it. The API re-checks the live roster aggregate at write time, so
the true ceiling test is server-side; `register.mjs:W3_CAP_USD` (500) is the
documented ceiling, not a pre-computed roster sum. Full procedure +
after-registration steps:
[workforce/docs/runbooks/agent-registration.md](../../docs/runbooks/agent-registration.md).

`bindings` are `[]` at registration; `wire-cadence.mjs` is a **separate**
script in this same bundle (not a follow-up PR) because this hire's entire
first deliverable IS this one Cadence — but it still runs as its own,
later step, since binding requires the skill folder to be merged and
deployed first (`SKILL_REQUIRES` regeneration — see the script's header).
Both `register.mjs` and `wire-cadence.mjs` require operator AWS credentials
(`aws-vault exec`) and are **not executed by this PR** — staging the bundle
for the operator to run is the deliverable, matching every prior hire-round
PR's posture (see e.g. `workforce/seed/ecosystem-landscape/`).
