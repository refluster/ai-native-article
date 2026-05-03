---
name: gas-call
description: Invoke this project's Google Apps Script web app from the terminal — POST a JSON action to the deployed L1→L4 pipeline endpoint and pretty-print the response. Use whenever you need to trigger a GAS handler manually (L2_BATCH, L3_BATCH, L4_PUBLISH, L2_BACKFILL, REBUILD_MANIFEST, etc.) or test a new action you just deployed via clasp. Triggers on requests like "run L2_BACKFILL", "trigger L3 batch", "call the GAS endpoint", "POST to GAS".
---

# gas-call

POST a JSON action to this project's deployed GAS web app and print the response.

## Why a skill, not a one-liner

`curl -X POST https://script.google.com/.../exec -d ...` **does not work**. GAS web apps redirect POST requests through `script.googleusercontent.com`, and that intermediate URL only accepts GET — curl follows the redirect and gets `HTTP 405`. The fix is Node's built-in `fetch` with `redirect: 'follow'`, which preserves method and body across the redirect. This skill encapsulates that workaround so it isn't rediscovered every time.

## Deployment ID

Read live from `src/lib/gas-config.ts` (the React app's source of truth). If that file ever moves, update the script below and this section together — they must agree.

Current value (also visible from `npx clasp deployments`):
```
AKfycbwT9brOVSZqKzpf9-yZ_O8BHKJiFuZxwxawKK4FAhBwq-sdloyv56rDgNec9uQ2N4u-
```

## Usage

The skill ships one script: `scripts/gas-call.mjs`. From the repo root:

```bash
node .claude/skills/gas-call/scripts/gas-call.mjs <ACTION> [json-payload]
```

Examples:

```bash
# Trigger the L2 backfill pass (regenerates up to 5 truncated explanations)
node .claude/skills/gas-call/scripts/gas-call.mjs L2_BACKFILL

# Synthesize a new L3 insight (uses normal L3_BATCH selection rules)
node .claude/skills/gas-call/scripts/gas-call.mjs L3_BATCH

# Save a single L1 article (extra fields go in the second arg as JSON)
node .claude/skills/gas-call/scripts/gas-call.mjs L1_SAVE '{"sourceUrl":"https://example.com/article"}'

# List available actions (GET to the same endpoint, no payload)
node .claude/skills/gas-call/scripts/gas-call.mjs
```

The script:
1. POSTs `{ action, ...payload }` to the GAS `/exec` URL with `Content-Type: application/json`.
2. Follows the 302 redirect with `redirect: 'follow'` (the curl trap).
3. Pretty-prints the JSON response. Non-200 responses or HTML returns are surfaced with status code so failures are obvious.

## Common pitfalls

- **GAS handlers can take 1–6 minutes** for batches that call Azure OpenAI multiple times. The script waits up to 6 minutes (matches GAS's own `maxExecutionTime`).
- **Auth is anonymous** (`appsscript.json` sets `access: ANYONE_ANONYMOUS`). No tokens needed.
- **You're hitting the deployed version, not @HEAD.** If you just changed `gas/src/Code.gs`, you must `npm run deploy-gas` first. Use the `gas-deploy-verify` skill to confirm the new action is actually live.
- **For deletes / mutations**, the response usually includes `{ success: true, data: { processed, errors } }`. Always inspect `errors` — handlers swallow per-item failures and report them rather than crashing the batch.
