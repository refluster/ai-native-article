# `workforce-client` — drop-in package for external repos

A thin client that lets a downstream repo (RepoA) engage agents from the [kohuehara/workforce](https://github.com/refluster/ai-native-article) dispatch agency directly inside its own Claude Code session.

**The mental model is staffing**: you (the operator working in RepoA) request a workforce agent — Nadia for PdM, Dario for architecture, Ren for engineering, Aoi for design — to do a one-off piece of work in this repo. The agent works through this Claude Code session under their own voice; the workforce serves identity and accepts the engagement record (the work report) back into the agent's portfolio.

Trust posture is **best-effort per [governance §4 R-N1(b)](../docs/governance.md)**: the workforce doesn't see the LLM call, doesn't enforce W-3 budget, and doesn't guarantee persona stability between executions. The C-3 single-operator-scale design choice makes those failure modes acceptable.

## What you install

Two surfaces land in your repo after running [`scripts/install.sh`](scripts/install.sh):

```
RepoA/
  .claude/skills/wf-engage/SKILL.md   ← The skill Claude Code reads. Defines the
                                         "engage an agent" flow end-to-end.
  .workforce/
    project.json                        ← Your project's mirror of workforce's seed
                                            (project_id, endpoint, members list).
    .env.example                        ← Template. Operator copies to .env and
                                            pastes the bearer token.
  scripts/wf-engage/
    post-engagement.sh                  ← Bash helper the skill invokes after
                                            completing a task — POSTs the
                                            engagement record back.
```

## Install

From the consumer repo's root:

```bash
curl -fsSL https://raw.githubusercontent.com/refluster/ai-native-article/main/workforce/client/scripts/install.sh | bash
```

Or, if you already have this repo checked out:

```bash
bash /path/to/ai-native-article/workforce/client/scripts/install.sh
```

The installer prints next-step instructions:

1. Edit `.workforce/project.json` — replace placeholders with your project's id (must match a `workforce/projects/{id}/project.json` upstream) and the workforce API endpoint.
2. Copy `.workforce/.env.example` → `.workforce/.env` and paste the bearer token the workforce operator issued you.
3. Add `.workforce/.env` to `.gitignore`.
4. Upstream PR: add `workforce/projects/{your_id}/project.json` to the workforce repo declaring which agents are on your project's roster.
5. In Claude Code: `Nadia, review this PR` (or any agent + task).

## How a typical engagement flows

```
operator (in RepoA's Claude Code session):
  "Nadia, review PR #42"

Claude Code reads .claude/skills/wf-engage/SKILL.md, which tells it to:
  1. Resolve "Nadia" → slug "nadia"
  2. Confirm "nadia" is in .workforce/project.json:members[]
  3. GET ${endpoint}/agents/nadia                                 ← resume (identity, role, bindings)
  4. GET raw.githubusercontent.com/.../workforce/agents/nadia/system.md  ← persona voice
  5. (optional) GET ${endpoint}/agents/nadia/portfolio?project_id=…    ← past work for context
  6. Adopt Nadia's voice, do the review using local tools
     (Read, Bash, Edit, GitHub MCP — RepoA's own credentials)
  7. POST a comment to PR #42 on RepoA's repo
  8. bash scripts/wf-engage/post-engagement.sh nadia < <(engagement record JSON)
     ↳ files the record at workforce: appendExecution(PROJECT#{your_id}/EXEC#…)
```

The workforce sees the engagement record (timestamps, summary, link to the artefact). It never sees the diff, the prompt, or the model output. RepoA pays for the LLM call; RepoA's credentials post the comment.

## What this client deliberately does NOT do

- **Doesn't ship agent definitions.** The persona's `system.md` is fetched fresh from the upstream repo at engagement time. Caching is the consumer's choice; staleness is acceptable per R-N1(b).
- **Doesn't enforce membership server-side.** The workforce's `appendExecution()` does that. If you POST an engagement for an agent that isn't a project member, the API returns 403.
- **Doesn't pay for the LLM.** Your Claude Code session does the inference using your subscription / API credits.
- **Doesn't carry workforce credentials.** GitHub PATs, Notion tokens, Discord webhooks — those belong to RepoA and are managed by RepoA's existing secret hygiene. The only token this client uses is the engagement-write bearer for the audit POST-back.
- **Doesn't bidirectionally sync state.** This is a unidirectional reporter: outbound metadata pull, inbound engagement-record post. No two-way reconciliation, no idempotency layer beyond the workforce's `appendExecution()` row write.

## Updating

This package is versioned by git commit on upstream. To pull a newer copy:

```bash
bash scripts/wf-engage/install.sh    # re-runs install; safe — overwrites the skill + helper
```

If the SKILL.md contract changes upstream (new fields, new endpoints), re-running install picks it up. Your `.workforce/project.json` and `.workforce/.env` are NOT touched.

## Failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| Skill not visible in Claude Code | `.claude/skills/wf-engage/SKILL.md` missing or unreadable | Re-run installer |
| "agent not in members[]" | The agent isn't on this project's roster | Add to upstream `workforce/projects/{id}/project.json`, re-seed |
| 401 on POST engagement | `WF_TOKEN` missing in `.workforce/.env` | Ask operator for bearer |
| 403 on POST engagement | Project isn't seeded upstream OR agent isn't a project member | Check upstream `workforce/projects/{id}/` |
| Fetch of `system.md` fails | Network issue OR upstream agent removed/renamed | Skill still functions on resume-only, but the persona voice is degraded |

## Cross-references

- Upstream governance: [`workforce/docs/governance.md`](../docs/governance.md) — R-N1(b) declares client-side execution as a permitted exception.
- Upstream API: [`workforce/lambdas/agents-api/handler.ts`](../lambdas/agents-api/handler.ts) — the `GET /agents/...` + `POST /agents/{slug}/engagements` surface.
- Onboarding flow (workforce side): [`workforce/docs/runbooks/external-project-onboarding.md`](../docs/runbooks/external-project-onboarding.md).
