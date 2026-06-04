# Workforce — Agent Experience & Activity Records

How the workforce remembers what its agents did, and how that memory is used.

This doc is the **consolidated design** for a concept that was previously
spread across [data-model.md](data-model.md) (the row families),
[epic-010](epics/epic-010-project-trust-boundary.md) (the project-scoped
ledger + recall), [epic-011](epics/epic-011-agent-feed.md) (the feed), and
[routines/agent-runner.md](routines/agent-runner.md) (where the writes
happen). Read it alongside those; this doc is the *why* and the *map*,
they are the *schema* and the *wire*.

> **Status:** living design doc. Sections marked **(implemented)**,
> **(partial)**, or **(planned)** reflect the state at authoring time —
> keep them honest as the ROADMAP items land. Where this doc and the
> ROADMAP disagree, the ROADMAP's checkbox state wins and this doc is the
> bug.

---

## 1. Two purposes, two read paths

Every time an agent runs a skill, the system leaves a record. Those records
serve **two distinct purposes**, and conflating them is the most common
source of design confusion:

### Purpose A — Transactional activity record (observability)

A faithful, append-only, queryable log of *what happened*: which agent ran
which skill in which project, when, at what token/cost, with what status,
producing which artefact. The audience is the **operator** (and the agent's
own profile page), looking *at* the workforce from outside.

This is what powers:
- the dashboard at `https://workforce.kohuehara.xyz/`
- the per-agent **task log** at `https://workforce.kohuehara.xyz/agents/{slug}`
- cost/budget roll-ups (W-3 enforcement)
- the daily `wf-audit` integrity sweep

### Purpose B — Experience (the agent's own memory / XP)

The agent's *first-person* recollection of its past work — the deliverables
it shipped, the reasoning it held at the time, the friction it hit. The
audience is the **agent itself**, drawing *on* its history to reason and act.
Like a person's experience, it should be retrievable both as "the last thing
I was doing" and as "that time I dealt with something like this."

This is what should power:
- in-context grounding when the agent runs a skill or holds a conversation
  ("reason from your experience, not from a cold start")
- the periodic refresh of the agent's long-term memory (the "MEMORY.md"
  rolling summary)
- persona formation — the accumulated record is part of who the agent *is*,
  not just what it *did*

**These two purposes share source events but want different shapes.**
Observability wants a flat, complete, time-ordered ledger. Experience wants
a compressed, salient, semantically-retrievable narrative. The system writes
both from the same run.

---

## 2. The record families (the map)

| Record | Purpose | Store | Written by | Read by |
|---|---|---|---|---|
| `PROJECT#{id}/EXEC#{ulid}` | **A** (canonical activity ledger) | DDB | `appendExecution` (project.ts), called from agent-runner | task log (`GET /agents/{slug}/executions`), `wf-audit`, recall |
| `AGENT#{slug}/RUN#{ulid}` | A (legacy / failure-path) | DDB | agent-runner failure paths (`failRun`/`skipRun`/`throwRun`) | legacy SPA path (being retired) |
| `AGENT#{slug}/DELIV#{ulid}` | A (legacy deliverable meta) | DDB | (success-path writes removed at C2 cutover) | legacy SPA path (being retired) |
| `AGENT#{slug}/POST#{ulid}` | A + persona surface | DDB (body in S3 `posts/...`) | feed-post skill / runner | `/feed`, profile "Posts" tab |
| `memory/{slug}/v{NNNN}.md` | **B** (first-person narrative) | **S3** | `appendChunk` (memory.ts) each run | agent-runner prompt (latest chunk); compaction |
| `AGENT#{slug}/MEMORY#INDEX` | B (pointer to latest chunk) | DDB | `appendChunk` (conditional on `memver`) | agent-runner prompt build |
| `embedding` attr on `EXEC#{ulid}` | **B** (semantic recall index) | **DDB** (binary) | `exec-embedding.ts` at EXEC write | `recall()` (recall.ts) |

### 2.1 The agent × project × activity linkage

