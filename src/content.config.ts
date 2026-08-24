// Copyright 2026 OpenSourceOM
// SPDX-License-Identifier: Apache-2.0
import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ base: './src/content/blog', pattern: '**/*.md' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date().optional(),
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
  }),
});

export const collections = { blog };
