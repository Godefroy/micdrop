import type { AstroUserConfig } from 'astro'

type Redirects = NonNullable<AstroUserConfig['redirects']>

/**
 * Static redirects compiled into the build (each becomes a 301 HTML page).
 * For wildcard patterns use public/_redirects instead.
 */
export const redirects: Redirects = {
  // The docs have no landing page of their own, the first chapter is it.
  '/docs': '/docs/getting-started',
  // Search now lives in the header rather than on a page of its own.
  '/search': '/',
  // The blog index lists every post, so it stands in for the old archive.
  '/blog/archive': '/blog',
  // Posts are no longer classified by tag. The per-tag URLs need a wildcard,
  // which only Netlify understands, see public/_redirects.
  '/blog/tags': '/blog',
  // Choosing a local model is now one page per part of the call, and the
  // overview lists the three.
  '/docs/ai-integration/local-models/choosing-models':
    '/docs/local-models',
  // The AI integrations are grouped by part of the call rather than by kind of
  // integration. Providers covering several parts keep a page of their own.
  '/docs/ai-integration/provided-integrations/ai-sdk':
    '/docs/agents/ai-sdk',
  '/docs/ai-integration/provided-integrations/cartesia':
    '/docs/text-to-speech/cartesia',
  '/docs/ai-integration/provided-integrations/elevenlabs':
    '/docs/text-to-speech/elevenlabs',
  '/docs/ai-integration/provided-integrations/gladia':
    '/docs/speech-to-text/gladia',
  '/docs/ai-integration/provided-integrations/kokoro':
    '/docs/text-to-speech/kokoro',
  '/docs/ai-integration/provided-integrations/phonon':
    '/docs/text-to-speech/phonon',
  '/docs/ai-integration/provided-integrations/piper':
    '/docs/text-to-speech/piper',
  '/docs/ai-integration/provided-integrations/pocket-tts':
    '/docs/text-to-speech/pocket-tts',
  '/docs/ai-integration/provided-integrations/qwen-tts':
    '/docs/text-to-speech/qwen-tts',
  '/docs/ai-integration/provided-integrations/typesafe':
    '/docs/classifiers/jev',
  '/docs/ai-integration/provided-integrations/whisper':
    '/docs/speech-to-text/whisper',
  '/docs/ai-integration/provided-integrations/gemini':
    '/docs/text-to-speech/gemini',
  '/docs/ai-integration/provided-integrations/openai':
    '/docs/agents/openai',
  '/docs/ai-integration/provided-integrations/mistral':
    '/docs/agents/mistral',
  '/docs/ai-integration/provided-integrations/gradium':
    '/docs/text-to-speech/gradium',
  '/docs/ai-integration/custom-integrations/custom-agent':
    '/docs/agents/custom',
  '/docs/ai-integration/custom-integrations/custom-stt':
    '/docs/speech-to-text/custom',
  '/docs/ai-integration/custom-integrations/custom-tts':
    '/docs/text-to-speech/custom',
  '/docs/ai-integration/custom-integrations/custom-classifier':
    '/docs/classifiers/custom',
  '/docs/ai-integration/fallback-strategies/agent-fallback':
    '/docs/agents/fallback',
  '/docs/ai-integration/fallback-strategies/stt-fallback':
    '/docs/speech-to-text/fallback',
  '/docs/ai-integration/fallback-strategies/tts-fallback':
    '/docs/text-to-speech/fallback',
  // The AI integrations then moved to the root of the docs, one folder per
  // part of the call, and the realtime and classifier guides joined them.
  '/docs/ai-integration':
    '/docs/providers',
  '/docs/ai-integration/local-models':
    '/docs/local-models',
  '/docs/ai-integration/local-models/agent':
    '/docs/local-models/agent',
  '/docs/ai-integration/local-models/explorations':
    '/docs/local-models/explorations',
  '/docs/ai-integration/local-models/explorations/auk':
    '/docs/local-models/explorations/auk',
  '/docs/ai-integration/local-models/explorations/minicpm':
    '/docs/local-models/explorations/minicpm',
  '/docs/ai-integration/local-models/explorations/minicpm-v':
    '/docs/local-models/explorations/minicpm-v',
  '/docs/ai-integration/local-models/explorations/mistral-7b':
    '/docs/local-models/explorations/mistral-7b',
  '/docs/ai-integration/local-models/explorations/voxtral-stt':
    '/docs/local-models/explorations/voxtral-stt',
  '/docs/ai-integration/local-models/explorations/voxtral-tts':
    '/docs/local-models/explorations/voxtral-tts',
  '/docs/ai-integration/local-models/performance':
    '/docs/local-models/performance',
  '/docs/ai-integration/local-models/speech-to-text':
    '/docs/local-models/speech-to-text',
  '/docs/ai-integration/local-models/text-to-speech':
    '/docs/local-models/text-to-speech',
  '/docs/ai-integration/sovereign-voice-ai':
    '/docs/providers/sovereign-voice-ai',
  '/docs/server/classifier':
    '/docs/classifiers',
  '/docs/server/realtime':
    '/docs/realtime',
}
