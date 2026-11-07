import { GeminiSTT } from '@micdrop/gemini'
import { key } from '../../src/env.js'
import { describeSTT } from '../../src/scenarios/stt.js'

describeSTT('GeminiSTT', {
  keys: ['GEMINI_API_KEY'],
  websocket: true,
  create: (overrides = {}) =>
    new GeminiSTT({
      apiKey: key('GEMINI_API_KEY'),
      language: 'en',
      ...overrides,
    }),
})