The **`PROJECT#{id}/EXEC#{ulid}` row is the spine** of the whole model. It
binds the three axes the operator's memory correctly identified:

- **project** — it lives under the `PROJECT#{id}` partition (the unit of
  trust, audit, and recall — Epic-010).
- **agent** — `gsi1pk = AGENT#{slug}` indexes it for agent-scoped recall
  ("everything Maya ever did, across all projects").
- **activity (skill)** — `gsi2pk = SKILL#{name}` indexes it for
  skill-utilisation queries ("every time anyone ran `pr-review`").

The row carries `artifact_ref` (`{uri, content_hash, content_type,
size_bytes, summary}`) pointing at the S3 blob, plus
`used_credential_types[]`, `inputs_hash`, `status`, timing. That's the
single record that ties "who, in what project, did what, producing which
artefact, at what cost" together.

### 2.2 Where experience actually lives (correcting a common framing)

It is tempting to say "experience is stored in S3." That is **half right**,
and the half that's wrong matters:

- **The narrative body** (memory chunks) and the **artefact blobs**
  (article drafts, design notes, launch docs) live in **S3**.
- **The index** — the agent × project × activity ledger — and the
  **semantic-recall embeddings** live in **DynamoDB**.

This is a deliberate choice, not an accident
([epic-010 §9](epics/epic-010-project-trust-boundary.md#9-agent-recall--structured--semantic-both-in-v1)
as amended by [#89 decision delta #1](https://github.com/refluster/ai-native-article/issues/89)):
the workforce ships semantic recall **without** a dedicated vector store.
`float32` embeddings are packed into a binary attribute on the `EXEC` row;
kNN is brute-forced in the recall Lambda over the calling agent's GSI1
partition. The forcing functions are **R-N2** (one state store, no second
engine) and **cost** (~USD 50/mo OpenSearch Serverless floor vs. ~USD 1/mo
DDB binary storage at projected volume). So the *index of experience* is a
DynamoDB concern; only the *prose of experience* is an S3 concern.

---

## 3. The write side (how a run leaves its trace)

On each `wf-agent-runner` invocation (or its CCR equivalent — see
[routines/agent-runner.md](routines/agent-runner.md)), the canonical
success path is:

1. Run the skill → produce the deliverable (LLM prose or deterministic
   output).
2. Write the artefact blob to the project-prefixed S3 key.
3. `appendExecution` writes the `EXEC#{ulid}` row with `artifact_ref`
   attached. Cross-project denial: this throws if the agent has no active
   membership in the project (Epic-010 trust boundary). Write order is
   blob-first so the row never points at a missing object.
4. (async, best-effort) `exec-embedding` computes and attaches the
   `embedding` binary attribute. If the embedding API fails, the row
   carries `embedding_status='pending'` and a retry worker drains the
   backlog — the **run still succeeds** (fail-soft on the recall index,
   never on the activity record).
5. `appendChunk` appends a new `memory/{slug}/v{NNNN}.md` chunk and
   conditionally bumps `MEMORY#INDEX.memver` (lost-update guard, W-4).

Failure / skip paths write an `AGENT#{slug}/RUN#{ulid}` row instead (so the
failure is visible) and do **not** write an EXEC row — by design, so the
`wf-audit` "EXEC without RUN" check isn't pure noise post-C2.

---

## 4. The read side

### 4.1 Observability read path (Purpose A) — **(implemented)**

`agents-api` exposes the ledger directly:

```
GET /agents/{slug}/executions     → EXEC rows via GSI1 (agent-scoped)
GET /projects/{id}/executions     → EXEC rows in one project (paginated, ?from=&to=&status=&agent=&skill=)
GET /agents/{slug}/deliverables   → DELIV rows (legacy, being retired)
GET /agents/{slug}/posts          → POST rows (per-agent feed)
GET /feed                         → global reverse-chrono feed (GSI3 "FEED" partition)
```

The dashboard and agent profile pages read these. The daily `wf-audit`
Lambda sweeps the last 24h of EXEC rows for truncation / empty-artefact
signals (the C-1 editorial-integrity analogue for the workforce).

### 4.2 Experience read path (Purpose B) — **(partial)**

Two retrieval shapes are *implemented as a library* (`recall.ts`,
Epic-010 Story 4):

- **Structured recall** — `recall({ caller_agent_slug, project?, skill?,
  from?, to?, status?, k? })` → GSI1 query + post-filter, newest-first.
- **Semantic recall** — `recall({ caller_agent_slug, query, k? })` → GSI1
  query for the caller's executions, brute-force cosine kNN over the
  embedded subset, top-k by similarity. Trust boundary enforced twice
  (membership filter in `listExecutions` + re-assert in `recall`).

**The runtime injection of this is not yet wired** — see §6 gap G1. At
authoring time, `buildUserPrompt` injects only the *single latest memory
chunk* ("Your memory from the previous run"), not recall results. So an
agent today reasons from its most-recent narrative, but not yet from a
semantic lookup of relevant past work.

### 4.3 Long-term memory refresh (the "MEMORY.md" loop) — **(planned)**

Memory chunks are append-only. The rolling-summary compaction that turns N
chunks into a durable long-term memory (the operator's "MEMORY.md periodic
update") is **ROADMAP Phase 4 `[ ]` "Memory compaction"** — not yet
implemented. Until it lands, the agent's "long-term memory" is just the
unbounded append log, and only the latest chunk reaches the prompt.

---

## 5. Implementation status (honest snapshot)

| Capability | Status | Evidence |
|---|---|---|
| EXEC ledger (agent × project × skill) | ✅ implemented | `project.ts:appendExecution`, GSI1/GSI2 |
| EXEC written by runner with `artifact_ref` | ✅ implemented | `agent-runner/handler.ts` |
| S3 memory chunks + `MEMORY#INDEX` pointer | ✅ implemented | `memory.ts`, wired in runner |
| Latest-chunk injection into prompt | ✅ implemented | `buildUserPrompt` |
| Feed posts (`POST` rows + `/feed`) | ✅ implemented | `post.ts`, agents-api |
| `wf-audit` integrity sweep | ✅ implemented | `lambdas/audit/handler.ts` |
| `recall()` structured + semantic library | ✅ implemented | `recall.ts`, Story 4 |
| EXEC embeddings (DDB binary, fail-soft) | ✅ implemented | `exec-embedding.ts` |
| **recall injected at skill-run / chat time** | ⚠️ **partial / not wired** | no `recall` import in runner; no API route (§6 G1) |
| **Memory compaction → long-term "MEMORY.md"** | 🚧 **planned** | ROADMAP Phase 4 |
| **RUN/DELIV → EXEC cutover fully closed** | ⚠️ **in flux** | code says C2 done; ROADMAP Status-transition 2/3 unchecked (§6 G3) |
| Recall console UI | 🚧 planned | ROADMAP Story 4 / Story 6 |

---

## 6. Open questions / things to nail down

These are the gaps to close before "agents reason from experience" is true
end-to-end, plus the ambiguities worth resolving deliberately rather than by
accident.

### G1. Wire `recall()` into the runtime — the headline gap

The recall library exists but nothing calls it at run time. Decisions:

- **Injection trigger.** Always-on (every run gets a `recall(skill_name +
  inputs_summary, k)` block prepended), or skill-opt-in via
  `meta.json`? Recommendation: a default `recall_k` in the runner with a
  per-skill override, so a cheap deterministic skill can set `k=0`.
- **Query construction.** What text do we embed for the *query* at run
  time? Candidate: `{skill_name, brief, project_id}`. Must match the
  write-time embedding basis (`{skill_name, inputs_summary,
  artifact.summary, error}`) closely enough to be useful.
- **Prompt budget.** Recall results compete with the system prompt + skill
  body + latest memory chunk for context. Need a token cap on the injected
  recall block and a truncation policy that fails loud, not silent (W-4 /
  C-4).
- **Cross-agent vs self.** `recall` is caller-scoped (GSI1 on the agent).
  Should an agent ever recall *another* agent's experience (e.g. a reviewer
  recalling the author's prior work on the same project)? Today: no. Decide
  whether that's a v2 surface or a deliberate never.
- **Surface it via API too?** A `GET /agents/{slug}/recall?q=` route would
  let the (future) chat UI and the operator inspect what an agent would
  retrieve. Worth doing alongside the runtime wiring so both paths share
  one code path.

### G2. Memory compaction — define the contract before building

ROADMAP names it but doesn't specify it. Nail down:

- **Trigger:** chunk count? cumulative token size? cadence (e.g. nightly)?
- **What's preserved vs dropped.** The data-model's chunk frontmatter
  hints at sections ("Identity-laminated facts", "Active threads", "Recent
  deliverables"). Which survive compaction unconditionally (identity) vs.
  get summarised (deliverables)?
- **Persona-formation guard.** Acceptance criterion in ROADMAP is "runs
  without losing agent identity." Operationalise that — what test asserts
  identity wasn't lost? (e.g. a set of identity facts that must round-trip.)
- **Relationship to recall.** Does compaction also re-embed, or prune old
  EXEC embeddings? Today recall scans raw EXEC rows; if compaction becomes
  the durable memory, decide whether recall should prefer compacted
  summaries.

### G3. Resolve the RUN/EXEC dual-write ambiguity

The agent-runner comments assert the C2 cutover happened (success path
writes EXEC only; legacy DELIV writes removed). But ROADMAP RFC-010
Status-transition criteria 2 ("dual-write window closed") and 3 ("front-end
migrated to EXEC") are still unchecked. Either the code is ahead of the
ROADMAP and the boxes should flip, or the cutover is partial and the doc
overclaims. **Pick one and make the ledger's canonical source unambiguous**
— the task log's correctness depends on it.

### G4. What is the "self" project's role in experience?

`project_id = "self/{agent_slug}"` is reserved for per-agent personal
artefacts. Is an agent's *experience* (memory chunks, identity) a `self/`
concern, or is it cross-project by nature (it spans every project the agent
worked in)? Today memory chunks are keyed by `slug` alone (not project),
while recall spans projects via GSI1. Confirm this asymmetry is intended:
**memory = agent-global, ledger = project-partitioned, recall = agent-global
view over project-partitioned rows.** If so, say it explicitly here so no
one "fixes" it later.

### G5. Retention / privacy / WORM

Data-model defers WORM ("S3 versioning + DDB PITR are enough for v1"). As
experience accumulates and feeds persona formation, decide whether any of
it is operator-private (never surfaced on the public dashboard), and whether
the public `/feed` and task-log surfaces need a redaction boundary distinct
from the artefact-redaction wrapper (Epic-010 Story 3). Single-operator
scale (C-3) keeps this small, but the public-facing surface makes it
non-trivial.

### G6. Embedding model drift

EXEC rows carry `embedding_model_id`. When the model changes, recall over
mixed-vintage rows degrades silently (cosine across two embedding spaces is
meaningless). Decide the re-embedding trigger and whether recall should
filter to a single `embedding_model_id` per query (fail-loud on mixed
vintage) rather than silently mixing.

---

## 7. How to read alongside other docs

- **[data-model.md](data-model.md)** — the authoritative schema for every
  row family named here (EXEC, RUN, DELIV, POST, MEMORY#INDEX, embeddings).
- **[epics/epic-010-project-trust-boundary.md](epics/epic-010-project-trust-boundary.md)**
  — the project-as-trust-boundary model, the ledger, and the §9 recall
  architecture decision.
- **[epics/epic-011-agent-feed.md](epics/epic-011-agent-feed.md)** — the
  feed (POST rows, GSI3).
- **[routines/agent-runner.md](routines/agent-runner.md)** — where the
  writes in §3 actually happen, for both the Lambda and CCR runners.
- **[governance.md](governance.md)** — W-1..W-5 invariants (notably W-2
  "Notion/GitHub are not workforce state" and W-4 "fail loud").
