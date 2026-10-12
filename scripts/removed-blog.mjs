#!/usr/bin/env node
// Copyright 2026 OpenSourceOM
// SPDX-License-Identifier: Apache-2.0
/**
 * Routes for blog URLs removed on purpose (templated noindex posts).
 * Google still requests them. 410 tells it the removal is permanent.
 * One duplicate URL 301s to the guide that replaced it.
 *
 * Vercel route `src` is limited to 4096 characters, so gone slugs are split.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_PATH = join(ROOT, 'src/data/removed-blog.json');
const BLOG_DIR = join(ROOT, 'src/content/blog');

/** Stay under the Build Output API max length of 4096. */
export const MAX_ROUTE_SRC = 4000;
const SLUG_RE = /^[a-z0-9-]+$/;
const PREFIX = '^/blog/(?:';
const SUFFIX = ')/?$';

/**
 * @typedef {{ redirects: Record<string, string>, gone: string[] }} RemovedBlog
 */

/** @returns {RemovedBlog} */
export function loadRemovedBlog() {
  const data = JSON.parse(readFileSync(DATA_PATH, 'utf8'));
  if (!data || typeof data.redirects !== 'object' || !Array.isArray(data.gone)) {
    throw new Error(`${DATA_PATH} must have redirects and gone`);
  }
  return data;
}

/** @returns {Set<string>} */
export function liveBlogSlugs() {
  return new Set(
    readdirSync(BLOG_DIR)
      .filter((name) => name.endsWith('.md'))
      .map((name) => name.slice(0, -3)),
  );
}

/**
 * @param {RemovedBlog} data
 * @param {Set<string>} live
 */
export function assertRemovedBlog(data, live) {
  const seen = new Set();
  for (const slug of data.gone) {
    if (!SLUG_RE.test(slug)) throw new Error(`Invalid gone slug: ${slug}`);
    if (seen.has(slug)) throw new Error(`Duplicate gone slug: ${slug}`);
    if (live.has(slug)) throw new Error(`Gone slug still has a post: ${slug}`);
    if (data.redirects[slug]) throw new Error(`Slug is both gone and redirected: ${slug}`);
    seen.add(slug);
  }
  for (const [slug, destination] of Object.entries(data.redirects)) {
    if (!SLUG_RE.test(slug)) throw new Error(`Invalid redirect slug: ${slug}`);
    if (live.has(slug)) throw new Error(`Redirect slug still has a post: ${slug}`);
    const match = /^\/blog\/([a-z0-9-]+)\/$/.exec(destination);
    if (!match || !live.has(match[1])) {
      throw new Error(`Redirect for ${slug} does not point at a live post: ${destination}`);
    }
  }
}

/**
 * @param {string[]} slugs
 * @returns {string[]}
 */
export function goneRouteSources(slugs) {
  /** @type {string[]} */
  const sources = [];
  /** @type {string[]} */
  let batch = [];
  let length = PREFIX.length + SUFFIX.length;

  for (const slug of slugs) {
    const extra = slug.length + (batch.length > 0 ? 1 : 0);
    if (batch.length > 0 && length + extra > MAX_ROUTE_SRC) {
      sources.push(PREFIX + batch.join('|') + SUFFIX);
      batch = [slug];
      length = PREFIX.length + SUFFIX.length + slug.length;
    } else {
      batch.push(slug);
      length += extra;
    }
  }
  if (batch.length > 0) sources.push(PREFIX + batch.join('|') + SUFFIX);
  return sources;
}

const GONE_HEADERS = {
  'X-Robots-Tag': 'noindex',
  'Cache-Control': 'public, max-age=86400',
};

/**
 * @param {RemovedBlog} data
 */
export function buildRemovedBlogRoutes(data) {
  const redirects = Object.entries(data.redirects).map(([slug, destination]) => ({
    src: `^/blog/${slug}/?$`,
    status: 301,
    headers: { Location: destination },
  }));
  const gone = goneRouteSources(data.gone).map((src) => ({
    src,
    dest: '/410.html',
    status: 410,
    headers: GONE_HEADERS,
  }));
  const self = {
    src: '^/410\\.html$',
    dest: '/410.html',
    status: 410,
    headers: GONE_HEADERS,
  };
  const routes = [...redirects, ...gone, self];
  for (const route of routes) {
    if (route.src.length > 4096) {
      throw new Error(`Route src is ${route.src.length} characters; Vercel allows 4096`);
    }
  }
  return routes;
}

/**
 * Insert before the filesystem handler so these statuses win over a static file.
 *
 * @param {Array<Record<string, unknown>>} routes
 * @param {RemovedBlog} data
 */
export function insertRemovedBlogRoutes(routes, data) {
  const filesystem = routes.findIndex((route) => route.handle === 'filesystem');
  if (filesystem === -1) {
    throw new Error('Vercel routes have no filesystem handler');
  }
  const next = routes.slice();
  next.splice(filesystem, 0, ...buildRemovedBlogRoutes(data));
  return next;
}

/**
 * @param {Array<Record<string, any>>} routes
 * @param {string} pathname
 * @param {{ fileExists?: (pathname: string) => boolean }} [options]
 */
export function matchRoute(routes, pathname, options = {}) {
  const fileExists = options.fileExists ?? (() => false);
  for (const route of routes) {
    if (route.handle === 'filesystem') {
      if (fileExists(pathname)) return { handle: 'filesystem', status: 200 };
      continue;
    }
    if (route.handle) continue;
    if (typeof route.src === 'string' && new RegExp(route.src).test(pathname)) return route;
  }
  return undefined;
}
