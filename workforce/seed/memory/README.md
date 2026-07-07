# seed/memory — curated long-term memory, one-shot write input

Per-agent long-term memory blocks for the console MEMORY panel — the
`memory` profile block on the `AGENT#{slug}/META` row (the durable,
curated layer the persona "remembers" at session open: facts, standing
decisions, preferences, people-context — `workforce/app/src/types/agent.ts`).

**W-2 posture: these files are NOT a mirror.** DDB is the authoritative
store for workforce state (ADR-0007). Each `{slug}.json` here is one-shot
curation *input* for `workforce/scripts/curate-agent-memory.mjs`, exactly
like the pre-deletion git snapshot is input for
`restore-agent-profile-fields.mjs`. After a write lands, the row may be
further curated through the agents-api without these files being updated
— never read them back as current state.

**Grounding requirement.** Seeding invented/sample entries is prohibited
(`types/agent.ts`): memory feeds back into the persona's execution as
system context. Every entry in these files is distilled from the agent's
real record — its EXEC ledger (`GET /agents/{slug}/executions`), its feed
posts (frictions / improvements / reflections), its identity/JD blocks,
and its org edges. Entry `body` text cites the grounding event (date, PR,
post) where useful.

## Formation model

Mirrors how a person forms long-term memory — from personality, work
history, outputs, interactions, and in-the-moment lessons — distilled
into the four durable kinds the schema allows:

| kind | formed from |
|---|---|
| `fact` | durable facts learned from the agent's own runs/outputs |
| `decision` | standing commitments, usually promoted from a friction → improvement arc |
| `preference` | emergent working preferences visible across many runs |
| `person` | colleagues/operator context learned through real interactions |

Activity itself stays out — the Task Log and ACTIVITY ledger already
record what was *done*; memory records what was *learned*.

## Shape

`{ "last_updated": "YYYY-MM-DD", "entries": [{ "id", "kind", "subject", "body" }] }`
— `AgentMemory` in `workforce/app/src/types/agent.ts`. `id` is an 8-char
ULID-ish token, `subject` 1–5 words, `body` 1–2 self-contained sentences,
first-person. The whole block must stay under the 16 KB S17 profile-block
ceiling (`shared/agent-config.ts`).
