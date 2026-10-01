// bindings-manifest.mjs — the issue→merge loop's bindings, declared as data
// (adr-0038).
//
// WHY THIS FILE EXISTS. Every binding used to be a hand-copied
// `wire-<skill>-<agent>-<project>.mjs`: ~140 lines of identical curl/sigv4/
// reconcile boilerplate wrapped around one `BINDING` literal. Adding a cadence
// to a project meant remembering to write another copy — and three times in a
// row nobody did:
//
//   - `pr-remediate` was wired for `agent-workforce` only, so PSVL/asp-cloud's
//     author lane had no worker; PRs #692/#693 aged 36h and escalated
//     `author-stale` (adr-0025 Context).
//   - `wire-pr-remediate-ren-asp-cloud.mjs` was then written but never run —
//     OP-016, still unwired five weeks later.
//   - `issue-triage` and `issue-design` were wired for `agent-workforce` only
//     and no asp-cloud counterpart script was ever written, so asp-cloud ran
//     the pre-adr-0022 world: `issue-implement` as the tracker's only consumer,
//     and 18 issues absorbed into `issue-implement:needs-human` with no
//     re-queue worker bound to release them.
//
// The common shape is not "someone forgot". It is that **a cadence which
// produces a queue was bindable independently of the cadence that consumes it**,
// and nothing could see the pair. A copied script cannot check a relationship it
// is only one half of. A list can — which is what `QUEUES` + R-N11
// (`check-binding-queues.mjs`) are.
//
// SCOPE. This manifest owns the four boilerplate loop cadences. `pr-autopilot`
// appears as an UNMANAGED entry: its per-project `config` (nomination rules,
// skip lists) is genuinely bespoke and stays in its own wire script, but the
// loop's invariant has to know it is bound, because it is the producer of the
// author-lane queue. Everything outside the loop (feed-post, daily-research,
// the report cadences) keeps its own script and is none of this file's
// business.

export const ROUTINE_SPEC = "workforce/docs/routines/agent-runner.md";

/** The queue relationships the loop depends on. Read by
 *  `check-binding-queues.mjs` (R-N11): for every project where `producer` is
 *  bound, `consumer` MUST be bound too, or the producer fills a queue nobody
 *  drains — which is invisible, because an unworked queue and a slow worker
 *  emit the same signal (adr-0025). */
export const QUEUES = Object.freeze([
  {
    queue: "wf:lane:implement",
    producer: "issue-triage",
    consumer: "issue-implement",
    why: "the router lanes implementable issues; without the engineer cadence they sit laned and unworked",
  },
  {
    queue: "wf:lane:design",
    producer: "issue-triage",
    consumer: "issue-design",
    why: "the design lane is the one that unlocks the L0/L1 tail; with no worker the tail simply ages in a different label",
  },
  {
    queue: "wf:handback",
    producer: "issue-implement",
    consumer: "issue-triage",
    why: "a worker that declines hands back to the router — with no router bound, the hand-back is an absorbing state (the asp-cloud 18-issue backlog)",
  },
  {
    queue: "wf:handback",
    producer: "issue-design",
    consumer: "issue-triage",
    why: "same hand-back path from the design lane",
  },
  {
    queue: "autopilot:needs-author",
    producer: "pr-autopilot",
    consumer: "pr-remediate",
    why: "the reviewer parks agent-fixable PRs in the author lane; with no remediation cadence every one ages 36h and escalates author-stale (#692/#693)",
  },
]);

const trigger = (cron) => ({
  scheduler: "external",
  invoked_by: "api",
  fired_from: "wf-orchestrator-tick",
  cron,
});

/**
 * The loop's bindings. `managed: false` means "this binding participates in the
 * QUEUES relation but is written by its own wire script" — `wire-bindings.mjs`
 * reports it and never PATCHes it.
 *
 * Cron slots are the COMPLETENESS FLOOR, not the latency budget: under
 * adr-0025/adr-0038 each hand-off dispatches the next cadence directly, so a
 * normal fire starts seconds after the label, not at the next cron. The stagger
 * still matters for the cold-start case (nothing dispatched, the whole loop
 * walks forward once a day), so each consumer sits after its producer.
 */
