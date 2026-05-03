---
name: gas-deploy-verify
description: Push gas/src/Code.gs via clasp, redeploy the web app, and confirm the new version is actually live by GETing the /exec endpoint and asserting the expected supportedActions are present. Use after every change to gas/src/Code.gs to avoid the "I deployed but is v49 actually serving?" ambiguity. Triggers on requests like "deploy GAS", "push and verify the GAS update", "redeploy the script", "is the new GAS action live yet?".
---

# gas-deploy-verify

`npm run deploy-gas` + a live readiness probe in one command. Same bytes through clasp; adds a `GET /exec` afterwards that asserts the supportedActions response contains the actions you expect (`--expect`).

## Why a skill

`npm run deploy-gas` reports `Deployed ... @<version>` and exits, but that doesn't actually prove the new code is serving traffic. Twice this session I had a "did v49 actually go live?" moment and resolved it by hand-curling the endpoint. This skill turns that into a hard check — the deploy fails fast if the new actions aren't visible at the public URL within a small budget.

## Usage

```bash
# Deploy + verify the named actions appear in supportedActions
node .claude/skills/gas-deploy-verify/scripts/gas-deploy-verify.mjs \
  --expect L2_BACKFILL,L3_BATCH

# Deploy without an expectation (just confirms /exec returns valid JSON)
node .claude/skills/gas-deploy-verify/scripts/gas-deploy-verify.mjs

# Skip the push, just probe the live deployment
node .claude/skills/gas-deploy-verify/scripts/gas-deploy-verify.mjs --probe-only --expect L2_BACKFILL
```

The script:
1. Runs `npm run deploy-gas` (which itself runs `check-gas` → `clasp push --force` → `clasp deploy -i <id>`).
2. Polls `GET https://script.google.com/macros/s/<id>/exec` for up to 90 seconds.
3. Parses the JSON response and asserts every action in `--expect` appears in `supportedActions`.
4. Exits 0 on success, 1 on missing actions (deploy didn't propagate / wrong handler), 2 on push/deploy failure, 3 on /exec returning HTML or non-JSON.

## When to call

- **Every time** you edit `gas/src/Code.gs` — running this instead of `npm run deploy-gas` is strictly safer at zero added cost (the probe takes ~2 seconds when things are healthy).
- After adding a new `case 'X'` to `doPost` — pass `--expect X` so a typo in the case name fails the deploy instead of silently exposing a broken action.
- After modifying the `supportedActions` array in `doGet` — the assertion catches drift between your edit and your intent.

## Pitfalls

- **The deployment ID is fixed** (matches `clasp deploy -i <id>` in `package.json`). The skill assumes you're pushing into the same slot. If you create a new deployment instead, update both `package.json` and `src/lib/gas-config.ts` together — see [docs/architecture-source-of-truth.md](../../../docs/architecture-source-of-truth.md).
- **GAS web apps cache the version briefly** — there's a 60–90s window between `clasp deploy` returning and the new code actually serving on `/exec`. The 90s poll budget is sized for that; if it expires, the deploy itself probably succeeded but propagation is stuck.
- **`--probe-only`** is useful for checking the live endpoint without pushing anything (e.g. "is what's already deployed actually current?"). Doesn't touch clasp.
