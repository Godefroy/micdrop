# Micdrop website

Marketing site and documentation for [Micdrop](https://micdrop.dev), built with
**Astro 6**, **MDX** and **Tailwind CSS v4**, deployed on Cloudflare by GitHub Actions (`.github/workflows/deploy-website.yml`). Content lives
in Git as markdown; there is no database, no server and no CMS backend.

Started from the [lonestone/astro-template](https://github.com/lonestone/astro-template)
starter, reduced to a single language (no locale prefix in URLs).

## Commands

Run from the repository root or from this folder.

```bash
pnpm --filter @micdrop/website dev        # http://localhost:6105
pnpm --filter @micdrop/website build      # static build into dist/
pnpm --filter @micdrop/website preview    # serve the build
pnpm --filter @micdrop/website typecheck  # astro check
pnpm --filter @micdrop/website astrocms   # bundled content editor UI
```

## Where things live

| What                                | Where                                     |
| ----------------------------------- | ----------------------------------------- |
| Site URL, brand, repo links         | `website.config.ts`                       |
| Header and footer links             | `src/navigation.ts`                       |
| Documentation                       | `src/content/docs/**/*.md`                |
| Blog posts                          | `src/content/blog/<slug>/index.md`        |
| Blog authors                        | `src/content/authors.yaml`                |
| Homepage and editorial pages        | `src/content/pages/*.mdx`                 |
| Collection schemas                  | `src/content.config.ts`                   |
| Theme tokens and markdown styles    | `src/styles/global.css`                   |
| Components usable from MDX          | `src/components/*.astro`                  |
| Redirects                           | `src/redirects.ts`, `public/_redirects`   |

## Documentation

Each file under `src/content/docs` becomes a page at the same path
(`docs/client/vad.md` → `/docs/client/vad`), and each folder becomes a sidebar
group. A folder's `index.md` is the page its group links to.

```yaml
---
title: 'Voice Activity Detection (VAD)'
description: 'Detect when the user speaks, in the browser.'
order: 12 # position across the whole sidebar
---
```

A group sits where its first page sits, so `order` is numbered once across the
whole sidebar rather than restarted inside each folder. Use `sidebarLabel` when
the title reads long in the rail.

Docs are plain markdown and stay readable on GitHub:

- relative links (`./installation`, `../server/tools#options`) are resolved to
  absolute site paths at build time by `src/utils/remark-doc-links.ts`;
- `:::tip` / `:::note` / `:::warning` blocks become callouts;
- ` ```mermaid ` blocks are rendered in the browser, on the pages that use them;
- the leading `# Title` is dropped from the page, which shows the frontmatter
  title instead.

## Blog

One folder per post, images alongside it:

```
src/content/blog/my-post/
  index.md
  thumbnail.jpg
```

```yaml
---
title: 'My post'
summary: 'One-line summary shown on the index card.'
date: 2026-03-03
author: godefroy # key in src/content/authors.yaml
image: ./thumbnail.jpg
---
```

The blog index and the authors page are generated from these files.

## Search

Algolia DocSearch, in the header and on ⌘K, against the index the previous docs
site already used. Credentials live in `website.config.ts` and are search-only.
The crawler runs on Algolia's side; nothing here feeds it.

## Deployment

Cloudflare: a push to `main` touching `website/` builds the site in GitHub
Actions (`.github/workflows/deploy-website.yml`) and deploys `website/dist` with
`wrangler deploy` (`wrangler.jsonc`). The build writes `_redirects` (exact
redirects of `src/redirects.ts`, then `public/_redirects`) and the `_headers`
file that advertises the `.md` twin of every page. `pnpm build` then
`pnpm exec wrangler dev` serves `dist/` the way Cloudflare does. The Umami
variables are repository variables passed to the build.
