import useDocusaurusContext from '@docusaurus/useDocusaurusContext'
import Layout from '@theme/Layout'
import { ArchitectureSection } from '../components/home/ArchitectureSection'
import { DemoSection } from '../components/home/DemoSection'
import { FeaturesSection } from '../components/home/FeaturesSection'
import { HomeHeader } from '../components/home/HomeHeader'
import { PackagesSection } from '../components/home/PackagesSection'
import { QuoteSection } from '../components/home/QuoteSection'
import { SovereignSection } from '../components/home/SovereignSection'

export default function Home(): JSX.Element {
  const { siteConfig } = useDocusaurusContext()
  return (
    <Layout
      title={`${siteConfig.title} - Real-time voice conversations with AI in the browser`}
      description="Integrate a powerful voice mode in your webapp with a few lines of code using Micdrop. Use provided AI integrations (agents, STT, TTS) or build your own. Build the best UX with our SDK."
    >
      <HomeHeader />
      <main className="flex flex-col gap-32 py-32 bg-ai-surface-100 dark:bg-ai-surface-900">
        <ArchitectureSection />
        <PackagesSection />
        <QuoteSection />
        <FeaturesSection />
        <SovereignSection />
        <DemoSection />
      </main>
    </Layout>
  )
}
