// bindings-manifest.mjs — the issue→merge loop's bindings, declared as data
// (adr-0038 §2, re-shaped by adr-0046).
//
// WHY THIS FILE EXISTS. Every binding used to be a hand-copied
// `wire-<skill>-<agent>-<project>.mjs`, and three times in a row a cadence
// that FILLS a queue was wired for a project whose DRAINING cadence was not
// (`pr-remediate` on asp-cloud, OP-016, the router on asp-cloud — see
// adr-0038 §Context). A copied script cannot check a relationship it is only
// one half of. A list can — which is what `QUEUES` + R-N11
// (`check-binding-queues.mjs`) are.
//
// THE LOOP (adr-0046). Four stages on every project — Proposed → Verified →
// Assigned → Closed — and three cadences:
//
//   backlog-reconcile (nadia)  Proposed  → Verified | Closed      fills stage:verified
//   issue-triage      (nadia)  Verified  → Assigned + owner:<x>   fills stage:assigned
//   issue-execute     (ren, dario, …)  Assigned → draft PR | hand-back (Verified again)
//   pr-autopilot      (nadia)  reviews the PR; parks agent-fixable ones in autopilot:needs-author
//   pr-remediate      (ren)    drains autopilot:needs-author
//
// `issue-execute` is bound once per (member × project): a member is a valid
// `owner:<slug>` on a project iff that binding is live there (the router reads
// the roster from the agents-api; this file is intent, the roster is fact).
//
// SCOPE. This manifest owns the loop's five boilerplate cadences.
// `pr-autopilot` appears UNMANAGED: its per-project `config` (nomination
// rules, skip lists) is bespoke and stays in its own wire script, but the
// loop's invariant has to know it is bound. Everything outside the loop keeps
// its own script and is none of this file's business.

export const ROUTINE_SPEC = "workforce/docs/routines/agent-runner.md";

/** The queues the loop's cadences fill for one another. R-N11: a producer may
 *  not be bound for a project unless its consumer is bound there too. */
