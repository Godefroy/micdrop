import { MistralAgent } from '@micdrop/mistral'
import { key } from '../../src/env.js'
import { describeAgent } from '../../src/scenarios/agent.js'

describeAgent('MistralAgent', {
  keys: ['MISTRAL_API_KEY'],
  create: (options) =>
    new MistralAgent({
      apiKey: key('MISTRAL_API_KEY'),
      model: 'mistral-medium-latest',
      ...options,
    }),
})
