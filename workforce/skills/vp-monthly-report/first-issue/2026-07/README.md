# vp-monthly-report — 創刊号 (2026年7月) staging

The 7 inaugural VP letters, written 2026-07-08 in-session per the operator's
direction ("まずはレポートを書こう…skillとして登録、bindしよう"). The process
that produced them is what `../SKILL.md` codifies (recall packet → digest →
documentary interviews from the live feed + epic RFC records → write → verify
→ deterministic post).

**These files are a one-time staging artefact, NOT a content source of truth
(C-2/W-2).** The remote session that authored them cannot reach the Notion API
(egress allowlist), so the deterministic write is deferred to the operator.

## Publish (operator, from an unrestricted machine)

```sh
NOTION_API_KEY=<wf/projects/agent-workforce notion.integration_token apiKey> \
  node workforce/skills/vp-monthly-report/first-issue/2026-07/publish.mjs
```

The helper loops the canonical writer over all 7 letters (`--agent <slug>`,
body + abstract per VP) and stops loud on the first non-zero exit (W-1 guard /
API error). Re-running after a partial failure re-posts only the slugs listed
on the command line, e.g. `… publish.mjs tessa elena`.

## After publishing

Notion becomes the authoritative copy (C-2). **Delete this `2026-07/`
directory in a follow-up commit** — from next month the letters are produced
by the bound cadence (`wire-vp-monthly-report.mjs`) and never staged in git.
