// Copyright 2026 OpenSourceOM
// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import vercel from '@astrojs/vercel';

export default defineConfig({
  site: 'https://opensourceom.org',
  output: 'static',
  adapter: vercel(),
  integrations: [sitemap()],
  markdown: {
    shikiConfig: {
      theme: 'github-dark',
    },
  },
});
