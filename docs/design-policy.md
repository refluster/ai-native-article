# ai-native-article Design Policy

**Status:** Draft v1.0
**Last updated:** 2026-05-16
**Scope:** every code edit, every prompt change, every model swap, every "do we build this?" decision in this repository
**Audience:** Claude Code agents acting on this repo, the operator

---

## 0. Why this doc exists

This is the **design-policy axis** of the project — orthogonal to [`docs/governance.md`](governance.md), which is the rules axis.

- Governance answers *"may I do this?"* via invariants (C-1〜C-4), mechanical regulations (R-1〜R-9), and the A/B action-authority matrix. CI and hooks enforce it; violating a C or R turns a build red.
- Design policy answers *"should I do this, and how?"* via principles (D-1〜D-3), the substrate map, and the iteration loop. **Nothing here is enforced by hook or CI.** A D-principle is a north star, not a tripwire. Violating one does not break the build — it just means an agent has drifted from the project's shape.

When the two axes appear to conflict, the rules axis wins. A D-principle never licenses a C-1 (editorial integrity) or C-4 (fail loud) violation. Design policy operates in the space governance leaves open — and governance leaves a lot of space open, deliberately.

### Reading order for a new session

1. [`CLAUDE.md`](../CLAUDE.md) — orientation
2. [`docs/governance.md`](governance.md) — rules
3. This doc — direction

If you only have time for one of (2)/(3): read governance.md before editing existing code; read this doc before proposing new architecture.

### Vocabulary

A few terms recur in this doc — defined once here so they read cleanly later:

- **Reversible** — changeable back by reverting Notion data and redeploying. Almost everything in this project is reversible. Exceptions: published slug changes (C-2 territory), removing a runtime guard, force-pushing `main`.
- **Shadow / primary** — a shadow run is a parallel invocation whose output is compared but not promoted to the corpus. A primary run is the production path.
- **Orchestrate vs. compute** — we wire external services together (orchestrate); we do not run inference, host a CMS, or serve traffic ourselves (compute).
- **Substrate / reinvention** — substrates are the external systems we ride on (Azure OpenAI, Notion, GitHub Actions, gh-pages, Claude Code, the workforce agent-runtime). Reinvention is building our own version of any of them.

---

## 1. Design principles

Three principles. Same `D-N. headline` formatting as governance's C-axioms so they look similar at a glance — but read the preamble above: **these are direction, not rules.**

### D-1. Innovation velocity is the first-order value.

Governance exists so we can ship faster, not slower. The default action authority for any **reversible** experiment is **A (auto-execute)** — a prompt tweak, a new skill, an additional batch handler, a shadow run, a new eval, a new external service tried in parallel.

When velocity is in tension with **editorial integrity (governance C-1)** or **fail-loud (governance C-4)**, safety wins. When velocity is in tension with **ceremony or process preference**, velocity wins.

Heuristics for the agent:

- If you have spent more than 30 minutes deciding whether something is A or B, it is A. Ship; revert if wrong.
- If you are about to ask the operator a question whose answer is "yes, that's reversible — just do it", do not ask. Just do it.
- If you are about to ask the operator >1 round-trip question on a single feature, you have misread autonomy. Re-read §5 of this doc.

Operationalized in §5.

### D-2. Software 2.0 is the design center.

The "code" of this project is not just TypeScript and the pipeline scripts. It also includes:

- **Prompts** — the strings the workforce `article-level{2,3}` cadences send to the LLM. A content-quality bug is more often fixed by editing a prompt than by editing a function.
- **Dataset** — the L1 web corpus, L2 explanations, and L3 insights. This is an asset that compounds; treat Notion as canonical.
- **Evaluation** — `article-health`, the W-1 `publish-notion.mjs` guard, the multi-judge quality layer (GROWTH.md). Evals are the "compilation" step: they decide whether a prompt change is shippable.
- **Model selection** — `gpt-5.4` today, something else tomorrow. The choice is an architectural decision, not a config tweak.

