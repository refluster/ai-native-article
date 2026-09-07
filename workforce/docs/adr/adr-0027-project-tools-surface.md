# ADR-0027 — Interactive project tools: a project-scoped Tools surface, a synchronous `tools-api`, and a declarative tool registry

- **Status**: Proposed (operator ratifies by merging the implementation PR)
- **Date**: 2026-08-30
- **Deciders**: operator (refluster), drafted by a Claude Code session on the operator's request ("リポジトリAのミニアプリをworkforceのフロントエンドの一部にツールとして移植したい")
- **Related**: [Epic-025](../epics/epic-025-project-tools-migration.md) (the migration this decision serves), [ADR-0005](adr-0005-single-execution-model-ccr.md) (the async execution model this deliberately does *not* extend), [ADR-0007](adr-0007-agent-config-single-source.md), [governance §4 R-N1/R-N2/R-N3/R-N4/R-N6](../governance.md)

## Context

Five mini-apps live in a separate repository (`refluster/luckyhat-ms`,
`frontend/src/page-apps/`) — **Insight Foundry**, **User Research**,
**Problem Finding**, **Business Impact Builder**, and **Task Process
(Hypothesis Validation)**, ~1,490 lines of MUI-based React. The operator
wants them inside the workforce console.

Four properties of the existing code force the decisions below:

1. **They are interactive, not scheduled.** Every one is a
   human-in-the-loop form → LLM call → rendered result, often multi-turn
   (User Research's tab/interview flow, Task Process's chat panel). The
   workforce's only execution model today is the asynchronous, cadence-
   shaped CCR fire (ADR-0005): persona-voiced, scheduled via
   `bindings[]` (R-N4), landing a deliverable. Nothing in that model
   answers a browser waiting for a response.

2. **They are project-shaped, but only latently.** All five read
   `?projectId=` from the query string; only Insight Foundry actually
   *uses* it (Notion page creation, source scoping) — the other four
   `console.log` it and move on. The intent was project scoping; the
   implementation never arrived.

3. **They depend on a foreign control plane.** Every tool calls
   `POST /gpts/{id}/run` on the luckyhat API with the GPT id **hard-coded
   in the component** (Task Process embeds the full API Gateway URL
   inline). The prompts those ids resolve to live in luckyhat's DynamoDB,
   not in any repository. The prompt *is* the tool; the React file is a
   form around it.

4. **They need exactly the credentials a workforce project already
   holds.** LLM key, Notion integration token, Discord bot token, GitHub
   token — the project credential vault (`wf/projects/{id}/…`) already
   provisions four of those five types, per project, with metadata
   surfaced in the console.

The operator's directions, given 2026-08-30, close the remaining
questions: **use Azure OpenAI** (not the Anthropic path) with a new
per-project credential; **keep the Business Impact Builder's news input**
but drive it from an operator-supplied **URL** rather than the News API;
**EOL the luckyhat `gpts` API** with no reuse; and **rebuild** Problem
Finding and User Research rather than port them.

## Decision

**1. Tools are a project surface, not a global one.**
The console gains a third project tab beside Overview and Performance:

```
/projects/{encId}/tools              — the tools available on this project
/projects/{encId}/tools/{toolId}     — one tool
```

There is no top-level `/tools` nav entry. The global nav is a row of
organisational *nouns* (Home / My Network / Projects / Skills / Reports);
a tool is a *verb* executed against a project's data and a project's
credentials. Placing execution anywhere else would force a
project-picker in front of every tool — reconstructing the project scope
one level up, without the credential binding or the audit anchor. This
keeps R-N6 (single frontend surface) intact: one more tab, no new
information architecture.

The project id may contain `/` (e.g. `self/ren`), so `/projects/*` stays
a wildcard route and the view suffix is parsed from the remainder. That
parsing — today an inline `endsWith('/performance')` in
`ProjectProfile.tsx` — moves to a tested pure function in
`app/src/lib/paths.ts` returning `{ projectId, view, toolId }`.

**2. Tool execution is a synchronous `tools-api` Lambda — a declared
third execution *trigger*, not a new execution *surface*.**

