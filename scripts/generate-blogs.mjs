#!/usr/bin/env node
/**
 * FROZEN 2026-08-30.
 *
 * Do not mint templated *-security-guide posts. Google is already sampling
 * near-duplicate pages onto page 1; more volume dilutes crawl and quality.
 * Rewrite operator-grade guides by hand (see the five page-1 rewrites).
 */
console.error(`generate-blogs.mjs is frozen (2026-08-30).

Do not generate templated blog posts. Rewrite unique, operator-grade
guides by hand. Do not pass --count or --skip-existing to bypass this.
`);
process.exit(1);
