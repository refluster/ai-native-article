// Workforce agents-api endpoint configuration.
//
// Resolved at build time from VITE_WORKFORCE_AGENTS_API_BASE (the SAM
// stack output AgentsApiUrl, suffixed with the stage path — for prod:
// https://{apiId}.execute-api.{region}.amazonaws.com/prod). When the
// var is unset the SPA shows static manifest data only and falls back
// to mock-stats for the live-stats sections.
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
