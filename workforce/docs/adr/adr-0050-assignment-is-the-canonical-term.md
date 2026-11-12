# ADR-0050 — "Assignment" is the canonical term for an agent's scheduled work; `bindings[]` stays the wire name for now

- **Status**: Accepted (operator decision in session, 2026-11-12)
- **Date**: 2026-11-12
- **Deciders**: operator
- **Related**: [ADR-0005](adr-0005-single-execution-model-ccr.md) (agent × skill × project composition), [ADR-0007](adr-0007-agent-config-single-source.md) (agents-api is the single writer of the entry), [ADR-0012](adr-0012-decouple-binding-from-ownership.md), [ADR-0017](adr-0017-skill-lifecycle-api.md), PR #877 (feed-view roll-out, where the term came up)
- **Epics**: none

## Context

One entry in an agent's `bindings[]` (DDB `AGENT#{slug}/META`) says *this
persona runs this skill, for this project, on this schedule*. The workforce has
called that entry a **binding** since Epic-007, after the software sense of
the word: a skill is wired to a scheduler.

The workforce is meant to read as a company of people, though. The operator's
judgement (2026-11-12, after the `feed-view` roll-out across 69 agents) is that
"binding" sounds mechanical. What the entry actually expresses is **work given
to a person**: a duty on their desk, and over time the set of skills that person
has built up. The natural word for that is **assignment**.

The term is now used in about 3,300 places across ~350 files. Those include the
DDB attribute name, the agents-api request/response contract, the
external-client package (`workforce/client/`), R-N rule text ("bindings-only
scheduling"), validator rule ids (`R8-binding-skill-exists`,
`S9-binding-duplicate`), and accepted ADRs, which are never edited in place.

## Decision

1. **"Assignment" is the canonical domain term** for one entry of an agent's
   scheduled work (agent × skill × project × trigger). Agents are *assigned* a
   skill and *unassigned* from it. The set is the agent's *assignments*.
2. **Every human-facing surface uses it from now on**: console copy (the
   agent-profile tab, the editor, confirm dialogs, archive warnings), new docs,
   PR / issue text, and agent-authored prose. The agent-profile tab is
   `?tab=assignments`, and the legacy `?tab=bindings` still resolves to it.
3. **The wire and storage name stays `bindings[]` for now.** The DDB attribute,
   the agents-api JSON field, `binding_idx` in the fire payload, the validator
   rule ids and code identifiers are unchanged. Read "binding" in those places
   as the legacy spelling of "assignment". Accepted ADRs keep their wording.
4. **Renaming the wire field is a separate, later decision.** If it is taken,
   the safe shape is: the API accepts and returns `assignments` as an alias of
   `bindings`, then a one-shot DDB migration copies the attribute, then the
   alias is retired once `workforce/client/` and every skill script have moved.
   It needs its own ADR because it changes the external client contract.

## Alternatives considered

- **Rename everything now.** Rejected. It means a data migration across every
  agent row, a breaking API change for `workforce/client/` consumers, and edits
  to accepted ADRs (forbidden). All of that would be for a vocabulary change
  whose value is in what people *read*, which decision 2 already delivers.
- **"Duty" / "role" / "post".** "Role" already means the agent's job title
  (`AGENT#.role`). "Post" is a feed post. "Duty" says the work-given half but
  not the skills-accumulated half. "Assignment" carries both.

## Consequences

- People reading the console see one word for the concept. Engineers see two
  for a while: "assignment" in prose and UI, `bindings` on the wire. This ADR
  is the mapping.
- New docs and runbooks should write "assignment (the `bindings[]` entry)" at
  first mention, so a grep for either word finds them.
- Nothing changes for the orchestrator, the validators or the dispatch path.