export const QUEUES = Object.freeze([
  {
    queue: "stage:verified",
    producer: "backlog-reconcile",
    consumer: "issue-triage",
    why: "the reconcile verifies issues for the router; without the router bound they sit verified and unowned",
  },
  {
    queue: "stage:assigned + owner:<slug>",
    producer: "issue-triage",
    consumer: "issue-execute",
    why: "the router assigns issues to members; with no executor bound on the project there is nobody to assign them to and every issue ends at the operator",
  },
  {
    queue: "stage:verified (hand-back)",
    producer: "issue-execute",
    consumer: "issue-triage",
    why: "an owner that cannot finish hands back to Verified — with no router bound, the hand-back is an absorbing state (the asp-cloud 18-issue backlog)",
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
 * The loop's bindings. `managed: false` means "participates in the QUEUES
 * relation but is written by its own wire script" — `wire-bindings.mjs`
 * reports it and never PATCHes it.
 *
 * Cron slots are the COMPLETENESS FLOOR, not the latency budget: each
 * transition dispatches the next cadence directly (adr-0025), so a normal
 * fire starts seconds after the label. The stagger still matters for the
 * cold-start case, so on each project: pr-autopilot tick → reconcile → router
 * → executors → pr-remediate.
 */
export const BINDINGS = Object.freeze([
  // ── the gate: Proposed → Verified | Closed ─────────────────────────────
  {
    agent: "nadia",
    skill: "backlog-reconcile",
    project_id: "agent-workforce",
    executor: "claude-code-routine",
    trigger: trigger("cron(41 2 ? * * *)"),
    config: { sign_off_persona: "nadia", max_issues_per_run: 15, max_closes_per_run: 10, stale_days: 30 },
    note:
      "Nadia's daily backlog-reconcile on refluster/ai-native-article (project agent-workforce), adr-0046. Moves every Proposed issue to Verified (labelled, with checkable acceptance) or Closed with evidence (completed → merged PR; duplicate → open survivor; not_planned → reason), re-checks Verified/Assigned issues idle 30 days, strips retired lane/handback labels. Comment + label + evidenced close only (R-N9); ≤10 closes per run. Fires 02:41 UTC, ahead of the 03:23 router.",
  },
  {
    agent: "nadia",
    skill: "backlog-reconcile",
    project_id: "asp-cloud",
    executor: "claude-code-routine",
    trigger: trigger("cron(5 2 ? * * *)"),
    config: { sign_off_persona: "nadia", max_issues_per_run: 15, max_closes_per_run: 10, stale_days: 30 },
    note:
      "Nadia's daily backlog-reconcile on PSVL/asp-cloud (project asp-cloud), adr-0046 / asp-cloud issue_lifecycle.md §4. The project side filed its lifecycle first (PSVL/asp-cloud#996); this is the cadence that operates it: Proposed → Verified or Closed with evidence, 30-day re-check of idle issues, required labels per issue_labeling.md §3.1 (one type, ≥1 area, one priority). Fires 02:05 UTC, 20 min after the 01:45 pr-autopilot tick and ahead of the 02:55 router.",
  },

  // ── the router: Verified → Assigned + owner ────────────────────────────
  {
    agent: "nadia",
    skill: "issue-triage",
    project_id: "agent-workforce",
    executor: "claude-code-routine",
    trigger: trigger("cron(23 3 ? * * *)"),
    config: {
      sign_off_persona: "nadia",
      max_issues_per_run: 15,
      routing_hints: [
        "code / config / CI / tests / scripts / Lambdas → ren",
        "ADRs, design notes, epic decompositions, governance amendment proposals → dario",
        "ratification, legal, product calls, AWS console / credentials / spend → operator",
      ],
    },
    note:
      "Nadia's daily issue-triage on refluster/ai-native-article (project agent-workforce), adr-0046. Assigns every Verified issue to exactly one owner — a member whose issue-execute is bound here (ren, dario) or the operator — as stage:assigned + owner:<slug> plus one comment, and re-assigns any Assigned issue whose owner is unbound. Comment + label only (R-N9). Fires 03:23 UTC after the 02:41 reconcile; also dispatched on every verify / hand-back.",
  },
  {
    agent: "nadia",
    skill: "issue-triage",
    project_id: "asp-cloud",
    executor: "claude-code-routine",
    trigger: trigger("cron(55 2 ? * * *)"),
    config: {
      sign_off_persona: "nadia",
      max_issues_per_run: 15,
      routing_hints: [
        "code / tests / CI / runbooks / reports needing no new human decision → ren",
        "ADR amendments to draft, design records, decomposition → dario",
        "Architect ratification, RAL / threat-model signatures, legal, field / on-site work, secrets and IAM → operator",
      ],
    },
    note:
      "Nadia's daily issue-triage on PSVL/asp-cloud (project asp-cloud), adr-0046 / asp-cloud issue_lifecycle.md §5. THE BINDING THIS PROJECT NEVER HAD: asp-cloud ran issue-implement since 2026-05 with no router, so the engineer cadence patrolled the whole tracker and declined what it could not take. Assigns Verified issues to ren / dario / operator per the runbook's routing table. Fires 02:55 UTC, after the 02:05 reconcile and ahead of the 03:17 executor.",
  },

  // ── the executors: Assigned → draft PR | hand-back ─────────────────────
  {
    agent: "ren",
    skill: "issue-execute",
    project_id: "agent-workforce",
    executor: "claude-code-routine",
    trigger: trigger("cron(11 4 ? * * *)"),
    config: { sign_off_persona: "ren", max_issues_per_run: 3 },
    note:
      "Ren's daily issue-execute on refluster/ai-native-article (project agent-workforce), adr-0046. Works only `is:open label:stage:assigned label:owner:ren`: catches up on the issue's epic and this repo's governance, delivers the change (or, for a decision, the document) as a DRAFT PR per issue, hands back to Verified when it is not his. Never merges (external-pr), never comments on an issue he does not own. Replaces issue-implement (archived). Fires 04:11 UTC after the 03:23 router; also dispatched on assignment.",
  },
  {
    agent: "ren",
    skill: "issue-execute",
    project_id: "asp-cloud",
    executor: "claude-code-routine",
    trigger: trigger("cron(17 3 ? * * *)"),
    config: { sign_off_persona: "ren", max_issues_per_run: 3 },
    note:
      "Ren's daily issue-execute on PSVL/asp-cloud (project asp-cloud), adr-0046 / asp-cloud issue_lifecycle.md §6. Works only `is:open label:stage:assigned label:owner:ren` (operator directive: 3 issues per fire). Verifies with the repo's own gate (yarn typecheck && yarn lint, ruff / pytest), opens a DRAFT PR per issue (Closes #N), never merges. The patrol it replaces (issue-implement selecting every open issue and declining in comments) is archived. Fires 03:17 UTC after the 02:55 router; also dispatched on assignment.",
  },
  {
    agent: "dario",
    skill: "issue-execute",
    project_id: "agent-workforce",
    executor: "claude-code-routine",
    trigger: trigger("cron(47 4 ? * * *)"),
    config: { sign_off_persona: "dario", max_issues_per_run: 2 },
    note:
      "Dario's daily issue-execute on refluster/ai-native-article (project agent-workforce), adr-0046. Works only `is:open label:stage:assigned label:owner:dario` — the architecture / governance lens: ADRs (numbered against open PRs too), design notes, epic decompositions, statute-amendment proposals, as DRAFT PRs; never implements the decision it proposes, never merges. Replaces issue-design (archived). 2 issues per fire. Fires 04:47 UTC; also dispatched on assignment.",
  },
  {
    agent: "dario",
    skill: "issue-execute",
    project_id: "asp-cloud",
    executor: "claude-code-routine",
    trigger: trigger("cron(5 4 ? * * *)"),
    config: { sign_off_persona: "dario", max_issues_per_run: 2 },
    note:
      "Dario's daily issue-execute on PSVL/asp-cloud (project asp-cloud), adr-0046 / asp-cloud issue_lifecycle.md §5 (the owner:dario row). Works only `is:open label:stage:assigned label:owner:dario`: drafts the ADR amendments, design records and RAL rows the Architect then signs (#620, #863 and their kind), as DRAFT PRs; never ratifies, never merges. 2 issues per fire. Fires 04:05 UTC; also dispatched on assignment.",
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
      "Ren's twice-daily pr-remediate on refluster/ai-native-article (project agent-workforce), adr-0022. Works the autopilot:needs-author queue — base conflicts, behind branches, open blocking lens findings — resolving semantically, verifying with the repo's own gate, pushing to the PR's HEAD branch (never main), and clearing the label so pr-autopilot re-routes at cycle N+1. Never merges (external-pr). Bounded: 3 attempts per PR plus the sweep's 36h author-stale escalation. Fires 06:29 and 18:29 UTC, each 6 min after a pr-autopilot tick (23 0,6,12,18).",
  },
  {
    agent: "ren",
    skill: "pr-remediate",
    project_id: "asp-cloud",
    executor: "claude-code-routine",
    trigger: trigger("cron(51 7,19 ? * * *)"),
    config: { sign_off_persona: "ren", max_prs_per_run: 3 },
    note:
      "Ren's twice-daily pr-remediate on PSVL/asp-cloud (project asp-cloud), adr-0022. Closes the gap that stranded #692/#693 and, on 2026-10-01, #981: pr-autopilot routes agent-fixable PRs into autopilot:needs-author on this repo with no worker bound, so every one ages 36h and escalates author-stale. Declared 2026-08-11 (OP-016) and never run until adr-0046's wiring. Pushes to the PR's HEAD branch only, never merges (external-pr). Fires 07:51 and 19:51 UTC, each 6 min after a pr-autopilot tick (45 1/6).",
  },

  // ── unmanaged: the author lane's PRODUCER ───────────────────────────────
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
 * Bindings the loop no longer has. `wire-bindings.mjs` REMOVES a live binding
 * matching one of these from the agent's `bindings[]` (and `--live` reports
 * one that is still there). adr-0041's in-place `retired_at` marker is still
 * Proposed and unimplemented on `AgentBinding`, so deletion is the only
 * retirement the API offers today; this list is the record of what was
 * removed and why, and the agents-api AUDIT# trail keeps the diff.
 */
export const RETIRED_BINDINGS = Object.freeze([
  { skill: "issue-implement", project_id: "agent-workforce", retired_on: "2026-10-05", reason: "replaced by issue-execute (adr-0046); the skill is archived" },
  { skill: "issue-implement", project_id: "asp-cloud", retired_on: "2026-10-05", reason: "replaced by issue-execute (adr-0046); this binding was the patrol that commented on every issue it declined" },
  { skill: "issue-design", project_id: "agent-workforce", retired_on: "2026-10-05", reason: "replaced by issue-execute (adr-0046); the skill is archived" },
  { skill: "issue-design", project_id: "asp-cloud", retired_on: "2026-10-05", reason: "never live; declared in the previous manifest only" },
]);

/**
 * The identity of a binding WITHIN ONE AGENT is `(skill, project_id, lane)`,
 * NOT `(skill, project_id)` — and getting that wrong silently destroys a
 * binding. adr-0030 gave `pr-remediate` a second lane: Ren carries BOTH an
 * author-lane binding and a groom-lane one (`config.lane: "groom"`) for the
 * SAME skill on the SAME project. A driver reconciling on the coarse key would
 * match the groom slot and overwrite it. An absent `config.lane` means the
 * author lane.
 *
 * Across agents the same (skill, project_id) legitimately repeats: ren and
 * dario both carry `issue-execute @ asp-cloud`. The matcher is applied to one
 * agent's `bindings[]` at a time, so that is never a collision.
 */
export function laneKeyOf(binding) {
  return String(binding?.config?.lane ?? "author");
}

/** The reconciliation key a driver must use to find the slot a manifest entry
 *  targets, inside one agent's bindings[]. */
export function bindingMatcher(desired) {
  const lane = laneKeyOf(desired);
  return (b) => b.skill === desired.skill && b.project_id === desired.project_id && laneKeyOf(b) === lane;
}

/** True for a live binding that `RETIRED_BINDINGS` says must go. */
export function isRetired(binding, retired = RETIRED_BINDINGS) {
  return retired.some((r) => r.skill === binding?.skill && r.project_id === binding?.project_id);
}

/** The bindings `wire-bindings.mjs` may write. */
export function managedBindings(list = BINDINGS) {
  return list.filter((b) => b.managed !== false);
}

/** `{skill, project_id}` presence test over any binding list. */
export function isBound(list, skill, projectId) {
  return list.some((b) => b.skill === skill && b.project_id === projectId);
}

/** The agents bound to `skill` on `projectId` in a binding list (the manifest's
 *  intent for the roster the router reads live). */
export function boundAgents(list, skill, projectId) {
  return [...new Set(list.filter((b) => b.skill === skill && b.project_id === projectId).map((b) => b.agent))].sort();
}

/**
 * R-N11, as a pure function: every project that binds a producer must bind its
 * consumer. Returns a list of violations (empty = compliant).
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
