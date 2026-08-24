<!--
Copyright 2026 OpenSourceOM
SPDX-License-Identifier: Apache-2.0
-->

# OpenSourceOM Website

Marketing site and documentation for [OpenSourceOM](https://github.com/OpenSourceOM) — an open-source, graph-native cloud security platform.

Built with [Astro](https://astro.build) for fast static pages and simple deployment to Vercel.

## Local development

**Prerequisites:** Node.js 20+ and Git (install Xcode Command Line Tools on macOS: `xcode-select --install`).

```bash
npm install
npm run dev
```

Open [http://localhost:4321](http://localhost:4321).

## Production build

```bash
npm run build
npm run preview
```

Output is written to `dist/`.

## Deploy to Vercel

1. Push this repo to `github.com/OpenSourceOM/website`
2. Go to [vercel.com/new](https://vercel.com/new) and import the repository
3. Vercel auto-detects Astro — no build settings changes needed
4. Add a custom domain under **Project → Settings → Domains**
5. Update the production URL in `astro.config.mjs` when your domain is finalized (`site: 'https://opensourceom.org'`)

See [SETUP.md](./SETUP.md) for GitHub organization and first-push instructions.  
See [DOMAIN.md](./DOMAIN.md) for domain registration and DNS setup.

## Org profile README

Copy [org-templates/github-profile-README.md](./org-templates/github-profile-README.md) into a new repo `OpenSourceOM/.github` as `profile/README.md`.

## Project structure

```
src/
  components/   # Hero, features, graph demo
  layouts/      # Base and docs layouts
  pages/        # Routes (/, /docs/*)
  styles/       # Global CSS
public/         # Static assets, robots.txt
```

## License

Apache-2.0
