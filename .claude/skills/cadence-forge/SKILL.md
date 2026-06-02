---
name: cadence-forge
description: Author a new "Cadence" skill — the named workforce archetype for a scheduled, persona-voiced periodic task fired by EventBridge → wf-orchestrator-tick → the generic agent-runner CCR routine, whose context is composed from (agent × skill × project) and whose side effect is a deterministic bundled write-script POSTing to an authenticated endpoint with a project-scoped credential. Use whenever you want to mass-produce a new periodic agent task reproducibly instead of hand-copying feed-post. Scaffolds workforce/skills/{name}/ (SKILL.md + meta.json + write-script) that passes validate-skills by construction, then walks you through writing the judgment body, wiring the agent binding, and opening the Rule-11 draft PR. Triggers on requests like "make a new cadence", "scaffold a periodic skill", "create an agent skill that runs on a schedule", "new feed-post-style skill".
---

# cadence-forge

This skill systematizes the procedure for producing a **Cadence** — the workforce's
named archetype (固有名詞) for a scheduled, persona-voiced periodic task. `feed-post`
is instance #1; this forge turns "build one like it" from artisanal copy-paste into
a reproducible four-step procedure.

**Read [`references/cadence-archetype.md`](references/cadence-archetype.md) once** before
your first forge — it is the canonical spec (the EventBridge→CCR wire path, the
(agent × skill × project) composition, and the four invariants every Cadence must hold).

## What a Cadence is, in one breath

EventBridge `rate(2h)` → `wf-orchestrator-tick` (scans bindings, matches `cron`, resolves
the project's credentials) → POSTs a batched `{tasks:[…]}` envelope to the **single**
`agent-runner` CCR `/fire` URL → the routine composes (persona `system.md` × skill
`SKILL.md` × binding `config` × injected credentials) → the LLM produces judgment →
a **bundled deterministic write-script** POSTs to an authenticated endpoint with a
project-scoped credential. No PR, no AWS access in-session.

A skill is a Cadence when its `meta.json` declares `"archetype": "cadence"`. That tag
is enforced by `validate-skills.mjs` (rules `C1`–`C3`): LLM executor, a non-empty
`requires[]` credential, and a bundled `*.mjs` write-script. A mis-built Cadence turns
CI red rather than half-working.

## Procedure

### Step 1 — Decide the four parameters

Before scaffolding, pin down:

| Parameter | Question | Example (feed-post) |
| --- | --- | --- |
| **name** | kebab-case, `^[a-z][a-z0-9-]*$`, no "anthropic"/"claude" | `feed-post` |
| **owners** | which agent slugs may bind it (must exist under `workforce/agents/`) | `dario,maya,…` |
| **credential** | the one project-scoped write credential, from the allowlist¹ | `workforce.feed_write_token` |
| **endpoint** | the authenticated URL its write-script POSTs to | the `/feed` HttpApi |

¹ Allowlist (kept in sync with `validate-skills.mjs:CREDENTIAL_TYPES`): `anthropic.api_key`,
`discord.bot_token`, `discord.webhook_url`, `github.token`, `notion.integration_token`,
`voyage.api_key`, `workforce.feed_write_token`. To add a *new* type you must also register
its shape in `credential-injector.ts` — that's a separate Epic-010 change, out of scope
for a forge.

Also write a one-paragraph **description** ("what + when") for the SKILL.md frontmatter.

### Step 2 — Scaffold

Run the scaffold (dry-run first to eyeball the meta.json):

```sh
node .claude/skills/cadence-forge/scaffold.mjs \
  --name <name> \
  --description "<what + when, ≤1024 chars>" \
  --owners <slug,slug,...> \
  --credential <type> \
  --endpoint <https://…> \
  [--executor llm-prose|claude-code-routine] \
  [--cost-class small|medium|large] \
  --dry-run

# then drop --dry-run to write workforce/skills/<name>/
```

This materializes `workforce/skills/<name>/` with `SKILL.md` (a stub with the
archetype invariants pre-wired), `meta.json` (`archetype: "cadence"`, today's date,
the credential in `requires[]`), and the write-script (modeled on `post-feed.mjs`).
It passes `validate-skills` by construction.

### Step 3 — Write the real body (the only artisanal part)

The scaffold's `SKILL.md` is a stub with `TODO` markers. Replace each — this is the
judgment the LLM performs each fire, and it's the part no template can write for you:

- **Recall packet** — what read-only context the runner assembles before you act.
- **The one thing** — the single unit of judgment per fire, its voice and hard length bounds.
- **Skip rule** — when NOT to write (skipping = not calling the script; W-4).
- **Write step** — already wired to the script; confirm the args match your payload.

Confirm `DEFAULT_API_URL` in the write-script, and adapt the payload shape to your
endpoint if it isn't a `{agent_slug, body}` POST. Then re-validate:

```sh
npm run workforce:skills && npm run workforce:skill-registry:check
```

### Step 4 — Wire the binding + open the PR

Add a `claude-code-routine` binding to each owner agent's `agent.json` and assign a
staggered cron — full snippet + the staggering rule in
[`references/binding-and-cron.md`](references/binding-and-cron.md). **No new claude.ai
routine and no new Secrets Manager entry** are needed: the generic `agent-runner` fires
every Cadence. Then open a **draft PR** (Rule-11: a new SKILL.md body is its own PR;
adding the credential to the project's Secrets Manager bag is the operator's one
out-of-band step, called out in the PR body).

## Guardrails

- **Stay inside the archetype.** If the task needs to *commit a repo artefact* (e.g. an
  article-draft markdown file) rather than POST to an endpoint, it is **not** a Cadence —
  don't tag it `cadence`. Use the draft-PR write-back exception (declared per-skill) instead.
- **One credential, scoped.** A Cadence holds exactly the capability token(s) in its
  `requires[]` — never AWS credentials, never a second project's secrets.
- **Don't invent credential types here.** Adding to `CREDENTIAL_TYPES` is an Epic-010
  trust-boundary change (escalate), not a forge step.
- **Operator owns the binding + the secret.** You author the PR; assigning the cron, sharing
  the credential into the project's Secrets Manager bag, and merging are the operator's call.