These artifacts are **versioned, reviewed, and rolled back** with the same care as code. §2 makes the artifact list explicit, with current state and Software 2.0 commitment per row.

When investigating a content issue, the **first reflex** should be: "is this a prompt problem, an eval gap, or a code problem?" In that order. Most are the first two.

### D-3. External substrate over reinvention.

We orchestrate; we do not compute. Every architectural decision is gated by the question:

> *Can we ride on an existing external substrate instead of building our own?*

If yes, ride it. If no, ask: *do we really need this, or can we live without?* Build only when neither escape exists.

The substrate map in §3 names what we currently ride and — equally important — what we have committed to never reinvent (training, CMS, scheduler, deploy server, AI agent, web server, original journalism).

The architectural payoff:

> **growth = orchestration quality × external substrate quality**

Azure OpenAI gets better → our articles get better, for free. Notion ships a new query API → our pipeline gets a new capability, for free. Claude Code adds skills → our iteration loop tightens, for free. The orchestration layer must stay thin and clean for this multiplication to work; the moment we own infrastructure that a substrate could own, the multiplier breaks.

---

## 2. What counts as "code" here (Software 2.0 artifacts)

| Artifact | Current state (2026-05) | Software 2.0 commitment |
|---|---|---|
| **TypeScript / generation scripts** | git-managed in the workforce `article-level{2,3}` cadences, the apps' `src/`, `newsletter/pipeline/` & root `scripts/` | unchanged — already first-class code |
| **Prompts** | the prompt strings the workforce `article-level{2,3}` cadences send to the LLM (in each skill body + its `publish-notion.mjs` path) | **commitment:** prompt changes ship as their own versioned PRs (AGENTS.md §2 rule 11), so PRs show prompt diffs cleanly. A prompt-version bump is its own PR; bumping is an A action to draft |
| **Dataset (L1〜L3 corpus)** | lives in Notion (the unified Articles DB) | Notion **is** the dataset. Treat it as a canonical asset: governance C-2 already pins this. Mass mutations require operator approval (governance §8.1 B). Backups out of scope until the corpus is irreplaceable |
| **Evaluation** | `article-health` heuristic (truncation + drift) + the shared `scripts/lib/truncation.mjs` guard (W-1 at generation, R-10 at deploy) + the multi-judge quality layer | grow over time: LLM-as-judge for editorial quality, factual-claim spot-check, style consistency. New eval skills live under `.claude/skills/` (adding one is **A**) |
| **Model selection** | `gpt-5.4` via `MODEL_REGISTRY`; budget brackets in [`docs/azure-budget-rules.md`](../newsletter/docs/azure-budget-rules.md) | swapping the primary model requires (a) eval comparison evidence, (b) a design-policy amendment naming the new model and the rationale, (c) operator approval (governance §8.1 B). **Shadow-running** a candidate model in parallel is **A** |

The order matters: prompts are the most fluid layer, dataset is the most precious, evals are the most under-invested, model selection is the rarest decision.

---

## 3. External substrate map

| Substrate | What it gives us | What we have committed never to build |
|---|---|---|
| **Azure OpenAI (gpt-5.4)** | LLM inference, content filtering, request/response shape | training, fine-tuning, self-hosted inference, our own content filter |
| **Notion** | content store, schema, CMS UI, mobile editing, sync, query API, relations | our own DB, our own CMS, our own editor, our own auth |
| **GitHub Actions** | scheduled jobs (gh-pages deploy cron), CI runners, secret store, workflow logs | our own scheduler, our own deploy server, our own CI runner |
| **gh-pages** | static-site CDN, TLS, custom domain hosting | our own web server, our own CDN, our own TLS termination |
| **Claude Code + skills** | code iteration, subagent orchestration, hook system, plan mode | our own AI agent, our own code-editing tooling, our own subagent framework |
| **Workforce agent-runtime** | scheduled generation (EventBridge → `wf-orchestrator-tick` → agent-runner), persona/skill context, project-scoped secret resolution, the bundled `publish-notion.mjs` write path | our own scheduler, our own agent framework, our own secret manager (historical: this role was the now-retired GAS time-triggers + script-properties store) |
| **Open web** | L1 source articles via manual + AI-assisted research | original journalism, primary reporting |

