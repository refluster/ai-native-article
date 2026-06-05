#!/usr/bin/env bash
# Install workforce-client into the current repo (the consumer / RepoA).
#
# Idempotent: re-running overwrites the skill + helper script (those are
# the load-bearing artefacts that evolve upstream), but leaves your
# `.workforce/project.json` and `.workforce/.env` alone.
#
# Two install paths:
#
#   1. From the upstream repo via curl (one-liner from anywhere):
#        curl -fsSL https://raw.githubusercontent.com/refluster/ai-native-article/main/workforce/client/scripts/install.sh | bash
#
#   2. From a local checkout (use this when iterating on the client):
#        bash /path/to/ai-native-article/workforce/client/scripts/install.sh
#
# In both cases the cwd at invocation time is treated as the consumer
# repo's root.

set -euo pipefail

WF_REPO="${WF_REPO:-refluster/ai-native-article}"
WF_BRANCH="${WF_BRANCH:-main}"
WF_CLIENT_PATH="${WF_CLIENT_PATH:-workforce/client}"

# Detect whether we're running from a local checkout. If so, prefer
# filesystem copies — they don't depend on network reachability and
# survive offline use. Heuristic: `$0` resolves to an existing file
# whose parent directory contains the expected `templates/` tree.
local_source=""
if [[ -f "${0}" ]]; then
  script_dir="$(cd "$(dirname "${0}")" && pwd)"
  if [[ -d "${script_dir}/../templates/claude-skills/wf-engage" ]]; then
    local_source="$(cd "${script_dir}/.." && pwd)"
  fi
fi

dest_root="$(pwd)"
echo "Installing workforce-client into: ${dest_root}"
if [[ -n "${local_source}" ]]; then
  echo "Source: local checkout at ${local_source}"
else
  echo "Source: https://raw.githubusercontent.com/${WF_REPO}/${WF_BRANCH}/${WF_CLIENT_PATH}/"
fi
echo

# fetch <relative-path-under-workforce-client> <destination-absolute>
fetch() {
  local rel="$1"
  local dst="$2"
  mkdir -p "$(dirname "${dst}")"
  if [[ -n "${local_source}" ]]; then
    cp "${local_source}/${rel}" "${dst}"
  else
    curl -fsSL "https://raw.githubusercontent.com/${WF_REPO}/${WF_BRANCH}/${WF_CLIENT_PATH}/${rel}" \
      -o "${dst}"
  fi
}

# 1. The skill — overwritten on every install (it's the contract).
fetch "templates/claude-skills/wf-engage/SKILL.md" \
      "${dest_root}/.claude/skills/wf-engage/SKILL.md"

# 2. The helper script — overwritten on every install.
fetch "scripts/post-engagement.sh" \
      "${dest_root}/scripts/wf-engage/post-engagement.sh"
chmod +x "${dest_root}/scripts/wf-engage/post-engagement.sh"

# 3. project.json — copied as a template ONLY if not already present.
if [[ -f "${dest_root}/.workforce/project.json" ]]; then
  echo "Kept existing .workforce/project.json (re-edit by hand if upstream schema changed)."
else
  fetch "templates/workforce/project.json.template" \
        "${dest_root}/.workforce/project.json"
  echo "Wrote .workforce/project.json (edit before first use)."
fi

# 4. .env.example — always copied; .env never touched.
fetch "templates/workforce/.env.example" \
      "${dest_root}/.workforce/.env.example"
if [[ -f "${dest_root}/.workforce/.env" ]]; then
  echo "Kept existing .workforce/.env (rotation = edit by hand)."
fi

cat <<EOF

Install OK. Next steps:

  1. Edit ${dest_root}/.workforce/project.json — replace
     REPLACE_WITH_YOUR_PROJECT_ID and REPLACE_WITH_YOUR_WORKFORCE_API_ENDPOINT.

  2. Copy .workforce/.env.example to .workforce/.env and paste the bearer
     token the workforce operator issued you:
       cp .workforce/.env.example .workforce/.env
       \$EDITOR .workforce/.env

  3. Add .workforce/.env to your .gitignore (do not commit secrets).

  4. Ensure upstream workforce/projects/<your_id>/project.json declares
     your roster (the agents your team can engage). Open a PR against
     refluster/ai-native-article if it isn't already there.

  5. Smoke test in Claude Code:
       "Nadia, what kind of work are you set up to do here?"
     Claude Code should load .claude/skills/wf-engage/SKILL.md, fetch
     Nadia's resume + system.md, and reply in Nadia's voice.

EOF
