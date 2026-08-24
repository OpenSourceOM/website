# Copyright 2026 OpenSourceOM
# SPDX-License-Identifier: Apache-2.0
#!/usr/bin/env bash
set -euo pipefail

# Connect opensourceom.org to the Vercel website project (non-interactive).
#
# Prerequisites:
#   - Domain purchased on Vercel
#   - VERCEL_TOKEN in ~/.config/opensourceom/vercel-token or env
#
# Usage:
#   ./scripts/connect-domain-vercel.sh

DOMAIN="${DOMAIN:-opensourceom.org}"
WWW_DOMAIN="www.${DOMAIN}"
PROJECT="${VERCEL_PROJECT:-website}"
SCOPE="${VERCEL_SCOPE:-opensourceom}"
TOKEN_FILE="${VERCEL_TOKEN_FILE:-$HOME/.config/opensourceom/vercel-token}"

if [ -z "${VERCEL_TOKEN:-}" ] && [ -f "$TOKEN_FILE" ]; then
  VERCEL_TOKEN=$(tr -d '[:space:]' < "$TOKEN_FILE")
fi

ARGS=(--scope "$SCOPE")
[ -n "${VERCEL_TOKEN:-}" ] && ARGS+=(--token "$VERCEL_TOKEN")

log() { printf '\n▸ %s\n' "$1"; }

log "Adding $DOMAIN to project $PROJECT..."
npx vercel domains add "$DOMAIN" "$PROJECT" "${ARGS[@]}"

log "Adding $WWW_DOMAIN to project $PROJECT..."
npx vercel domains add "$WWW_DOMAIN" "$PROJECT" "${ARGS[@]}"

log "Verifying DNS..."
npx vercel domains verify "$DOMAIN" "${ARGS[@]}" || true
npx vercel domains inspect "$DOMAIN" "${ARGS[@]}"

log "Done. Site should be live at https://$DOMAIN once nameservers propagate (usually minutes)."
