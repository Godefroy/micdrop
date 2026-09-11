# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Working rules

- Never read `.env`. You can read `.env.example`.
- Don't co-author git commits with Claude.
- Never commit or push without explicit user approval, even for small follow-up fixes. One approval covers one commit, not the whole session.
- Before committing changes to a package in `packages/`, propose a version bump for each modified package. A pushed version bump publishes it to npm (`.github/workflows/publish.yml`).
- Commit on the current branch. When already on `main` and the user hasn't asked for a branch, commit directly on `main` (don't auto-create a branch).
- Never use Claude's user/project memory. When asked to remember something, add a minimal instruction here in `CLAUDE.md` (or in the relevant skill under `.claude/skills/`).
- Instruction files (`CLAUDE.md`, skills) hold instructions, not history. No account of what went wrong, no commit SHAs, no "the mistake made". Write the rule, keep it short and actionable.
- A one-off correction is not a permanent rule. Ask before turning a single request into doctrine.

## Typescript Formatting

Follow this Prettierformatting for all Typescript code.

```json
{
  "semi": false,
  "singleQuote": true,
  "trailingComma": "es5"
}
```

## Monorepo Structure

This is a pnpm monorepo with packages in `packages/`, examples in `examples/`, and the public site in `website/`. Each package can be developed independently by running `pnpm dev` in the package directory.

### Core Architecture

- **@micdrop/client**: Browser library handling microphone input, audio playback, and WebSocket communication with the server
- **@micdrop/server**: Server implementation orchestrating audio streaming and AI integration
- **Agent System**: Abstract base class for LLM agents with conversation management and event handling
- **Modular AI Providers**: Separate packages for OpenAI, ElevenLabs, Cartesia, Mistral, and Gladia integrations

`@micdrop/web` and `@micdrop/react-native` are the two platform layers over the
same client. Any improvement to one goes to the other, packages and examples
alike, and both are published together.

### Key Components

**MicdropClient** (`packages/client/src/client/MicdropClient.ts`):

- Manages WebSocket connection, microphone, and speaker
- Handles voice activity detection (VAD) and real-time audio streaming
- Emits state changes and manages conversation flow
- Key states: `isListening`, `isProcessing`, `isUserSpeaking`, `isAssistantSpeaking`

**MicdropServer** (`packages/server/src/MicdropServer.ts`):

- Orchestrates STT, Agent, and TTS components
- Handles WebSocket communication with clients
- Manages conversation flow and audio streaming
- Supports interruption and cancellation

**Agent** (`packages/server/src/agent/Agent.ts`):

- Abstract base class for AI agents with conversation management
- Emits events: `Message`, `CancelLastUserMessage`, `SkipAnswer`, `EndCall`
- Maintains conversation history and handles streaming responses

## Package Development

Each package uses:

- TypeScript with `tsconfig.json`
- Build tool: `tsup` (configured in `tsup.config.ts`)
- Output directory: `dist/`

When working on AI integrations, follow the established patterns:

- STT implements the `STT` interface with `transcribe()` method
- TTS implements the `TTS` interface with `speak()` method
- Agents extend the `Agent` base class and implement `answer()` and `cancel()`

## Website (`website/`)

