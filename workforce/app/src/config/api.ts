// Workforce agents-api endpoint configuration.
//
// Resolved at build time from VITE_WORKFORCE_AGENTS_API_BASE. The console
// deploy workflow now derives this directly from the SAM stack output
// AgentsApiUrl, which already includes the stage path (for prod:
// https://{apiId}.execute-api.{region}.amazonaws.com/prod) — no manual
// suffixing, no hand-maintained secret to drift out of region. When the
// var is unset, the roster read (lib/agents.ts) falls back to the prod
// custom domain (ADR-0008 §7 — the roster is live-API, no static manifest
// remains) and the live-stats sections fall back to mock-stats.
//
// Trailing slashes are stripped so callers can always concatenate
// "/agents/foo" without worrying about double slashes.

const raw = (import.meta.env.VITE_WORKFORCE_AGENTS_API_BASE ?? '') as string

export const WORKFORCE_AGENTS_API_BASE: string = raw.replace(/\/+$/, '')

// Workforce credentials-api endpoint configuration.
//
// Resolved at build time from VITE_WORKFORCE_CREDENTIALS_API_BASE — the
// SAM stack output for the AWS_IAM-protected credentials Lambda. This
// is distinct from the agents-api base because PUT/DELETE writes pass
// through a separate API Gateway HTTP API (aws_iam auth) and lambda. The
// LIST endpoint lives on agents-api and is reached via the agents base.
//
// When this var is unset, write actions surface a "credentials write
// disabled" advisory in the SPA (the LIST still works through the
// agents-api base, mirroring the apiConfigured() precedent).
//
// Trailing slashes are stripped so callers can always concatenate
// "/projects/foo/credentials/bar" cleanly.

const credsRaw = (import.meta.env.VITE_WORKFORCE_CREDENTIALS_API_BASE ?? '') as string

export const WORKFORCE_CREDENTIALS_API_BASE: string = credsRaw.replace(/\/+$/, '')
