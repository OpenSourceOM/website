<!--
Copyright 2026 OpenSourceOM
SPDX-License-Identifier: Apache-2.0
-->

# Analytics setup

The site supports **Vercel Web Analytics** (recommended) and optional **Google Analytics 4**.

## Vercel Web Analytics (built-in)

Tracks page views, visitors, top pages, countries, and devices.

### Enable (one-time, dashboard)

1. Open [vercel.com/opensourceom/website/analytics](https://vercel.com/opensourceom/website/analytics)
2. Click **Enable Web Analytics**
3. Redeploy if prompted (or wait for the next `git push`)

No API keys in code — `@vercel/analytics` is already in the site layout.

### GitHub link clicks

Custom event **`github_click`** fires when anyone clicks a link to `github.com/OpenSourceOM/*`.

View in Vercel: **Analytics → Events** (after traffic accumulates).

Event payload:

| Field | Example |
|-------|---------|
| `href` | `https://github.com/OpenSourceOM/core` |
| `label` | `GitHub` |
| `page` | `/blog/attack-path-analysis-cloud-security/` |

## Google Analytics 4 (optional)

Use GA4 if you prefer Google Search Console integration or familiar GA reports.

1. Create a property at [analytics.google.com](https://analytics.google.com)
2. Copy the **Measurement ID** (`G-XXXXXXXXXX`)
3. In Vercel: **Project → Settings → Environment Variables**
   - Name: `PUBLIC_GA_MEASUREMENT_ID`
   - Value: `G-XXXXXXXXXX`
   - Environments: Production (and Preview if desired)
4. Redeploy

GitHub clicks also send a GA4 `github_click` event when GA is enabled.

## Local development

Analytics are disabled or minimal locally. Test events on the production URL after deploy.

## Privacy

- Vercel Analytics is cookie-free and GDPR-friendly ([docs](https://vercel.com/docs/analytics))
- GA4 uses cookies — add a cookie notice if required for your jurisdiction
