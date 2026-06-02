---
name: discord-heartbeat
description: Post a single liveness heartbeat embed to the team Discord channel via webhook URL. CCR-routed sibling of the deterministic `discord-ping` skill — same intent (the workforce's dispatch chain is alive), different execution surface (CCR session via agent-runner.md). Deterministic-shape: the CCR session invokes the bundled `post.mjs` script verbatim; no LLM construction of the webhook payload. Reads the Discord webhook URL from the active project's credential bag (`discord.webhook_url`); does NOT use environment variables or special-case secret paths.
---

# discord-heartbeat

Post one short status embed to the team Discord channel, every time this skill fires. The point is **monotonic operator confidence**: a heartbeat means "the workforce's CCR dispatch chain (orchestrator-tick → CCR session → outbound HTTP) is healthy right now."

Sibling to `discord-ping` (which does the same on the Lambda path). Both can coexist during the CCR trial; discord-ping reads its webhook URL from a Lambda env var (legacy), discord-heartbeat reads its webhook URL from the active project's credential bag (the canonical Epic-010 §5 path).

## Reasoning shape — deterministic

The payload posted to Discord is structurally identical every fire. The skill is therefore a **deterministic-shape skill**: the CCR session does NOT construct the JSON itself, does NOT compose the embed body, does NOT decide colors. It runs the bundled script and reports the exit code. This keeps token use minimal and the on-wire output bit-stable.

The general rule: if a future skill's value comes from LLM judgment over varying inputs (feed-post's body, an article draft, a PR review), the LLM generates the output directly. If a skill's value is "execute this side-effect verbatim with the inputs I'm given" (this skill, a label-add, a webhook ping), the LLM invokes a script. Each fire of a deterministic-shape skill should produce identical output for identical inputs.

## How to execute (CCR session instructions)

Your fire payload includes:

- `agent_slug` — who you are speaking as (e.g. `yuki`)
- `binding_idx` — your binding row index in `workforce/agents/{agent_slug}/agent.json`
- `project_id` — the project context (e.g. `agent-workforce`)
- `ticked_at` — ISO timestamp the orchestrator decided to fire you
- `credentials` — sealed map. For this skill: `{"discord.webhook_url": {"url": "https://discord.com/api/webhooks/..."}}`

Run:

```sh
DISCORD_WEBHOOK_URL="$(<url from credentials['discord.webhook_url']>)" \
AGENT_SLUG="<agent_slug from payload>" \
TICKED_AT="<ticked_at from payload>" \
  node workforce/skills/discord-heartbeat/post.mjs
```

Report the exit code in your session output:

- `0` — heartbeat delivered (Discord returned 204).
- `1` — env-var misconfiguration. Operator must verify the `agent-workforce` project's credential bag is correctly populated.
- `2` — Discord webhook returned non-2xx. Read stderr for the status + body.
- `3` — network / fetch error. Likely transient; next tick is the retry.

Do **not** retry inside this fire — the orchestrator's 2-hourly cadence is the retry surface.

Do **not** look for the webhook URL anywhere else — not in env vars on your routine, not in repo files, not in operator chat. The credential bag is the only authoritative source; if it's missing the right key, fail loudly with exit code 1.

## What the script posts

See `post.mjs` source — it's intentionally short. The shape:

```json
{
  "embeds": [
    {
      "title": "wf-pulse · {agent_slug}",
      "color": 3447003,
      "timestamp": "{ticked_at, second precision}"
    }
  ]
}
```

`color: 3447003` is `0x3498db` (info blue) — bit-identical to the discord-ping handler. Future health states (degraded / warn / critical) would be a script change with new color constants, not an LLM decision.

## No skip path

Unlike `feed-post`, this skill **does NOT have a skip path**. Every fire posts. A "skipped" heartbeat is indistinguishable from a "dispatch chain broken" outage — exactly the signal this skill exists to disambiguate. If the script's exit code is anything other than 0, that's the signal; don't paper over it.

## Cost

- One HTTPS POST per fire. Discord webhook is free.
- LLM cost is just the wrapping — read SKILL.md (this file) + agent-runner.md + Yuki's system.md + execute one bash command. At Sonnet that's roughly ~500 input tokens + ~30 output tokens per fire = ~$0.0007/fire = ~$0.25/month at the 2-hourly cadence. Well under Yuki's USD 5/month budget.
- A future cost-optimization PR can collapse the SKILL.md-read step further (cache the routine across fires) but that's premature at v1.

## Failure modes

- **`credentials["discord.webhook_url"]` missing on the fire payload** — the project's credential bag doesn't have the key. Exit code 1 from the script (env var unset). Operator must add the secret at `wf/projects/{project_id}/discord.webhook_url`.
- **Discord webhook returns non-2xx** — exit code 2 from the script. Surfaces the status + truncated body on stderr. Discord webhook URLs can be rotated/revoked; the operator's `aws secretsmanager update-secret-value` flow is the fix.
- **Network timeout** — exit code 3 from the script. Surfaces the underlying error on stderr.

## Why this exists when discord-ping already does it

Three reasons:

1. **No env-var special-case for the webhook URL.** discord-ping reads from `DISCORD_WEBHOOK_SECRET` env var. That predates Epic-010's project credential bag and is a one-off path. discord-heartbeat consumes the same primitive (`discord.webhook_url`) as any other skill would.
2. **Validates the CCR dispatch chain.** discord-ping running on Lambda only verifies the Lambda path is alive. If CCR is silently broken, the heartbeat keeps firing and the operator has no signal. discord-heartbeat on CCR closes that gap.
3. **Additive, not destructive.** discord-ping stays. If discord-heartbeat misbehaves during the trial, the Lambda heartbeat continues — the workforce never loses its liveness signal.

When CCR proves out, the operator may decide to retire discord-ping in favor of discord-heartbeat. At that point `discord-ping/handler.ts` can `import` from `discord-heartbeat/post.mjs` to share the payload-construction code — but that consolidation is deliberately not in this PR.

## Related

- `workforce/skills/discord-heartbeat/post.mjs` — the deterministic script.
- `workforce/skills/discord-ping/SKILL.md` — the Lambda sibling.
- `workforce/docs/routines/agent-runner.md` — the CCR routine that executes this skill.
- `workforce/lambdas/shared/credential-injector.ts` — the credential-injection primitive.
- `workforce/projects/agent-workforce/project.json` — the project this skill's webhook URL belongs to.
- [Epic-010 §5](../../docs/epics/epic-010-project-trust-boundary.md) — the per-project credential-bag design.