```
POST /projects/{id}/tools/{toolId}/run
  → resolve the tool from the registry (§3)
  → injectCredentials() for the tool's declared requires[]
  → call Azure OpenAI (§4)
  → appendExecution() → PROJECT#{id}/EXEC#{ulid}
  → return the result to the browser
```

Reasoning runs on Lambda, which is R-N1's default surface — no
amendment is needed there. What *is* new, and is hereby declared, is
that a workforce LLM call may be initiated by **an authenticated
operator request from the console**, synchronously, outside any
`bindings[]` entry. R-N4 forbids *undeclared scheduled* runs; an
operator pressing a button is neither scheduled nor recurring, so it
falls outside that rule rather than violating it. The boundary is
explicit: **a tool run has no schedule, no persona byline, and no
deliverable** — the moment a tool wants to recur, it stops being a tool
and becomes a Cadence with a binding.

W-3 (budget) is enforced at the call site like any other LLM path, but
tool spend is attributed to the **project**, not to an agent — a tool
run has no agent. Tool EXEC rows carry `agent_slug: "_operator"`,
matching the existing `_operator` convention on project ownership.

**3. A tool is a declarative registry entry, not a React component.**
`workforce/tools/{toolId}/tool.json` + a prompt body, mirroring the
shape of the skill registry (and validated in CI the same way):

```jsonc
{
  "tool_id": "problem-finding",
  "display_name": "Problem Finding",
  "version": "1.0.0",
  "requires": ["azure.openai"],          // credential types
  "model": { "deployment": "…" },        // Azure deployment name
  "input":  { /* JSON Schema — renders the form */ },
  "output": { /* JSON Schema — forced structured output */ },
  "steps":  [ /* one or more prompt stages */ ]
}
```

The console renders the form, the run button, and the result from the
schemas; a sixth tool ships without touching the SPA. Hard-coded model
ids and inline API Gateway URLs — the single worst property of the
source material — cannot survive this shape.

Two carve-outs are accepted up front: tools whose interaction is
genuinely bespoke (Task Process's chat panel, Insight Foundry's
multi-source picker) get a **custom renderer component** keyed by
`tool_id`, while still running through the registry's prompts and the
same `/run` endpoint. The registry governs *execution*; it does not
pretend to generate every UI.

