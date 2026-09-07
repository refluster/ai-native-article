# ADR-0006 — Publication disclosure: comply with the strictest reading instead of classifying ourselves

- **Status**: Proposed
- **Date**: 2026-09-07
- **Deciders**: operator (ratifies by merge); framing from `priya`, `noor`, `elena`, `celeste`, `kai` (2026-07..09 monthly letters)

## Context

The EU AI Act's Article 50 transparency duties began applying on 2026-08-02,
with a grace window to **2026-12-02** for systems already on the market. As of
2026-09-03 the repository contained **no owner, no plan and no line** about
this — verified by grep across `docs/`, `newsletter/docs/`, `workforce/docs/`
and the reader app (issue #667).

Two questions blocked every decision downstream of it. Noor consolidated four
separate counsel questions into one on 2026-08-22:

> ひとりの人間が編集せず、AIだけで運営しているこの発行の仕組みは、それぞれの
> 法律が言う「事業者」や「責任のある当事者」にあたるのか、あたらないのか。

Priya, separately, found that two unrelated regimes — the Art.50(4) carve-out
and California's automated-decision rules — exit through the same door: *"出力
の意味がわかり、実際に見て、変える権限を持つ、名前のある人間"*, and proposed
one appointment to close both. That proposal has been open since 2026-07-31.

The org's standing rule is that it does **not** write its own legal opinions
(*問いを枠づけるのが私たち、答えを出すのは顧問弁護士と責任者*). The intended
resolution was outside counsel. **The operator has ruled that out** (2026-09-07).

That leaves a genuine dilemma: we may not author the legal answer, and we may
not obtain it. Meanwhile the date does not move — Priya's line, *私たちは自分
たちの問いを延期できますが、法律の日付は延期できません*.

The way out came from noticing what the blocked decisions actually depend on.
Every one of them is blocked on **classification**, and in every branch of that
classification **the conservative action is identical**: mark the output, tell
the reader, name who is responsible. The classification is load-bearing for
*whether we are obliged*; it is not load-bearing for *what we should build*.

Two further facts closed the remaining option. Kai checked on 2026-08-19 that
the Art.50(4) exemption does not fit our facts: it requires substantive human
involvement in the AI-generated text plus a real person bearing editorial
responsibility, and this pipeline published 58 articles in a month with no
per-article human review. And Celeste established (2026-09) that synthetic
**audio** has no editorial exemption at all, needs disclosure the listener can
perceive more than once, and that our stock synthetic voice carries no
watermark or provenance signature of any kind.

## Decision

Adopt **dominant-strategy compliance**: never rely on an exemption or on a
scope threshold. Build to what the strictest applicable reading would require,
so that the unanswered classification question stops gating the work.

Three commitments:

**D-1 — Disclosure floor.** Every artefact this organisation publishes carries,
without exception:
1. a machine-readable marking that it is AI-generated,
2. a disclosure a human can actually perceive in that medium — visible on a
   page, audible and repeated in audio (a once-at-the-top line does not count
   for a listener who cannot scroll back), and
3. a named person accountable for the publication.

No exemption is claimed anywhere, **including Art.50(4)**.

**D-2 — No automated decisions about natural persons.** This workforce's
"hires" are LLM personas, not people. It must not apply automated
decision-making to a natural person in any consequential domain — employment,
credit, housing, education, essential services. This is a self-imposed design
constraint, and it is mechanically checkable (the roster contains no natural
person; no cadence takes a natural person as its subject).

**D-3 — Named accountability, honestly scoped.** The operator is named as the
person responsible for publication, on the site and in the repository. This
records who bears responsibility — which is already true: the operator holds
merge authority, spend authority and final escalation (governance §8.1 B). It
explicitly does **not** purchase the Art.50(4) exemption, which additionally
requires human review of each text. We name the person and still disclose.

**This ADR is not a legal opinion and does not become one.** It is an
engineering posture chosen to be *robust to* the unanswered question. The
residual — that we still do not know our classification — is not resolved. It
is written down and signed by the operator in
[`docs/risk-acceptance-ledger.md`](../risk-acceptance-ledger.md) as **RAL-006**,
which is this repository's existing mechanism for a known, deliberately
tolerated gap. The operator's signature on that row is what replaces the
counsel opinion, and only the operator can give it.

## Alternatives considered

1. **Wait for outside counsel.** Ruled out by the operator. Also insufficient
   on its own: 90 days remained at the time of writing, and Noor's consolidated
   question had been ready to send for two weeks without moving — the letters'
   own evidence that "framed and ready" is not the same as "asked".

2. **Answer the classification in-house.** Refused. It is exactly what the
   org's own rule forbids, and it fails in an asymmetric way: a wrong
   self-classification is *worse* than no classification, because its only use
   would be to justify claiming an exemption we might not hold.

3. **Appoint a reviewer in order to claim the Art.50(4) exemption.** Rejected
   as dishonest on our facts. With 58 articles a month and one human, a claimed
   "substantive human involvement" would be a fiction. Claiming an exemption we
   do not satisfy is a **C-1 editorial-integrity failure before it is a legal
   one** — the invariant is about not publishing degraded truth, and a false
   compliance claim is degraded truth about ourselves.

4. **Cut output until per-article human review is feasible.** Rejected. It
   trades away the organisation's reason for existing to buy an exemption whose
   entire value is saving one disclosure line. D-1 costs less and proves more.

## Consequences

- **The blocked work unblocks.** #668 (reader-facing disclosure surface,
  synthetic-audio disclosure) can be specified and shipped now, without waiting
  on a classification. #667 reduces to one operator signature plus D-3's naming.
- **We forgo an exemption we may have been entitled to.** Accepted; it is
  cheap, and the letters show we could not have honestly claimed it anyway.
- **D-2 becomes a real constraint on the roadmap.** Any future cadence that
  screens, ranks or rejects a real person — a genuine job applicant, say — is
  out of bounds until a superseding ADR takes that decision deliberately, with
  the operator's eyes open.
- **A compliance claim is now a testable artefact, not prose.** D-1 is three
  checkable properties per artefact, which means it can become an R-rule rather
  than a promise. That matters more than the legal posture: the whole 2026-08/09
  finding was that this organisation states policy it does not enforce.
- **Re-evaluate** if the organisation acquires users at scale, revenue, or
  human employees; if a regulator publishes guidance that changes the calculus;
  or if the operator later chooses to retain counsel after all.

## Related

- Issues [#667](https://github.com/refluster/ai-native-article/issues/667),
  [#668](https://github.com/refluster/ai-native-article/issues/668),
  tracker [#659](https://github.com/refluster/ai-native-article/issues/659)
- [`docs/governance.md`](../governance.md) C-1 · [`workforce/docs/governance.md`](../../workforce/docs/governance.md) W-1
- [`docs/risk-acceptance-ledger.md`](../risk-acceptance-ledger.md) RAL-006
- Monthly letters: elena 2026-08 `f2b4d50d3b1b` / 2026-09 `fe4569aad4c6` ·
  priya 2026-08 `facb6494ada8` / 2026-09 `dd7746df6c96` ·
  celeste 2026-09 `d482e5e92f0d` · Maya 2026-09 `c67fc4b00375` §5
