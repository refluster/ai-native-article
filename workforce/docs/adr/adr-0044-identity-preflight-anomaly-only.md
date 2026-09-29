# ADR-0044 — The ML-040 identity preflight is an anomaly detector, not a credential-scoping restore, and governance should say so

- **Status**: Proposed
- **Date**: 2026-09-29
- **Deciders**: operator (proposed by `wf:dario`, `issue-design`)
- **Related**: [#777](https://github.com/refluster/ai-native-article/issues/777) (the finding this answers), [#781](https://github.com/refluster/ai-native-article/issues/781) (the implementation issue, `wf:lane:implement`), [PR #784](https://github.com/refluster/ai-native-article/pull/784) (merged 2026-09-29, ships the preflight this ADR reviews), ML-040 (`docs/memory-lint-backlog.md`), R-N9 (`workforce/docs/governance.md` §4 — external git is PR-only, the credential-scoping this preflight was meant to protect), W-2 / W-4 / W-5 (`workforce/docs/governance.md` §2)
- **Epics**: none — incident follow-up

## Context

**The defect (ML-040).** Inside a CCR remote session, every outbound call to
`api.github.com` — raw `fetch`, `gh`, `git push`, and the GitHub MCP connector —
is authenticated by the CCR platform as the routine's own account, regardless of
the `Authorization` header the caller sends. Confirmed twice within 90 days
(PSVL/asp-cloud, 2026-09-18; this repo's `pr-remediate` fire, 2026-09-27, PR
#776) and then observed as a **landed write**, not just a reproduction: on
2026-09-27 a `pr-remediate` fire pushed and merged PR #775 under the account
`refluster` — the operator's own GitHub identity — not the project-scoped
credential the binding was supposed to bound the blast radius to (#777, comment
2026-09-27T20:09:45Z). This defeats the per-project credential-scoping model
every raw-fetching skill relies on: `pr-autopilot`, `pr-remediate`,
`issue-triage`, `issue-implement`, `weekly-project-report`, `research-study`,
and this `issue-design` lane itself.

**How it was filed, and how it shipped.** #777 named the defect and proposed a
`GET /user` preflight, and explicitly scoped it for **operator sign-off, not
self-merge**: *"touching shared credential handling is a Zone A/B judgment
call, not an autonomous L3 edit"* (quoting root `CLAUDE.md`'s action-authority
matrix). `issue-implement` (Ren) read that line and handed the issue back
uncoded for exactly that reason. A second issue, **#781**, was then filed the
same day carrying the identical proposal as a checklist of acceptance criteria
— but labelled `wf:lane:implement`, not `wf:lane:design` — and was implemented
directly, landing in **PR #784 (merged 2026-09-29T04:35Z)**, roughly ninety
minutes before this design-lane fire picked #777 back up. #777 itself is still
open: the router (Nadia) had already said, dispatching #777 to this lane, that
*"once `wf:dario`'s design proposal lands as a PR, the normal review/sign-off
path covers it"* — this ADR is that proposal, reviewing what actually shipped
rather than drafting from a blank page.

**What #784 actually built.** `workforce/scripts/lib/github-identity.mjs` adds
`assertGithubIdentity()`: a one-time `GET /user` call before a session's first
write, comparing the returned `login` against an expected set and throwing
(C-4/W-4) on a mismatch or an unreadable identity. It is wired into the shared
`makeGh()` in `workforce/skills/pr-autopilot/pr-merge.mjs`, which
`pr-autopilot`, `pr-remediate`, and `issue-triage` all import — three of the six
named consumers are covered by one shared gate.

**The gap this ADR is for.** The expected-identity default is:

```js
export const DEFAULT_EXPECTED_GITHUB_LOGINS = Object.freeze(["refluster"]);
```

`refluster` is the operator's own personal account — and it is *also* the exact
identity the substitution bug always returns, for every credential, in every
CCR session (every reproduction on record, including the landed PR #775 write,
resolved to this same login). A preflight whose "expected" identity is
identical to the substituted identity will **always pass in the broken
environment it was written to catch.** It does not, and structurally cannot,
distinguish "this write correctly used the project-scoped credential" from
"this write silently fell back to the operator's own account" — those two
cases produce the identical `GET /user` response. The code's own comment
concedes this is unresolved: *"WHETHER the workforce should keep writing as
that account, or move to a bot identity, is the operator's decision (#777). It
is not this file's."* That decision is still open; #784 shipped the mechanism
without it.

Three further gaps, distinct from the identity-policy question, are worth
separating because each needs a different fix:

1. **Partial wiring.** `weekly-project-report/publish-report.mjs` and
   `research-study/publish-study.mjs` each build their own independent `gh()`
   client (`DEFAULT_API_URL` + a local `fetch` wrapper) and do not call
   `makeGh()` or `assertGithubIdentity()` at all — two of the six consumers
   #781's acceptance criteria named are still unguarded. This is a mechanical
   gap, not a design question.
2. **The MCP surface is untouched, and cannot be reached this way.**
   `issue-implement` and `issue-design` (this lane) write through the GitHub
   MCP connector's tools, not a deterministic write-script — and #777's own
   reproduction confirms the substitution reaches MCP calls too (an
   independent `mcp__github__get_me` returned the same substituted login,
   alongside two raw-fetch reproductions). No `makeGh()`-level patch can gate
   an MCP tool call; the checked-in JS preflight has no jurisdiction there.
3. **The Lambda-side "equivalent" #777/#781 asked for does not apply.**
   `workforce/lambdas/shared/external-pr.ts` was named in both issues'
   acceptance criteria, but per `github-identity.mjs`'s own comment, Lambda
   writes use an Actions/IAM-scoped path that never crosses the CCR proxy
   where the substitution happens, and a GitHub Actions installation token
   cannot even read `GET /user` (403). That criterion was written from #777's
   list before the mechanism's shape was known; it names a surface that isn't
   actually exposed, not an oversight to close.

## Decision

1. **Keep the shipped preflight, but re-scope what it is documented to do.**
   It is a real, if narrow, control: it still throws if `GET /user` ever
   returns a *third* identity — an unrelated account, an expired/rotated
   token, a takeover — a failure mode distinct from ML-040's own. That is
   worth keeping. What must stop is describing it, anywhere in governance
   text or a PR body, as having restored per-project credential scoping. It
   has not. Until (2) below is true, every CCR-session GitHub write in this
   workforce is attributable to one shared human account, regardless of which
   project's `github.token` a binding carries.
2. **The identity-policy question #777 deferred is answered here: move to
   real per-project identities is the target, not a configuration flip
   available today.** `WF_GITHUB_EXPECTED_LOGINS` could in principle be set
   per project to that project's own bot login, which would make the
   preflight catch the substitution the moment it happened (the substituted
   `refluster` would then mismatch the expected bot). But no per-project bot
   GitHub identity or PAT is provisioned anywhere in the workforce today —
   "the account CCR fires write as today" *is* "the routine owner," full
   stop. Setting an aspirational expected login now would make every write
   to every external project fail closed immediately, which is a much bigger
   operational change than this ADR can authorize by itself: it needs its own
   rollout (who provisions which bot account per project, the W-3 cost line,
   the credential-storage shape) as a follow-up proposal, not a same-PR flip.
3. **Say the gap in writing where the law lives.** `workforce/docs/governance.md`
   §2 (W-2 / R-N9's credential-scoping premise) should carry a line, next to
   R-N9's text, stating plainly that CCR-session writes are not currently
   identity-isolated per project — the preflight added by #784 detects a
   *different* identity appearing, not a *wrong* one — until per-project bot
   identities exist. This is a documentation change to an L0/L1 file and is
   explicitly **not made in this PR** (see Implementation).
4. **The two unwired `gh()` clients get wired to the same shared gate.**
   `weekly-project-report/publish-report.mjs` and `research-study/publish-study.mjs`
   should call `makeGh()` (or `assertGithubIdentity()` directly) the same way
   `pr-autopilot`/`pr-remediate`/`issue-triage` already do, closing #781's
   acceptance criteria for real rather than by omission. Mechanical,
   implement-shaped, **not done in this PR**.
5. **The MCP-call substitution and the Lambda-side non-applicability are
   named, not solved, here.** Neither has a code fix available at this
   layer. They are recorded so #777 does not read as closed by #784 when two
   of its three named surfaces are either unreachable from this code (MCP) or
   never applied in the first place (Lambda).

## Alternatives considered

- **Leave #784 as the closing word on #777.** Rejected: the shipped default
  cannot detect the exact failure #777 documents, and letting the tracker read
  "resolved" invites the same silent-absorption ML-040 already flagged once —
  "we'll remember next time" is the outcome this lane exists to refuse.
- **Set `WF_GITHUB_EXPECTED_LOGINS` per project today, so the preflight starts
  catching the substitution immediately.** Rejected for *now*: no bot identity
  exists for any external project to expect, so this would fail closed on
  every external-project write starting today, not just the mis-scoped ones.
  Kept as the target state (Decision 2) pending its own provisioning proposal.
- **Remove the preflight as a no-op.** Rejected: it is not a no-op — it still
  catches a real, different failure (an unrelated/rotated identity), and its
  one-time-per-session shape is exactly the scaffolding Decision 2's future
  fix reuses. Removing it throws away real partial protection and the
  mechanism the actual fix builds on.
- **Silently wire the two remaining `gh()` clients and update the governance
  line in this same PR.** Rejected by this lane's own contract: a design
  artefact does not implement the change it proposes in the same PR. Named as
  follow-up work instead (Implementation, below).

## Consequences

- Nothing in this PR changes runtime behaviour. The preflight shipped by
  #784 keeps running exactly as it does today; no code path is touched.
- `workforce/docs/governance.md` will, once this ADR is accepted and its
  documentation follow-up lands, state explicitly that CCR-session GitHub
  writes are not currently project-identity-isolated — a more honest but
  less comfortable claim than the credential-scoping language R-N9 currently
  implies stands unqualified.
- `weekly-project-report` and `research-study` remain unguarded by the
  preflight until their follow-up PR lands; they are no worse off than before
  #784, but #781's acceptance criteria should not be read as fully met until
  they are.
- The MCP-call substitution stays an open, unmitigated risk with no proposed
  mechanical fix in this repo — any workforce session using the GitHub MCP
  tools (including this very fire) writes under the same shared, substituted
  identity today. That is a CCR-platform-level defect outside this repo's
  reach; the honest thing this ADR can do is name it rather than let the
  JS-level fix imply it is covered.

## Reversal

Superseded once per-project bot GitHub identities are provisioned: a follow-up
ADR sets `WF_GITHUB_EXPECTED_LOGINS` per project to each bot's real login,
verifies in a controlled test that a wrong-credential write now throws instead
of silently landing as `refluster`, and updates the governance line from
Decision 3 back to an unqualified credential-scoping claim. It would also be
shown wrong the other way — if this ADR's honest framing gets read as "already
handled" and is used as a reason *not* to provision real bot identities, which
is precisely the silent-absorption outcome it is trying to head off.

## Out of scope

- Implementing the `weekly-project-report` / `research-study` wiring (a small,
  implement-shaped follow-up per consumer).
- Provisioning actual per-project bot GitHub identities/PATs — a Zone A
  cost/identity decision on its own, not decided by this ADR.
- Fixing CCR's upstream identity-substitution defect, or building any
  MCP-layer guard for it — outside this repo.
- Re-adjudicating whether #781 should have run through `issue-design` before
  merging; noted above as provenance, not re-opened here.
