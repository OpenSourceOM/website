// Copyright 2026 OpenSourceOM
// SPDX-License-Identifier: Apache-2.0
import { defineConfig, envField } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import vercel from '@astrojs/vercel';
import { buildLastmodByPath, lastmodForUrl, noindexBlogPathnames } from './scripts/content-dates.mjs';

const SITE = 'https://opensourceom.org';
const noindexBlogPages = noindexBlogPathnames();
const lastmodByPath = buildLastmodByPath();

export default defineConfig({
  site: SITE,
  output: 'static',
  adapter: vercel(),
  integrations: [
    sitemap({
      filter: (page) => {
        try {
          const pathname = new URL(page).pathname;
          if (pathname === '/rss.xml') return false;
          return !noindexBlogPages.has(pathname);
        } catch {
          return true;
        }
      },
      serialize(item) {
        const lastmod = lastmodForUrl(item.url, lastmodByPath);
        if (lastmod) item.lastmod = lastmod;
        return item;
      },
    }),
  ],
  env: {
    schema: {
      RESEND_API_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
      CONTACT_FROM: envField.string({ context: 'server', access: 'secret', optional: true }),
      CONTACT_TO: envField.string({ context: 'server', access: 'secret', optional: true }),
    },
  },
  markdown: {
    shikiConfig: {
      theme: 'github-dark',
    },
  },
});
