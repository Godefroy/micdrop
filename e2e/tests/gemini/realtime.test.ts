import { GeminiLive } from '@micdrop/gemini'
import { key } from '../../src/env.js'
import { describeRealtime } from '../../src/scenarios/realtime.js'

describeRealtime('GeminiLive', {
  keys: ['GEMINI_API_KEY'],
  create: (options) =>
    new GeminiLive({
      apiKey: key('GEMINI_API_KEY'),
      model: 'gemini-3.8-live',
      ...options,
    }),
})
