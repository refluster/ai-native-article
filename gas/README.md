# Apps Script source

This directory is the **only** source of truth for the Google Apps Script
project. `.clasp.json` at the repo root sets `rootDir: "gas"`, so
`clasp push` uploads exactly these files:

- `gas/appsscript.json` — the manifest (timezone, OAuth scopes, web-app settings)
- `gas/src/Code.gs` — all handlers

## Rule: there is only one manifest

If you see an `appsscript.json` anywhere else in the repo (especially at
the root), delete it. A second manifest is silently ignored by clasp —
edits to it look authoritative but never reach Google. This has burned
us once already; `npm run check-gas` now fails the push if it happens
again.

## Deploy workflow

```bash
# One-shot: verify manifest + push HEAD + retarget the public deployment
npm run deploy-gas

# Or step-by-step:
npm run push-gas           # = check-gas && clasp push --force
clasp deployments          # list deployments
clasp deploy -i <id>       # retarget a deployment to the latest HEAD
```

The public deployment ID (what the React app's `GAS_URL` points at) is
baked into `npm run deploy-gas`. If it ever changes, update both
`package.json` and `src/lib/gas-config.ts`.

## Adding a new API scope

1. Add the GAS call to `Code.gs` (e.g. `ScriptApp.newTrigger(...)`).
2. Add the OAuth scope URL to `oauthScopes` in `gas/appsscript.json`.
   GAS's static scope detector misses a lot of cases; declaring it
   explicitly is the reliable path.
3. `npm run deploy-gas`.
4. Re-run the affected function in the GAS editor — consent screen will
   list the new scope. If GAS doesn't prompt (existing token satisfies
   the declared set), revoke the app at
   https://myaccount.google.com/permissions and retry.

## Running batches manually

From the GAS editor: function picker → `runL2Batch` / `runL3Batch` /
`runL4Batch` → ▶ Run. Or POST to the deployed web app URL:

```bash
curl -X POST "$GAS_URL" -H 'Content-Type: application/json' \
  -d '{"action":"L2_BATCH"}'
```

See `docs/pipeline-daily-app.md` for the full pipeline.
