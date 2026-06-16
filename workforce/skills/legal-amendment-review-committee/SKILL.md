---
name: legal-amendment-review-committee
description: Maya-chaired deliberative committee that reviews a proposed amendment to the bound project's governance document(s), renders an APPROVE / REJECT recommendation, and on REJECT organises the follow-up items needed to reach APPROVE. The committee seats every agent at VP tier and above (founder + lead), resolved dynamically from the org topology, plus domain experts co-opted per the amendment's subject. Output is a single COMMENT-only review on the target PR — the committee recommends; it never approves, requests-changes, or merges at the git level (W-5 / R-N9). Operator-invoked (no cron); the specific amendment under review is supplied per invocation.
---

# Legal Amendment Review Committee

The standing committee that reviews proposed **changes to a project's governance**
(its statute / "law") and decides whether to recommend them. Bound to project
`asp-cloud`, chaired by `maya` (PM / Founder).

**Owner / chair**: `maya`
**Executor**: `claude-code-routine` (operator-invoked sub-agent today; future CCR API trigger)
**Scheduler**: `manual` — non-periodic. There is no cron; the committee convenes on
demand and the amendment under review is named per invocation ("具体的な変更内容は都度指示").
**Side effect**: one `event: COMMENT` review posted to the target PR via the bundled
`post-review.mjs`. Comment-only by construction — see Guardrails.

## What governance this committee reviews

The **bound project's** governance, not the workforce's own. The runner resolves the
active `project_id` (here `asp-cloud`) and reads that project's
`workforce/projects/{project_id}/project.json:governance_docs[]` — for `asp-cloud`
that is `AGENTS.md` in the target repo (`PSVL/asp-cloud`). An amendment that does not
touch a path in `governance_docs[]` is **out of scope** (see the Skip rule).

## Committee composition (resolved per fire)

The roster is **dynamic**, never hard-coded:

- **Chair** — `maya` (the `founder` tier), who convenes and synthesises the verdict.
- **Members** — every agent whose tier is `lead` or `founder` ("VP class and above"):
  the VP layer (e.g. `priya` VP People & Legal, `elena` VP Customer Experience,
  `dario` VP Engineering Excellence, `tessa` VP Policy & Government Affairs,
  `silas` VP Finance & Capital Strategy) as it stands at invocation time. Resolve the
  set by tier, so the committee tracks the org chart automatically as VPs are hired or
  retired — do not paste a fixed list.
- **Experts (有識者)** — co-opt the IC or external specialist whose function the
  amendment most touches (e.g. an outside-counsel-liaison lens for an IP clause, a
  grid-policy analyst for a regulatory clause). Co-option is per-topic and must be
  **named in the verdict** so the record shows who advised.

> The People & Legal lens (`priya`) is the natural rapporteur for a *legal* amendment,
> but the recommendation is the committee's, not one VP's.

## Recall packet (assembled before deliberation)

1. The bound project's `project.json` (repo, `governance_docs[]`, members).
2. The target PR: title, body, diff of the governance doc(s), and any linked issue —
   read via the GitHub read surface using `ctx.credentials["github.token"]`.
3. The amendment's **stated rationale** (the PR body's "why") and the **before/after**
   text of each changed clause.
4. Cross-impact context: the workforce's own governance
   ([`workforce/docs/governance.md`](../../docs/governance.md) §2 W-1..W-5, §4 R-N\*,
   §5 authority) — an amendment to a *project's* law must not ask a workforce agent to
   violate workforce law (e.g. it cannot grant the workforce merge authority the
   workforce's own W-5 forbids except under R-N10).

## The one unit of judgment per fire

Produce **one committee verdict** on **one amendment**. Each seated lens raises its
concerns; the chair synthesises a single decision. The verdict (the comment body) has
this shape:

1. **Convened** — the amendment under review (PR #, the clause(s) touched) and the
   roster that sat (chair + VP members by slug + any co-opted expert, each named).
2. **Lens notes** — the material concern from each lens that had one (legal/IP,
   product, engineering/release, policy/regulatory, finance/cost). Omit a lens that had
   nothing to add rather than padding it.
3. **Decision** — **APPROVE** or **REJECT** (a recommendation; see Guardrails).
4. **Rationale** — why, tied to the specific clauses and to the cross-impact check.
5. **Follow-ups (REJECT only)** — a numbered, concrete list of what must change for the
   amendment to reach APPROVE: each item actionable and tied to a clause. A REJECT
   without a follow-up list is incomplete (it must tell the author how to get to yes).

Keep the voice deliberative and specific to the clauses; no boilerplate verdicts.

## Skip rule (when NOT to write)

Do **not** post — return without calling `post-review.mjs` — when:

- The PR touches **no** path in the bound project's `governance_docs[]` (not a
  governance amendment; out of this committee's scope).
- The amendment is editorial-only (typo / formatting, no normative change).
- A human reviewer has already left `CHANGES_REQUESTED` covering the same concern (don't
  pile on; defer to the human).

Skipping means not calling the script. Never post an empty or "no comment" review (W-4).

## Write step

The deliberation is performed in-session; the **deterministic** write is owned by the
bundled script (W-4 / R-N9: the script is the only thing that touches the external git
surface, and it can only POST a comment-review — it has no merge/approve path):

```sh
# write the verdict to a file so multi-line / Unicode prose isn't shell-mangled
GITHUB_TOKEN="$WF_GITHUB_TOKEN" \
  node workforce/skills/legal-amendment-review-committee/post-review.mjs \
    --project asp-cloud --pr <PR_NUMBER> --body-file /tmp/larc-verdict-<PR_NUMBER>.md
```

`GITHUB_TOKEN` is the project-scoped `github.token` injected per fire from the active
project's credential bag (declared in `meta.json:requires`). The script reads
`owner/repo` from the in-repo `project.json`, refuses an empty body, and posts exactly
one `event: COMMENT` review.

## Guardrails

- **Recommendation, never a gate.** The committee posts an `event: COMMENT` review only.
  It never sends `APPROVE` / `REQUEST_CHANGES` and never merges — W-5 (agents never gate
  merges) and R-N9 (external git surface is PR/comment-only; there is no
  `external-commit`). The human operator and the target repo's maintainer remain the
  deciders; for a Zone A governance amendment, operator approval is required regardless
  of the committee's recommendation.
- **Dynamic roster, not a snapshot.** Resolve "VP class and above" by tier each fire.
  Editing this SKILL.md to hard-code names is a Rule-11 body change, not a roster update.
- **One project's law per fire.** The committee reviews the *bound* project's
  governance; it does not edit or rule on the workforce's own `governance.md` (that is a
  Zone A operator decision, not a committee deliverable).
- **One credential, scoped.** This skill holds exactly `github.token` for the active
  project — never AWS credentials, never a second project's secrets.
