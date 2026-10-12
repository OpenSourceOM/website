#!/usr/bin/env node
// Copyright 2026 OpenSourceOM
// SPDX-License-Identifier: Apache-2.0
/**
 * Patch the Vercel build output so removed blog URLs return 410, and the
 * RDS duplicate URL redirects to the guide that replaced it.
 * Astro's static adapter serves unknown paths as 404 and cannot set 410.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertRemovedBlog,
  insertRemovedBlogRoutes,
  liveBlogSlugs,
  loadRemovedBlog,
} from './removed-blog.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = join(ROOT, '.vercel/output/config.json');
const GONE_PAGE = join(ROOT, '.vercel/output/static/410.html');

const data = loadRemovedBlog();
assertRemovedBlog(data, liveBlogSlugs());

if (!existsSync(CONFIG_PATH)) {
  console.error(`Missing ${CONFIG_PATH}. Run astro build first.`);
  process.exit(1);
}
if (!existsSync(GONE_PAGE)) {
  console.error(`Missing ${GONE_PAGE}. public/410.html was not copied into the build.`);
  process.exit(1);
}

const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
if (!Array.isArray(config.routes)) {
  console.error(`${CONFIG_PATH} has no routes array`);
  process.exit(1);
}

if (config.routes.some((route) => route.status === 410 && route.dest === '/410.html')) {
  console.log('Removed-blog routes already applied');
  process.exit(0);
}

config.routes = insertRemovedBlogRoutes(config.routes, data);
writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);

const goneRoutes = config.routes.filter((route) => route.status === 410 && route.src.startsWith('^/blog/'));
const redirects = config.routes.filter((route) => route.status === 301);
console.log(
  `Removed-blog routes: ${data.gone.length} URLs as 410 across ${goneRoutes.length} rules, ${redirects.length} redirect`,
);
