#!/usr/bin/env bash
# Copyright 2026 OpenSourceOM
# SPDX-License-Identifier: Apache-2.0
#
# Submit sitemap to Google Search Console via API.
#
# Prerequisites (one-time):
# 1. Add property at https://search.google.com/search-console
#    - Recommended: Domain property for opensourceom.org
# 2. Verify ownership (DNS TXT record or HTML meta tag)
#    - For HTML tag: set PUBLIC_GOOGLE_SITE_VERIFICATION in Vercel env vars
# 3. Enable Search Console API: https://console.cloud.google.com/apis/library/searchconsole.googleapis.com
# 4. Authenticate: gcloud auth login && gcloud auth application-default login
#
# Usage:
#   ./scripts/submit-google-sitemap.sh

set -euo pipefail

SITE_URL='sc-domain:opensourceom.org'
SITEMAP_URL='https://opensourceom.org/sitemap-index.xml'
ENCODED_SITE=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$SITE_URL', safe=''))")
ENCODED_SITEMAP=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$SITEMAP_URL', safe=''))")

if ! command -v gcloud >/dev/null 2>&1; then
  echo "gcloud CLI not found."
  echo ""
  echo "Submit manually instead:"
  echo "  1. Open https://search.google.com/search-console/sitemaps?resource_id=sc-domain%3Aopensourceom.org"
  echo "  2. Enter: sitemap-index.xml"
  echo "  3. Click Submit"
  exit 1
fi

TOKEN=$(gcloud auth print-access-token)
HTTP_CODE=$(curl -s -o /tmp/gsc-sitemap-response.txt -w '%{http_code}' \
  -X PUT \
  "https://www.googleapis.com/webmasters/v3/sites/${ENCODED_SITE}/sitemaps/${ENCODED_SITEMAP}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H 'Content-Length: 0')

if [[ "$HTTP_CODE" == "204" || "$HTTP_CODE" == "200" ]]; then
  echo "Sitemap submitted successfully: ${SITEMAP_URL}"
  exit 0
fi

echo "Submission failed (HTTP ${HTTP_CODE})."
cat /tmp/gsc-sitemap-response.txt
echo ""
echo "If the property is not verified yet, complete verification first:"
echo "  https://search.google.com/search-console"
exit 1
