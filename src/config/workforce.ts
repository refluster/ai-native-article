// Workforce agents-api endpoint configuration.
//
// The agents-api lives on an AWS-generated API Gateway URL after the SAM
// stack deploys. Operator drops the URL into the env var below (or edits
// this file in a follow-up PR when a custom domain lands). When unset,
// the SPA shows static metadata only and the live-stats section
// degrades gracefully to "stats unavailable".

/**
 * Base URL of the wf-agents-api HTTP API for the current stage, with no
 * trailing slash. Empty string disables the API client.
 *
 * To set, edit this constant when the operator gets the dev/prod URL from
 * `aws cloudformation describe-stacks --stack-name wf-data-plane-<stage>
 *  --query 'Stacks[0].Outputs[?OutputKey==\`AgentsApiUrl\`].OutputValue'`.
 */
export const WORKFORCE_AGENTS_API_BASE = '' as const