Astro 6 + MDX + Tailwind v4 site, built from the
[lonestone/astro-template](https://github.com/lonestone/astro-template) starter
and reduced to a single language (no locale prefix in URLs). Content lives in
Git as markdown, there is no backend. Commands:
`pnpm --filter @micdrop/website dev | build | typecheck`.

The rules below are the template's conventions, adapted to this repository.

### Content and routing

- URLs carry no language prefix. There is no `translations` collection and no
  `src/utils/i18n.ts`; UI strings are written directly in the components.
- Collections are `docs`, `blog`, `authors` and `pages` (`src/content.config.ts`).
- Docs: the file path is the URL (`docs/client/vad.mdx` → `/docs/client/vad`) and
  each folder is a sidebar group whose `index.mdx` is the page it links to. The
  tree is built in `src/utils/docs-tree.ts`.
- `order` in the docs frontmatter is numbered once across the whole sidebar, not
  restarted per folder: a group sits where its first page sits.
- **Every content file is `.mdx`**, in all four collections. Never add a `.md`
  under `src/content/`, so any page can call a component without being renamed.
  MDX parses stricter than Markdown: outside code fences, `{` opens a JS
  expression and `<` opens a tag, and HTML comments are invalid (use
  `{/* … */}`). The build resolves relative
  links (`src/utils/remark-doc-links.ts`), turns `:::tip` fences into callouts
  (`remark-admonitions.ts`), renders ` ```mermaid ` blocks in the browser, and
  drops the leading `# Title` since the layout renders the frontmatter title
  (`remark-strip-title.ts`).
- Header and footer links live in `src/navigation.ts`, site-wide values in
  `website.config.ts`.

### MDX discipline

MDX files are **pure content**: frontmatter, markdown, and component calls with
simple props.

- No `import` statements (every component in `src/components/` is auto-discovered).
- No `export const` or script blocks.
- No raw HTML tags (`<div>`, `<section>`, `<h2>`, `<p>`, `<img>`). Use markdown
  syntax or components.
- No `class`, `style`, or `<style>`. Styling lives in components.
- No JSON arrays or JS logic. Write data as repeated component calls.
- Images: markdown syntax `![alt](./image.jpg)` with files co-located in the
  content folder. Astro handles the import.
- Callouts: `<Callout type="info|warning|tip">`. Buttons: `<Button>` with the
  `label` prop, not children.

When a page needs a new visual treatment, build a component in
`src/components/` with a clean prop surface, then call it from MDX. Prefer props
over Fragment slots for simple strings; reserve slots for rich content.

### Components and styling

- Keep page-specific copy out of reusable components. It belongs in MDX files
  (or in `src/pages/` for the few Astro-only pages).
- Accessibility: interactive elements need `tabindex`, `aria-label`, and both
  `onclick` and `onkeydown` handlers when appropriate.
- Event handlers: name with a `handle` prefix (`handleClick`, `handleKeyDown`).
- The site is dark by default with a light mode, switched by `data-theme` on
  `<html>`. Use the semantic tokens (`bg-bg-main`, `text-text-secondary`,
  `border-border`, `text-primary`) or the `ai-*` palette rather than raw colors,
  so both themes stay right.
- Markdown styles target the `.md` class (added by
  `src/utils/rehype-md-class.ts`). Don't restyle markdown elements globally,
  component markup must stay unaffected.

### Maintenance reflexes

- Renaming or deleting a page: add a redirect. One-to-one redirects go in
  `src/redirects.ts`; patterns Astro cannot emit go in `public/_redirects`
  (Netlify syntax).
- The published URL set must stay a superset of the one the previous Docusaurus
  site served. Check `dist/sitemap-0.xml` after a build.
- Clearing the Astro cache means `node_modules/.astro` too, not only `.astro`.
  Stale renders survive otherwise, which hides changes to the remark plugins.
- When you remove an import, check whether the source file is still referenced
  anywhere. If not, delete it (and follow its own imports).
- The astro dev server normally already runs on the port set in
  `astro.config.ts` (`server.port`). Use that port only. If nothing responds
  there, start it; if it responds but is broken, kill it and restart it. Never
  start it on another port.
- `astrocms.json` drives the bundled CMS UI. Keep `contentDir`, `contentConfig`,
  `assetsDir` and `componentsDir` in sync if those paths move.

## Contents

Don't use em dashes (—) or simple dashes (-) as punctuation, use different formulation.

Prefer positive formulations over negative ones. Avoid label-colon patterns like
"Objectif :", "Result:", "Avantage :"; integrate the information into the
sentence.
