// Copyright 2026 OpenSourceOM
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLastmodByPath,
  frontmatterDate,
  lastmodForUrl,
  loadBlogDateEntries,
  maxIsoDate,
  parseIsoDate,
} from './content-dates.mjs';

test('parseIsoDate keeps calendar dates and drops time', () => {
  assert.equal(parseIsoDate('2026-09-18'), '2026-09-18');
  assert.equal(parseIsoDate('2026-09-18T12:00:00Z'), '2026-09-18');
  assert.equal(parseIsoDate('not-a-date'), undefined);
});

test('frontmatterDate reads YAML dates', () => {
  const fm = 'title: Hello\nupdatedDate: 2026-09-18\npubDate: 2026-08-27\n';
  assert.equal(frontmatterDate(fm, 'updatedDate'), '2026-09-18');
  assert.equal(frontmatterDate(fm, 'pubDate'), '2026-08-27');
});

test('maxIsoDate is lexicographic on ISO dates', () => {
  assert.equal(maxIsoDate('2026-08-27', '2026-09-18'), '2026-09-18');
});

test('indexed blogs have lastmod and /blog/ uses the newest', () => {
  const entries = loadBlogDateEntries().filter((entry) => !entry.noindex && !entry.draft);
  assert.ok(entries.length > 0);
  for (const entry of entries) {
    assert.ok(entry.lastmod, `${entry.slug} is indexed but has no pubDate/updatedDate`);
  }

  const lastmodByPath = buildLastmodByPath();
  const newest = entries.reduce((acc, entry) => maxIsoDate(acc, entry.lastmod), '1970-01-01');
  assert.equal(lastmodByPath.get('/blog/'), newest);
  assert.equal(lastmodByPath.get('/'), '2026-08-24');

  const sample = entries.find((entry) => entry.slug === 'agentless-vs-agent-cloud-security');
  assert.ok(sample);
  assert.equal(
    lastmodForUrl('https://opensourceom.org/blog/agentless-vs-agent-cloud-security/', lastmodByPath),
    sample.lastmod
  );
});
