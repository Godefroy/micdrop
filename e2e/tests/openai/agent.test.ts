import { OpenaiAgent } from '@micdrop/openai'
import { key } from '../../src/env.js'
import { describeAgent } from '../../src/scenarios/agent.js'

describeAgent('OpenaiAgent', {
  keys: ['OPENAI_API_KEY'],
  create: (options) =>
    new OpenaiAgent({
      apiKey: key('OPENAI_API_KEY'),
      model: 'gpt-5.4-mini',
      ...options,
    }),
})
