import { defineConfig } from 'astro/config'
import { unified } from '@astrojs/markdown-remark'
import mdx, { type MdxOptions } from '@astrojs/mdx'
import netlify from '@astrojs/netlify'
import sitemap from '@astrojs/sitemap'
import tailwindcss from '@tailwindcss/vite'
import expressiveCode from 'astro-expressive-code'
import rehypeExternalLinks from 'rehype-external-links'
import rehypeMermaid from 'rehype-mermaid'
import { redirects } from './src/redirects'
import { contentLastmod } from './src/utils/content-lastmod'
import rehypeMdClass from './src/utils/rehype-md-class'
import { getExternalLinkRel } from './src/utils/external-links'
import remarkAdmonitions from './src/utils/remark-admonitions'
import remarkDocLinks from './src/utils/remark-doc-links'
import remarkStripTitle from './src/utils/remark-strip-title'
import enrichMd from './src/integrations/enrich-md'
import config from './website.config'

const { site } = config

// Drives `.md` files. `pre-mermaid` leaves a `<pre class="mermaid">` rendered
// client-side by `src/scripts/mermaid.ts`, so no Playwright is needed at build
// time. It runs before `rehypeMdClass` so the diagram `<pre>` also gets `.md`,
// and before Expressive Code, which then finds no `<code>` left to highlight.
const processor = unified({
  remarkPlugins: [remarkStripTitle, remarkAdmonitions, remarkDocLinks],
  rehypePlugins: [
    [rehypeMermaid, { strategy: 'pre-mermaid' }],
    rehypeMdClass,
    [rehypeExternalLinks, { target: '_blank', rel: getExternalLinkRel }],
  ],
  gfm: true,
})

export default defineConfig({
  site,
  adapter: netlify({
    // Netlify's on-demand image service only exists on their production
    // runtime, so `pnpm dev` would otherwise get broken image URLs.
    imageCDN: process.env.NODE_ENV === 'production',
    edgeMiddleware: false,
  }),
  output: 'static',
  trailingSlash: 'never',
  build: { format: 'file' },
  redirects,
  server: {
    // Fixed so several sites can run side by side on the same machine.
    port: 6105,
  },
  markdown: { processor },
  integrations: [
    // Every code block on the site: the markdown fences and the `<Code>` of the
    // hero. Options live in ec.config.mjs, which `<Code>` loads on its own.
    expressiveCode(),
    // mdx@5 reads only its own options, so the pipeline is repeated here for
    // `.mdx` files. Reading it back off the processor is what matters: `unified()`
    // copies the arrays it receives and integrations append to those copies
    // during `astro:config:setup`, which is how Expressive Code lands on MDX
    // pages. `gfm` is explicit for the same reason, a custom processor hides the
    // default Astro would otherwise pass on (dropping remark-gfm breaks tables).
    mdx({
      remarkPlugins: processor.options
        .remarkPlugins as MdxOptions['remarkPlugins'],
      rehypePlugins: processor.options
        .rehypePlugins as MdxOptions['rehypePlugins'],
      gfm: true,
    }),
    sitemap({
      // Date of the last commit on each page's source, so a crawler (and an agent
      // ranking what to read first) can tell what actually moved since last time.
      serialize: (item) => {
        item.lastmod = contentLastmod(new URL(item.url).pathname)
        return item
      },
    }),
    enrichMd(),
  ],
  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: {
      // Pre-bundled rather than discovered on the fly: both load lazily, and a
      // mid-session re-optimize hands the page that asked for them a stale
      // module (504 Outdated Optimize Dep).
      include: ['mermaid', '@docsearch/js'],
    },
  },
})
