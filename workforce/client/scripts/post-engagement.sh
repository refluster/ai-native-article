#!/usr/bin/env bash
# Post an engagement record back to the workforce. Invoked by the
# wf-engage skill at the end of each engagement; the JSON record arrives
# on stdin.
#
# Usage:
#   bash scripts/wf-engage/post-engagement.sh <agent_slug> < record.json
#   bash scripts/wf-engage/post-engagement.sh <agent_slug> <<EOF
#   { ...record... }
#   EOF
#
# Exit codes:
#   0  — workforce returned 201 (engagement filed)
#   2  — usage error (missing slug, no body, missing config)
#   3  — workforce returned 4xx/5xx (response body printed to stderr)
#   4  — transport / network failure (curl error printed to stderr)

set -euo pipefail

SLUG="${1:-}"
if [[ -z "${SLUG}" ]]; then
  echo "usage: $0 <agent_slug> < record.json" >&2
  exit 2
fi

# Walk up from cwd to find .workforce/project.json — supports invocation
# from anywhere under the repo, not just the root.
find_workforce_dir() {
  local dir
  dir="$(pwd)"
  while [[ "${dir}" != "/" ]]; do
    if [[ -f "${dir}/.workforce/project.json" ]]; then
      echo "${dir}/.workforce"
      return 0
    fi
    dir="$(dirname "${dir}")"
  done
  return 1
}

WF_DIR="$(find_workforce_dir)" || {
  echo "post-engagement: no .workforce/project.json found in this repo or ancestors" >&2
  exit 2
}

if [[ -f "${WF_DIR}/.env" ]]; then
  # shellcheck source=/dev/null
  set -a; source "${WF_DIR}/.env"; set +a
fi

WF_TOKEN="${WF_TOKEN:-}"
if [[ -z "${WF_TOKEN}" ]]; then
  echo "post-engagement: WF_TOKEN not set; check ${WF_DIR}/.env" >&2
  exit 2
fi

ENDPOINT="$(jq -r .workforce_endpoint "${WF_DIR}/project.json")"
if [[ -z "${ENDPOINT}" || "${ENDPOINT}" == "null" || "${ENDPOINT}" == https://REPLACE_WITH* ]]; then
  echo "post-engagement: workforce_endpoint missing or placeholder in ${WF_DIR}/project.json" >&2
  exit 2
fi

# Strip a trailing slash so the join is clean.
ENDPOINT="${ENDPOINT%/}"

# Buffer stdin so we can print it back on failure for diagnostics.
record="$(cat)"
if [[ -z "${record}" ]]; then
  echo "post-engagement: empty stdin — pipe the engagement record JSON in" >&2
  exit 2
fi

# Capture status + body separately so we can branch on the response.
response="$(mktemp)"
trap 'rm -f "${response}"' EXIT
http_status="$(
  curl -sS -o "${response}" -w "%{http_code}" \
    -X POST \
    -H "Authorization: Bearer ${WF_TOKEN}" \
    -H "Content-Type: application/json" \
    --data-binary "${record}" \
    "${ENDPOINT}/agents/${SLUG}/engagements" \
  || echo "transport_failure"
)"

if [[ "${http_status}" == "transport_failure" ]]; then
  echo "post-engagement: curl transport failure (network down? wrong endpoint?)" >&2
  exit 4
fi

if [[ "${http_status}" == "201" ]]; then
  cat "${response}"
  exit 0
fi

echo "post-engagement: workforce returned ${http_status}" >&2
cat "${response}" >&2
echo >&2
exit 3
