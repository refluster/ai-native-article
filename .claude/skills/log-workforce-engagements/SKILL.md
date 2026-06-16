---
name: log-workforce-engagements
description: Batch-record workforce engagements (Track Record EXEC rows) for every contributor of a session's work — the multi-row companion to the single-write workforce/scripts/record-engagement.mjs. Use after a session where agent personas authored or reviewed PRs (e.g. a pr-route review panel, a Legal Amendment Review Committee verdict) and each contributor's ACTIVITY / RUNS·DELIVERABLES ledger should reflect it. Resolves a reachable agents-api base (the custom domain is egress-blocked in remote sessions) and loops the canonical writer over a rows file. Triggers on requests like "log the engagements", "register the contributors' track records", "record engagements for this session's PRs", "実績登録して".
---

# log-workforce-engagements

Record **one engagement (EXEC row) per contributor** for a batch of work, so each
agent persona's **ACTIVITY / RUNS · DELIVERABLES** deck reflects the session. This
is the multi-row driver around the canonical single-write script —
[`workforce/scripts/record-engagement.mjs`](../../../workforce/scripts/record-engagement.mjs)
(ADR-0005 item 5, the one activity sink). It does **not** re-implement the mint/POST;
it resolves a reachable API base and loops.

## Why a skill, not a `for` loop you retype each time

Two things bite every time and are encoded here so they aren't rediscovered:

1. **The custom domain is egress-blocked in a remote session.** `record-engagement.mjs`
   defaults `WF_API_BASE` to `https://workforce-api.kohuehara.xyz`, but a remote
   Claude Code session's network allowlist rejects it — the POST dies with
   `403 Host not in allowlist`. The API Gateway **execute-api** host *is* reachable.
   The bundled script resolves it from the live stack output
   (`wf-data-plane-{stage}` → `AgentsApiUrl`) via the session's AWS creds — the same
   creds that are the token-mint trust gate — and sets `WF_API_BASE` for every row.
2. **The trust gate is AWS creds, not a project credential.** This is **not** a
   Cadence: nothing schedules it, it holds no project-scoped capability token. The
   mint (`dynamodb:UpdateItem` on `wf-table-{stage}`) needs AWS credentials in the
   shell. In a remote session those are present (`aws sts get-caller-identity` works);
   that is what lets the session do this directly instead of dispatching the
   `workforce-record-engagement.yml` workflow (which needs `actions:write` the
   session's GitHub token lacks).

## Run

Write a rows file, then run the batch (preview with `--dry-run` first):

```sh
cat > /tmp/engagements.json <<'JSON'
[
  { "agent": "maya",  "skill": "legal-amendment-review-committee",
    "summary": "Chaired the committee on #330 — APPROVE.", "uri": "https://github.com/refluster/ai-native-article/pull/330" },
  { "agent": "nadia", "skill": "pr-route",
    "summary": "Routed #332 and synthesised the 🟢 verdict.", "uri": "https://github.com/refluster/ai-native-article/pull/332" }
]
JSON

node .claude/skills/log-workforce-engagements/scripts/log-engagements.mjs \
  --rows /tmp/engagements.json --project agent-workforce --dry-run
# drop --dry-run to write
```

Flags: `--rows <file>` (required), `--project <id>` (default `agent-workforce`),
`--stage <dev|prod>` (default `prod`), `--dry-run`. Per-row `project` / `status`
override the defaults. Exit 0 = all rows recorded; exit 1 = ≥1 failed (the rest
still ran — re-run with a rows file trimmed to the failures).

### Row shape

| Field | Required | Meaning |
| --- | --- | --- |
| `agent` | ✓ | whose Track Record this lands on (slug) |
| `skill` | ✓ | EXEC label — a bound skill (`pr-review`, `pr-route`) or a descriptive non-cadence label; R-N1(b) best-effort, not registry-validated |
| `summary` | ✓ | ONE title-first business sentence (≤512 chars), an accomplishment, not a machine blob |
| `uri` | – | artefact link (PR / run / page) |
| `status` | – | `ok` \| `throw` \| `skipped` (default `ok`; a `skipped` row says *why* in its summary) |
| `project` | – | project id the row files under (default `--project`) |

## Discipline (inherited from record-engagement)

- **One row = one completed unit of work.** Don't log "started X"; don't backfill
  cadence runs (the CCR runner already self-records those — logging again
  double-counts); don't fabricate a deliverable to fill a row.
- **Title-first summaries.** The operator reads the summary deck — lead with the
  result, never a technical string.
- **Reviews count.** When an agent's `pr-review`/`pr-route` lens was applied inline
  (the common case until dispatch is wired everywhere), that review is real work and
  belongs on the reviewer's Track Record — one row per (agent, PR).

## Related

- [`workforce/skills/record-engagement`](../../../workforce/skills/record-engagement/SKILL.md) — the single-write workforce skill this batches.
- [`workforce/scripts/record-engagement.mjs`](../../../workforce/scripts/record-engagement.mjs) — the canonical mint+POST writer.
- ADR-0005 (engagement = the one activity sink), ADR-0009 (short-lived mint token).