**4. Azure OpenAI is a first-class provider, added as one new
credential type `azure.openai`.**
The workforce's only LLM path today is `shared/llm-anthropic.ts`
(`anthropic.api_key`). Tools run on Azure OpenAI per operator
direction, so a sibling `shared/llm-azure.ts` is added with the same
contract — most importantly the W-1/W-4 loud failure on a truncated
completion (`finish_reason === "length"` throws, mirroring the
Anthropic wrapper's `stop_reason === "max_tokens"`).

The credential is **one secret, not four**: Azure needs an endpoint, a
deployment name, and an API version alongside the key, and splitting
those across a secret and project attributes would let them drift out of
sync into a 404 that reads like an auth failure. Shape:

```jsonc
{ "apiKey": "…", "endpoint": "https://….openai.azure.com",
  "deployment": "…", "apiVersion": "2024-10-21" }
```

`deployment` here is the project default; a tool may override it via
`model.deployment`. Adding the type touches the five mirror points named
in `credential-injector.ts`'s header, plus the console's own
`CREDENTIAL_TYPES` in `app/src/lib/credentials.ts` — six in total. The
credential vault panel picks it up with no further change, so the
"CREDENTIALS n/6 PROVISIONED" readout becomes the tool's readiness
indicator.

**5. Structured output is carried by the registry, not by a foreign
GPT record.** The source tools obtain typed results through Azure
function-calling with a forced `toolChoice` (luckyhat's `GptModel.function`).
That mechanism is kept — it is the right one — but the function schema
moves into `tool.json:output`, where it is reviewable in a PR.

**6. The luckyhat `gpts` API is end-of-life for this work; nothing is
reused across the boundary.** No workforce code calls
`4bkyrkfyo1.execute-api.us-west-2.amazonaws.com`, in the steady state or
during migration. The one thing that crosses is **data, once**: the
prompt bodies behind the GPT ids in use, extracted during Phase 0 and
committed to `workforce/tools/`. Calling the foreign API — even
temporarily — would breach R-N2 (single state store), R-N3 (single
secret store: Secrets Manager `wf/` only), and W-2 (no double
source-of-truth), and migration-period exceptions to those have a
well-known habit of not ending.

## Alternatives considered

**Global `/tools` nav entry (the operator's option A).** Rejected on
three counts: it adds an organisational-nav noun that is actually a
verb; it strands EXEC rows with no project partition to land in; and it
needs a project picker in front of every credential-consuming tool,
which is the project tab with extra steps. A *catalogue* at `/tools`
(read-only, "what tools exist") remains available later as pure
addition — but the run surface stays project-scoped.

**Tools as skills with `executor: cli|manual`.** Attractive — one
registry instead of two, and the binding validator already exists. It
breaks on shape rather than on plumbing: a skill is persona-voiced,
produces a deliverable, and fires asynchronously; a tool is anonymous,
returns to a waiting browser, and often runs multi-turn. Modelling one
as the other would either force fake personas onto tool runs or
loosen the skill contract for everyone. The two registries are kept
deliberately separate; if they converge later, it will be because tools
grew a schedule, and that is exactly the point at which a tool should
have become a Cadence.

**Proxy the luckyhat `gpts` API during migration.** Fastest path,
rejected — see Decision 6.

**Anthropic instead of Azure OpenAI.** The workforce's existing LLM
path, and it would have cost nothing to reuse. Overridden by operator
direction: Azure OpenAI is the provider for tools. Consequence
accepted below.

**Keeping the News API for Business Impact Builder.** Rejected by
operator direction in favour of URL-supplied input — see Consequences.

## Consequences

- **Two LLM providers now live in the workforce.** `llm-anthropic.ts`
  (agents, cadences, memory) and `llm-azure.ts` (tools). W-3 accounting
  must cover both or the budget guard silently under-counts; the Azure
  wrapper therefore reports tokens through the same `budget.ts` path.
  Cost-per-token differs by provider, so the cost model gains a
  provider dimension.
- **A sixth credential type** raises the vault's "n provisioned" ceiling
  and adds one more thing to provision per project. Tools fail closed
  and legibly when it is absent, in the manner of the existing
  `credentialsApiConfigured()` advisory.
- **The prompt extraction in Phase 0 is a hard dependency.** Until the
  luckyhat DynamoDB prompt bodies are in hand, no ported tool can run.
  Problem Finding and User Research are exempt — they are rebuilt from
  scratch per operator direction — which makes them the right first
  tools to ship.
- **Business Impact Builder changes behaviour, not just hosting.** The
  News API auto-fetch is replaced by an operator-supplied URL whose page
  content becomes the input. That needs an outbound fetch + text
  extraction step in `tools-api`, and it carries the usual hazards of
  fetching operator-supplied URLs: the fetched page is **untrusted
  input**, never instructions, and the fetcher needs a timeout, a size
  cap, and no access to internal addresses.
- **The UI is rewritten, not transplanted.** The source is MUI v5 +
  emotion + `sx`; the console is Tailwind with `wf-*` tokens and no
  component library. A handful of composite controls (tabs, accordion,
  slider, checkbox groups) must be written locally rather than imported,
  preserving the console's zero-runtime-dependency posture.
- **`ProjectProfile.tsx`'s inline suffix parsing gets a real home.**
  A third view is what breaks the current string-slicing; extracting it
  to a tested helper is a precondition, not a nice-to-have.
- **`refluster/luckyhat-ms` loses these five routes** once the workforce
  equivalents are live. Removing them there is the migration's last
  phase, not its first.

## Related

- [Epic-025](../epics/epic-025-project-tools-migration.md) — the migration plan and phase order.
- [governance.md §4](../governance.md) — R-N1 (execution surfaces), R-N2, R-N3, R-N4 (bindings), R-N6 (single frontend surface).
- [ADR-0005](adr-0005-single-execution-model-ccr.md) — the asynchronous CCR model this decision leaves untouched.
- `workforce/lambdas/shared/credential-injector.ts` — the five mirror points a new credential type must touch.
