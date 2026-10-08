import { defineCollection } from 'astro:content'
import { file, glob } from 'astro/loaders'
import { z } from 'astro/zod'

/**
 * Documentation. Folders become sidebar groups and the file path becomes the
 * URL (`docs/client/vad.mdx` → `/docs/client/vad`), so the tree on disk is the
 * tree in the navigation. See `src/utils/docs-tree.ts`.
 */
const docs = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/docs' }),
  schema: z.object({
    title: z.string(),
    // Meta description. Docs open on their own introduction, so this is not
    // repeated on the page itself.
    description: z.string().optional(),
    // Shorter label when the title reads long in the sidebar.
    sidebarLabel: z.string().optional(),
    // Position among siblings. Numbered across the whole sidebar, so a group
    // sits where its first page sits.
    order: z.number().optional(),
    // Set to false on titles that already name the brand, so the document
    // title is not suffixed with it twice.
    titleBrand: z.boolean().default(true),
    // Language of the page, declared in `<html lang>`, `og:locale` and the
    // JSON-LD. The site is in English, a few pages are written in French.
    lang: z.enum(['en', 'fr']).default('en'),
  }),
})

// Blog: one folder per article (`<slug>/index.mdx`) with its images alongside.
const blog = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/blog' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      // Optional SEO `<title>` / headline split: `title` stays the document
      // title and JSON-LD headline, `h1` overrides the visible on-page H1.
      h1: z.string().optional(),
      summary: z.string(),
      date: z.coerce.date().optional(),
      update: z.coerce.date().optional(),
      image: image().optional(),
      // Author key, resolved against the `authors` collection.
      author: z.string().optional(),
      // Extra keywords for the meta tag, kept from the previous docs site.
      keywords: z.array(z.string()).default([]),
      similarPosts: z.array(z.string()).optional(),
      // Key takeaways rendered as a highlighted box at the top of the article.
      takeaways: z.array(z.string()).default([]),
      // Drafts are excluded from the index and from the generated pages.
      draft: z.boolean().default(false),
      // Language of the page, as on `docs`.
      lang: z.enum(['en', 'fr']).default('en'),
    }),
})

// Blog authors, keyed by the value used in a post's `author` field.
const authors = defineCollection({
  loader: file('./src/content/authors.yaml'),
  schema: z.object({
    name: z.string(),
    url: z.string().optional(),
    imageUrl: z.string().optional(),
    title: z.string().optional(),
  }),
})

/**
 * Editorial pages, one file per URL. The slug `index` becomes the homepage.
 * Pages are MDX and hold nothing but component calls.
 */
const pages = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/pages' }),
  schema: z.object({
    title: z.string(),
    // Meta description, rendered by `BaseLayout` and the social preview.
    description: z.string().optional(),
    // Homepage and other full-bleed pages skip the prose container.
    fullWidth: z.boolean().default(false),
    titleBrand: z.boolean().default(true),
    // Language of the page, as on `docs`.
    lang: z.enum(['en', 'fr']).default('en'),
  }),
})

export const collections = { docs, blog, authors, pages }
