# Copyright 2026 OpenSourceOM
# SPDX-License-Identifier: Apache-2.0
#!/usr/bin/env bash
# Load token from a local file (non-interactive). Create the file once:
#   mkdir -p ~/.config/opensourceom
#   chmod 700 ~/.config/opensourceom
#   printf '%s' 'ghp_YOUR_REAL_TOKEN' > ~/.config/opensourceom/token
#   chmod 600 ~/.config/opensourceom/token
#
# Then run:
#   ./scripts/push-to-org-noninteractive.sh

set -euo pipefail

TOKEN_FILE="${GITHUB_TOKEN_FILE:-$HOME/.config/opensourceom/token}"

if [ -z "${GITHUB_TOKEN:-}" ] && [ -f "$TOKEN_FILE" ]; then
  GITHUB_TOKEN=$(tr -d '[:space:]' < "$TOKEN_FILE")
  export GITHUB_TOKEN
fi

exec "$(dirname "$0")/push-to-org.sh" "$@"
