#!/usr/bin/env node
// Copyright 2026 OpenSourceOM
// SPDX-License-Identifier: Apache-2.0
/**
 * On pull requests, require indexed blog edits to bump updatedDate (or set
 * pubDate on new posts). Sitemap lastmod is derived from those fields.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { frontmatterDate, frontmatterFlag } from './content-dates.mjs';

const base = process.env.BLOG_DATE_BASE_SHA ?? '';
const head = process.env.BLOG_DATE_HEAD_SHA ?? 'HEAD';

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

function gitQuiet(args) {
  try {
    execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

function changedBlogFiles() {
  return git(['diff', '--name-only', '-z', base, head])
    .split('\0')
    .filter((path) => path.startsWith('src/content/blog/') && path.endsWith('.md'));
}

function frontmatterAt(ref, path) {
  try {
    return git(['show', `${ref}:${path}`]).split('---')[1] ?? '';
  } catch {
    return '';
  }
}

function lastmodDate(frontmatter) {
  return frontmatterDate(frontmatter, 'updatedDate') ?? frontmatterDate(frontmatter, 'pubDate');
}

function isDateOnlyDiff(path) {
  return git(['diff', '-U0', base, head, '--', path])
    .split('\n')
    .filter((line) => (line.startsWith('+') || line.startsWith('-')) && !line.startsWith('+++') && !line.startsWith('---'))
    .every((line) => /^(?:\+|-)updatedDate:/.test(line));
}

if (!base) {
  console.log('No base SHA; skipping updatedDate check (push / local).');
  process.exit(0);
}

const problems = [];

for (const path of changedBlogFiles()) {
  const nextFm = readFileSync(path, 'utf8').split('---')[1] ?? '';
  if (frontmatterFlag(nextFm, 'noindex') || frontmatterFlag(nextFm, 'draft')) continue;

  const nextDate = lastmodDate(nextFm);
  if (!nextDate) {
    problems.push(`${path}: indexed posts need pubDate (and updatedDate when you edit them).`);
    continue;
  }

  const prevFm = frontmatterAt(base, path);
  if (!prevFm) continue;
  if (frontmatterFlag(prevFm, 'noindex') || frontmatterFlag(prevFm, 'draft')) continue;
  if (gitQuiet(['diff', '--quiet', base, head, '--', path])) continue;
  if (isDateOnlyDiff(path)) continue;

  const prevDate = lastmodDate(prevFm);
  if (!prevDate) continue;
  if (nextDate <= prevDate) {
    problems.push(
      `${path}: content changed but lastmod date did not increase (was ${prevDate ?? 'unset'}, now ${nextDate}). Set updatedDate to today's UTC date (YYYY-MM-DD).`
    );
  }
}

if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}

console.log('Blog lastmod dates look consistent with the diff.');
