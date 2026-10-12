// Copyright 2026 OpenSourceOM
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertRemovedBlog,
  buildRemovedBlogRoutes,
  goneRouteSources,
  insertRemovedBlogRoutes,
  liveBlogSlugs,
  loadRemovedBlog,
  matchRoute,
} from './removed-blog.mjs';

const data = loadRemovedBlog();
const live = liveBlogSlugs();

test('removed slugs do not overlap live posts and redirects resolve', () => {
  assertRemovedBlog(data, live);
  assert.equal(data.gone.length, 232);
  assert.deepEqual(data.redirects, {
    'aws-rds-database-security-guide': '/blog/aws-rds-security-guide/',
  });
});

test('gone route sources stay within the Vercel src limit', () => {
  const sources = goneRouteSources(data.gone);
  assert.ok(sources.length >= 2);
  for (const src of sources) {
    assert.ok(src.length <= 4096, `src length ${src.length}`);
    assert.match(src, /^\^\/blog\/\(\?:/);
    assert.match(src, /\)\/\?\$/);
  }
});

test('removed URLs return 410 and the RDS duplicate redirects', () => {
  const routes = insertRemovedBlogRoutes(
    [{ handle: 'filesystem' }, { src: '/.*', dest: '/404.html', status: 404 }],
    data,
  );
  const fileExists = (pathname) => pathname === '/blog/aws-rds-security-guide/' || pathname === '/blog/aws-rds-security-guide';

  const gone = matchRoute(routes, '/blog/aws-acm-security-guide/');
  assert.equal(gone?.status, 410);
  assert.equal(gone?.dest, '/410.html');
  assert.equal(matchRoute(routes, '/blog/aws-acm-security-guide')?.status, 410);

  const redirect = matchRoute(routes, '/blog/aws-rds-database-security-guide/');
  assert.equal(redirect?.status, 301);
  assert.equal(redirect?.headers.Location, '/blog/aws-rds-security-guide/');

  assert.equal(matchRoute(routes, '/blog/aws-rds-security-guide/', { fileExists })?.status, 200);
  assert.equal(matchRoute(routes, '/blog/not-a-removed-or-live-post/')?.status, 404);
  assert.equal(matchRoute(routes, '/410.html')?.status, 410);
  assert.equal(matchRoute(routes, '/blog/')?.status, 404);

  const filesystem = routes.findIndex((route) => route.handle === 'filesystem');
  assert.ok(filesystem > 0);
  assert.ok(routes.slice(0, filesystem).every((route) => route.status === 410 || route.status === 301));
});

test('built routes do not match a live slug', () => {
  const routes = buildRemovedBlogRoutes(data);
  for (const slug of live) {
    const hit = matchRoute(routes, `/blog/${slug}/`);
    assert.equal(hit, undefined, slug);
  }
});
