import { CartesiaTTS } from '@micdrop/cartesia'
import { OpenaiTTS } from '@micdrop/openai'
import { FallbackTTS } from '@micdrop/server'
import { INVALID_KEY, key } from '../../src/env.js'
import { describeTTS } from '../../src/scenarios/tts.js'

// The first provider refuses its key, so every answer goes to the second
describeTTS('FallbackTTS from a refused Cartesia to OpenAI', {
  keys: ['OPENAI_API_KEY'],
  create: () =>
    new FallbackTTS({
      factories: [
        () =>
          new CartesiaTTS({
            apiKey: INVALID_KEY,
            voiceId: 'none',
            modelId: 'sonic-3.6',
            maxRetry: 0,
            retryDelay: 100,
          }),
        () => new OpenaiTTS({ apiKey: key('OPENAI_API_KEY'), voice: 'marin' }),
      ],
    }),
})
