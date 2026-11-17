/**
 * Site navigation, in one place.
 *
 * The header, the mobile menu and the footer all read from here, so adding a
 * section to the site means adding a single entry below. The docs sidebar is
 * built from the content itself, see `src/utils/docs-tree.ts`.
 */
import config from '../website.config'

export interface NavLink {
  label: string
  href: string
  /** Section root for the active state, when the link points deeper than it. */
  match?: string
  external?: boolean
}

/** Header links, left to right. Also drives the mobile drawer. */
export const mainNav: NavLink[] = [
  { label: 'Documentation', href: '/docs/getting-started', match: '/docs' },
  { label: 'Blog', href: '/blog' },
]

/** Footer columns. */
export const footerNav: { title: string; links: NavLink[] }[] = [
  {
    title: 'Documentation',
    links: [
      { label: 'Getting Started', href: '/docs/getting-started' },
      { label: 'Examples', href: '/docs/examples' },
      { label: 'Client', href: '/docs/client' },
      { label: 'React Native', href: '/docs/react-native' },
      { label: 'Server', href: '/docs/server' },
      { label: 'Migration', href: '/docs/migration' },
      { label: 'React Hooks', href: '/docs/client/react-hooks' },
    ],
  },
  {
    title: 'AI Integrations',
    links: [
      { label: 'Speech to Text', href: '/docs/speech-to-text' },
      { label: 'Text to Speech', href: '/docs/text-to-speech' },
      { label: 'LLM (Agent)', href: '/docs/agents' },
      { label: 'Realtime', href: '/docs/realtime' },
      { label: 'Classifiers', href: '/docs/classifiers' },
      { label: 'Providers', href: '/docs/providers' },
    ],
  },
  {
    title: 'Local Models',
    links: [
      { label: 'Running Locally', href: '/docs/local-models' },
      {
        label: 'Whisper',
        href: '/docs/speech-to-text/whisper',
      },
      {
        label: 'Kokoro',
        href: '/docs/text-to-speech/kokoro',
      },
      {
        label: 'Piper',
        href: '/docs/text-to-speech/piper',
      },
      {
        label: 'Pocket TTS',
        href: '/docs/text-to-speech/pocket-tts',
      },
      {
        label: 'Qwen3-TTS',
        href: '/docs/text-to-speech/qwen-tts',
      },
    ],
  },
  {
    title: 'More',
    links: [
      { label: 'Blog', href: '/blog' },
      { label: 'GitHub', href: config.github, external: true },
    ],
  },
]
