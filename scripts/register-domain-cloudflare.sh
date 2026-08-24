# Copyright 2026 OpenSourceOM
# SPDX-License-Identifier: Apache-2.0
#!/usr/bin/env bash
set -euo pipefail

# Register opensourceom.org via Cloudflare Registrar API (CLI).
# WHOIS privacy (redaction) is enabled by default — no extra cost on Cloudflare.
#
# ONE-TIME BROWSER SETUP (before running this script):
#   1. Create account: https://dash.cloudflare.com/sign-up
#   2. Add credit card: https://dash.cloudflare.com → Billing → Payment methods
#   3. Set default registrant + accept agreement:
#      https://dash.cloudflare.com → Domain Registration → set address book default
#   4. Create API token: https://dash.cloudflare.com/profile/api-tokens
#      Template: "Edit Cloudflare Registrar" OR custom with:
#        Account → Cloudflare Registrar → Edit
#   5. Save credentials:
#        mkdir -p ~/.config/opensourceom
#        printf '%s' 'YOUR_TOKEN' > ~/.config/opensourceom/cloudflare-token
#        chmod 600 ~/.config/opensourceom/cloudflare-token
#        printf '%s' 'YOUR_ACCOUNT_ID' > ~/.config/opensourceom/cloudflare-account-id
#
# Usage:
#   ./scripts/register-domain-cloudflare.sh
#   DOMAIN=opensourceom.org ./scripts/register-domain-cloudflare.sh
#   SETUP_VERCEL_DNS=1 ./scripts/register-domain-cloudflare.sh   # after Vercel domain add

DOMAIN="${DOMAIN:-opensourceom.org}"
API="https://api.cloudflare.com/client/v4"
CONF_DIR="${HOME}/.config/opensourceom"
TOKEN_FILE="${CLOUDFLARE_API_TOKEN_FILE:-$CONF_DIR/cloudflare-token}"
ACCOUNT_FILE="${CLOUDFLARE_ACCOUNT_ID_FILE:-$CONF_DIR/cloudflare-account-id}"

log() { printf '\n▸ %s\n' "$1"; }
die() { printf '\n✗ %s\n' "$1" >&2; exit 1; }

load_credentials() {
  if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] && [ -f "$TOKEN_FILE" ]; then
    CLOUDFLARE_API_TOKEN=$(tr -d '[:space:]' < "$TOKEN_FILE")
  fi
  if [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ] && [ -f "$ACCOUNT_FILE" ]; then
    CLOUDFLARE_ACCOUNT_ID=$(tr -d '[:space:]' < "$ACCOUNT_FILE")
  fi
  [ -n "${CLOUDFLARE_API_TOKEN:-}" ] || die "Missing CLOUDFLARE_API_TOKEN. Save to $TOKEN_FILE"
  [ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ] || die "Missing CLOUDFLARE_ACCOUNT_ID. Save to $ACCOUNT_FILE or run: ./scripts/register-domain-cloudflare.sh --account-id"
}

auth_headers() {
  AUTH=(-H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json")
}

fetch_account_id() {
  auth_headers
  log "Fetching Cloudflare account ID..."
  RESPONSE=$(curl -s "${AUTH[@]}" "$API/accounts")
  ACCOUNT_ID=$(echo "$RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  [ -n "$ACCOUNT_ID" ] || die "Could not fetch account ID. Save manually to $ACCOUNT_FILE"
  printf '%s' "$ACCOUNT_ID" > "$ACCOUNT_FILE"
  chmod 600 "$ACCOUNT_FILE"
  CLOUDFLARE_ACCOUNT_ID="$ACCOUNT_ID"
  log "Saved account ID to $ACCOUNT_FILE"
}

check_availability() {
  auth_headers
  log "Checking availability for $DOMAIN..."
  BODY=$(curl -s "${AUTH[@]}" -X POST \
    "$API/accounts/$CLOUDFLARE_ACCOUNT_ID/registrar/domain-check" \
    -d "{\"domains\":[\"$DOMAIN\"]}")
  echo "$BODY" | grep -q '"registrable":true' || {
    echo "$BODY" | head -c 2000
    die "$DOMAIN is not available or not registrable via API"
  }
  PRICE=$(echo "$BODY" | grep -o '"registration_cost":[0-9.]*' | head -1 | cut -d: -f2 || echo "?")
  log "Available. Registration cost: \$$PRICE USD (approx)"
}

register_domain() {
  auth_headers
  log "Registering $DOMAIN (WHOIS privacy: redaction)..."
  RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" "${AUTH[@]}" -X POST \
    "$API/accounts/$CLOUDFLARE_ACCOUNT_ID/registrar/registrations" \
    -d "{
      \"domain_name\": \"$DOMAIN\",
      \"years\": 1,
      \"auto_renew\": true,
      \"privacy_mode\": \"redaction\"
    }")
  HTTP=$(echo "$RESPONSE" | grep HTTP_CODE | cut -d: -f2)
  BODY=$(echo "$RESPONSE" | sed '/HTTP_CODE/d')

  if [ "$HTTP" = "201" ] || [ "$HTTP" = "200" ]; then
    log "Registration complete!"
    echo "$BODY" | head -c 1500
    return
  fi

  if [ "$HTTP" = "202" ]; then
    log "Registration in progress (HTTP 202). Polling..."
    POLL_URL=$(echo "$BODY" | grep -o '"self":"[^"]*"' | head -1 | cut -d'"' -f4)
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      sleep 5
      STATUS=$(curl -s "${AUTH[@]}" "$POLL_URL")
      echo "$STATUS" | grep -q '"state":"succeeded"' && { log "Registration succeeded!"; return; }
      echo "$STATUS" | grep -q '"state":"failed"' && die "Registration failed: $STATUS"
      log "Still processing..."
    done
    die "Registration timed out. Check Cloudflare dashboard → Domain Registration"
  fi

  echo "$BODY"
  die "Registration failed (HTTP $HTTP)"
}

setup_vercel_dns() {
  [ "${SETUP_VERCEL_DNS:-}" = "1" ] || return 0
  auth_headers
  log "Adding Vercel DNS records for $DOMAIN..."

  ZONE_ID=$(curl -s "${AUTH[@]}" "$API/zones?name=$DOMAIN" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  [ -n "$ZONE_ID" ] || die "Zone not found for $DOMAIN (may take a minute after registration)"

  curl -s "${AUTH[@]}" -X POST "$API/zones/$ZONE_ID/dns_records" \
    -d '{"type":"A","name":"@","content":"76.76.21.21","proxied":false}' >/dev/null

  curl -s "${AUTH[@]}" -X POST "$API/zones/$ZONE_ID/dns_records" \
    -d '{"type":"CNAME","name":"www","content":"cname.vercel-dns.com","proxied":false}' >/dev/null

  log "DNS records added. Add $DOMAIN in Vercel → Settings → Domains if not done yet."
}

main() {
  if [ "${1:-}" = "--account-id" ]; then
    load_credentials 2>/dev/null || true
    [ -n "${CLOUDFLARE_API_TOKEN:-}" ] || die "Set CLOUDFLARE_API_TOKEN first"
    fetch_account_id
    exit 0
  fi

  load_credentials
  auth_headers
  check_availability
  register_domain
  setup_vercel_dns
  log "Done. Domain: https://$DOMAIN"
  log "Next: add $DOMAIN in Vercel → Settings → Domains, then run:"
  log "  SETUP_VERCEL_DNS=1 ./scripts/register-domain-cloudflare.sh  # if DNS not auto-set"
}

main "$@"
