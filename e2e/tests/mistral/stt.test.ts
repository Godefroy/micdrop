import { MistralSTT } from '@micdrop/mistral'
import { key } from '../../src/env.js'
import { describeSTT } from '../../src/scenarios/stt.js'

describeSTT('MistralSTT', {
  keys: ['MISTRAL_API_KEY'],
  websocket: true,
  create: (overrides = {}) =>
    new MistralSTT({ apiKey: key('MISTRAL_API_KEY'), ...overrides }),
})
