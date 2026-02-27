import type { SidebarsConfig } from '@docusaurus/plugin-content-docs'

const sidebars: SidebarsConfig = {
  sidebar: [
    'getting-started',
    {
      type: 'category',
      label: 'Client (Browser)',
      link: {
        type: 'doc',
        id: 'client/index',
      },
      items: [
        'client/installation',
        'client/react-hooks',
        'client/start-stop-call',
        'client/pause-resume-call',
        'client/mute-unmute-call',
        'client/call-state',
        'client/display-conversation-messages',
        'client/handling-tool-calls',
        'client/devices-management',
        'client/vad',
        'client/error-handling',
        {
          type: 'category',
          label: 'Utility Classes',
          items: [
            'client/utility-classes/mic',
            'client/utility-classes/micdrop-client',
            'client/utility-classes/mic-recorder',
            'client/utility-classes/speaker',
          ],
        },
      ],
    },
    {
      type: 'category',
      label: 'Server (Node.js)',
      link: {
        type: 'doc',
        id: 'server/index',
      },
      items: [
        'server/installation',
        'server/with-fastify',
        'server/with-nestjs',
        'server/auth-and-parameters',
        'server/first-message',
        'server/save-messages',
        'server/recording-audio',
        'server/error-handling',
        'server/tools',
        'server/extract',
        'server/auto-end-call',
        'server/semantic-turn-detection',
        'server/noise-filtering',
        'server/protocol',
      ],
    },
    {
      type: 'category',
      label: 'AI Integrations',
      link: {
        type: 'doc',
        id: 'ai-integration/index',
      },
      items: [
        {
          type: 'category',
          label: 'Provided Integrations',
          items: [
            'ai-integration/provided-integrations/ai-sdk',
            'ai-integration/provided-integrations/cartesia',
            'ai-integration/provided-integrations/elevenlabs',
            'ai-integration/provided-integrations/gladia',
            'ai-integration/provided-integrations/gradium',
            'ai-integration/provided-integrations/mistral',
            'ai-integration/provided-integrations/openai',
          ],
        },
        {
          type: 'category',
          label: 'Custom Integrations',
          items: [
            'ai-integration/custom-integrations/custom-agent',
            'ai-integration/custom-integrations/custom-stt',
            'ai-integration/custom-integrations/custom-tts',
          ],
        },
        {
          type: 'category',
          label: 'Fallback Strategies',
          items: [
            'ai-integration/fallback-strategies/stt-fallback',
            'ai-integration/fallback-strategies/tts-fallback',
          ],
        },
        'ai-integration/sovereign-voice-ai',
      ],
    },
  ],
}

export default sidebars
