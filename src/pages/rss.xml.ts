// Copyright 2026 OpenSourceOM
// SPDX-License-Identifier: Apache-2.0
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

function escapeXml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function rfc822(date: Date) {
  return date.toUTCString();
}

export const GET: APIRoute = async ({ site }) => {
  const origin = site ?? new URL('https://opensourceom.org');
  const posts = (await getCollection('blog', ({ data }) => !data.draft && !data.noindex)).sort(
    (a, b) => {
      const aDate = a.data.updatedDate ?? a.data.pubDate;
      const bDate = b.data.updatedDate ?? b.data.pubDate;
      return (bDate?.getTime() ?? 0) - (aDate?.getTime() ?? 0);
    }
  );

  const newest = posts[0]?.data.updatedDate ?? posts[0]?.data.pubDate ?? new Date();

  const items = posts
    .map((post) => {
      const url = new URL(`/blog/${post.id}/`, origin).href;
      const date = post.data.updatedDate ?? post.data.pubDate;
      return `    <item>
      <title>${escapeXml(post.data.title)}</title>
      <link>${escapeXml(url)}</link>
      <guid>${escapeXml(url)}</guid>
      <description>${escapeXml(post.data.description)}</description>
      ${date ? `<pubDate>${rfc822(date)}</pubDate>` : ''}
    </item>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>OpenSourceOM blog</title>
    <link>${escapeXml(new URL('/blog/', origin).href)}</link>
    <description>Cloud security, CSPM, CNAPP, and attack-path articles from OpenSourceOM.</description>
    <lastBuildDate>${rfc822(newest)}</lastBuildDate>
${items}
  </channel>
</rss>
`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
    },
  });
};