The mapping above is the **whole infrastructure surface** the project consumes. The contract is:

> **growth = orchestration quality × external substrate quality**

If Azure ships gpt-6, we benefit. If Notion adds a richer relation type, we benefit. If Claude Code adds a new skill primitive, we benefit. The price of this leverage is that our code stays thin around each substrate — no abstraction layers that pretend the substrate is something else, no "what if we swap Notion someday" hedging, no wrappers that exist only to "make testing easier".

A new feature proposal must answer:

1. Is there a substrate above that already does this?
2. If not, is there an external service we should add to the map?
3. If neither, is the feature important enough to justify owning the code?

The bias is hard toward (1) and (2). Item (3) requires a strong case.

---

## 4. Iteration loop

```
edit prompt (versioned, in the article-level{2,3} cadence)
  → shadow run (parallel call, compare outputs)
    → operator glance (sample 2-3 outputs)
      → promote (replace primary prompt; its own PR)
        → cadence runs on Notion corpus (wf-orchestrator-tick schedule)
          → article-health sweep
            → deploy (gh workflow run deploy-article-site.yml)
```

Each step is the friction point candidate for the next skill or automation. Current friction map (updated 2026-06-28):

- **edit prompt (versioned)** — prompts live in the workforce `article-level{2,3}` cadences; a prompt-version bump ships as its own PR (AGENTS.md §2 rule 11) so the diff shows exactly what changed about content generation.
- **shadow run** — no harness yet. A proper shadow harness (run both old and new prompt, dump the pair to disk for comparison) is a worthwhile future skill.
- **operator glance** — informal; operator opens 2-3 Notion rows in the browser.
- **promote** — replace the primary prompt in the cadence, in its own PR; the next scheduled fire uses it.
- **cadence run + article-health + deploy** — the cadence fires on schedule, then `article-health` and the `deploy-article-site.yml` workflow cover the rest.

Things that are conspicuously missing and likely worth adding (each is an A action when an agent undertakes it):

- An **LLM-as-judge eval** skill that scores a sample of generated articles against editorial criteria (clarity, completeness, factual sourcing). Could live as `.claude/skills/article-quality/`.
- A **prompt-diff harness** that runs a candidate prompt and the current prompt on the same input and emits a side-by-side report.
- A **substrate-readiness probe** that quickly reports the live status of Azure / Notion / GitHub Actions so a session can localize a fault before guessing.

None of these are mandatory. They are the kind of thing an agent should propose-and-ship on a Tuesday afternoon, not wait for permission to consider.

### 4.1 Canary rollout discipline

The loop above has a sharp edge: **promote** replaces the primary prompt, and every subsequent
cadence fire runs the new prompt against pending articles. A subtly-worse prompt therefore degrades
a run's output before `article-health` catches it post-deploy. The discipline is:

> Never promote a prompt change and immediately let it generate at full volume. Validate it against a
> **small canary set first**, sweep `article-health`, *then* widen.

Concretely, today: run the cadence against a short explicit set of sources/slugs (3–5 articles),
inspect, and only then let it run at full volume. A first-class canary mode wired into the cadence is
deferred (tracked as **RAL-003** in the [risk-acceptance ledger](risk-acceptance-ledger.md)) — the
small-set convention covers the common case until a prompt change actually burns a run. The two
editorial guards are the backstop if canary discipline is skipped: W-1 (`publish-notion.mjs`, exit 2)
stops a degraded body from reaching Notion, and the pre-deploy truncation gate (governance R-10)
stops one from reaching gh-pages.

### 4.2 Closing the loop: reader behaviour → roadmap

