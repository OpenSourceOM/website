<!--
Copyright 2026 OpenSourceOM
SPDX-License-Identifier: Apache-2.0
-->

# Domain strategy for OpenSourceOM

This guide helps you choose, register, and connect a domain for the project website and GitHub org.

## Recommended primary domain

**`opensourceom.org`** — best fit for an open-source security project.

| Factor | Why `.org` |
|--------|------------|
| Trust | `.org` signals community / non-profit mission (common for OSS) |
| SEO | Exact-match brand (`opensourceom`) helps branded search |
| Cost | Typically $10–15/year |
| Availability | Check before committing to the org name |

### Alternatives if `opensourceom.org` is taken

| Domain | Use case |
|--------|----------|
| `opensourceom.io` | Developer / infra audience |
| `opensourceom.dev` | Emphasizes builder community |
| `opensourceom.com` | Commercial support or SaaS later |
| `getopensourceom.com` | Marketing redirect only (not primary) |

**Avoid:** Names too close to existing vendors (e.g. containing "wiz") — trademark risk.

---

## Where to register

| Registrar | Pros | Cons |
|-----------|------|------|
| **[Cloudflare Registrar](https://www.cloudflare.com/products/registrar/)** | At-cost pricing, excellent DNS, free CDN | Must use Cloudflare DNS |
| **[Porkbun](https://porkbun.com)** | Cheap, simple UI, good for side projects | Fewer enterprise features |
| **[Namecheap](https://www.namecheap.com)** | Popular, easy WHOIS privacy | Upsells |
| **Google Domains → Squarespace** | Simple | Now Squarespace; check current pricing |

**Recommendation:** Register at **Cloudflare** if you plan to use Cloudflare DNS anyway; otherwise **Porkbun** or **Namecheap** for simplicity.

---

## DNS layout (Vercel hosting)

After deploying to Vercel, add the domain in **Project → Settings → Domains**.

### Apex + www (recommended)

| Type | Name | Value |
|------|------|--------|
| `A` | `@` | `76.76.21.21` (Vercel apex) |
| `CNAME` | `www` | `cname.vercel-dns.com` |

Vercel will issue TLS certificates automatically. Redirect `www` → apex (or vice versa) in Vercel domain settings — pick one canonical host for SEO.

### Subdomains for future services

| Subdomain | Purpose |
|------------|---------|
| `docs.opensourceom.org` | Optional: separate docs (currently `/docs` on main site) |
| `api.opensourceom.org` | Core product API (future) |
| `demo.opensourceom.org` | Live sandbox / graph demo |
| `status.opensourceom.org` | Uptime page (Better Stack, Instatus) |

Start with **only apex + www**. Add subdomains when you need them.

---

## Email (optional but professional)

GitHub org verification and partner outreach benefit from `@opensourceom.org` email.

| Provider | Cost | Notes |
|----------|------|-------|
| **[Cloudflare Email Routing](https://developers.cloudflare.com/email-routing/)** | Free | Forward `hello@`, `security@` to personal inbox |
| **Google Workspace** | Paid | Full mailbox + Calendar |
| **Proton Mail** | Paid | Privacy-focused |

Minimum setup:

- `hello@opensourceom.org` → contact / general
- `security@opensourceom.org` → vulnerability reports (link in `SECURITY.md`)
- `abuse@opensourceom.org` → if you run public infra

---

## GitHub org verification

Once the domain is live:

1. GitHub org → **Settings → Verified & approved domains**
2. Add `opensourceom.org`
3. Add DNS `TXT` record GitHub provides
4. Enables `@OpenSourceOM` noreply emails and domain-based access rules

Update org profile URL to `https://opensourceom.org`.

---

## SEO checklist after domain goes live

1. Set `site` in `astro.config.mjs` to your canonical URL
2. Update `public/robots.txt` sitemap URL
3. Submit sitemap in [Google Search Console](https://search.google.com/search-console)
4. Submit sitemap in [Bing Webmaster Tools](https://www.bing.com/webmasters)
5. Add canonical URLs (already handled by `SEO.astro`)
6. Register same name on X/GitHub Discussions if available

---

## Budget estimate (year 1)

| Item | Cost |
|------|------|
| Domain `.org` | ~$12/yr |
| Vercel (OSS site) | $0 |
| Cloudflare DNS | $0 |
| Email forwarding | $0 |
| **Total** | **~$12/yr** |

---

## Action checklist

- [ ] Search availability at [Cloudflare Registrar](https://dash.cloudflare.com/?to=/:account/domains/register) or Porkbun
- [ ] Register `opensourceom.org` (or chosen variant)
- [ ] Deploy website to Vercel
- [ ] Point DNS to Vercel
- [ ] Verify domain on GitHub org
- [ ] Set up `security@` forwarding
- [ ] Submit sitemap to Google Search Console
