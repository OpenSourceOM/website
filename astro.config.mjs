// Copyright 2026 OpenSourceOM
// SPDX-License-Identifier: Apache-2.0
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, envField } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import vercel from '@astrojs/vercel';

const SITE = 'https://opensourceom.org';

function noindexBlogPathnames() {
  const dir = join(process.cwd(), 'src/content/blog');
  const paths = new Set();
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.md')) continue;
    const frontmatter = readFileSync(join(dir, file), 'utf8').split('---')[1] ?? '';
    if (!/^noindex:\s*true\s*$/m.test(frontmatter)) continue;
    const slug = file.replace(/\.md$/, '');
    paths.add(`/blog/${slug}/`);
    paths.add(`/blog/${slug}`);
  }
  return paths;
}

const noindexBlogPages = noindexBlogPathnames();

export default defineConfig({
  site: SITE,
  output: 'static',
  adapter: vercel(),
  integrations: [
    sitemap({
      filter: (page) => {
        try {
          return !noindexBlogPages.has(new URL(page).pathname);
        } catch {
          return true;
        }
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
