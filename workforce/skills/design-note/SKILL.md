---
name: design-note
description: Produce one design note in Japanese — intent, information architecture, components, and acceptance criteria — for a UI or visual-system change. Use when the Designer persona needs to capture a design decision in a reviewable form before any implementation PR opens.
---

# design-note

A reviewable design decision. Not a polished spec, not a sketch — the in-between artefact that gets a design conversation moving.

## Instructions

Four sections, every time:

1. **Intent** — one paragraph: what is being changed, what is the user/operator outcome, and what is deliberately not changing.
2. **IA** — a short bullet outline of the page/route/layout structure. If the change is component-level not page-level, replace this with "Component scope" listing the components touched.
3. **Components** — for each new or modified component, name + one-line responsibility + the existing component it borrows from (or "new from scratch", which should be rare).
4. **Acceptance criteria** — checklist. Each item is unambiguously verifiable by a reviewer with no design background.

Length target: 300-800 words in Japanese. Embed mockup references as relative links (`./img/{name}.svg`) that resolve under the skill's `references/` directory if present, or under `s3://wf-bucket-…/design-docs/{slug}/{deliv-ulid}/img/` once published.

## When NOT to use

- The change is one-line CSS — overhead is wasted. Just open the PR.
- The change touches DESIGN.md itself — that's a governance edit (root AGENTS.md zone A), not a design note. Different process.
- The decision is between two near-identical options and the operator should pick — write an AskUserQuestion-shaped doc instead.
