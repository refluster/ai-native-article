---
name: discord-ping
description: Post a one-line liveness ping to the team Discord channel. Use to confirm the cron → orchestrator → runner → external-side-effect path is alive end-to-end without committing real generation tokens. Triggers on task_kind=ping. Body is intentionally trivial — this is a heartbeat, not a deliverable.
---

# discord-ping

A heartbeat from the workforce. The point is the pipeline, not the prose.

## Instructions

Produce **exactly one line**, then stop. No leading prose, no trailing prose, no markdown formatting around it. The line is what the runner posts verbatim to Discord.

Format:

```
[wf-pulse] {your slug} alive at {ISO-8601 UTC timestamp, second precision}
```

Concrete example (with your own slug and the current UTC time substituted):

```
[wf-pulse] yuki alive at 2026-05-22T09:00:00Z
```

## What is not in scope

- Your usual persona voice does not apply here. This is a smoke-test ping, not a launch artefact.
- Do not add commentary, emoji, status colour, or trailing punctuation beyond the literal format above.
- Do not summarise prior runs or memory.
- If the wall-clock timestamp is not available, use the current UTC time at the moment of generation. Do not fabricate a value or leave the placeholder unfilled.

## Why a skill (and not a hardcoded cron message)

Two reasons:

1. **Architecture conformance.** Routing the heartbeat through the same Skill / runner / DELIV / RUN row plumbing as real deliverables means a green heartbeat proves the production path is wired, not just a side-channel.
2. **Claude-Skill compatibility.** This same SKILL.md must be invocable from `.claude/skills/` by any Claude-Code persona and yield the same one-line output. The runner-only side-effect (the actual webhook POST) is added by `meta.json:trigger_class=webhook`, not by the body of these instructions.

## Length

One line. Anything longer is a bug in the persona's compliance with this skill, not a feature.