export const BINDINGS = Object.freeze([
  // ── the router ───────────────────────────────────────────────────────────
  {
    agent: "nadia",
    skill: "issue-triage",
    project_id: "agent-workforce",
    executor: "claude-code-routine",
    trigger: trigger("cron(23 2 ? * * *)"),
    config: {
      sign_off_persona: "nadia",
      max_issues_per_run: 10,
      requeue_days: 14,
      lane_owners: { implement: "ren", design: "dario", operator: "maya" },
    },
    note:
      "Nadia's daily issue-triage on refluster/ai-native-article (project agent-workforce), adr-0022/adr-0038. Assigns every open issue to exactly one lane — wf:lane:implement (ren), wf:lane:design (dario), wf:lane:operator (a human, with the wf:human:<role> act named) — as machine-readable labels plus a stated dispatch comment, answers wf:handback immediately, and re-examines legacy *:needs-human parks after 14d so no state is absorbing. Comment+label only (R-N9). Fires 02:23 UTC ahead of Ren's 04:11 issue-implement; under adr-0038 the lane label also dispatches the lane's worker directly, so the cron is the floor rather than the latency.",
  },
  {
    agent: "nadia",
    skill: "issue-triage",
    project_id: "asp-cloud",
    executor: "claude-code-routine",
    trigger: trigger("cron(5 2 ? * * *)"),
    config: {
      sign_off_persona: "nadia",
      // Raised above the agent-workforce default for the first fires: this
      // project starts with a 18-issue parked backlog (the oldest untouched
      // since 2026-06-16) plus whatever is untriaged, and the scan is
      // oldest-first, so a larger batch drains the tail rather than
      // re-examining the same head every day. Drop it back to 10 once the
      // parked queue is empty.
      max_issues_per_run: 15,
      requeue_days: 14,
      lane_owners: { implement: "ren", design: "dario", operator: "maya" },
    },
    note:
      "Nadia's daily issue-triage on PSVL/asp-cloud (project asp-cloud), adr-0038. THE BINDING THIS PROJECT NEVER HAD: asp-cloud has run issue-implement since 2026-05 with no router and no design lane, so the tracker had exactly one consumer (an engineer cadence that correctly declines architecture/legal/product work) and every decline landed in issue-implement:needs-human with nothing bound to release it — 18 open issues at the time of wiring. Fires 02:05 UTC, 20 min after the 01:45 pr-autopilot tick and ahead of Ren's 03:17 issue-implement, so a cold-start loop still walks forward in one day.",
  },

  // ── the design lane's worker ────────────────────────────────────────────
  {
    agent: "dario",
    skill: "issue-design",
    project_id: "agent-workforce",
    executor: "claude-code-routine",
    trigger: trigger("cron(47 4 ? * * *)"),
    config: { sign_off_persona: "dario", max_issues_per_run: 2 },
    note:
      "Dario's daily issue-design on refluster/ai-native-article (project agent-workforce), adr-0022. Works the wf:lane:design issues — architecture / product / L0-L1 items whose deliverable is a decision or document, which issue-implement structurally cannot take — into a DRAFT PR carrying an ADR, an epic decomposition, a statute-amendment proposal, or a design record. Never implements the decision it proposes and never merges (external-pr); an L0/L1 artefact still escalates to the operator by the existing predicate, arriving as a reviewable diff instead of an untouched issue. 2 issues/fire (design work is dearer per item). Fires 04:47 UTC, after triage (02:23) has laned the backlog.",
  },
  {
    agent: "dario",
    skill: "issue-design",
    project_id: "asp-cloud",
    executor: "claude-code-routine",
    trigger: trigger("cron(5 4 ? * * *)"),
    config: { sign_off_persona: "dario", max_issues_per_run: 2 },
    note:
      "Dario's daily issue-design on PSVL/asp-cloud (project asp-cloud), adr-0038. The design lane's worker for the project whose parked backlog is mostly design work wearing an engineering label: draft ADR amendments awaiting Architect ratification (#838, #835, #755, #620, #601, #598), RAL rows (#836), compliance self-assessments (#660, #599). Each of those has a draftable document and a human residue; this cadence produces the document so the human's act is a signature rather than an investigation (adr-0038 §the split rule). Never implements the decision it proposes, never merges (external-pr). Fires 04:05 UTC, after triage at 02:05.",
  },

  // ── the implement lane's worker ─────────────────────────────────────────
  {
    agent: "ren",
    skill: "issue-implement",
    project_id: "agent-workforce",
    executor: "claude-code-routine",
    trigger: trigger("cron(11 4 ? * * *)"),
    config: {
      sign_off_persona: "ren",
      max_issues_per_run: 3,
      issue_selection: {
        deny_labels: [
          "blocked",
          "needs-design",
          "discussion",
          "duplicate",
          "wontfix",
          "question",
          "wf:blocked",
          "layer:L0",
          "layer:L1",
          "type:tracker",
        ],
      },
    },
    note:
      "Ren's daily issue-implement on the workforce's own repo refluster/ai-native-article (project agent-workforce). Fires once a day; picks up to 3 eligible open issues, catches up on each issue's referenced epic/design doc plus this repo's governance (CLAUDE.md, AGENTS.md, docs/governance.md, workforce/docs/governance.md and both ADR trees) and the surrounding code, implements the change, verifies with the repo's own gate (npm run lint / test / validate-*), and opens a DRAFT PR per issue (Closes #N, R-N9 citation of run_id + agent). Never merges (deliverable.type=external-pr) and never pushes main — the R-N10 merge grant of adr-0011 belongs to Nadia's pr-autopilot on this same project, which is the review path that picks these drafts up (adr-0010). Operator-owned surface is excluded by deny_labels (layer:L0, layer:L1 — the L0 invariants, L1 statute docs/ADRs and Zone-A files) plus type:tracker epics; anything the labels miss still hands back to the router (wf:handback), never guessed at.",
  },
  {
    agent: "ren",
    skill: "issue-implement",
    project_id: "asp-cloud",
    executor: "claude-code-routine",
    trigger: trigger("cron(17 3 ? * * *)"),
    config: {
      sign_off_persona: "ren",
      // Hard cap per fire (operator directive: "1回で対応するissueの数は3件まで").
      // The daily cadence, not a single run, works down the backlog.
      max_issues_per_run: 3,
      issue_selection: {
        // adr-0038: layer:L0 / layer:L1 / type:tracker / wf:blocked were present
        // on the agent-workforce binding and absent here, so on asp-cloud the
        // engineer cadence was offered exactly the governance, architecture and
        // epic issues it structurally cannot take — and declined each one
        // individually, forever. The deny list is now the same on both projects.
        deny_labels: [
          "blocked",
          "needs-design",
          "discussion",
          "duplicate",
          "wontfix",
          "question",
          "wf:blocked",
          "layer:L0",
          "layer:L1",
          "type:tracker",
        ],
        // NOT allow_labels: ["wf:lane:implement"] — deliberately. Narrowing the
        // cadence to the lane is the operator's separate step, taken only once
        // triage has demonstrably laned this backlog (issue-to-merge-flow.md
        // "Order matters" §3). Doing it in the same change would stop the
        // engineer cadence dead for a cycle.
      },
    },
    note:
      "Ren's daily issue-implement on PSVL/asp-cloud (project asp-cloud). Fires once a day; picks up to 3 eligible open issues, catches up on each issue's referenced epic/design doc plus the repo's own governance (AGENTS.md + whatever ADR/CONTRIBUTING surface it discovers) and the surrounding code, implements the change, verifies with the repo's own gate, and opens a DRAFT PR per issue (Closes #N, R-N9 citation of run_id + agent). Never merges (deliverable.type=external-pr) and never pushes the default branch. Ambiguous or governance-conflicting issues hand back to the router (wf:handback) rather than asserting a human is needed, per adr-0038.",
  },

  // ── the PR author lane's worker ─────────────────────────────────────────
  {
    agent: "ren",
    skill: "pr-remediate",
    project_id: "agent-workforce",
    executor: "claude-code-routine",
    trigger: trigger("cron(29 6,18 ? * * *)"),
    config: { sign_off_persona: "ren", max_prs_per_run: 3 },
    note:
      "Ren's twice-daily pr-remediate on refluster/ai-native-article (project agent-workforce), adr-0022. Works the autopilot:needs-author queue — base conflicts (the #517 shape: main moved under the branch), behind branches, and open blocking lens findings — resolving semantically, verifying with the repo's own gate, pushing to the PR's HEAD branch (never main), and clearing the label so pr-autopilot re-routes at cycle N+1. Never merges (external-pr). Bounded: 3 attempts per PR, plus the sweep's 36h author-stale escalation, so the lane can never absorb a PR. Fires 06:29 and 18:29 UTC — each 6 min after a pr-autopilot tick (23 0,6,12,18) so it picks up that tick's labels; 06:29 also clears Ren's 04:11 issue-implement. Author lane bound to Ren, not to the reviewer persona: adr-0022 rejects collapsing author into reviewer, which is what keeps the adr-0011 R-N10 delegated merge trustworthy.",
  },
  {
    agent: "ren",
    skill: "pr-remediate",
    project_id: "asp-cloud",
    executor: "claude-code-routine",
    trigger: trigger("cron(51 7,19 ? * * *)"),
    config: { sign_off_persona: "ren", max_prs_per_run: 3 },
    note:
      "Ren's twice-daily pr-remediate on PSVL/asp-cloud (project asp-cloud), adr-0022. Closes the gap that stranded #692/#693: pr-autopilot has routed agent-fixable PRs into autopilot:needs-author on this repo since the lane shipped, with no worker bound to that queue for this project — every one aged 36h and escalated author-stale. Declared by wire-pr-remediate-ren-asp-cloud.mjs on 2026-08-11 (adr-0025) and never run — OP-016; this manifest is where it stops being one script's private business. Works the queue — base conflicts, behind branches, and open blocking lens findings from the panel's remediation brief — resolving semantically, verifying with the repo's own gate (yarn typecheck && yarn lint, per its CLAUDE.md), pushing to the PR's HEAD branch (never main), and clearing the label so pr-autopilot re-routes at cycle N+1. Never merges (external-pr). Fires 07:51 and 19:51 UTC, each 6 min after a pr-autopilot tick (45 1/6), clear of Ren's 03:17 issue-implement here.",
  },

  // ── unmanaged: the author lane's PRODUCER ───────────────────────────────
  // Declared so R-N11 can see the pair; written by
  // wire-pr-autopilot-*.mjs, whose per-project nomination_rules / skip_list are
  // genuinely bespoke and do not belong in a shared manifest.
  {
    agent: "nadia",
    skill: "pr-autopilot",
    project_id: "agent-workforce",
    managed: false,
    note: "declared in wire-pr-autopilot-agent-workforce.mjs (bespoke nomination_rules)",
  },
  {
    agent: "nadia",
    skill: "pr-autopilot",
    project_id: "asp-cloud",
    managed: false,
    note: "declared in wire-pr-autopilot-asp-cloud.mjs (bespoke nomination_rules)",
  },
]);

