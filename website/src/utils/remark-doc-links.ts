import type { Root } from 'mdast'
import { visit } from 'unist-util-visit'
import config from '../../website.config'

/**
 * Rewrites the relative links the docs were written with into absolute site
 * paths.
 *
 * Markdown files link to each other the way they sit on disk
 * (`./installation`, `../server/tools#options`), which the previous docs engine
 * resolved from the file path. Resolving them here keeps the sources portable
 * (they stay readable and clickable on GitHub) while the published HTML gets
 * links that never depend on a trailing slash.
 *
 * A link climbing above the collection root points at the repository rather
 * than at a page, so it becomes a GitHub URL.
 */

/** `/blog/<slug>/index.mdx` and `/docs/a/b.mdx` both reduce to their URL path. */
function pageUrl(filePath: string): { url: string; collection: string } | null {
  const match = filePath
    .replace(/\\/g, '/')
    .match(/\/src\/content\/([^/]+)\/(.+)$/)
  if (!match) return null

  const [, collection, rest] = match
  const withoutExt = rest.replace(/\.(md|mdx)$/, '')
  // `index` names its folder rather than a page inside it.
  const slug = withoutExt.replace(/(^|\/)index$/, '')
  const base = collection === 'pages' ? '' : `/${collection}`

  return { url: slug ? `${base}/${slug}` : base, collection }
}

export default function remarkDocLinks() {
  return (tree: Root, file: { path?: string }) => {
    if (!file.path) return
    const page = pageUrl(file.path)
    if (!page) return

    // Relative links resolve from the folder holding the page, which for an
    // `index` file is the page URL itself.
    const isIndex = /(^|\/)index\.(md|mdx)$/.test(file.path.replace(/\\/g, '/'))
    const dir = isIndex ? page.url : page.url.replace(/\/[^/]*$/, '')

    // A link may never climb above the collection it belongs to.
    const root = page.collection === 'pages' ? '' : page.collection

    visit(tree, 'link', (node) => {
      const url = node.url
      // `.` and `..` alone name the folder page, which the browser would
      // otherwise resolve to a trailing slash URL.
      if (!/^\.\.?(\/|#|$)/.test(url)) return

      const [target, hash] = url.split('#')
      const segments = dir.split('/').filter(Boolean)

      for (const segment of target.split('/')) {
        if (segment === '.' || segment === '') continue
        if (segment === '..') segments.pop()
        else segments.push(segment)
      }

      // Out of the collection: the target is a file in the repository, not a
      // page. Those links were written against the folder layout of the repo,
      // so send the reader to GitHub.
      if (root && segments[0] !== root) {
        const path = segments.filter((segment) => segment !== root).join('/')
        node.url = `${config.github}/blob/main/${path}`
        return
      }

      const path = `/${segments.join('/')}`.replace(/\.(md|mdx)$/, '')
      node.url = hash ? `${path}#${hash}` : path
    })
  }
}
