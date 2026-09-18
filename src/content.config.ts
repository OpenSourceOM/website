// Copyright 2026 OpenSourceOM
// SPDX-License-Identifier: Apache-2.0
import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ base: './src/content/blog', pattern: '**/*.md' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    /** First publish date. Required for indexed posts (sitemap lastmod fallback). */
    pubDate: z.coerce.date().optional(),
    /** Bump this (YYYY-MM-DD) when the article body or title changes — sitemap lastmod uses it. */
    updatedDate: z.coerce.date().optional(),
    author: z.string().default('OpenSourceOM Team'),
    tags: z.array(z.string()).default([]),
    /** Primary SEO keyword phrase */
    focusKeyword: z.string().optional(),
    faq: z
      .array(
        z.object({
          question: z.string(),
          answer: z.string(),
        })
      )
      .optional(),
    draft: z.boolean().default(false),
    /** When true, emit robots noindex and omit from the sitemap. */
    noindex: z.boolean().default(false),
  }).superRefine((data, ctx) => {
    if (!data.noindex && !data.draft && !data.pubDate) {
      ctx.addIssue({
        code: 'custom',
        path: ['pubDate'],
        message: 'Indexed posts require pubDate (YYYY-MM-DD) for sitemap lastmod.',
      });
    }
  }),
});

export const collections = { blog };
