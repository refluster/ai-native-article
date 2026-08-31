# Epic-025 — Project Tools: migrate the five luckyhat mini-apps into the workforce console

- **Status**: In-progress (2026-08-31)
- **Owner**: operator (refluster)
- **Created**: 2026-08-30
- **Implemented by**: Phase 1 — [#642](https://github.com/refluster/ai-native-article/pull/642); Phase 2 — (PR link set on open)

> **Lifecycle note.** The operator approved this Epic in-session on
> 2026-08-30 ("EOLはエンドオブライフの意味？であればそれで進めよう" and the three
> sibling answers recorded below), then directed Phase 1 and Phase 2 in turn
> ("Phase 1 の実装に進めますか" → はい; "はい、進めて"). That is the operator
> sign-off the `Draft → Accepted` gate exists to capture, so this Epic moves
> straight to `In-progress` with this note as the audit trail.

## Problem

Five mini-apps sit in `refluster/luckyhat-ms` (`frontend/src/page-apps/`),
built on a stack the workforce console has moved past, calling a control
plane the workforce does not own:

| App | LOC | Backend dependency | Uses `projectId` today |
|---|---:|---|---|
| `problem-finding.tsx` | 243 | `api.gpts.run(gptId)` | no — read, then `console.log`ged |
| `task-process.tsx` | 413 | `axios.post` with API URL + GPT id **inline** | no |
| `business-impact-builder.tsx` | 297 | `api.gpts.run` ×3 + News API | no |
| `user-research.tsx` | 525 | `api.gpts.run` ×2 (one is `run('anonymous', …)`) | no |
| `insight-foundry.tsx` | 410 | `run()` ×2 + `createNotionPage` + Discord/GitHub source pickers | **yes** |

Three consequences follow. The tools are invisible to the workforce's
audit ledger — no EXEC rows, so nothing a tool does appears on a
project's activity or performance surface. Their credentials live in
luckyhat's SSM (`luckyhat-openai-token`), a second secret store the
workforce's R-N3 does not admit. And their prompts — the actual product —
live only in luckyhat's DynamoDB behind hard-coded GPT ids, reviewable by
nobody.

Meanwhile the workforce console already has the thing they need: a
per-project credential vault holding exactly the credential types these
tools consume (LLM key, Notion token, Discord bot token, GitHub token),
a project partition to write execution rows into, and a project page with
room for one more tab.

## Outcome

An operator opens a project in the workforce console, clicks **Tools**,
picks one of five tools, runs it against that project's credentials, and
the run lands in the project's execution ledger. The luckyhat routes are
deleted.

Structural decisions — where tools live, how they execute, how they are
declared, and which LLM provider they use — are settled in
[ADR-0027](../adr/adr-0027-project-tools-surface.md). This Epic covers
scope, order, and what "done" means per tool.

## Operator directions (2026-08-30)

Four questions were open when the approach was drafted; all four are
answered, and the answers are load-bearing:

1. **Azure OpenAI, with a new per-project credential.** Tools do not run
   on the workforce's existing Anthropic path. ADR-0027 §4 adds one
   credential type, `azure.openai`, carrying key + endpoint + deployment
   + API version as a single secret.
2. **Business Impact Builder keeps a news input, but not the News API.**
   The operator supplies a **URL**; the page's content becomes the input.
   The auto-fetching News API integration is not migrated.
3. **The luckyhat `gpts` API is end-of-life.** Nothing is reused across
   the repository boundary — not permanently, not during migration
   (ADR-0027 §6). Prompt bodies are extracted once and committed here.
4. **Problem Finding and User Research are rebuilt, not ported.** Both
   are substantially demo scaffolding in the source (Problem Finding's
   method tree is mostly commented-out sample data; User Research calls
   `run('anonymous', …)`). Rebuilding is cheaper than porting, and it
   removes their dependency on the Phase 0 prompt extraction.

## Scope

**In scope.** The five named tools; the `/projects/{id}/tools` surface;
the `tools-api` Lambda; the `workforce/tools/` registry + its CI
validator; `shared/llm-azure.ts`; the `azure.openai` credential type
across its six mirror points; URL-fetch-and-extract for Business Impact
Builder; Discord/GitHub source selection for Insight Foundry, rebuilt
against project credentials; removal of the five luckyhat routes.

**Out of scope.** The other nine luckyhat page-apps (`ai-instance*`,
`peets`, `sf`, `progress-rader`, `project-*`, `task-generation`). A
global `/tools` catalogue. Non-operator (multi-user) access to tools —
C-3 still holds. Migrating luckyhat's GPT-instance CRUD, its Discord
bot, or its news pipeline.

## Phases

Phase order is set by dependency, then by risk. The two rebuilt tools
come first precisely because they do not wait on the prompt extraction.

**Phase 0 — Prompt extraction (blocking for Phases 3–5).**
Enumerate every GPT id referenced by the three ported tools, pull each
record's `instructions` + `function` schema from luckyhat's DynamoDB, and
commit them as `workforce/tools/{id}/`. Done when every ported tool's
prompts exist in this repository and no `gptId` string remains in the
migration's target code. *Not* blocking for Phases 1–2.

**Phase 1 — Foundation.** ADR-0027 + this Epic; the `paths.ts` view
parser extraction with tests; the Tools tab rendering an empty registry;
`azure.openai` across its six mirror points; the credential vault
surfacing it. Ships with zero tools and is still worth merging — it makes
every later phase a small PR.

**Phase 2 — `tools-api` + the two rebuilds.** The Lambda, the registry
loader, the schema-driven form/result renderer, `shared/llm-azure.ts`
with its `finish_reason === "length"` throw, EXEC-row writing, and the
W-3 guard. Then **Problem Finding** and **User Research** built on it.
Two tools on one execution path is the smallest honest test of the
registry's generality.

**Phase 3 — Task Process.** Ported. Needs a bespoke renderer (the
left/right chat layout) and multi-turn state, so it is the first tool to
exercise the ADR-0027 §3 custom-renderer carve-out.

**Phase 4 — Business Impact Builder.** Ported, with the URL-input change
from operator direction 2: an outbound fetch + text extraction step with
a timeout, a response size cap, no access to internal addresses, and the
fetched page treated as untrusted input rather than instructions.

**Phase 5 — Insight Foundry.** The heaviest by a wide margin — Discord
and GitHub source pickers plus Notion page creation, all rebuilt against
project credentials rather than luckyhat's API. Roughly the effort of the
other four combined; deliberately last, when the platform underneath it
has been proven four times.

**Phase 6 — EOL.** Delete the five routes and their components from
`refluster/luckyhat-ms`, and retire the GPT records the migration
consumed.

## Acceptance criteria

1. Each of the five tools is reachable at `/projects/{id}/tools/{toolId}`,
   runs against that project's credentials, and renders its result.
2. Every tool run appends an EXEC row to `PROJECT#{id}` and is visible on
   the project's existing execution table.
3. No workforce code references the luckyhat API host, and no GPT id is
   hard-coded in the console or the Lambda.
4. A tool whose required credentials are unprovisioned says so, in the
   manner of the existing credentials advisory — it does not fail at the
   API boundary with an opaque error.
5. An Azure completion that hits the token ceiling throws (W-1/W-4); a
   truncated tool result never renders as if it were complete.
6. A sixth tool can be added by committing a registry entry, without
   editing the SPA — verified by the fact that the five in scope share
   one renderer except for the two declared custom-renderer carve-outs.
7. The five luckyhat routes are gone.

## Open questions

- **Q1 — Tool result persistence.** EXEC rows record *that* a tool ran.
  Whether the *result* is stored (S3 artefact, as cadences do) or is
  ephemeral to the browser session is unresolved. Ephemeral is the
  cheaper default and is assumed until someone asks to revisit a result.
- **Q2 — Notion write target.** Insight Foundry writes a page; which
  Notion database it writes into, per project, needs a project attribute
  or a variant-suffixed credential (`notion.integration_token@tools`).
  Decided in Phase 5.
- **Q3 — Streaming.** Several tools take tens of seconds. Whether
  `tools-api` streams (and what that costs in API Gateway shape) or
  simply blocks with a progress indicator is deferred to Phase 2, where
  the first real latency measurement exists.

## Related

- [ADR-0027](../adr/adr-0027-project-tools-surface.md) — the structural decisions.
- [governance.md §4](../governance.md) — R-N1/R-N2/R-N3/R-N4/R-N6.
- Source material: `refluster/luckyhat-ms` → `frontend/src/page-apps/`, `frontend/src/components/source-pickers/`, `ai-instances/src/gpts/`.
