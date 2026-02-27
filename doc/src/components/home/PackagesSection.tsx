import Heading from '@theme/Heading'

export function PackagesSection() {
  return (
    <section className="container">
      <div className="text-center mb-8">
        <Heading as="h2" className="text-3xl font-bold mb-4">
          📦 Packages
        </Heading>
        <p className="text-ai-surface-700 dark:text-ai-surface-300 text-lg">
          Modular architecture with specialized packages for different use cases
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 mb-8">
        {/* Core Packages */}
        <div className="ai-card text-center">
          <h3 className="dark:text-ai-primary-300 font-bold text-xl mb-4">
            Core Packages
          </h3>
          <p className="text-ai-surface-700 dark:text-ai-surface-300">
            Essential packages for browser and server-side implementation
          </p>
          <div className="flex flex-wrap justify-center gap-2 mb-4">
            <a href="/docs/client" className="ai-badge-core">
              @micdrop/client
            </a>
            <a href="/docs/server" className="ai-badge-core">
              @micdrop/server
            </a>
          </div>
        </div>

        {/* AI Integrations */}
        <div className="ai-card text-center">
          <h3 className="dark:text-ai-primary-300 font-bold text-xl mb-4">
            AI Integrations
          </h3>
          <p className="text-ai-surface-700 dark:text-ai-surface-300">
            Ready-to-use integrations with popular AI providers
          </p>
          <div className="flex flex-wrap justify-center gap-2 mb-4">
            <a
              href="/docs/ai-integration/provided-integrations/openai"
              className="ai-badge-ai"
            >
              @micdrop/openai
            </a>
            <a
              href="/docs/ai-integration/provided-integrations/ai-sdk"
              className="ai-badge-ai"
            >
              @micdrop/ai-sdk
            </a>
            <a
              href="/docs/ai-integration/provided-integrations/elevenlabs"
              className="ai-badge-ai"
            >
              @micdrop/elevenlabs
            </a>
            <a
              href="/docs/ai-integration/provided-integrations/cartesia"
              className="ai-badge-ai"
            >
              @micdrop/cartesia
            </a>
            <a
              href="/docs/ai-integration/provided-integrations/gradium"
              className="ai-badge-ai"
            >
              @micdrop/gradium
            </a>
            <a
              href="/docs/ai-integration/provided-integrations/mistral"
              className="ai-badge-ai"
            >
              @micdrop/mistral
            </a>
            <a
              href="/docs/ai-integration/provided-integrations/gladia"
              className="ai-badge-ai"
            >
              @micdrop/gladia
            </a>
          </div>
        </div>

        {/* Utilities */}
        <div className="ai-card text-center">
          <h3 className="dark:text-ai-primary-300 font-bold text-xl mb-4">
            Utilities
          </h3>
          <p className="text-ai-surface-700 dark:text-ai-surface-300">
            React hooks and utilities for seamless frontend integration
          </p>
          <div className="flex flex-wrap justify-center gap-2 mb-4">
            <a href="/docs/client/react-hooks" className="ai-badge-utility">
              @micdrop/react
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
