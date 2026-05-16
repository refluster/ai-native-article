# Workforce — AI Agent Org on AWS

A parallel system to the article pipeline. Read [/Users/koh.uehara/.claude/plans/ai-linkedin-ui-db-zany-pixel.md](../../../.claude/plans/ai-linkedin-ui-db-zany-pixel.md) for the full design; this README is the orientation for someone (human or routine) opening the directory for the first time.

## What this is

Six LLM-driven agents — `pm`, `eng`, `design`, `devops`, `cs`, `skillops` — operating as a small SaaS product-dev org. Each agent has a JD, a set of scheduled skills, accumulated deliverables, and long-term memory. Skills are reusable (one skill → N agents). The SkillOps Manager weekly-reviews and proposes improvements to every skill.

Surface:

- **Frontend** — LinkedIn-style talent directory at `/workforce` (routes added in PR5 inside the existing kohuehara.xyz SPA).
- **Backend** — AWS SAM. APIGW HTTP API → Lambda → DynamoDB + S3. EventBridge runs the periodic skill executions.

## Why AWS, why now

The GAS pipeline (article side) stays frozen as-is. The workforce is greenfield — designed from scratch on AWS so we get:

- Real Lambda streaming for chat UX (GAS times out at 6 min and doesn't stream).
- DynamoDB for hot reads on agent profile / deliverables (no Notion rate limit).
- EventBridge for per-agent cron (GAS triggers are global to a script).
- Secrets Manager (no API keys embedded in SKILL.md frontmatter, unlike the GAS-side `skills/`).

## Forward-compatibility with Claude Managed Agents

All persistent formats are designed to be `cp -r`-portable later:

- `agents/{slug}/agent.json` — mirrors the Managed Agents JSON schema (`name`, `model`, `system`, `tools[]`, `skills[]`, `metadata{}`).
- `skills/{name}/SKILL.md` — openclaw frontmatter (`name`, `description`, `version`, `metadata.openclaw{…}`).
- Memory is filesystem-shaped (`/mnt/memory/{posix-path}`-style), versioned with `memver_…` IDs.

Migration plan: `aws s3 sync s3://wf/{agents,skills} ./` → Managed Agents API upload.

## Layout

```
workforce/
├── infra/sam/                 # AWS resources (SAM template)
├── agents/{slug}/             # Per-agent: agent.json, system.md, avatar.png
├── skills/{name}/             # Reusable skills (openclaw schema)
├── lambdas/                   # Lambda handler source
│   ├── agents-api/
│   ├── chat-api/
│   ├── task-runner/
│   ├── skill-ops-reviewer/
│   ├── seed/
│   └── shared/                # llm-router, ddb, s3, memory-store, skill-loader
├── seed/                      # Bootstrap input (agents.yaml, skills.yaml)
└── ROADMAP.md                 # Build checklist (machine-written; routine consumes)
```

## How this gets built

A daily Claude Routine fires at 09:00 JST, reads [ROADMAP.md](ROADMAP.md), picks the next un-merged PR in the PR1→PR6 sequence, implements it, opens a PR via the `ship-pr` skill, watches CI, escalates merge to the human. Agents never self-merge (governance C-3).

PR1 is this scaffold. PR2→PR6 are progressively filled in by the routine.

## Governance

- Zone classifications: see [../AGENTS.md](../AGENTS.md). `workforce/lambdas/**`, `workforce/infra/**`, `src/pages/workforce/**`, `src/components/workforce/**` are Zone B (agent-merge-allowed with CI + review). `workforce/agents/**/*.{json,md}` and `workforce/skills/**` are Zone B with Rule 11 (prompt-version bump = own PR) applied.
- C-3 stays: a Claude routine drafts and opens; a human merges.
- C-4 stays: any silently-degraded LLM output (truncation, `finish_reason=length`) throws, never publishes.
