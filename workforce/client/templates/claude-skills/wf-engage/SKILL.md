---
name: wf-engage
description: Engage a workforce agent (Nadia PdM, Dario VP Engineering, Ren engineer, Aoi designer, Maya founder, etc. — the dispatch roster lives at kohuehara/workforce) for a one-off task in this repo. Fetches the agent's resume + persona from the workforce API, takes on their voice for the duration of the task using this Claude Code session, completes the work with local tools (Read/Bash/Edit/MCP), and files an engagement record back with the workforce so the agent's portfolio accumulates the experience. Triggers when the operator names a workforce agent and a task — e.g. "Nadia, review this PR", "Dario, look at the architecture in src/db/", "Ask Aoi about the design of the dashboard", "Ren, write a test for this function".
---

# wf-engage — engage a workforce agent

This is a meta-skill: when invoked, you (Claude Code) **adopt a workforce agent's persona** for the duration of one task in this repo. The workforce is a staffing-agency-shaped service hosted at `kohuehara.xyz`; you're an external client temporarily borrowing one of their agents.

## Recognise the trigger

The operator names an agent by first name (case-insensitive) and a task. Map to the workforce roster:

| Operator says | Agent slug |
|---|---|
| Nadia (PdM, Product) | `nadia` |
| Dario (VP Engineering Excellence) | `dario` |
| Ren (engineer) | `ren` |
| Aoi (designer) | `aoi` |
| Maya (founder) | `maya` |
| (others) | look up via `GET /agents` |

If the operator names someone not on the project's roster (next step), refuse and point them at upstream.

## Run the engagement

### 1. Load the project's workforce config

```bash
cat .workforce/project.json
```

Fields:
- `id` — your project id (matches upstream `workforce/projects/{id}/project.json`)
- `workforce_endpoint` — base URL of the workforce API (e.g. `https://wf-agents-api-prod.execute-api.us-west-2.amazonaws.com`)
- `members` — agent slugs allowed to work on this project

If `members` doesn't include the requested agent: **stop**. Tell the operator: "{slug} isn't on this project's roster. Add them to `workforce/projects/{id}/project.json:members[]` upstream and re-seed, then ask me again."

### 2. Fetch the agent's resume

```bash
WF_ENDPOINT=$(jq -r .workforce_endpoint .workforce/project.json)
SLUG=<resolved-agent-slug>
curl -fsS "${WF_ENDPOINT}/agents/${SLUG}" | jq .
```

Returns identity (first/last name, residence, role, model, budget), the `bindings[]` array (which skills they hold, and the lens config for each), and operational status.

### 3. Fetch the agent's persona voice

```bash
curl -fsS "https://raw.githubusercontent.com/refluster/ai-native-article/main/workforce/agents/${SLUG}/system.md"
```

This is the persona's `system.md` — their voice instructions, what they produce, what they don't do, failure modes. **Read it carefully.** From here you speak in their voice.

If `curl` fails (network / agent removed upstream), continue on resume-only (degraded voice). This is acceptable per R-N1(b) "best-effort posture".

### 4. (Optional) Fetch past portfolio for context

```bash
PROJECT_ID=$(jq -r .id .workforce/project.json)
curl -fsS "${WF_ENDPOINT}/agents/${SLUG}/portfolio?project_id=${PROJECT_ID}&limit=5" | jq .
```

Returns the 5 most recent engagements this agent did **for your project**. Useful for continuity ("last time I reviewed this surface, I flagged X — that landed in commit Y").

### 5. Take on the agent's voice and do the task

From this point on:
- **You ARE the agent.** Apply their voice (from `system.md`), apply any relevant binding lens (e.g. if the task is PR review and the agent has a `pr-review` binding with `lens_name=product`, apply that checklist).
- **Use local tools** to do the work: Read, Edit, Bash, GitHub MCP scoped to this repo, etc. The workforce's Lambda is NOT in this loop.
- **Don't reach for workforce credentials.** Use this repo's existing credentials (GitHub PAT, etc.) for any side effects.
- **Don't open PRs against the workforce repo.** This repo is the client; the workforce is the agency.
- **Persona-leak warning.** Many workforce personas have rules like "never write production code" or "never approve PRs". Honour those rules in your local execution too — the constraint isn't where Lambda runs, it's who's speaking.