D-2 named evaluation as the under-invested layer, and §4 above named the analytics→roadmap gap. That
gap is now closed by the **weekly content-insights loop**
([governance-mechanisms.md §1 Engine B](governance-mechanisms.md#engine-b--improvement-is-generated-not-remembered-the-loop)):
GA4 engagement is joined to the published manifest every Monday and surfaced as one triage issue, so
"which articles underperform?" drives "what to revise/cross-link/write next?" without the operator
remembering to look. This is the article-side version of the Software 2.0 feedback loop D-2 commits
to. It is inert until the GA4 credential is provisioned (an operator B action, RAL-002), then
self-running.

---

## 5. Innovation-velocity discipline (D-1 implementation guide)

The default decision tree for an agent:

| Situation | Default | Rationale |
|---|---|---|
| Editing a prompt; reversible by re-edit | **A** | reversible, no governance R touched |
| Adding a new `.claude/skills/` skill | **A** | additive, reversible, no critical path mutated |
| Adding a new eval check that flags more things | **A** | L2 tightening per governance §8.1; design policy concurs |
| Running an existing generation cadence (`article-level{2,3}`) | **A** | idempotent by governance I-3 |
| Trying a new external service in shadow mode (parallel, output discarded) | **A** | shadow = reversible by definition |
| Editing an L1 doc (e.g. this file, [`azure-budget-rules.md`](../newsletter/docs/azure-budget-rules.md)) | **A** to draft as a PR; **B** to merge | matches governance §8.1 |
| Swapping the primary LLM model for production | **B** | governance §8.1 B (spending money / changing critical path) + design-policy §2 (model swap protocol) |
| Promoting a shadow substrate to primary | **B** | matches governance §8.1 B "spending money outside the existing envelope" |
| Rewriting >50% of an existing L2/L3 prompt in one diff | **B** | operator should eyeball 2-3 sample outputs before commit |
| Removing or weakening an R-rule | **B** | governance §8.1 explicit |
| Merging any PR (including own) | **B** | governance C-3 / §8.1 explicit |

The principle behind the table: **default to A; escalate only when an action is (a) irreversible, (b) outside the agent's branch (push to `main`, merge PRs, external services), (c) about money, or (d) explicitly named B by governance.** Everything else is A.

Symptoms that you have drifted from D-1:

- Asking the operator >1 question on a single feature.
- Stating a plan that begins with "first I'll ask whether..." for something reversible.
- Adding a runtime check whose only purpose is to make a reversible action feel less risky.
- Drafting a PR description that is longer than the diff.

When you notice the drift, just ship. The cost of a wrong A is a revert; the cost of a stalled feature is forever.

---

## 6. Where this doc binds

Citations from other places. The doc is binding (= an agent should cite the relevant section in its reasoning or commit message) in these four moments:

1. **A prompt edit** — cite §1 D-2 and §2 (prompts as versioned code). The commit message tag is fine: `D-2: revise L2 explanation prompt to ...`.
2. **A model swap or model-related decision** — cite §2 (model selection commitment) and §4 (iteration loop). A primary swap also requires the §8.1 B path in governance.
3. **A "build it ourselves vs. use a substrate" decision** — cite §1 D-3 and §3 (substrate map). If the answer is "build it ourselves", the rationale lives in the PR description.
4. **A "should I ask the operator?" moment** — cite §1 D-1 and §5 (velocity discipline + the A/B table). If the answer is A, do not ask.

### Back-references

- This doc is reached from [`docs/governance.md` §0.1](governance.md#01-the-other-axis-design-policy).
- Governance C-axioms and R-regulations are reachable from each row of §2 and §5 of this doc.
- The `CLAUDE.md` orientation doc need not change for this axis to take effect; new sessions will discover this doc via governance.md §0.1.

### Amending this doc

D-principles change less often than runbooks but more often than governance C-axioms. Edits are made as a normal PR:

1. Open a PR that edits this file.
2. PR description names the section being changed and the experience that prompted the change (a friction point, a new substrate, a velocity drag).
3. Operator approves (this doc is L1-adjacent in spirit — drafting is A, merging is B, per governance §8.1).
