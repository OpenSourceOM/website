#!/usr/bin/env node
// Copyright 2026 OpenSourceOM
// SPDX-License-Identifier: Apache-2.0
/**
 * Editorial lastmod dates for the sitemap. Do not use build time or git mtime —
 * Google treats those as untrustworthy when they jump on every deploy.
 *
 * Blogs: updatedDate, else pubDate, from frontmatter.
 * /blog/: newest indexed post date (the listing itself changed).
 * Other routes: STATIC_LASTMOD — bump the date only when that page's copy changes.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BLOG_DIR = join(ROOT, 'src/content/blog');
const DATE_RE = /^(\d{4}-\d{2}-\d{2})/;

/** @type {Record<string, string>} */
export const STATIC_LASTMOD = {
  '/': '2026-08-24',
  '/contact/': '2026-08-26',
  '/docs/': '2026-08-24',
  '/docs/getting-started/': '2026-08-24',
  '/docs/architecture/': '2026-08-24',
  '/docs/the-graph/': '2026-08-24',
  '/docs/open-source/': '2026-08-26',
};

/**
 * @param {string} raw
 * @returns {string | undefined}
 */
export function parseIsoDate(raw) {
  const match = DATE_RE.exec(raw.trim());
  return match?.[1];
}

/**
 * @param {string} frontmatter
 * @param {string} key
 * @returns {string | undefined}
 */
export function frontmatterDate(frontmatter, key) {
  const match = new RegExp(`^${key}:\\s*['"]?([^\\s#'"]+)`, 'm').exec(frontmatter);
  return match ? parseIsoDate(match[1]) : undefined;
}

/**
 * @param {string} frontmatter
 * @param {string} key
 * @returns {boolean}
 */
export function frontmatterFlag(frontmatter, key) {
  return new RegExp(`^${key}:\\s*true\\s*$`, 'm').test(frontmatter);
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {string}
 */
export function maxIsoDate(a, b) {
  return a >= b ? a : b;
}

/**
 * @typedef {{
 *   slug: string;
 *   pathname: string;
 *   noindex: boolean;
 *   draft: boolean;
 *   pubDate?: string;
 *   updatedDate?: string;
 *   lastmod?: string;
 * }} BlogDateEntry
 */

/**
 * @returns {BlogDateEntry[]}
 */
export function loadBlogDateEntries() {
  return readdirSync(BLOG_DIR)
    .filter((file) => file.endsWith('.md'))
    .map((file) => {
      const slug = file.replace(/\.md$/, '');
      const frontmatter = readFileSync(join(BLOG_DIR, file), 'utf8').split('---')[1] ?? '';
      const pubDate = frontmatterDate(frontmatter, 'pubDate');
      const updatedDate = frontmatterDate(frontmatter, 'updatedDate');
      const lastmod = updatedDate ?? pubDate;
      return {
        slug,
        pathname: `/blog/${slug}/`,
        noindex: frontmatterFlag(frontmatter, 'noindex'),
        draft: frontmatterFlag(frontmatter, 'draft'),
        pubDate,
        updatedDate,
        lastmod,
      };
    });
}

/**
 * Pathname → YYYY-MM-DD for sitemap lastmod.
 * @returns {Map<string, string>}
 */
export function buildLastmodByPath() {
  /** @type {Map<string, string>} */
  const lastmodByPath = new Map(Object.entries(STATIC_LASTMOD));
  const indexed = loadBlogDateEntries().filter((entry) => !entry.noindex && !entry.draft);

  let latestBlog;
  for (const entry of indexed) {
    if (!entry.lastmod) continue;
    lastmodByPath.set(entry.pathname, entry.lastmod);
    lastmodByPath.set(entry.pathname.replace(/\/$/, ''), entry.lastmod);
    latestBlog = latestBlog ? maxIsoDate(latestBlog, entry.lastmod) : entry.lastmod;
  }

  if (latestBlog) {
    lastmodByPath.set('/blog/', latestBlog);
    lastmodByPath.set('/blog', latestBlog);
  }

  return lastmodByPath;
}

/**
 * @param {string} pageUrl
 * @param {Map<string, string>} lastmodByPath
 * @returns {string | undefined}
 */
export function lastmodForUrl(pageUrl, lastmodByPath) {
  try {
    const pathname = new URL(pageUrl).pathname;
    return lastmodByPath.get(pathname);
  } catch {
    return undefined;
  }
}

export function noindexBlogPathnames() {
  const paths = new Set();
  for (const entry of loadBlogDateEntries()) {
    if (!entry.noindex) continue;
    paths.add(entry.pathname);
    paths.add(entry.pathname.replace(/\/$/, ''));
  }
  return paths;
}
