import Link from '@docusaurus/Link'
import useDocusaurusContext from '@docusaurus/useDocusaurusContext'
import Heading from '@theme/Heading'
import { FaGithub } from 'react-icons/fa'
import { HomeCode } from './HomeCode'

export function HomeHeader() {
  const { siteConfig } = useDocusaurusContext()
  return (
    <header className="hero hero--primary py-16 text-center relative bg-grid">
      <div className="absolute inset-0 bg-gradient-to-br from-ai-surface-50 via-ai-surface-100 to-ai-surface-50 dark:from-ai-surface-950 dark:via-ai-surface-900 dark:to-ai-surface-950"></div>
      <div className="container mx-auto px-4 relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-top max-w-6xl mx-auto">
          <div className="text-left lg:pt-16">
            <Heading
              as="h1"
              className="text-5xl font-black mb-4 bg-gradient-to-r from-ai-primary-400 via-ai-primary-300 to-ai-accent-400 bg-clip-text text-transparent animate-text-glow"
            >
              🖐️🎤 {siteConfig.title}
            </Heading>
            <p className="text-2xl text-ai-surface-700 dark:text-ai-surface-200 mb-8">
              {siteConfig.tagline}
            </p>
            <p className="text-lg leading-relaxed text-ai-surface-700 dark:text-ai-surface-200 mb-8">
              Integrate a powerful voice mode in your webapp with a few lines of
              code using Micdrop. Use provided AI integrations (agents, STT,
              TTS) or build your own. Build the best UX with our SDK.
            </p>
            <div className="flex flex-wrap gap-4">
              <Link className="ai-button" to="/docs/getting-started">
                Start Building (5 min)
              </Link>
              <Link
                className="ai-button-secondary"
                to="https://github.com/Godefroy/micdrop"
                target="_blank"
              >
                <FaGithub className="mr-2" />
                View on GitHub
              </Link>
            </div>
            <p className="text-sm text-ai-surface-500 dark:text-ai-surface-400 mt-4">
              Free, open source (MIT). Bring your own API keys (BYOK).
            </p>
          </div>
          <HomeCode />
        </div>
      </div>
    </header>
  )
}
