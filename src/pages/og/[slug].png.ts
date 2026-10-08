// Copyright 2026 OpenSourceOM
// SPDX-License-Identifier: Apache-2.0
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { ogKicker, renderOgPng } from '@/lib/og-card';

export async function getStaticPaths() {
  const posts = await getCollection('blog', ({ data }) => !data.draft);
  return posts.map((post) => ({
    params: { slug: post.id },
    props: {
      title: post.data.title,
      description: post.data.description,
      kicker: ogKicker(post.data.tags, post.data.focusKeyword),
    },
  }));
}

export const GET: APIRoute<{ title: string; description: string; kicker: string }> = async ({
  props,
}) => {
  const png = await renderOgPng(props);
  return new Response(new Uint8Array(png), {
    headers: { 'Content-Type': 'image/png' },
  });
};