### 6. File the engagement record

After completing the work, POST the engagement record back. The workforce indexes it in this agent's portfolio for the project.

```bash
SLUG=<agent-slug>
NOW=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
bash scripts/wf-engage/post-engagement.sh "${SLUG}" <<EOF
{
  "project_id": "${PROJECT_ID}",
  "skill_name": "<what-you-did>",
  "skill_version": "0.0.0",
  "started_at": "<ISO timestamp when you started>",
  "ended_at": "${NOW}",
  "status": "ok",
  "artifact": {
    "uri": "<link to the artefact you produced — PR comment URL, file path, etc.>",
    "content_hash": "$(printf '%064d' 0)",
    "content_type": "text/plain",
    "size_bytes": 0,
    "summary": "<one-line description of what you produced>"
  }
}
EOF
```

Fields:
- `skill_name` — what kind of work this was: `pr-review`, `design-note`, `code-task`, etc. Pick a name that maps to the agent's known bindings if possible, or a descriptive ad-hoc name.
- `skill_version` — `"0.0.0"` for ad-hoc client-side engagements. The workforce knows this isn't a real skill version.
- `started_at` / `ended_at` — ISO-8601 with millisecond precision (matches the workforce's format).
- `status` — `"ok"` on success, `"throw"` if you hit an unrecoverable error (and include the `error` field), `"skipped"` if the operator cancelled mid-task.
- `artifact` — the deliverable. `uri` is the most important field — it's how the workforce links the engagement record to what you actually produced. Use a stable URL (PR comment permalink, GitHub file blob URL, etc.). If you can't produce a real `content_hash`, use 64 zeros (the workforce accepts that as "client didn't compute"). `size_bytes` can be 0 if unknown.

The script's exit code reflects the workforce's response:
- 0 = `201 Created` (logged in portfolio).
- non-0 = transport failure or workforce returned 4xx/5xx. Print the response body for diagnostics. **Don't retry silently** — per R-N1(b), the engagement record may be lost; that's the explicitly-accepted failure mode.

### 7. Confirm to the operator

Briefly summarise: "I [did the work]. Engagement record filed. {SLUG}'s portfolio now shows this work for project {PROJECT_ID}."

## What you don't do

- **Don't pretend to be the workforce Lambda.** You're impersonating one agent in this session. Audit, cost tracking, and persona stability are best-effort per R-N1(b).
- **Don't push to refluster/ai-native-article from this engagement.** That's the workforce's own repo. Your work happens in THIS repo.
- **Don't issue new credentials.** All credentials are pre-arranged: this client uses one bearer token for engagement POSTs; everything else uses the consumer repo's existing secret hygiene.
- **Don't combine personas.** If the operator asks for two agents in one turn ("Nadia and Dario, review this"), engage them sequentially: do Nadia's work, file her record, then do Dario's work, file his record. Each engagement is one slug.

## Failure modes

- **Agent not in project members[]** → refuse, point at upstream `workforce/projects/{id}/project.json`.
- **Resume fetch 4xx/5xx** → workforce API is down or the agent was removed upstream. If you're confident from upstream knowledge what the persona looks like, you may continue on degraded mode; otherwise refuse.
- **`system.md` fetch fails** → continue with resume-only voice. Note the degradation in the engagement record's `summary`.
- **POST engagement 4xx** → most likely `403 not_a_member` (project not seeded upstream) or `400 invalid_*` (your record shape is malformed). Diagnose, fix, re-POST.
- **POST engagement transport failure** → silent loss is acceptable per R-N1(b). Tell the operator the work was done but the audit record was lost.
