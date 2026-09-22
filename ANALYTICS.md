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

## Google Analytics 4

The Google tag for measurement ID `G-M9EMDYHBPE` is injected at the start of `<head>` on every page. Vercel Web Analytics stays in place and is not replaced.

To point the site at a different property, set `PUBLIC_GA_MEASUREMENT_ID` in Vercel (**Project → Settings → Environment Variables**) and redeploy. An invalid or empty value disables the Google tag only.

GitHub clicks also send a GA4 `github_click` event when GA is enabled.

## Local development

Analytics are disabled or minimal locally. Test events on the production URL after deploy.

## Privacy

- Vercel Analytics is cookie-free and GDPR-friendly ([docs](https://vercel.com/docs/analytics))
- GA4 uses cookies — add a cookie notice if required for your jurisdiction
