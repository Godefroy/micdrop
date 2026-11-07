import { OpenaiRealtime } from '@micdrop/openai'
import { key } from '../../src/env.js'
import { describeRealtime } from '../../src/scenarios/realtime.js'

describeRealtime('OpenaiRealtime', {
  keys: ['OPENAI_API_KEY'],
  create: (options) =>
    new OpenaiRealtime({
      apiKey: key('OPENAI_API_KEY'),
      model: 'gpt-realtime-mini',
      language: 'en',
      ...options,
    }),
})
