#!/usr/bin/env node
// Copyright 2026 OpenSourceOM
// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLastmodByPath, lastmodForUrl, parseIsoDate } from './content-dates.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sitemapPath = join(ROOT, 'dist/client/sitemap-0.xml');
const xml = readFileSync(sitemapPath, 'utf8');
const lastmodByPath = buildLastmodByPath();

const urls = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((match) => {
  const block = match[1];
  const loc = block.match(/<loc>([^<]+)<\/loc>/)?.[1];
  const lastmod = block.match(/<lastmod>([^<]+)<\/lastmod>/)?.[1];
  return { loc, lastmod };
});

if (urls.length === 0) {
  console.error(`No <url> entries in ${sitemapPath}`);
  process.exit(1);
}

const missing = [];
const mismatched = [];

for (const { loc, lastmod } of urls) {
  if (!loc) continue;
  if (!lastmod) {
    missing.push(loc);
    continue;
  }
  const expected = lastmodForUrl(loc, lastmodByPath);
  if (expected && parseIsoDate(lastmod) !== expected) {
    mismatched.push(`${loc}: sitemap=${lastmod} expected=${expected}`);
  }
}

if (missing.length > 0 || mismatched.length > 0) {
  if (missing.length > 0) {
    console.error(`Missing <lastmod> (${missing.length}):\n${missing.join('\n')}`);
  }
  if (mismatched.length > 0) {
    console.error(`lastmod mismatch:\n${mismatched.join('\n')}`);
  }
  process.exit(1);
}

console.log(`Sitemap lastmod OK for ${urls.length} URLs.`);
