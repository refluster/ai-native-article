// L1 capture endpoint config for the Capture page.
//
// Replaces the retired gas-config.ts. The Capture page POSTs new source URLs
// to the wf-l1-source-register Lambda (POST /l1/register) and lists recent
// rows (GET /l1/sources). The base URL is a build-time, NON-secret value; the
// bearer token is entered by the operator at runtime and kept in localStorage
// (never baked into the bundle) — see Capture.tsx.
//
// Set VITE_L1_CAPTURE_ENDPOINT to the register URL, e.g.
//   https://<api-id>.execute-api.us-west-2.amazonaws.com/dev/l1/register
// The list URL is derived by swapping the trailing /register → /sources.

export const L1_REGISTER_URL =
  (import.meta.env.VITE_L1_CAPTURE_ENDPOINT as string | undefined) ?? ''

export const L1_SOURCES_URL = L1_REGISTER_URL
  ? L1_REGISTER_URL.replace(/\/register\/?$/, '/sources')
  : ''

/** localStorage key for the operator's bearer token (wf/api/l1-source-write-token). */
export const L1_TOKEN_KEY = 'l1-capture-token-v1'
