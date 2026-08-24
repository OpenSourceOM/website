<!--
Copyright 2026 OpenSourceOM
SPDX-License-Identifier: Apache-2.0
-->

# Setup guide: GitHub org, repo, and Vercel hosting

Follow these steps to publish the OpenSourceOM website under a new GitHub organization.

## 1. Install prerequisites (one time)

On macOS, install developer tools and Node.js:

```bash
# Git (required for GitHub)
xcode-select --install

# Node.js 20 LTS — pick one:
# Option A: https://nodejs.org/en/download
# Option B: Homebrew — brew install node
# Option C: fnm — curl -fsSL https://fnm.vercel.app/install | bash
```

Optional but recommended — [GitHub CLI](https://cli.github.com/):

```bash
brew install gh
gh auth login
```

---

## 2. Create the GitHub organization

1. Sign in to GitHub
2. Open [github.com/organizations/plan](https://github.com/organizations/plan)
3. Choose **Create a free organization**
4. Organization name: **`OpenSourceOM`**
   - If taken, try `OpenSourceOM-io`, `opensource-om`, or register a domain first
5. Contact email: your team address
6. Choose **My personal account** (or a company account) as owner
7. Skip paid features — the free plan is enough for public repos

**Recommended org settings** (Settings → Organization settings):

| Setting | Value |
|---------|--------|
| Profile → Display name | OpenSourceOM |
| Profile → Description | Open-source cloud security with attack-path graphing |
| Profile → URL | `https://opensourceom.org` (after domain is live) |
| Member privileges | Restrict repo creation to owners initially |
| Verified domains | Add `opensourceom.org` when you own it (enables `@OpenSourceOM` email links) |

---

## 3. Create the public repository

### Option A — GitHub website

1. Org home → **New repository**
2. Name: **`website`**
3. Description: `Marketing site and docs for OpenSourceOM`
4. **Public**
5. Do **not** initialize with README (this folder already has one)
6. Create repository

### Option B — GitHub CLI

```bash
gh org create OpenSourceOM --description "Open-source cloud security platform"
gh repo create OpenSourceOM/website --public --source . --remote origin --push
```

---

## 4. Push this code

From `/Users/om/Projects/OpenSourceOM/website`:

```bash
git init
git add .
git commit -m "Initial OpenSourceOM marketing site with docs"
git branch -M main
git remote add origin git@github.com:OpenSourceOM/website.git
git push -u origin main
```

Use HTTPS if you prefer:

```bash
git remote add origin https://github.com/OpenSourceOM/website.git
```

---

## 5. Deploy on Vercel (recommended)

Vercel fits Astro well: zero-config builds, preview URLs on every PR, free tier for open source.

1. Sign in at [vercel.com](https://vercel.com) with GitHub
2. **Add New → Project**
3. Import **`OpenSourceOM/website`**
4. Framework preset: **Astro** (auto-detected)
5. Deploy

**Production domain options:**

| Approach | URL | Notes |
|----------|-----|--------|
| Vercel subdomain | `website-xxx.vercel.app` | Instant, good for staging |
| Custom domain | `opensourceom.org` | Buy domain (Namecheap, Cloudflare Registrar, etc.), add DNS in Vercel |
| `www` redirect | `www.opensourceom.org` → apex | Configure in Vercel domain settings |

After adding a custom domain, update `site` in `astro.config.mjs` and redeploy.

---

## 6. Optional: GitHub Pages (alternative)

If you prefer everything on GitHub:

1. Install `@astrojs/github-pages` or set `base` in Astro config for project pages
2. Enable **Settings → Pages → GitHub Actions**
3. Add a deploy workflow

Vercel is simpler for custom domains and preview deploys; GitHub Pages is fine if you want zero third-party hosting.

---

## 7. Future repos in the org

Suggested layout as the product grows:

| Repo | Purpose |
|------|---------|
| `OpenSourceOM/website` | This marketing + docs site |
| `OpenSourceOM/core` | Main platform (collectors, graph, API) — scaffolded at `../core` |
| `OpenSourceOM/.github` | Org profile README, community health files |

Push the core repo:

```bash
cd /Users/om/Projects/OpenSourceOM/core
git init
git add .
git commit -m "Initial core repo scaffold with roadmap and architecture"
git branch -M main
git remote add origin git@github.com:OpenSourceOM/core.git
git push -u origin main
```

Add an org profile README by creating `OpenSourceOM/.github` with `profile/README.md` (template in `website/org-templates/`).

---

## 8. Domain checklist

See **[DOMAIN.md](./DOMAIN.md)** for registrar recommendations, DNS records, email setup, and GitHub verification.

Quick checklist:

1. Register **opensourceom.org** (or your chosen name)
2. Point DNS to Vercel (A/CNAME records from Vercel dashboard)
3. Enable HTTPS (automatic on Vercel)
4. Add domain verification in GitHub org settings
5. Update `astro.config.mjs`, `public/robots.txt`, and footer links if the domain differs

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `xcode-select: No developer tools` | Run `xcode-select --install` and complete the dialog |
| Org name taken | Pick a variant or use a domain-backed name |
| Vercel build fails | Ensure Node 20 in Project Settings → General → Node.js Version |
| Sitemap 404 | Run `npm run build` locally; `@astrojs/sitemap` emits `sitemap-index.xml` in `dist/` |
