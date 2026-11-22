import type { AstroIntegration } from 'astro'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { redirects } from '../redirects'

/**
 * Rewrites `dist/_redirects` for Cloudflare, which reads it before serving any
 * asset: the exact redirects of `src/redirects.ts` become real 301s (instead of
 * the meta refresh page Astro generates), followed by the rules of
 * `public/_redirects`.
 *
 * Cloudflare applies every rule before the assets, so the `!` of a forced rule
 * is dropped. It has no conditions (`Language=`, `Country=`) nor rewrites with
 * an error status (`/en/*  /en/404  404`), so those lines are left out: the root
 * language redirect is done by the Worker (`worker/index.ts`), and a missing
 * page gets the nearest `404.html` up its path (`not_found_handling`).
 */
/** An internal page path, as opposed to a file (`/favicon.png`) or an external URL. */
const isPage = (path: string) => path.startsWith('/') && !/[.?#]/.test(path)

/** Redirects, plus 200 for a rewrite to another path of the site. */
const SUPPORTED = ['200', '301', '302', '303', '307', '308']

export default function cloudflareRedirects(): AstroIntegration {
  return {
    name: 'cloudflare-redirects',
    hooks: {
      'astro:build:done': ({ dir, logger }) => {
        const file = fileURLToPath(new URL('_redirects', dir))

        const exact = Object.entries(redirects).flatMap(([from, to]) => {
          const destination = typeof to === 'string' ? to : to.destination
          const rules = [`${encodeURI(from)} ${encodeURI(destination)} 301`]
          // An agent asking for markdown is served `page.md` (zone rewrite
          // rule, see README.md), so the old page's twin redirects as well.
          if (isPage(from) && isPage(destination)) {
            const target = destination === '/' ? '/index' : destination
            rules.push(`${encodeURI(from)}.md ${encodeURI(target)}.md 301`)
          }
          return rules
        })

        const copied = existsSync(file)
          ? readFileSync(file, 'utf-8').split('\n')
          : []
        const kept: string[] = []
        for (const line of copied) {
          const rule = line.trim()
          if (!rule || rule.startsWith('#')) continue
          const [from, to, status = '301', ...rest] = rule.split(/\s+/)
          if (from === '/') continue
          const code = status.replace(/!$/, '')
          if (rest.length > 0 || !SUPPORTED.includes(code)) {
            logger.warn(`Left out, Cloudflare can't express it: ${rule}`)
            continue
          }
          kept.push(`${from} ${to} ${code}`)
        }

        writeFileSync(file, `${[...exact, ...kept].join('\n')}\n`)
      },
    },
  }
}
