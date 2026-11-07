import { GeminiAgent } from '@micdrop/gemini'
import { key } from '../../src/env.js'
import { describeAgent } from '../../src/scenarios/agent.js'

describeAgent('GeminiAgent', {
  keys: ['GEMINI_API_KEY'],
  create: (options) =>
    new GeminiAgent({
      apiKey: key('GEMINI_API_KEY'),
      model: 'gemini-3.5-flash-lite',
      ...options,
    }),
})
