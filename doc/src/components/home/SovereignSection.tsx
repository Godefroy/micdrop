import Heading from '@theme/Heading'
import Link from '@docusaurus/Link'

const providers = [
  {
    name: 'Mistral',
    role: 'Agent (LLM)',
    href: '/docs/ai-integration/provided-integrations/mistral',
    description: 'French LLM for conversational AI',
  },
  {
    name: 'Gladia',
    role: 'Speech-to-Text',
    href: '/docs/ai-integration/provided-integrations/gladia',
    description: 'French STT with 90+ languages',
  },
  {
    name: 'Gradium',
    role: 'Text-to-Speech',
    href: '/docs/ai-integration/provided-integrations/gradium',
    description: 'French TTS with natural voices',
  },
]

export function SovereignSection() {
  return (
    <section className="container max-w-4xl px-4">
      <div className="text-center mb-10">
        <div className="text-4xl mb-4">
          <span title="France">🇫🇷</span>{' '}
          <span title="European Union">🇪🇺</span>
        </div>
        <Heading as="h2" className="text-3xl font-bold mb-4">
          Build Sovereign Voice AI
        </Heading>
        <p className="text-ai-surface-700 dark:text-ai-surface-300 text-lg max-w-2xl mx-auto">
          Micdrop is the perfect solution to build{' '}
          <strong>sovereign voice AI applications</strong>, especially in
          French. Combine European AI providers to keep your data and
          infrastructure fully within EU borders.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {providers.map((provider) => (
          <Link
            key={provider.name}
            to={provider.href}
            className="ai-card text-center hover:no-underline group"
          >
            <h3 className="dark:text-ai-primary-300 font-bold text-xl mb-1 group-hover:text-ai-primary-400">
              {provider.name}
            </h3>
            <p className="text-sm text-ai-primary-600 dark:text-ai-primary-400 font-medium mb-2">
              {provider.role}
            </p>
            <p className="text-ai-surface-700 dark:text-ai-surface-300 text-sm">
              {provider.description}
            </p>
          </Link>
        ))}
      </div>

      <div className="text-center">
        <p className="text-ai-surface-600 dark:text-ai-surface-400 mb-4">
          100% open-source stack. No data leaves the EU. Full GDPR compliance.
        </p>
        <Link
          to="/docs/ai-integration/sovereign-voice-ai"
          className="ai-button-secondary"
        >
          Learn more about sovereign voice AI
        </Link>
      </div>
    </section>
  )
}
