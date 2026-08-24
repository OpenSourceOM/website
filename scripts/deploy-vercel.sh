# Copyright 2026 OpenSourceOM
# SPDX-License-Identifier: Apache-2.0
#!/usr/bin/env bash
set -euo pipefail

# Deploy OpenSourceOM website to Vercel (non-interactive).
#
# One-time: create token at https://vercel.com/account/settings/tokens
#   mkdir -p ~/.config/opensourceom
#   printf '%s' 'YOUR_VERCEL_TOKEN' > ~/.config/opensourceom/vercel-token
#   chmod 600 ~/.config/opensourceom/vercel-token
#
# Usage:
#   ./scripts/deploy-vercel.sh
#   VERCEL_TOKEN=xxx ./scripts/deploy-vercel.sh

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TOKEN_FILE="${VERCEL_TOKEN_FILE:-$HOME/.config/opensourceom/vercel-token}"

if [ -z "${VERCEL_TOKEN:-}" ] && [ -f "$TOKEN_FILE" ]; then
  VERCEL_TOKEN=$(tr -d '[:space:]' < "$TOKEN_FILE")
  export VERCEL_TOKEN
fi

[ -n "${VERCEL_TOKEN:-}" ] || {
  echo "Missing VERCEL_TOKEN. Create one at https://vercel.com/account/settings/tokens"
  echo "Then: printf '%s' 'TOKEN' > ~/.config/opensourceom/vercel-token"
  exit 1
}

log() { printf '\n▸ %s\n' "$1"; }

cd "$PROJECT_DIR"

log "Building locally..."
npm run build

log "Deploying to Vercel production..."
npx vercel deploy --prod --yes --token="$VERCEL_TOKEN"

log "Done. Check the production URL above (or your Vercel dashboard)."
