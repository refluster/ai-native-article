#!/usr/bin/env node
// dependabot-triage/apply-triage.mjs — the deterministic write for the
// "dependabot-triage" Cadence. Kept as this skill's own CLI entry (C3: a Cadence
// bundles a *.mjs write-script) but the merge logic is now SHARED: the entire
// engine — the R-N10 server-side, fail-closed predicate re-check and the
// comment→approve→squash-merge / escalate primitives — lives once in the
// sibling pr-route skill at ../pr-route/pr-merge.mjs, and pr-route's cycle-2
// verdict mode calls the same engine. This file is a thin wrapper so there is
// one merge implementation, not two.
//
// Contract is unchanged:
//   TOKEN=<credentials['github.token']> \
//     node workforce/skills/dependabot-triage/apply-triage.mjs \
//       --repo <owner>/<repo> --decisions /tmp/decisions.json [--skill-version 0.1.0]
//
// Decisions file shape + exit codes: see ../pr-route/pr-merge.mjs.

import { main } from "../pr-route/pr-merge.mjs";

process.exit(await main(process.argv, process.env));
