import type { AstroUserConfig } from 'astro'

type Redirects = NonNullable<AstroUserConfig['redirects']>

/**
 * Static redirects compiled into the build (each becomes a 301 HTML page).
 * For wildcard patterns use public/_redirects instead.
 */
export const redirects: Redirects = {
  // The docs have no landing page of their own, the first chapter is it.
  '/docs': '/docs/getting-started',
  // Search now lives in the header rather than on a page of its own.
  '/search': '/',
  // The blog index lists every post, so it stands in for the old archive.
  '/blog/archive': '/blog',
  // Posts are no longer classified by tag. The per-tag URLs need a wildcard,
  // which only Netlify understands, see public/_redirects.
  '/blog/tags': '/blog',
  // Choosing a local model is now one page per part of the call, and the
  // overview lists the three.
  '/docs/ai-integration/local-models/choosing-models':
    '/docs/ai-integration/local-models',
}