/**
 * The identity of a binding is `(skill, project_id, lane)`, NOT `(skill,
 * project_id)` — and getting that wrong silently destroys a binding.
 *
 * adr-0030 gave `pr-remediate` a second lane: Ren carries BOTH an author-lane
 * binding (`autopilot:needs-author`, twice daily) and a groom-lane one
 * (`autopilot:needs-human`, daily, `config.lane: "groom"`) for the SAME skill
 * on the SAME project. `wire-pr-remediate-groom-ren-agent-workforce.mjs`
 * already keys on the finer tuple for exactly this reason, and flags it as its
 * sharp edge. A generic driver reconciling on the coarse key would match the
 * groom binding and overwrite it with the author lane's config.
 *
 * An absent `config.lane` means the author lane, which is the convention the
 * groom script established and the reason no manifest entry sets it: adding
 * the field explicitly would read as drift against every live binding.
 */
export function laneKeyOf(binding) {
  return String(binding?.config?.lane ?? "author");
}

/** The reconciliation key a driver must use to find the slot a manifest entry
 *  targets. */
export function bindingMatcher(desired) {
  const lane = laneKeyOf(desired);
  return (b) => b.skill === desired.skill && b.project_id === desired.project_id && laneKeyOf(b) === lane;
}

/** The bindings `wire-bindings.mjs` may write. */
export function managedBindings(list = BINDINGS) {
  return list.filter((b) => b.managed !== false);
}

/** `{skill, project_id}` presence test over any binding list. */
export function isBound(list, skill, projectId) {
  return list.some((b) => b.skill === skill && b.project_id === projectId);
}

/**
 * R-N11, as a pure function: every project that binds a producer must bind its
 * consumer. Returns a list of violations (empty = compliant).
 *
 * @param {ReadonlyArray<{skill: string, project_id: string}>} list
 * @returns {{queue: string, producer: string, consumer: string, project_id: string, why: string}[]}
 */
export function queueViolations(list = BINDINGS, queues = QUEUES) {
  const out = [];
  for (const q of queues) {
    for (const b of list) {
      if (b.skill !== q.producer) continue;
      if (!isBound(list, q.consumer, b.project_id)) {
        out.push({ queue: q.queue, producer: q.producer, consumer: q.consumer, project_id: b.project_id, why: q.why });
      }
    }
  }
  return out;
}

/** The binding literal as the agents-api expects it (manifest bookkeeping
 *  fields — `agent`, `managed` — are not part of the stored shape). */
export function toBindingLiteral(entry) {
  const { agent: _agent, managed: _managed, ...rest } = entry;
  return { ...rest, routine_spec: ROUTINE_SPEC };
}
