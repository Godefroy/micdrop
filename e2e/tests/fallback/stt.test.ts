import { GladiaSTT } from '@micdrop/gladia'
import { OpenaiSTT } from '@micdrop/openai'
import { FallbackSTT } from '@micdrop/server'
import { INVALID_KEY, key } from '../../src/env.js'
import { describeSTT } from '../../src/scenarios/stt.js'

// The first provider refuses its key, so every utterance goes to the second
describeSTT('FallbackSTT from a refused Gladia to OpenAI', {
  keys: ['OPENAI_API_KEY'],
  create: () =>
    new FallbackSTT({
      factories: [
        () =>
          new GladiaSTT({ apiKey: INVALID_KEY, maxRetry: 0, retryDelay: 100 }),
        () => new OpenaiSTT({ apiKey: key('OPENAI_API_KEY'), language: 'en' }),
      ],
    }),
})
