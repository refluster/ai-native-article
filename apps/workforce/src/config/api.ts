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
