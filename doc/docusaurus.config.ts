import type * as Preset from '@docusaurus/preset-classic'
import type { Config } from '@docusaurus/types'
import { themes as prismThemes } from 'prism-react-renderer'

const config: Config = {
  title: 'Micdrop',
  tagline: 'Real-time voice conversations with AI in the browser',
  favicon: 'img/favicon.svg',

  url: 'https://micdrop.dev',
  baseUrl: '/',

  organizationName: 'lonestone',
  projectName: 'micdrop',

  onBrokenLinks: 'warn',
  onBrokenMarkdownLinks: 'warn',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/Godefroy/micdrop/tree/main/doc',
          showLastUpdateAuthor: true,
          showLastUpdateTime: true,
        },
        blog: {
          showReadingTime: true,
          editUrl: 'https://github.com/Godefroy/micdrop/tree/main/doc',
        },
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/micdrop-social-card.jpg',
    navbar: {
      title: 'Micdrop',
      logo: {
        alt: 'Micdrop Logo',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'sidebar',
          position: 'left',
          label: 'Documentation',
        },
        // { to: '/blog', label: 'Blog', position: 'left' },
        {
          href: 'https://github.com/Godefroy/micdrop',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Documentation',
          items: [
            {
              label: 'Getting Started',
              to: '/docs/getting-started',
            },
          ],
        },
        {
          title: 'Packages',
          items: [
            {
              label: 'Client',
              to: '/docs/client',
            },
            {
              label: 'Server',
              to: '/docs/server',
            },
            {
              label: 'React Hooks',
              to: '/docs/client/react-hooks',
            },
          ],
        },
        {
          title: 'AI Integrations',
          items: [
            {
              label: 'OpenAI',
              to: '/docs/ai-integration/provided-integrations/openai',
            },
            {
              label: 'ElevenLabs',
              to: '/docs/ai-integration/provided-integrations/elevenlabs',
            },
            {
              label: 'Gladia',
              to: '/docs/ai-integration/provided-integrations/gladia',
            },
            {
              label: 'Cartesia',
              to: '/docs/ai-integration/provided-integrations/cartesia',
            },
            {
              label: 'Mistral',
              to: '/docs/ai-integration/provided-integrations/mistral',
            },
          ],
        },
        {
          title: 'More',
          items: [
            {
              label: 'Blog',
              to: '/blog',
            },
            {
              label: 'GitHub',
              href: 'https://github.com/Godefroy/micdrop',
            },
            {
              label: 'Lonestone',
              href: 'https://lonestone.io',
            },
          ],
        },
      ],
      copyright: `Made by <a href="https://lonestone.io">Lonestone</a> • MIT License`,
    },
    prism: {
      theme: prismThemes.oneLight,
      darkTheme: prismThemes.oneDark,
      additionalLanguages: ['bash', 'json'],
    },
    colorMode: {
      defaultMode: 'dark',
      disableSwitch: false,
      respectPrefersColorScheme: false,
    },
    algolia: {
      appId: 'DXD2XNHHEN',
      apiKey: '48321ed44b3c849280be207db9260d46',
      indexName: 'Micdrop Documentation',
      contextualSearch: true,
      searchParameters: {},
      searchPagePath: 'search',
    },
  } satisfies Preset.ThemeConfig,

  themes: ['@docusaurus/theme-mermaid'],
  markdown: {
    mermaid: true,
  },

  plugins: ['./plugins/tailwind-plugin.js'],
}

export default config
