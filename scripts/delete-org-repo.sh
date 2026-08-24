# Copyright 2026 OpenSourceOM
# SPDX-License-Identifier: Apache-2.0
#!/usr/bin/env bash
set -euo pipefail

# Delete OpenSourceOM/website from GitHub.
# Usage: ./scripts/delete-org-repo.sh

ORG="OpenSourceOM"
REPO="website"
API="https://api.github.com/repos/$ORG/$REPO"

TOKEN_FILE="${GITHUB_TOKEN_FILE:-$HOME/.config/opensourceom/token}"
if [ -z "${GITHUB_TOKEN:-}" ] && [ -f "$TOKEN_FILE" ]; then
  GITHUB_TOKEN=$(tr -d '[:space:]' < "$TOKEN_FILE")
  export GITHUB_TOKEN
fi

[ -n "${GITHUB_TOKEN:-}" ] || { echo "Set GITHUB_TOKEN or create $TOKEN_FILE"; exit 1; }

CODE=$(curl -s -o /tmp/gh-delete-response.json -w "%{http_code}" -X DELETE \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "$API")

if [ "$CODE" = "204" ]; then
  echo "Deleted https://github.com/$ORG/$REPO"
elif [ "$CODE" = "404" ]; then
  echo "Repo does not exist (already deleted)"
else
  echo "Failed (HTTP $CODE):"
  cat /tmp/gh-delete-response.json
  exit 1
fi
